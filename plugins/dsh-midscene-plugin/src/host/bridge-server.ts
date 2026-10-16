/**
 * 本地 OpenAI 兼容桥接服务（FNOS-013-01、03、04）。
 *
 * 用 Node 内置 `http` 而不是引入框架：端点只有四个，引框架只会增加一份需要
 * 跟随上游升级的依赖。
 *
 * 服务只绑回环地址（需求行为约束）；端口被占用时**自动向上尝试**下一个端口
 * （最多 {@link PORT_SCAN_LIMIT} 个），避免「端口冲突导致插件不可用」。实际端口
 * 通过 {@link BridgeServer.port} 暴露，由调用方写回配置并呈现给用户——这正是
 * 原设计（D4 fail-fast）要防的「静默失配」：不静默，而是写回 + 如实呈现。
 */
import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type { GenerateOptions, LlmRuntime } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { BRIDGE_HOST, FIXED_MODEL_NAME, OPENAI_API_PREFIX, PORT_SCAN_LIMIT, renderEnvFile, type BridgeConfig } from '../contracts/config.ts'
import { resolveModelName } from '../contracts/model-name.ts'
import { buildCatalog, type ModelCatalogSnapshot } from './catalog.ts'
import { resolveFamily } from '../contracts/model-family.ts'
import { chooseModel, type SessionModelReader } from './model-choice.ts'
import { convertMessages, convertTools, RequestConversionError } from './convert.ts'
import { aggregateStream, makeChunk, sseLine, toFinishReason, toOpenAiError } from './stream.ts'

/** 桥接服务的运行依赖。 */
export interface BridgeDeps {
  readonly llm: LlmRuntime
  /** 附件服务；图片落盘用。profile 未提供时为 `undefined`（图片请求返回明确错误）。 */
  readonly attachments: AttachmentStore | undefined
  readonly config: BridgeConfig
  /** DSH 当前模型选择的读取面（固定模型名 `dsh-model` 用它决定实际模型）。 */
  readonly sessionModel: SessionModelReader
  /** 记录一行日志（不含消息内容与图片数据）。 */
  readonly log: (message: string) => void
}

/**
 * 连续尝试的端口全部被占用：带处理建议的明确错误。
 *
 * 只在「整段可用端口都被占」时抛出——单个端口被占用会继续向下尝试，不再报错。
 */
export class BridgePortExhaustedError extends Error {
  /**
   * @param from - 起始（首选）端口。
   * @param attempts - 已尝试的端口列表。
   * @param cause - 最后一次的原始错误。
   */
  constructor(readonly from: number, readonly attempts: readonly number[], cause: unknown) {
    const range = attempts.length === 0 ? `${from}` : `${attempts[0]}–${attempts.at(-1)}`
    super(
      `Midscene 桥接服务无法启动：从端口 ${from} 起连续尝试的 ${attempts.length} 个端口（${range}）均被占用。`
      + `请释放其中一个（如 lsof -i :${from} 找到进程后停止它），或把插件配置的 port 改到空闲区间后重启 DSH。`,
      { cause },
    )
    this.name = 'BridgePortExhaustedError'
  }
}

/** 端口被占用时继续尝试下一个（内部信号，不对外抛出）。 */
class PortInUseSignal extends Error {
  /** @param port - 被占用的端口。 */
  constructor(readonly port: number) {
    super(`port ${port} in use`)
    this.name = 'PortInUseSignal'
  }
}

/**
 * 模型目录缓存。
 *
 * 目录查询会遍历全部提供方（每个 `listModels()` 可能打远端），因此缓存在
 * 桥内；`llm/adapters-updated` 事件由插件层订阅后调用 {@link invalidate}——
 * 新装提供方插件或配置新自定义端点后目录即时更新（AC-03）。
 */
export class CatalogCache {
  #snapshot: ModelCatalogSnapshot | undefined
  #inflight: Promise<ModelCatalogSnapshot> | undefined

