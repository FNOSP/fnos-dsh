/**
 * ZCode Start Plan 执行通道：托管官方 `zcode app-server` 并把它接成 LLM 适配器。
 *
 * 为什么不是 HTTP：Start Plan 端点的请求由 agent 二进制自己构造（含客户端身份与
 * 请求签名），插件在 Node 侧复现不出来；直连会拿到业务码 3012 / 3007。这里改为
 * 「托管进程 + 协议」——模型请求由 agent 发出，插件只做三件事：注入账号、按需
 * 提供鉴权、把流式事件转成 DSH 的 chunk。
 *
 * 实测出来的三个硬前提（缺一个就静默卡住，不报错）：
 * 1. 子进程的数据目录必须**可写**。只读时 `session/send` 返回 accepted、状态变
 *    `running`，但永远没有 model 请求，也没有 `turn.failed`。
 * 2. `basedOnZCodeBuiltinRevision` 必须与实际加载的那份 `zcode-builtin.json`
 *    逐字符一致（`zcode-builtin:<revision>:<sha256(绝对路径)>`），否则账号注入
 *    被 registry 的合并守卫**静默丢弃**。
 * 3. `session/create` → `subscribe` → `setModel` → `send` 之间需要垫时间：零延迟
 *    提交的回合会被丢弃（send 返回 accepted、事件流为空）。
 *
 * @module dsh-zcode/bridge/adapter
 */

