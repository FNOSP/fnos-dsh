/**
 * ZCode Protocol 的 stdio 客户端。
 *
 * 信封是行分隔的裸 JSON，**没有** `jsonrpc` 字段：请求 `{id, method, params}`、
 * 通知 `{method, params}`、响应 `{id, result|error}`。带上 `jsonrpc` 会被判成
 * `Invalid ZCode Protocol message`。
 *
 * 除常规请求/通知外，agent 会向宿主发**反向请求**，不回就会静默卡住：
 * - `session/requestRuntimePreferences`：建会话与提交提示各一次，15 秒内必须回，
 *   否则 `session/create` 直接失败；
 * - `interaction/requestProviderRuntimeHeaders`：模型请求前索取鉴权，回
 *   `{headersApplied, requestAuth:{apiKey, headers}}`；
 * - 其余（权限、浏览器、官方 MCP 鉴权）按最小可用语义回，*不能*不回。
 *
 * @module dsh-zcode/bridge/protocol
 */

import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'

/** 客户端要求的运行期偏好（缺字段会被 `.strict()` 判非法）。 */
export const ZCODE_RUNTIME_PREFERENCES = {
  nativeSearchEnhancementsEnabled: false,
  memoryEnabled: false,
  askUserQuestionAutoResolutionEnabled: true,
  modelContextBudgetStrategy: 'preflight-v1',
} as const

/** 启动就绪的兜底等待（毫秒）。 */
const STARTUP_FALLBACK_MS = 9_000

/** 反向请求应答器：由适配器注入，返回 `undefined` 表示用默认空结果。 */
export interface ZCodeReverseRequestHandlers {
  readonly runtimeHeaders: (params: ZCodeReverseRequestParams) => Promise<unknown>
}

type ZCodeReverseRequestParams = Record<string, unknown>

/** 子进程环境变量白名单：宿主 env 里可能带其他供应商密钥，不整包透传。 */
const CHILD_ENV_BASE = new Set([
  'path', 'home', 'shell', 'user', 'logname', 'tmpdir', 'pwd',
  'lang', 'lc_all', 'lc_ctype', 'term', 'node_extra_ca_certs', 'ssh_auth_sock',
])

/** 组装子进程环境：系统基础变量 + `ZCODE_*` + 显式覆盖。 */
export function buildAppServerEnv(
  overrides: Readonly<Record<string, string>>,
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue
    const lower = key.toLowerCase()
    if (CHILD_ENV_BASE.has(lower) || lower.startsWith('zcode_')) env[key] = value
  }
  // 先删再覆盖：Electron 宿主下 `process.execPath` 就是 Electron 二进制，子进程要
  // 继续当 node 用就必须保留这个变量（DSH Desktop 自带的 node 壳也是这么做的：
  // `export ELECTRON_RUN_AS_NODE=1; exec <electron> ...`）。而普通 Node 宿主下它若
  // 被继承下去，会让 Electron 子进程误入 node 模式，所以默认删掉。
  delete env.ELECTRON_RUN_AS_NODE
  Object.assign(env, overrides)
  return env
}

/** 客户端日志器的最小接口。 */
export interface ZCodeBridgeLogger {
  readonly info: (message: string) => void
  readonly warn: (message: string) => void
}

export interface ZCodeProtocolClientOptions {
  readonly nodePath: string
  readonly cliPath: string
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
  readonly logger: ZCodeBridgeLogger
  readonly handlers: ZCodeReverseRequestHandlers
  /** 单次请求超时。 */
  readonly requestTimeoutMs?: number
}

interface PendingRequest {
  readonly resolve: (value: unknown) => void
  readonly reject: (error: Error) => void
}

/**
 * 常驻 app-server 客户端：一次 spawn，后续请求复用同一进程。
 *
 * 进程退出/启动失败都会让所有在途请求立刻失败，而不是等超时；适配器据此把
 * 缓存会话全部作废并给在途流一个明确的收尾。
 */