  /**
   * @param llm - 宿主模型层。
   * @param log - 日志函数。
   */
  constructor(private readonly llm: LlmRuntime, private readonly log: (message: string) => void) {}

  /** 丢弃缓存，下次查询重新聚合。 */
  invalidate(): void {
    this.#snapshot = undefined
  }

  /**
   * 取目录快照（带缓存；并发查询合并为一次）。
   * @returns 目录快照。
   */
  async get(): Promise<ModelCatalogSnapshot> {
    if (this.#snapshot !== undefined) return this.#snapshot
    this.#inflight ??= buildCatalog(this.llm)
      .then((snapshot) => {
        this.#snapshot = snapshot
        this.log(`模型目录已刷新：${snapshot.entries.length} 个模型 / ${snapshot.providers.length} 个提供方`)
        return snapshot
      })
      .finally(() => { this.#inflight = undefined })
    return await this.#inflight
  }
}

/** 读取请求体（上限 32 MiB：图片数据 URI 会显著放大 JSON 体积）。 */
const MAX_BODY_BYTES = 32 * 1024 * 1024

/**
 * 读取并解析 JSON 请求体。
 * @param request - 入站请求。
 * @returns 解析结果。
 */
async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = chunk as Buffer
    size += buffer.byteLength
    if (size > MAX_BODY_BYTES) {
      throw new RequestConversionError('request body exceeds 32 MiB', 413, 'invalid_request_error')
    }
    chunks.push(buffer)
  }
  if (size === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    throw new RequestConversionError('request body is not valid JSON', 400, 'invalid_request_error')
  }
}

/**
 * 写一个 JSON 响应。
 * @param response - 出站响应。
 * @param status - HTTP 状态码。
 * @param body - 响应体。
 */
function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  })
  response.end(payload)
}

/**
 * 把宿主在 `finish` 分片里给出的失败详情转成标准 OpenAI 错误。
 *
 * 宿主用 `finish.reason.failure` 承载提供方失败（未配置凭据、额度不足等），
 * 此时流里没有文本产出。若把它当作正常结束，客户端会看到「成功的空回答」，
 * 真实原因彻底消失（FNOS-013-04-AC-04 要避免的正是这种不可诊断）。
 * @param failure - 宿主给出的失败详情。
 * @param failure.message - 提供方给出的可读原因。
 * @param failure.code - 稳定错误码。
 * @param failure.status - 提供方返回的 HTTP 状态（有则优先采用）。
 * @param attribution - 「提供方/模型」归因。
 * @returns 标准错误映射结果。
 */
function failureToOpenAiError(
  failure: { readonly message: string, readonly code: string, readonly status?: number },
  attribution: string,
): { status: number, body: { error: { message: string, type: string, code: string | null } } } {
  const error = Object.assign(new Error(failure.message), { code: failure.code })
  const mapped = toOpenAiError(error, attribution)
  // 提供方给了 HTTP 状态时优先采用（如 401/403 直接对应客户端的鉴权语义）。
  return failure.status === undefined ? mapped : { ...mapped, status: failure.status }
}

/**
 * 写一个标准 OpenAI 错误响应。
 * @param response - 出站响应。
 * @param error - 异常。
 * @param attribution - 「提供方/模型」归因。
 */
function sendError(response: ServerResponse, error: unknown, attribution?: string): void {
  const mapped = error instanceof RequestConversionError
    ? { status: error.status, body: { error: { message: error.message, type: 'invalid_request_error', code: error.code } } }
    : toOpenAiError(error, attribution)
  if (!response.headersSent) sendJson(response, mapped.status, mapped.body)
  else response.end()
}

/**
 * 桥接服务：持有 HTTP server 与目录缓存，`start()`/`stop()` 成对使用。
 */