import { copyFileSync, mkdirSync, rmSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'

import { LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm'

import { ZCODE_PROVIDER, ZCODE_PROVIDER_NAME } from '../../contracts/identity.ts'
import {
  buildAppServerEnv,
  delay,
  ZCodeProtocolClient,
  type ZCodeBridgeLogger,
  type ZCodeNotification,
} from './protocol.ts'
import {
  isElectronHost,
  prepareBridgeDataDir,
  readBuiltinRevision,
  resolveBuiltinConfigPath,
  resolveZCodeCliPath,
  resolveZCodeNodePath,
  ZCODE_FALLBACK_APP_VERSION,
} from './runtime-paths.ts'
import {
  agentModelId,
  BRIDGE_TOOL_NOTE,
  BRIDGE_TOOL_RULE,
  flattenConversation,
  lastUserText,
  looksLikeLeakedCall,
  sanitizeLeakedCalls,
  titleSourceText,
} from './transcript.ts'

/** 宿主图片媒体类型到文件扩展名的映射（agent 需要扩展名才认得图片格式）。 */
const IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
}

/** 单回合默认超时：思考型模型的长回合不应被过早打断。 */
export const ZCODE_BRIDGE_TURN_TIMEOUT_MS = 900_000
/** 单次协议请求超时。 */
export const ZCODE_BRIDGE_REQUEST_TIMEOUT_MS = 120_000
/** 账号注入是异步注册，等它进 registry 再 `setModel`。 */
const REGISTRY_SETTLE_MS = 2_000
/** `setModel` 之后到提交提示之间的稳定期。 */
const TURN_SETTLE_MS = 1_500
/** 撞上未释放回合锁时，补发 `session/stop` 后的等待。 */
const STOP_SETTLE_MS = 1_500
/** 同一 DSH 会话排队等上一轮的上限。 */
const TURN_QUEUE_MAX_MS = 60_000

/** 上一轮没释放回合锁（被中止/超时）。 */
const STUCK_TURN = /already running|already in flight|still running|in progress|is busy/i

/** 账号家族。 */
export type ZCodeBridgeFamily = 'bigmodel' | 'zai'

/** 宿主侧的图片定位能力（只用到「取绝对路径」这一项）。 */
export interface ZCodeImageLocator {
  imageHostPath?: (ref: never) => string | undefined
}

/** 桥接适配器依赖。全部以函数注入，偏好/目录变化后下一次调用即生效。 */
export interface ZCodeBridgeAdapterOptions {
  /** CLI 路径；未配置时自动探测。 */
  readonly cliPath?: () => string | undefined
  /** 插件自有数据目录（可写）。 */
  readonly dataDir: () => string
  /** 运行 CLI 的 node 可执行文件。 */
  readonly nodePath?: () => string
  /** 账号家族，决定注入哪个 `account:<family>-start-plan`。 */
  readonly family: () => ZCodeBridgeFamily | Promise<ZCodeBridgeFamily>
  /** 账号 JWT；未登录返回 undefined。 */
  readonly accountJwt: () => Promise<string | undefined>
  /** 当前目录里的模型 id（用来生成注入的 `builtinModelIds`）。 */
  readonly modelIds: () => readonly string[]
  /** 取附件服务，用于把图片落成 agent 可 Read 的本地文件。 */
  readonly attachments?: () => ZCodeImageLocator | undefined
  readonly logger: ZCodeBridgeLogger
  readonly turnTimeoutMs?: number
  readonly requestTimeoutMs?: number
  /** 工作目录；缺省用数据目录下的 `workspace`。 */
  readonly workspacePath?: () => string | undefined
}

/**
 * 一个 DSH 会话对应的 agent 会话。
 *
 * `modelId` 与 `reasoningLevel` 一起记录：两者任一变化都要重切，否则 agent 会继续
 * 用旧的执行目标（用户改了思考等级却看不到任何差别）。
 */
interface BridgeSession {
  readonly sessionId: string
  firstTurn: boolean
  modelId: string
  reasoningLevel: 'low' | 'high' | 'max'
}

/** 回合收尾句柄：进程退出时立刻唤醒在途流。 */
interface StreamHandle {
  readonly onDeath: () => void
}

/** 一轮内排队的一条增量。 */
interface QueuedDelta {
  readonly kind: 'text' | 'reasoning'
  readonly text: string
}

/** 回合结论。 */
interface TurnOutcome {
  readonly response: string
  readonly resultType: string
  readonly usage: TokenUsage
  readonly error?: string
}

/**
 * 把 DSH 选择的思考等级投影成 agent 的 `reasoningLevel`。
 *
 * agent 只认 `low` / `high` / `max` 三档（Start Plan 的 GLM 系列一致），而 DSH
 * 提供七档，所以这里做归并而不是直传；关闭思考（`off`）也落到 `low`，
 * 因为该端点没有「不思考」这一档。
 */
export function reasoningLevelOf(effort: string | undefined): 'low' | 'high' | 'max' {
  switch (effort) {
    case 'off':
    case 'minimal':
    case 'low':
      return 'low'
    case 'medium':
    case 'high':
      return 'high'
    case 'xhigh':
    case 'max':
      return 'max'
    default:
      return 'max'
  }
}

/** 从 `session/event` 里读出类型与数据。 */
function eventPayload(message: ZCodeNotification): {
  type: string | undefined
  payload: Record<string, unknown>
} {
  const params = (message.params ?? {}) as Record<string, unknown>
  const payload = (params.payload ?? params) as Record<string, unknown>
  const type = typeof params.type === 'string'
    ? params.type
    : (typeof payload.type === 'string' ? payload.type : undefined)
  return { type, payload }
}

/** 把上游 usage 投影成 DSH 的 token 计数（字段是互斥的）。 */
function toUsage(raw: unknown): TokenUsage {
  const value = (raw ?? {}) as Record<string, unknown>
  const pick = (key: string): number | undefined => {
    const field = value[key]
    return typeof field === 'number' && Number.isFinite(field) ? field : undefined
  }
  const cacheRead = pick('cacheReadTokens')
  const cacheWrite = pick('cacheWriteTokens')
  const reasoning = pick('reasoningTokens')
  return {
    inputTokens: pick('inputTokens') ?? 0,
    outputTokens: pick('outputTokens') ?? 0,
    ...(pick('totalTokens') === undefined ? {} : { totalTokens: pick('totalTokens') as number }),
    ...(cacheRead === undefined ? {} : { cacheReadTokens: cacheRead }),
    ...(cacheWrite === undefined ? {} : { cacheWriteTokens: cacheWrite }),
    ...(reasoning === undefined ? {} : { reasoningTokens: reasoning }),
  }
}

/** 等 promise 落定，最多 `ms` 毫秒；超时不视为失败。 */
function settleWithin(promise: Promise<unknown>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    timer.unref?.()
    const done = (): void => {
      clearTimeout(timer)
      resolve()
    }
    promise.then(done, done)
  })
}

/**
 * `dsh-zcode` 的 Start Plan 执行通道。
 *
 * 只实现 `stream()`（`LlmAdapter` 的唯一抽象方法）；模型元数据由同一路由上的
 * pi-ai 适配器提供，两者共用目录快照，因此上下文窗口/思考等级在两通道一致。
 */