export class ZCodeProtocolClient {
  private child: ChildProcessWithoutNullStreams | undefined
  private buffer = ''
  private nextId = 1
  private readonly pending = new Map<number, PendingRequest>()
  private readonly listeners = new Set<(message: ZCodeNotification) => void>()
  private starting: Promise<void> | undefined
  private disposed = false
  private ready = false
  private releaseStartup: (() => void) | undefined
  /** 子进程 stderr 尾部：启动失败时用它给出真实原因，而不是一句"没能启动"。 */
  private stderrTail: string[] = []
  /** spawn 阶段的具体错误（ENOENT / EACCES / 退出码等）。 */
  private spawnFailure: string | undefined

  /** 进程退出回调：适配器用它丢弃悬空会话。 */
  onExit: (() => void) | undefined

  constructor(private readonly options: ZCodeProtocolClientOptions) {}

  /** 已就绪（startup 走完）。 */
  isReady(): boolean {
    return this.ready && this.child !== undefined
  }

  /** 幂等启动：并发调用共享同一次启动。 */
  async ensureStarted(): Promise<void> {
    if (this.disposed) throw new Error('zcode: app-server 已销毁')
    if (this.child !== undefined) return
    if (this.starting !== undefined) return this.starting
    this.starting = this.start().finally(() => {
      this.starting = undefined
    })
    return this.starting
  }

  private async start(): Promise<void> {
    const { logger } = this.options
    const child = spawn(
      this.options.nodePath,
      [this.options.cliPath, 'app-server', '--surface', 'terminal', '--no-color'],
      {
        cwd: this.options.cwd,
        env: this.options.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      },
    )
    this.child = child
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => this.onData(chunk))
    child.stderr.on('data', (chunk: string) => {
      const text = String(chunk)
      for (const line of text.split('\n')) {
        const trimmed = line.trim()
        if (trimmed === '') continue
        this.stderrTail.push(trimmed.slice(0, 300))
        if (this.stderrTail.length > 20) this.stderrTail.shift()
        logger.info(`zcode app-server stderr: ${trimmed.slice(0, 200)}`)
      }
    })
    child.on('exit', (code) => {
      this.spawnFailure = `app-server 进程退出（code=${String(code)}）`
      logger.warn(`zcode: app-server 退出（code=${String(code)}），下次调用会重启`)
      this.failAll(new Error('zcode: app-server 已退出'))
    })
    child.on('error', (error: Error) => {
      this.spawnFailure = `app-server 启动失败：${error.message}`
      logger.warn(`zcode: app-server 启动失败：${error.message}`)
      this.failAll(new Error(`zcode: app-server 启动失败：${error.message}`))
    })