export class BridgeServer {
  #server: Server | undefined
  /** 实际监听端口；启动成功前为 undefined。 */
  #port: number | undefined
  /**
   * 桥自身的会话标识，随每次请求下发给模型层。
   *
   * 部分提供方要求「按会话路由」的请求头（如 opencode 的 `x-opencode-session`），
   * 而 DSH 正是从 `GenerateOptions.sessionId` 生成该头。桥原先不传这个字段，
   * 于是**只要会话模型属于这类提供方，桥就整体不可用**（502 `MissingSessionID`）——
   * 与「DSH 会话能正常请求的模型，桥也应该能正常发送」直接冲突。
   *
   * 取值稳定（每个桥实例一个）：既满足按会话路由的要求，也让支持提示缓存的
   * 提供方拿到稳定的缓存键；不支持的提供方会忽略它，因此对所有提供方都安全。
   */
  readonly #sessionId = SessionId(randomUUID())
  readonly catalog: CatalogCache

  /**
   * @param deps - 运行依赖。
   */
  constructor(private readonly deps: BridgeDeps) {
    this.catalog = new CatalogCache(deps.llm, deps.log)
  }

  /**
   * 监听端口是否就绪（健康检查用）。
   * @returns 是否正在监听。
   */
  get listening(): boolean {
    return this.#server?.listening === true
  }

  /**
   * 实际监听的端口。
   *
   * 与 `deps.config.port` 的区别：端口被占用而自动跳号后，配置字段在写回完成前
   * 仍是首选值，而本属性始终是**真正在监听**的那个端口。`.env` 渲染、健康端点与
   * 设置页都必须用它，否则用户会拿到连不上的地址。
   * @returns 实际端口；尚未启动时为配置里的首选端口。
   */
  get port(): number {
    return this.#port ?? this.deps.config.port
  }

  /**
   * 当前会**实际使用**的模型（`dsh-model` 这个固定名背后真正路由到的模型）。
   *
   * 供设置页推导协议家族与展示「正在用哪个模型」：与请求路径调用同一套决策
   * （`chooseModel`），因此界面显示的与实际调用的必然一致——若各算一套，设置页会
   * 显示一个理论上可能、实际却不会被用到的模型。
   * @returns 模型标识；目录为空时 `undefined`。
   */
  async resolveModel(): Promise<string | undefined> {
    const snapshot = await this.catalog.get()
    return chooseModel(snapshot, this.deps.config.model, this.deps.sessionModel)?.entry.id
  }