export class ZCodeBridgeAdapter extends LlmAdapter {
  private client: ZCodeProtocolClient | undefined
  private readonly sessions = new Map<string, BridgeSession>()
  private readonly turnLocks = new Map<string, Promise<void>>()
  private readonly activeStreams = new Set<StreamHandle>()
  private injectedSignature: string | undefined
  private dataDirPrepared: string | undefined
  /** 最近一次实际使用的端点与模型，供详情页诊断。 */
  private lastChannel: { providerId: string; modelId: string; baseURL: string } | undefined

  constructor(private readonly options: ZCodeBridgeAdapterOptions) {
    super()
  }

  /** 路由展示信息。 */
  override providerInfo(provider: string): { id: string; name: string } {
    return { id: provider, name: ZCODE_PROVIDER_NAME }
  }

  /** 最近一次执行的渠道（供诊断展示）。 */
  channel(): { providerId: string; modelId: string; baseURL: string } | undefined {
    return this.lastChannel
  }

  /** 终止子进程并让在途流收尾。 */
  dispose(): void {
    for (const handle of this.activeStreams) {
      try {
        handle.onDeath()
      } catch {
        // 单个流的收尾不影响其他。
      }
    }
    this.activeStreams.clear()
    this.sessions.clear()
    this.turnLocks.clear()
    this.client?.dispose()
    this.client = undefined
    this.injectedSignature = undefined
  }

  /** 该会话当前的 agent 模型 id（诊断用）。 */
  sessionModel(sessionKey: string): string | undefined {
    return this.sessions.get(sessionKey)?.modelId
  }

  /** 解析宿主实际可用的 CLI 路径。 */
  cliPath(): string | undefined {
    return resolveZCodeCliPath(this.options.cliPath?.())
  }

  /** 子进程运行所需的一切是否齐备；不齐备时给出可读原因。 */
  availability(): { readonly ready: boolean; readonly reason?: string } {
    if (this.cliPath() === undefined) {
      return {
        ready: false,
        reason: '未找到 ZCode 客户端自带的 CLI（zcode.cjs）；请安装 ZCode 客户端，'
          + '或把 DSH_ZCODE_CLI 指向该文件',
      }
    }
    return { ready: true }
  }

  private logger(): ZCodeBridgeLogger {
    return this.options.logger
  }

  /** 取（必要时创建）常驻客户端，并把账号注入到 registry。 */
  private async ensureClient(): Promise<ZCodeProtocolClient> {
    if (this.client !== undefined && this.client.isReady()) {
      await this.injectAccount()
      return this.client
    }
    const cliPath = this.cliPath()
    if (cliPath === undefined) {
      throw new LlmError(
        '未找到 ZCode 客户端自带的 CLI（zcode.cjs）。Start Plan 通道需要本机安装 ZCode 客户端；'
        + '也可用环境变量 DSH_ZCODE_CLI 指定该文件路径',
        'MISSING_CREDENTIAL',
      )
    }
    const jwt = await this.options.accountJwt()
    if (jwt === undefined || jwt.length === 0) {
      throw new LlmError('ZCode 凭据不可用：请先在插件详情页登录 ZCode 账号', 'MISSING_CREDENTIAL')
    }
    const family = await this.options.family()
    const dataDir = this.prepareDataDir(jwt, family)
    const builtinPath = resolveBuiltinConfigPath(cliPath)
    if (builtinPath === undefined) {
      throw new LlmError(
        `没找到客户端自带的 provider 配置（zcode-builtin.json）。请确认 ${cliPath} 来自完整安装的 ZCode 客户端`,
        'PROVIDER',
      )
    }

    const client = new ZCodeProtocolClient({
      nodePath: resolveZCodeNodePath(this.options.nodePath?.()),
      cliPath,
      cwd: dataDir,
      env: this.childEnv(dataDir, builtinPath),
      logger: this.logger(),
      handlers: { runtimeHeaders: params => this.runtimeHeaders(params, builtinPath, jwt) },
      requestTimeoutMs: this.options.requestTimeoutMs ?? ZCODE_BRIDGE_REQUEST_TIMEOUT_MS,
    })
    client.onExit = () => {
      if (this.sessions.size > 0) {
        this.logger().warn(`zcode: app-server 已退出，丢弃 ${String(this.sessions.size)} 个缓存会话`)
        this.sessions.clear()
      }
      for (const handle of this.activeStreams) {
        try {
          handle.onDeath()
        } catch {
          // 忽略单个流收尾异常。
        }
      }
    }
    this.client = client
    await client.ensureStarted()
    this.injectedSignature = undefined
    await this.injectAccount()
    return client
  }