    await new Promise<void>((resolve) => {
      let settled = false
      const finish = (): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.releaseStartup = undefined
        resolve()
      }
      this.releaseStartup = finish
      const timer = setTimeout(finish, STARTUP_FALLBACK_MS)
      timer.unref?.()
    })
    if (this.child === undefined) {
      // 把 stderr 尾部与退出码带出去：只报"没能启动"会让这类问题无法定位。
      const detail = [
        this.spawnFailure,
        this.stderrTail.length === 0 ? undefined : `stderr: ${this.stderrTail.slice(-3).join(' / ')}`,
      ].filter((part): part is string => part !== undefined && part !== '')
      throw new Error(
        detail.length === 0
          ? 'zcode: app-server 没能启动（子进程没有任何输出）'
          : `zcode: ${detail.join('；')}`,
      )
    }
    // 就绪后仍有一段稳定期（实测约 2.5s）；不等就开始 create/send，回合会被静默丢弃。
    await delay(2_500)
    this.ready = true
  }

  private failAll(error: Error): void {
    this.child = undefined
    this.ready = false
    for (const entry of this.pending.values()) entry.reject(error)
    this.pending.clear()
    this.onExit?.()
  }

  private onData(chunk: string): void {
    this.buffer += chunk
    let index = this.buffer.indexOf('\n')
    while (index !== -1) {
      const line = this.buffer.slice(0, index).trim()
      this.buffer = this.buffer.slice(index + 1)
      index = this.buffer.indexOf('\n')
      if (line === '') continue
      let message: ZCodeWireMessage
      try {
        message = JSON.parse(line) as ZCodeWireMessage
      } catch {
        continue
      }
      this.dispatch(message)
    }
  }

  private dispatch(message: ZCodeWireMessage): void {
    // 我方请求的响应：只有 id、没有 method。
    if (message.id !== undefined && message.method === undefined) {
      const id = typeof message.id === 'number' ? message.id : Number(message.id)
      const entry = this.pending.get(id)
      if (entry === undefined) return
      this.pending.delete(id)
      if (message.error !== undefined) {
        const detail = typeof message.error.message === 'string' ? message.error.message : '未知错误'
        entry.reject(new Error(`zcode: ${detail}`))
      } else {
        entry.resolve(message.result)
      }
      return
    }
    // 服务端 → 宿主的反向请求：必须应答。
    if (message.method !== undefined && message.id !== undefined) {
      void this.answerReverseRequest(message.method, message.id, message.params)
      return
    }
    if (message.method !== undefined) {
      if (/^startup\//.test(message.method)) {
        const phase = (message.params as { phase?: unknown } | undefined)?.phase
        if (phase === 'ready') this.releaseStartup?.()
      }
      for (const listener of this.listeners) {
        try {
          listener({ method: message.method, params: message.params })
        } catch {
          // 单个监听器异常不影响收发。
        }
      }
    }
  }

  private async answerReverseRequest(
    method: string,
    id: unknown,
    params: unknown,
  ): Promise<void> {
    const requestParams = (params ?? {}) as ZCodeReverseRequestParams
    try {
      if (method === 'session/requestRuntimePreferences') {
        this.write({ id, result: ZCODE_RUNTIME_PREFERENCES })
        return
      }
      if (method === 'interaction/requestProviderRuntimeHeaders') {
        const result = await this.options.handlers.runtimeHeaders(requestParams)
        this.write({ id, result })
        return
      }
      if (method === 'interaction/requestPermission') {
        // 权限由 DSH 侧管理；agent 侧一律放行，否则工具会卡在批准上。
        this.write({ id, result: { decision: 'allow' } })
        return
      }
      if (method === 'interaction/browserList') {
        this.write({ id, result: { browsers: [] } })
        return
      }
      if (method === 'interaction/browserExecute') {
        this.write({
          id,
          result: {
            ok: false,
            error: { code: 'host_unavailable', message: '宿主不提供浏览器集成' },
          },
        })
        return
      }
      this.write({ id, result: {} })
    } catch (error) {
      this.options.logger.warn(
        `zcode: 应答 ${method} 失败：${error instanceof Error ? error.message : String(error)}`,
      )
      this.write({ id, result: {} })
    }
  }

  /** 发送请求并等待响应。 */
  request(method: string, params: unknown, timeoutMs?: number): Promise<unknown> {
    const id = this.nextId++
    const limit = timeoutMs ?? this.options.requestTimeoutMs ?? 120_000
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`zcode: ${method} 超时（${limit}ms）`))
      }, limit)
      timer.unref?.()
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
      })
      this.write({ id, method, params })
    })
  }

  /** 发送通知（无响应）。 */
  notify(method: string, params: unknown): void {
    this.write({ method, params })
  }

  /** 订阅所有通知。 */
  onNotification(listener: (message: ZCodeNotification) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private write(message: Record<string, unknown>): void {
    const child = this.child
    if (child === undefined) return
    child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  /** 销毁客户端并终止子进程。 */
  dispose(): void {
    this.disposed = true
    this.ready = false
    const child = this.child
    this.child = undefined
    try {
      child?.kill()
    } catch {
      // 已经退了。
    }
    this.failAll(new Error('zcode: app-server 已销毁'))
  }
}

/** 服务端通知。 */
export interface ZCodeNotification {
  readonly method: string
  readonly params: unknown
}

interface ZCodeWireMessage {
  readonly id?: number | string
  readonly method?: string
  readonly params?: unknown
  readonly result?: unknown
  readonly error?: { readonly message?: unknown }
}

/** 简单延时。 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    timer.unref?.()
  })
}
