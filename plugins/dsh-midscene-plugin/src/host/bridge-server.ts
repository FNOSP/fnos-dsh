/**
 * 本地 OpenAI 兼容桥接服务（FNOS-013-01、03、04）。
 *
 * 用 Node 内置 `http` 而不是引入框架：端点只有四个，需求明确不做设置 UI 与
 * 鉴权（回环绑定 + 本机使用），引框架只会增加一份需要跟随上游升级的依赖。
 *
 * 服务只绑回环地址（需求行为约束）；端口被占用时**不静默换端口**，直接把
 * `EADDRINUSE` 抛给宿主——静默换端口会让工作区 `.env` 的接入配置失配
 * （决策 D4）。
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type { GenerateOptions, LlmRuntime } from '@deepseek-ai/dsh-llm'
import { BRIDGE_HOST, OPENAI_API_PREFIX, type BridgeConfig } from '../contracts/config.ts'
import { resolveModelName } from '../contracts/model-name.ts'
import { buildCatalog, type ModelCatalogSnapshot } from './catalog.ts'
import { convertMessages, convertTools, RequestConversionError } from './convert.ts'
import { aggregateStream, makeChunk, sseLine, toFinishReason, toOpenAiError } from './stream.ts'

/** 桥接服务的运行依赖。 */
export interface BridgeDeps {
  readonly llm: LlmRuntime
  /** 附件服务；图片落盘用。profile 未提供时为 `undefined`（图片请求返回明确错误）。 */
  readonly attachments: AttachmentStore | undefined
  readonly config: BridgeConfig
  /** 记录一行日志（不含消息内容与图片数据）。 */
  readonly log: (message: string) => void
}

/** 端口被占用：带处理建议的明确错误（AC-03）。 */
export class BridgePortInUseError extends Error {
  /**
   * @param port - 冲突端口。
   * @param cause - 原始错误。
   */
  constructor(readonly port: number, cause: unknown) {
    super(
      `Midscene 桥接服务无法启动：端口 ${port} 已被其它进程占用。`
      + `请释放该端口（如 lsof -i :${port} 找到进程后停止它），或修改插件配置的 port 后重启 DSH。`
      + '本插件不会自动更换端口——静默换端口会让工作区 .env 的接入配置失配。',
      { cause },
    )
    this.name = 'BridgePortInUseError'
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
   * 启动服务。
   *
   * 端口被占用时抛 {@link BridgePortInUseError}；其余监听错误原样抛出。等待
   * `listening` 事件而不是立刻返回，保证调用方拿到的是一个已就绪的服务。
   * @returns 服务就绪后的 Promise。
   */
  async start(): Promise<void> {
    if (this.#server !== undefined) return
    const server = createServer((request, response) => {
      void this.#handle(request, response)
    })
    // 长连接与 SSE 场景：禁用请求超时（模型调用可能持续数分钟）。
    server.requestTimeout = 0
    server.headersTimeout = 0
    // 先挂错误监听再 listen：EADDRINUSE 是异步事件，晚挂会漏掉。
    await new Promise<void>((resolve, reject) => {
      const onError = (error: NodeJS.ErrnoException): void => {
        server.removeListener('listening', onListening)
        if (error.code === 'EADDRINUSE') reject(new BridgePortInUseError(this.deps.config.port, error))
        else reject(error)
      }
      const onListening = (): void => {
        server.removeListener('error', onError)
        resolve()
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(this.deps.config.port, BRIDGE_HOST)
    })
    this.#server = server
    this.deps.log(`Midscene 桥接服务已就绪：http://${BRIDGE_HOST}:${this.deps.config.port}${OPENAI_API_PREFIX}`)
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
   * 路由并处理一个请求。
   * @param request - 入站请求。
   * @param response - 出站响应。
   */
  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', `http://${BRIDGE_HOST}:${this.deps.config.port}`)
    const path = url.pathname.replace(/\/+$/u, '') || '/'
    try {
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
        sendJson(response, 200, {
          status: 'ok',
          host: BRIDGE_HOST,
          port: this.deps.config.port,
          defaultProvider: this.deps.config.defaultProvider,
          providers: snapshot.providers,
          models: snapshot.entries.length,
          attachments: this.deps.attachments !== undefined,
        })
        return
      }
      if (request.method === 'POST' && path === `${OPENAI_API_PREFIX}/chat/completions`) {
        await this.#chatCompletions(request, response)
        return
      }
      sendJson(response, 404, {
        error: { message: `unknown endpoint ${path}; available: ${OPENAI_API_PREFIX}/models, ${OPENAI_API_PREFIX}/chat/completions, ${OPENAI_API_PREFIX}/health`, type: 'invalid_request_error', code: null },
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
    const resolved = resolveModelName(rawModel, snapshot.providers, this.deps.config.defaultProvider)
    if (resolved === undefined) {
      throw new RequestConversionError(
        `model "${rawModel}" is not a "provider/model" name and no defaultProvider is configured;`
        + ` pick one from ${OPENAI_API_PREFIX}/models`,
        400,
        'invalid_request_error',
      )
    }
    const attribution = `${resolved.provider}/${resolved.model}`

    // 图片能力按宿主元数据门控：查不到该模型时不阻断（新提供方目录可能刚变，
    // 让提供方自己做权威判定并给出自己的错误）。
    const known = snapshot.entries.find(entry => entry.id === attribution)
    const supportsImage = known === undefined
      ? true
      : known.vision === true

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
      provider: resolved.provider,
      model: resolved.model,
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
    const stream = this.deps.llm.stream({ ...options, signal: controller.signal })

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