  /** 写插件自有数据目录（幂等）。 */
  private prepareDataDir(jwt: string, family: ZCodeBridgeFamily): string {
    const dataDir = this.options.dataDir()
    const base = prepareBridgeDataDir({ dataDir, accountJwt: jwt, family })
    mkdirSync(join(base, 'workspace'), { recursive: true })
    if (this.dataDirPrepared !== base) {
      this.dataDirPrepared = base
      this.logger().info(`zcode: 插件数据目录 ${base}`)
    }
    return base
  }

  /**
   * 子进程环境：GUI 同款运行时定位 + 插件自有可写数据目录。
   *
   * 必须经 `buildAppServerEnv` 组包：宿主 env 里可能带着别的供应商密钥，要按白名单
   * 过滤；同时 `PATH` / `HOME` / `TMPDIR` / `NODE_EXTRA_CA_CERTS` 与
   * `ZCODE_CREDENTIAL_SECRET` 必须能到达子进程——凭据按该 secret 派生的指纹加密，
   * 子进程拿不到它就会用兜底指纹解密失败。
   */
  private childEnv(dataDir: string, builtinPath: string): NodeJS.ProcessEnv {
    return buildAppServerEnv({
      // Electron 宿主（DSH Desktop）下 `process.execPath` 是 Electron 二进制，
      // 必须让它以 node 身份运行，否则子进程会当成 GUI 应用启动并立即退出。
      ...(isElectronHost() ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
      ZCODE_SERVICE_AUTHORITY_MODE: 'desktop-local',
      ZCODE_APP_VERSION: ZCODE_FALLBACK_APP_VERSION,
      ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: builtinPath,
      ZCODE_PERSONAL_PROVIDER_CONFIG_FILE: join(dataDir, '.zcode', 'v2', 'provider_config.json'),
      ZCODE_BASE_URL: 'https://zcode.z.ai',
      ZCODE_DATA_BASE_DIR: dataDir,
      ZCODE_STORAGE_DIR: dataDir,
      ZCODE_SESSION_DB: join(dataDir, 'session.sqlite'),
    })
  }

  /** 注入账号；账号家族或模型集合变化时重注入。 */
  private async injectAccount(): Promise<void> {
    const client = this.client
    if (client === undefined) return
    const cliPath = this.cliPath()
    if (cliPath === undefined) return
    const builtinPath = resolveBuiltinConfigPath(cliPath)
    if (builtinPath === undefined) return
    const family = await this.options.family()
    const providerId = `account:${family}-start-plan`
    const modelIds = [...new Set(this.options.modelIds().map(agentModelId))]
    const signature = `${builtinPath}|${providerId}|${modelIds.join(',')}`
    if (this.injectedSignature === signature) return
    let basedOn: string
    try {
      basedOn = readBuiltinRevision(builtinPath)
    } catch (error) {
      this.logger().warn(
        `zcode: 读取 provider 配置 revision 失败：${error instanceof Error ? error.message : String(error)}`,
      )
      return
    }
    try {
      const result = await client.request('provider/updateAccountConfig', {
        revision: `dsh-zcode:${String(Date.now())}`,
        basedOnZCodeBuiltinRevision: basedOn,
        providers: {
          [providerId]: {
            access: { type: 'zhipu-account', entitled: true },
            builtinModelIds: modelIds.length === 0 ? ['GLM-5.3-Flash'] : modelIds,
          },
        },
        states: {
          [providerId]: { availability: 'available', entitled: true, current: true },
        },
      })
      const status = (result as { status?: unknown } | undefined)?.status
      this.injectedSignature = signature
      this.logger().info(`zcode: Start Plan 账号已注入（${providerId}，status=${String(status ?? '?')}）`)
    } catch (error) {
      this.logger().warn(
        `zcode: Start Plan 账号注入失败：${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  /**
   * 应答 agent 的鉴权索取。
   *
   * 客户端身份头跟着发行版本走（写死会漂移，指纹不符可能被上游拦），所以这里
   * 用与 spawn 时同一个版本值。
   */
  private async runtimeHeaders(
    params: Record<string, unknown>,
    builtinPath: string,
    jwt: string,
  ): Promise<unknown> {
    void params
    void builtinPath
    const appVersion = ZCODE_FALLBACK_APP_VERSION
    return {
      headersApplied: true,
      requestAuth: {
        apiKey: jwt,
        headers: {
          'http-referer': 'https://zcode.z.ai',
          'user-agent': `ZCode/${appVersion}`,
          'x-zcode-app-version': appVersion,
          'x-title': 'Z Code@cli',
        },
      },
    }
  }

  /** 建立（或复用）agent 会话。 */
  private async ensureSession(
    sessionKey: string,
    modelId: string,
    reasoningLevel: 'low' | 'high' | 'max',
  ): Promise<BridgeSession> {
    const existing = this.sessions.get(sessionKey)
    if (existing !== undefined) {
      // 同一会话中途换模型 / 换思考等级：必须显式重切，否则 agent 继续用旧目标。
      if (existing.modelId !== agentModelId(modelId) || existing.reasoningLevel !== reasoningLevel) {
        await this.applyModel(existing, modelId, reasoningLevel, true)
      }
      return existing
    }
    const client = await this.ensureClient()
    const workspacePath = this.options.workspacePath?.()
      ?? join(this.options.dataDir(), 'workspace')
    const created = await client.request('session/create', {
      workspace: { workspacePath, workspaceKey: 'dsh-zcode' },
    })
    const session = (created as { session?: { sessionId?: unknown } } | undefined)?.session
    const sessionId = session?.sessionId
    if (typeof sessionId !== 'string' || sessionId === '') {
      throw new LlmError('zcode: app-server 没有返回 sessionId', 'PROVIDER')
    }
    await client.request('session/subscribe', {
      sessionId,
      deliveryKind: 'desktop-continuous',
      afterSeq: 0,
      includeSnapshot: true,
    })
    try {
      // yolo：DSH 委派场景没有人工批准界面，build 模式会让 agent 的工具全卡在批准上。
      await client.request('session/setMode', { sessionId, mode: 'yolo' })
    } catch (error) {
      this.logger().warn(
        `zcode: 切换会话权限模式失败（继续用默认模式）：${error instanceof Error ? error.message : String(error)}`,
      )
    }
    await this.injectAccount()
    await delay(REGISTRY_SETTLE_MS)
    await this.applyModel(
      { sessionId, firstTurn: true, modelId: '', reasoningLevel },
      modelId,
      reasoningLevel,
      false,
    )
    await delay(TURN_SETTLE_MS)
    const entry: BridgeSession = {
      sessionId,
      firstTurn: true,
      modelId: agentModelId(modelId),
      reasoningLevel,
    }
    this.sessions.set(sessionKey, entry)
    this.logger().info(`zcode: 新建 agent 会话 ${sessionId}（模型 ${entry.modelId}，${reasoningLevel}）`)
    return entry
  }

  /** 在既有会话上重切模型与思考等级。 */
  private async applyModel(
    session: BridgeSession,
    modelId: string,
    reasoningLevel: 'low' | 'high' | 'max',
    logFailure: boolean,
  ): Promise<void> {
    const client = this.client
    if (client === undefined) return
    const providerId = `account:${await this.options.family()}-start-plan`
    try {
      await client.request('session/setModel', {
        sessionId: session.sessionId,
        model: {
          providerId,
          modelId: agentModelId(modelId),
          options: { reasoningLevel },
        },
      })
      session.modelId = agentModelId(modelId)
      session.reasoningLevel = reasoningLevel
      this.logger().info(`zcode: 会话模型已切到 ${providerId}/${session.modelId}（${reasoningLevel}）`)
    } catch (error) {
      if (logFailure) {
        this.logger().warn(
          `zcode: 切换会话模型失败（继续用当前模型）：${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
  }

  /** 让 agent 放弃当前回合，释放回合锁。 */
  private stopTurn(session: BridgeSession | undefined, reason: string): void {
    if (session === undefined || this.client === undefined) return
    try {
      this.client.notify('session/stop', { sessionId: session.sessionId })
      this.logger().warn(`zcode: 已补发 session/stop（${reason}）`)
    } catch {
      // 通知失败不影响收尾。
    }
  }

  /**
   * 收集本轮要落给 agent 的图片路径。
   *
   * agent 用 Read 读图，而宿主存的对象名没有扩展名（实测：模型读失败后会自己
   * 复制一份带 `.png` 的副本才成功）。这里直接在当前工作区准备一份带正确扩展名
   * 的副本，避免把宿主的存储细节变成模型的负担；副本在回合结束后删除。
   */
  private stageImages(
    messages: readonly unknown[],
    fullHistory: boolean,
  ): { readonly paths: readonly string[]; readonly staged: readonly string[] } {
    const attachments = this.options.attachments?.()
    // 必须带 this 调用：AttachmentStore.imageHostPath 要读 this.root，取出来单独调用
    // 会抛 `Cannot read properties of undefined (reading 'root')`。
    if (typeof attachments?.imageHostPath !== 'function') return { paths: [], staged: [] }
    const source = fullHistory ? messages : messages.filter((_m, index) => index === messages.length - 1)
    const paths: string[] = []
    const staged: string[] = []
    for (const message of source) {
      const content = (message as { content?: unknown }).content
      if (!Array.isArray(content)) continue
      for (const block of content) {
        const value = block as { type?: unknown; attachment?: unknown }
        if (value.type !== 'image' || value.attachment === undefined) continue
        const record = value.attachment as { attachmentId?: unknown; mediaType?: unknown }
        const resolved = attachments.imageHostPath(value.attachment as never)
        if (typeof resolved !== 'string' || resolved === '') continue
        if (extname(resolved) !== '') {
          paths.push(resolved)
          continue
        }
        const extension = IMAGE_EXTENSIONS[String(record.mediaType ?? '')] ?? '.png'
        const target = join(
          this.options.dataDir(),
          'workspace',
          'images',
          `${String(record.attachmentId ?? basename(resolved))}${extension}`,
        )
        try {
          mkdirSync(dirname(target), { recursive: true })
          copyFileSync(resolved, target)
          paths.push(target)
          staged.push(target)
        } catch (error) {
          this.logger().warn(
            `zcode: 图片副本准备失败，退回原路径：${error instanceof Error ? error.message : String(error)}`,
          )
          paths.push(resolved)
        }
      }
    }
    return { paths, staged }
  }

  /** 拼本轮提交的正文。 */
  private buildContent(
    session: BridgeSession,
    options: GenerateOptions,
    images: readonly string[],
  ): string {
    const messages = options.messages as readonly unknown[]
    const base = session.firstTurn
      ? flattenConversation(messages as never)
      : lastUserText(messages as never)
    const head = session.firstTurn ? `${BRIDGE_TOOL_RULE}\n\n${base}\n\n${BRIDGE_TOOL_NOTE}` : base
    const text = head.trim() === '' ? '（继续）' : head
    if (images.length === 0) return text
    const listing = images.map((file, index) => `#${String(index + 1)} ${file}`).join('\n')
    return `${text}\n\n[图片附件] 本条消息附有 ${String(images.length)} 张本地图片（对应上文 [图片 #k] 占位）：\n`
      + `${listing}\n回答前请先用 Read 工具逐张读取这些图片。`
  }

  /** 流式执行一轮对话。 */
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    // 会话标题在本地生成：走一次模型调用只为起名会白烧额度。
    if (options.purpose === 'session-title') {
      // DSH 的标题请求把「指令 + 人话 JSON」放在同一条用户消息里，必须先解出 JSON，
      // 否则标题会变成那句英文指令。
      const source = titleSourceText(options.messages as never, options.system)
      const title = source.replace(/\s+/g, ' ').trim().slice(0, 24)
      // 取不到人话就交回默认标题：宁可保留「新会话」，也不要拿英文指令当标题。
      if (title !== '') {
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: title }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: title } }
      }
      yield { type: 'usage', usage: { inputTokens: 0, outputTokens: 0 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }

    const key = String(options.sessionId ?? 'default')
    const previous = this.turnLocks.get(key) ?? Promise.resolve()
    let releaseTurn = (): void => {}
    const turnDone = new Promise<void>((resolve) => {
      releaseTurn = resolve
    })
    const tail = previous.then(() => turnDone)
    this.turnLocks.set(key, tail)
    void tail.catch(() => undefined).then(() => {
      if (this.turnLocks.get(key) === tail) this.turnLocks.delete(key)
    })
    await settleWithin(previous, TURN_QUEUE_MAX_MS)

    const queue: QueuedDelta[] = []
    let notify = (): void => {}
    const waitFor = (): Promise<void> => new Promise<void>((resolve) => {
      notify = resolve
    })
    let outcome: TurnOutcome | undefined
    let channel: { providerId: string; modelId: string; baseURL: string } | undefined
    let off = (): void => {}
    let settled = false
    /** 本轮为图片准备的临时副本；回合结束（含失败）后删除。 */
    let stagedImages: readonly string[] = []

    let session: BridgeSession | undefined
    try {
      session = await this.ensureSession(key, options.model, reasoningLevelOf(options.reasoningEffort))
    } catch (error) {
      releaseTurn()
      throw error
    }

    const activeSession = session
    off = (this.client?.onNotification((message) => {
      if (message.method !== 'session/event') return
      const params = (message.params ?? {}) as Record<string, unknown>
      if (params.sessionId !== activeSession.sessionId) return
      const { type, payload } = eventPayload(message)
      switch (type) {
        case 'session.updated': {
          const providerId = payload.providerId
          const modelId = payload.modelId
          const baseURL = payload.baseURL
          if (typeof baseURL === 'string') {
            channel = {
              providerId: typeof providerId === 'string' ? providerId : '',
              modelId: typeof modelId === 'string' ? modelId : '',
              baseURL,
            }
            this.lastChannel = channel
          }
          break
        }
        case 'model.streaming': {
          if (payload.done === true) break
          const delta = typeof payload.delta === 'string' ? payload.delta : ''
          if (delta === '') break
          if (payload.kind === 'text_delta') queue.push({ kind: 'text', text: delta })
          else if (payload.kind === 'reasoning_delta') queue.push({ kind: 'reasoning', text: delta })
          else break
          notify()
          break
        }
        case 'turn.completed': {
          const response = typeof payload.response === 'string' ? payload.response : ''
          outcome = {
            response,
            resultType: typeof payload.resultType === 'string' ? payload.resultType : 'success',
            usage: toUsage(payload.usage),
          }
          notify()
          break
        }
        case 'turn.failed': {
          const error = (payload.error ?? {}) as Record<string, unknown>
          const detail = typeof error.message === 'string'
            ? error.message
            : (typeof error.code === 'string' ? error.code : '未知错误')
          outcome = {
            response: '',
            resultType: 'failed',
            usage: { inputTokens: 0, outputTokens: 0 },
            error: detail,
          }
          notify()
          break
        }
        default:
          break
      }
    })) ?? (() => {})

    const handle: StreamHandle = {
      onDeath: () => {
        if (outcome !== undefined) return
        outcome = {
          response: '',
          resultType: 'failed',
          usage: { inputTokens: 0, outputTokens: 0 },
          error: 'zcode: app-server 进程已退出，回合中止（下次调用会自动重建会话）',
        }
        notify()
      },
    }
    this.activeStreams.add(handle)

    let started = false
    let suppressed = false
    let tailText = ''
    const emitText = function* (raw: string): Generator<StreamChunk> {
      if (suppressed) return
      if (looksLikeLeakedCall(raw) || looksLikeLeakedCall(`${tailText}${raw}`.slice(-64))) {
        suppressed = true
        return
      }
      tailText = `${tailText}${raw}`.slice(-24)
      if (!started) {
        started = true
        yield { type: 'block-start', index: 1, blockType: 'text' }
      }
      yield { type: 'text-delta', index: 1, text: raw }
    }

    try {
      const images = this.stageImages(options.messages as readonly unknown[], session.firstTurn)
      stagedImages = images.staged
      const content = this.buildContent(session, options, images.paths)
      if (session.firstTurn) await delay(TURN_SETTLE_MS)

      const client = this.client
      if (client === undefined) throw new LlmError('zcode: app-server 不可用', 'TRANSPORT')

      for (let attempt = 0; ; attempt += 1) {
        try {
          await client.request('session/send', {
            sessionId: activeSession.sessionId,
            content,
          })
          activeSession.firstTurn = false
          break
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error)
          if (attempt >= 1 || !STUCK_TURN.test(detail)) throw error
          this.logger().warn(`zcode: 上一轮回合锁未释放（${detail}）→ 补发 session/stop 后重试`)
          this.stopTurn(activeSession, '上一轮未释放')
          await delay(STOP_SETTLE_MS)
        }
      }

      const deadline = Date.now() + (this.options.turnTimeoutMs ?? ZCODE_BRIDGE_TURN_TIMEOUT_MS)
      // 结论由通知回调写入，因此这里用「循环内检查 + break」而不是把它放进循环条件：
      // 静态检查看不到闭包里的赋值，会误判成死循环。
      for (;;) {
        while (queue.length > 0) {
          const item = queue.shift()
          if (item === undefined) break
          if (item.kind === 'text') yield* emitText(item.text)
          else yield { type: 'reasoning-delta', index: 0, text: sanitizeLeakedCalls(item.text) }
        }
        if (outcome !== undefined) break
        if (Date.now() > deadline) {
          throw new LlmError(
            `zcode: agent 回合超时（${String(this.options.turnTimeoutMs ?? ZCODE_BRIDGE_TURN_TIMEOUT_MS)}ms）`,
            'TIMEOUT',
          )
        }
        if (options.signal?.aborted === true) throw new LlmError('zcode: 请求被调用方中止', 'ABORTED')
        await Promise.race([waitFor(), delay(500)])
      }

      const finished = outcome as TurnOutcome
      settled = finished.resultType === 'success' && finished.error === undefined
      if (settled) activeSession.firstTurn = false

      while (queue.length > 0) {
        const item = queue.shift()
        if (item === undefined) break
        if (item.kind === 'text') yield* emitText(item.text)
        else yield { type: 'reasoning-delta', index: 0, text: sanitizeLeakedCalls(item.text) }
      }

      if (suppressed && !started) {
        started = true
        yield { type: 'block-start', index: 1, blockType: 'text' }
      }
      if (suppressed) {
        yield {
          type: 'text-delta',
          index: 1,
          text: '\n\n〔拦截说明：模型把工具调用写成了正文（伪 antml 标记），这段输出已被桥接层拦下。'
            + '本通道的工具由 agent 原生执行、不会以文本形式出现；若反复出现请重发或新开会话。〕',
        }
      }
      if (started) {
        yield {
          type: 'block-end',
          index: 1,
          block: { type: 'text', text: sanitizeLeakedCalls(finished.response) },
        }
      }
      if (channel !== undefined) {
        this.logger().info(
          `zcode: 本轮渠道 providerId=${channel.providerId || '?'} model=${channel.modelId || '?'}`,
        )
      }
      yield { type: 'usage', usage: finished.usage }
      if (finished.error !== undefined) {
        yield {
          type: 'finish',
          reason: {
            kind: 'error',
            failure: {
              message: `ZCode Start Plan 回合失败：${finished.error}`,
              code: 'PROVIDER',
            },
          },
        }
        return
      }
      yield { type: 'finish', reason: { kind: 'stop' } }
    } finally {
      this.activeStreams.delete(handle)
      off()
      // 回合没正常结束就必须补 stop，否则回合锁一直占着，下一轮直接撞「已在运行」。
      if (!settled) this.stopTurn(activeSession, '本轮未正常结束（超时 / 中止 / 发送失败 / 回合失败）')
      for (const file of stagedImages) {
        try {
          rmSync(file, { force: true })
        } catch {
          // 清理失败不影响回合结论。
        }
      }
      releaseTurn()
    }
  }
}

/** 桥接通道用来注入的 provider id。 */
export function bridgeProviderId(family: ZCodeBridgeFamily): string {
  return `account:${family}-start-plan`
}

/** 桥接通道暴露的路由 id（与 HTTP 通道同一个路由）。 */
export const ZCODE_BRIDGE_PROVIDER = ZCODE_PROVIDER

/** 供测试用：数据目录下 workspace 的默认路径。 */
export function bridgeWorkspacePath(dataDir: string): string {
  return join(dataDir, 'workspace')
}

/** 供测试用：数据目录本身。 */
export function bridgeDataDirOf(dataDir: string): string {
  return join(dirname(join(dataDir, 'workspace')), '')
}