  /**
   * 启动服务。
   *
   * 端口被占用时**自动向上尝试**下一个端口（最多 {@link PORT_SCAN_LIMIT} 个），
   * 全部被占用才抛 {@link BridgePortExhaustedError}；其余监听错误原样抛出。等待
   * `listening` 事件而不是立刻返回，保证调用方拿到的是一个已就绪的服务。
   *
   * 每次尝试都用**新的 server 实例**：`listen` 失败后同一个实例不可复用。
   * @returns 服务就绪后的 Promise，值为**实际监听端口**（调用方据此写回配置）。
   */
  async start(): Promise<number> {
    if (this.#server !== undefined) return this.port
    const preferred = this.deps.config.port
    const attempts: number[] = []
    let lastError: unknown
    for (let offset = 0; offset < PORT_SCAN_LIMIT; offset += 1) {
      const candidate = preferred + offset
      attempts.push(candidate)
      try {
        const server = await this.#listenOn(candidate)
        this.#server = server
        this.#port = candidate
        if (candidate !== preferred) {
          // 改成 error 级之外的 info：这不是故障，但用户必须知道端口变了（.env 要重拉）。
          this.deps.log(
            `首选端口 ${preferred} 被占用，已改用 ${candidate}；`
            + '请重新执行 /v1/midscene-env 更新工作区的 .env（或到插件设置页复制新的接入配置）',
          )
        }
        this.deps.log(`Midscene 桥接服务已就绪：http://${BRIDGE_HOST}:${candidate}${OPENAI_API_PREFIX}`)
        return candidate
      } catch (error) {
        if (!(error instanceof PortInUseSignal)) throw error
        lastError = error
      }
    }
    throw new BridgePortExhaustedError(preferred, attempts, lastError)
  }

  /**
   * 在指定端口上创建并监听一个服务实例。
   *
   * 先挂错误监听再 `listen`：`EADDRINUSE` 是异步事件，晚挂会漏掉。端口被占用时
   * 关闭实例并抛 {@link PortInUseSignal}，交由 {@link start} 决定是否继续尝试。
   * @param port - 本次尝试的端口。
   * @returns 已就绪的服务实例。
   */
  #listenOn(port: number): Promise<Server> {
    const server = createServer((request, response) => {
      void this.#handle(request, response)
    })
    // 长连接与 SSE 场景：禁用请求超时（模型调用可能持续数分钟）。
    server.requestTimeout = 0
    server.headersTimeout = 0
    return new Promise<Server>((resolve, reject) => {
      const onError = (error: NodeJS.ErrnoException): void => {
        server.removeListener('listening', onListening)
        if (error.code === 'EADDRINUSE') {
          // 释放可能已建立的内部句柄，避免扫描过程中累积。
          server.close()
          reject(new PortInUseSignal(port))
        } else reject(error)
      }
      const onListening = (): void => {
        server.removeListener('error', onError)
        resolve(server)
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(port, BRIDGE_HOST)
    })
  }

  /**
   * 停止服务并等待端口真正释放。
   *
   * HMR/卸载时宿主会立刻加载新实例，若这里不等 `close` 回调就返回，新实例会
   * 撞上尚未释放的端口（AC-02 要求端口无残留）。`closeAllConnections` 先断开
   * 挂起的 keep-alive，否则 `close` 可能长时间不回调。
   * @returns 停止完成后的 Promise。
   */
  async stop(): Promise<void> {
    const server = this.#server
    if (server === undefined) return
    this.#server = undefined
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
      server.closeAllConnections()
    })
  }

  /**
   * 校验请求携带的接入密钥。
   *
   * 接受 `Authorization: Bearer <key>` 与 `x-api-key: <key>` 两种标准写法；
   * OpenAI 客户端用前者，Midscene 二者皆可。
   * @param request - 入站请求。
   * @returns 是否通过。
   */
  #authorized(request: IncomingMessage): boolean {
    const expected = this.deps.config.apiKey
    const header = request.headers.authorization
    const bearer = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : undefined
    const apiKey = request.headers['x-api-key']
    const provided = bearer ?? (typeof apiKey === 'string' ? apiKey : undefined)
    // 定长比较：避免按字符提前返回造成的时序差异。
    if (provided === undefined || provided.length !== expected.length) return false
    let diff = 0
    for (let index = 0; index < expected.length; index += 1) {
      diff |= expected.charCodeAt(index) ^ provided.charCodeAt(index)
    }
    return diff === 0
  }

  /**
   * 路由并处理一个请求。
   * @param request - 入站请求。
   * @param response - 出站响应。
   */
  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', `http://${BRIDGE_HOST}:${this.deps.config.port}`)
    const path = url.pathname.replace(/\/+$/u, '') || '/'
    try {
      // 接入密钥校验：桥只绑回环，但同一台机器上的其它进程也能访问回环端口；
      // 密钥把「本机任意进程」与「持有配置的 Midscene」区分开。
      //
      // **密钥守住的是「推理」**（会消耗提供方额度的那次调用），只读的发现类端点
      // 不校验——它们不含凭据、不产生额度消耗，且不校验才能让文档里的快速接入步骤
      // 可直接复制执行（此前 `/v1/models` 也校验，导致按文档逐步执行会拿到 401，
      // 由 TC-034/036 的干净环境复现抓出）：
      // - `/v1/midscene-env`：返回的就是这份密钥（自举）；只含本机模型名与家族。
      // - `/v1/health`：诊断用，不含敏感信息。
      // - `/v1/models`：模型目录；只暴露已配置模型标识，不含凭据。
      const isDiscovery = path === `${OPENAI_API_PREFIX}/midscene-env`
        || path === `${OPENAI_API_PREFIX}/health`
        || path === `${OPENAI_API_PREFIX}/models`
      if (!isDiscovery && !this.#authorized(request)) {
        sendJson(response, 401, {
          error: {
            message: 'invalid API key; use the value from DSH plugin settings (or GET '
              + `${OPENAI_API_PREFIX}/midscene-env`,
            type: 'invalid_request_error',
            code: 'invalid_api_key',
          },
        })
        return
      }
      if (request.method === 'GET' && path === `${OPENAI_API_PREFIX}/models`) {
        const snapshot = await this.catalog.get()
        sendJson(response, 200, {
          object: 'list',
          data: snapshot.entries.map(entry => ({
            id: entry.id,
            object: 'model',
            created: Math.floor(snapshot.fetchedAt / 1000),
            owned_by: entry.owned_by,
            name: entry.name,
            ...entry.description === undefined ? {} : { description: entry.description },
            ...entry.input_modalities === undefined ? {} : { input_modalities: entry.input_modalities },
            vision: entry.vision,
          })),
        })
        return
      }
      if (request.method === 'GET' && path === `${OPENAI_API_PREFIX}/health`) {
        const snapshot = await this.catalog.get()
        const healthChoice = chooseModel(snapshot, this.deps.config.model, this.deps.sessionModel)
        sendJson(response, 200, {
          status: 'ok',
          host: BRIDGE_HOST,
          // 实际端口（端口被占用跳号后与配置里的首选值可能不同）。
          port: this.port,
          // Midscene 侧固定使用的模型名；桥按它决定实际模型。
          fixedModelName: FIXED_MODEL_NAME,
          // 家族按**实际会使用的模型**推导（用户不配置它）。取不到模型时回落到
          // 配置里的当前值，健康检查不应因目录为空而失败。
          family: resolveFamily(healthChoice?.entry.id ?? this.deps.config.family).family,
          resolvedModel: healthChoice?.entry.id,
          configuredModel: this.deps.config.model,
          providers: snapshot.providers,
          models: snapshot.entries.length,
          attachments: this.deps.attachments !== undefined,
        })
        return
      }
      // 接入配置：四行全是固定值（基址、密钥、固定模型名、协议家族），因此用户
      // 可以把 .env 写死——换模型只改插件设置，不动这个文件。
      if (request.method === 'GET' && path === `${OPENAI_API_PREFIX}/midscene-env`) {
        const snapshot = await this.catalog.get()
        const choice = chooseModel(snapshot, this.deps.config.model, this.deps.sessionModel)
        // 家族随实际模型推导：Midscene 按它解析坐标，写错会静默错位。用户在界面只选模型，
        // 家族由这里保证一致。
        const family = resolveFamily(choice?.entry.id ?? this.deps.config.family).family
        sendJson(response, 200, {
          content: renderEnvFile({ ...this.deps.config, port: this.port, family }),
          variables: {
            MIDSCENE_MODEL_BASE_URL: `http://${BRIDGE_HOST}:${this.port}${OPENAI_API_PREFIX}`,
            MIDSCENE_MODEL_API_KEY: this.deps.config.apiKey,
            MIDSCENE_MODEL_NAME: FIXED_MODEL_NAME,
            MIDSCENE_MODEL_FAMILY: family,
          },
          // 当前会实际使用的模型与它的来源，便于用户确认「跟随会话」是否生效。
          ...choice === undefined ? {} : {
            resolvedModel: choice.entry.id,
            resolvedFrom: choice.source,
          },
          ...choice === undefined || choice.skippedConfigured.length === 0 ? {} : {
            skippedConfigured: choice.skippedConfigured,
          },
          availableModels: snapshot.entries
            .filter(entry => entry.vision === true)
            .map(entry => entry.id),
        })
        return
      }
      if (request.method === 'POST' && path === `${OPENAI_API_PREFIX}/chat/completions`) {
        await this.#chatCompletions(request, response)
        return
      }
      sendJson(response, 404, {
        error: { message: `unknown endpoint ${path}; available: ${OPENAI_API_PREFIX}/models, ${OPENAI_API_PREFIX}/chat/completions, ${OPENAI_API_PREFIX}/midscene-env, ${OPENAI_API_PREFIX}/health`, type: 'invalid_request_error', code: null },
      })
    } catch (error) {
      sendError(response, error)
    }
  }

  /**
   * 处理对话补全（流式与非流式）。
   * @param request - 入站请求。
   * @param response - 出站响应。
   */
  async #chatCompletions(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = await readJsonBody(request) as Record<string, unknown>
    const rawModel = typeof body.model === 'string' ? body.model : ''
    const snapshot = await this.catalog.get()

    // 固定模型名（Midscene 侧的默认写法）：由桥决定实际用哪个模型——配置指定的
    // 优先，否则跟随 DSH 当前模型选择，最后兜底挑一个具备图片能力的。
    if (rawModel === FIXED_MODEL_NAME) {
      const choice = chooseModel(snapshot, this.deps.config.model, this.deps.sessionModel)
      if (choice === undefined) {
        throw new RequestConversionError(
          'no model is available in DSH; configure a provider in DSH first',
          400,
          'invalid_request_error',
        )
      }
      const attribution = choice.entry.id
      await this.#runCompletion(body, attribution, choice.entry.vision === true, response)
      return
    }

    const resolved = resolveModelName(rawModel, snapshot.providers, '')
    if (resolved === undefined) {
      throw new RequestConversionError(
        `model "${rawModel}" is neither "${FIXED_MODEL_NAME}" nor a "provider/model" name;`
        + ` use "${FIXED_MODEL_NAME}" to follow the DSH model, or pick one from ${OPENAI_API_PREFIX}/models`,
        400,
        'invalid_request_error',
      )
    }
    const attribution = `${resolved.provider}/${resolved.model}`

    // 图片能力按宿主元数据门控：查不到该模型时不阻断（新提供方目录可能刚变，
    // 让提供方自己做权威判定并给出自己的错误）。
    const known = snapshot.entries.find(entry => entry.id === attribution)
    await this.#runCompletion(body, attribution, known === undefined ? true : known.vision === true, response)
  }

  /**
   * 用已解析好的模型执行一次补全（两条路由共用）。
   *
   * 与模型选择分离：`dsh-model` 与显式「提供方/模型」两条路径最终都落到这里，
   * 消息转换、图片门控、流式/非流式与错误映射只有一份实现。
   * @param body - 已解析的请求体。
   * @param attribution - 「提供方/模型」标识（错误归因与响应 `model` 字段用）。
   * @param supportsImage - 该模型是否接受图片输入。
   * @param response - 出站响应。
   */
  async #runCompletion(
    body: Record<string, unknown>,
    attribution: string,
    supportsImage: boolean,
    response: ServerResponse,
  ): Promise<void> {
    const [provider, ...modelParts] = attribution.split('/')
    const model = modelParts.join('/')

    let converted: { system: string | undefined, messages: import('@deepseek-ai/dsh-llm').RequestMessage[] }
    try {
      converted = await convertMessages(body.messages, {
        attachments: this.deps.attachments,
        supportsImage,
      })
    } catch (error) {
      sendError(response, error, attribution)
      return
    }
    if (converted.messages.length === 0) {
      sendError(response, new RequestConversionError('messages produced no content', 400, 'invalid_request_error'), attribution)
      return
    }

    const options: GenerateOptions = {
      provider: provider!,
      model,
      messages: converted.messages,
      ...converted.system === undefined ? {} : { system: converted.system },
      ...typeof body.temperature === 'number' ? { temperature: body.temperature } : {},
      ...typeof body.max_tokens === 'number' ? { maxTokens: body.max_tokens } : {},
      ...Array.isArray(body.stop) && body.stop.every((value: unknown) => typeof value === 'string')
        ? { stop: body.stop as string[] }
        : {},
      ...(() => {
        const tools = convertTools(body.tools)
        return tools === undefined ? {} : { tools }
      })(),
    }

    const wantsStream = body.stream === true
    const id = `chatcmpl-${Math.random().toString(36).slice(2, 12)}`
    const created = Math.floor(Date.now() / 1000)
    if (this.deps.config.logRequests) {
      this.deps.log(`请求 ${attribution}（${wantsStream ? 'stream' : 'buffered'}，${converted.messages.length} 条消息${supportsImage ? '' : '，无图片能力'}）`)
    }

    const controller = new AbortController()
    // 客户端断开时中止上游调用：否则模型会继续生成、按提供方计费。
    response.on('close', () => { controller.abort() })
    const timeoutMs = this.deps.config.requestTimeoutMs
    const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : undefined
    // 提供方按会话路由/缓存时依赖 sessionId（如 opencode 的 x-opencode-session 头）；
    // 不支持的提供方会忽略它，因此对所有提供方都安全。
    const stream = this.deps.llm.stream({
      ...options,
      sessionId: this.#sessionId,
      signal: controller.signal,
    })

    try {
      if (!wantsStream) {
        const answer = await aggregateStream(stream)
        if (answer.failure !== undefined) {
          // 提供方在流内报告失败：以标准错误格式返回，而不是一个空回答。
          sendError(
            response,
            Object.assign(new Error(answer.failure.message), { code: answer.failure.code }),
            attribution,
          )
          return
        }
        sendJson(response, 200, {
          id,
          object: 'chat.completion',
          created,
          model: attribution,
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: answer.text,
              ...answer.reasoning.length === 0 ? {} : { reasoning_content: answer.reasoning },
              ...answer.toolCalls.length === 0 ? {} : {
                tool_calls: answer.toolCalls.map(call => ({
                  id: call.id,
                  type: 'function',
                  function: { name: call.name, arguments: call.arguments },
                })),
              },
            },
            finish_reason: toFinishReason(answer.finishReason),
          }],
          ...answer.usage === undefined ? {} : { usage: answer.usage },
        })
        return
      }

      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })
      response.write(sseLine(makeChunk(id, attribution, created, { role: 'assistant', content: '' }, null)))
      for await (const chunk of stream) {
        if (chunk.type === 'text-delta') {
          response.write(sseLine(makeChunk(id, attribution, created, { content: chunk.text }, null)))
        } else if (chunk.type === 'reasoning-delta') {
          response.write(sseLine(makeChunk(id, attribution, created, { reasoning_content: chunk.text }, null)))
        } else if (chunk.type === 'usage') {
          response.write(sseLine({
            id,
            object: 'chat.completion.chunk',
            created,
            model: attribution,
            choices: [],
            usage: {
              prompt_tokens: chunk.usage.inputTokens,
              completion_tokens: chunk.usage.outputTokens,
              total_tokens: chunk.usage.totalTokens ?? chunk.usage.inputTokens + chunk.usage.outputTokens,
            },
          }))
        } else if (chunk.type === 'finish') {
          // 流内失败：先发标准错误分片，让客户端拿到可诊断原因，再发结束分片
          // 保证 SSE 序列完整（客户端不会停在半个流上）。
          const detail = (chunk.reason as { failure?: { message?: unknown, code?: unknown, status?: unknown } }).failure
          if (typeof detail?.message === 'string') {
            const mapped = failureToOpenAiError(
              {
                message: detail.message,
                code: typeof detail.code === 'string' ? detail.code : 'UNKNOWN',
                ...typeof detail.status === 'number' ? { status: detail.status } : {},
              },
              attribution,
            )
            response.write(sseLine(mapped.body))
          }
          response.write(sseLine(makeChunk(id, attribution, created, {}, toFinishReason(chunk.reason))))
        }
      }
      response.write(sseLine('[DONE]'))
      response.end()
    } catch (error) {
      // 流已开始（SSE 头已发出）时无法再改状态码：以标准错误分片 + 终止标记收尾，
      // 让客户端看到结构化错误而不是挂断的流。
      if (response.headersSent) {
        const mapped = toOpenAiError(error, attribution)
        response.write(sseLine(mapped.body))
        response.write(sseLine('[DONE]'))
        response.end()
        return
      }
      sendError(response, error, attribution)
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }
}
