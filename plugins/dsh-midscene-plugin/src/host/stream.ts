/**
 * 流式聚合与错误映射（FNOS-013-03）。
 *
 * 桥向客户端提供两种形态：流式（标准 OpenAI SSE，`data: {...}\n\n` + `data: [DONE]`）
 * 与非流式（一次性完整响应）。宿主模型层的调用**始终是流式**（`ctx.llm.stream()`），
 * 因此非流式只是把 chunk 流聚合起来——提供方的请求形态约束（如某提供方仅接受
 * 流式）由其适配器在宿主内处理，桥不感知（需求行为约束）。
 */

/** 标准 OpenAI 聊天补全的增量分片形态。 */
interface OpenAiChunk {
  readonly id: string
  readonly object: 'chat.completion.chunk'
  readonly created: number
  readonly model: string
  readonly choices: readonly {
    readonly index: number
    readonly delta: Record<string, unknown>
    readonly finish_reason: string | null
  }[]
}

import type { FinishReason, StreamChunk } from '@deepseek-ai/dsh-llm'

/** harness 的 `finish` 原因 → OpenAI 的 `finish_reason`。 */
const FINISH_REASONS: Readonly<Record<string, string>> = {
  stop: 'stop',
  // harness 的 kind 是 `max-tokens`（不是 OpenAI 的 `length`）。
  'max-tokens': 'length',
  'tool-calls': 'tool_calls',
  'tool-call': 'tool_calls',
  content_filter: 'content_filter',
  // 中止与错误在 OpenAI 侧没有对应值；给出 `stop` 会让客户端误认为回答完整，
  // 因此映射为一个明确表示异常结束的值。
  aborted: 'aborted',
  error: 'error',
}

/**
 * 把 harness 的结束原因映射为 OpenAI 的 `finish_reason`。
 *
 * harness 的 `FinishReason` 是带 `kind` 的对象（可按 kind 联合扩展），不是字符串；
 * 未知 kind 回落 `stop`：客户端（Midscene）只按「有没有正常结束」判断，给出一个
 * 非 null 值比泄漏宿主内部词汇更有用。
 * @param reason - harness 结束原因。
 * @returns OpenAI `finish_reason`。
 */
export function toFinishReason(reason: FinishReason): string {
  // 防御性取值：宿主契约里 reason 必有 kind，但它是合并可扩展的联合，外部
  // （或未来适配器）传入非对象值时不该让整个响应组装崩掉。
  const kind = (reason as { kind?: unknown } | null | undefined)?.kind
  if (typeof kind !== 'string') return 'stop'
  return FINISH_REASONS[kind] ?? 'stop'
}

/** 一次聚合的结果。 */
export interface AggregatedAnswer {
  /** 拼接后的可见文本。 */
  readonly text: string
  /** 拼接后的推理内容（若有）。 */
  readonly reasoning: string
  /** 结束原因（harness 原值）。 */
  readonly finishReason: FinishReason
  /** token 用量（宿主给出时）。 */
  readonly usage?: { prompt_tokens: number, completion_tokens: number, total_tokens: number }
  /** 模型产出的工具调用（桥不断言其语义，原样透出）。 */
  readonly toolCalls: readonly { id: string, name: string, arguments: string }[]
  /**
   * 结束原因为 `error`/`aborted` 时宿主给出的失败详情。
   *
   * 宿主把提供方失败编码进 `finish` 分片（`failure.message`/`code`），此时流里
   * 没有文本产出。丢掉它会让客户端看到一个「成功的空回答」——真实原因（未配置
   * 凭据、额度不足）就此消失，这正是 FNOS-013-04-AC-04 要求避免的。
   */
  readonly failure?: { readonly message: string, readonly code: string, readonly status?: number }
}

/**
 * 聚合 harness 分片流为一次完整回答。
 *
 * 文本按 `index` 归位后拼接（一个回答可能有多个文本块）；工具调用的参数是
 * 增量字符串，按 index 累积。
 * @param chunks - harness 分片流。
 * @returns 聚合结果。
 */
export async function aggregateStream(
  chunks: AsyncIterable<StreamChunk>,
): Promise<AggregatedAnswer> {
  const textByIndex = new Map<number, string>()
  const reasoningByIndex = new Map<number, string>()
  const toolCalls = new Map<number, { id: string, name: string, arguments: string }>()
  let finishReason: FinishReason = { kind: 'stop' }
  let usage: AggregatedAnswer['usage']
  let failure: AggregatedAnswer['failure']

  for await (const chunk of chunks) {
    switch (chunk.type) {
      case 'text-delta':
        textByIndex.set(chunk.index, (textByIndex.get(chunk.index) ?? '') + chunk.text)
        break
      case 'reasoning-delta':
        reasoningByIndex.set(chunk.index, (reasoningByIndex.get(chunk.index) ?? '') + chunk.text)
        break
      case 'tool-call-delta': {
        const current = toolCalls.get(chunk.index) ?? { id: chunk.id, name: '', arguments: '' }
        toolCalls.set(chunk.index, {
          id: current.id,
          name: chunk.name ?? current.name,
          arguments: current.arguments + chunk.argumentsDelta,
        })
        break
      }
      case 'usage':
        usage = {
          prompt_tokens: chunk.usage.inputTokens,
          completion_tokens: chunk.usage.outputTokens,
          total_tokens: chunk.usage.totalTokens ?? chunk.usage.inputTokens + chunk.usage.outputTokens,
        }
        break
      case 'finish': {
        finishReason = chunk.reason
        const detail = (chunk.reason as { failure?: { message?: unknown, code?: unknown, status?: unknown } }).failure
        if (typeof detail?.message === 'string') {
          failure = {
            message: detail.message,
            code: typeof detail.code === 'string' ? detail.code : 'UNKNOWN',
            ...typeof detail.status === 'number' ? { status: detail.status } : {},
          }
        }
        break
      }
      default:
        // block-start / block-end 不携带增量文本，聚合时无需特殊处理。
        break
    }
  }

  return {
    text: [...textByIndex.entries()].sort(([a], [b]) => a - b).map(([, text]) => text).join(''),
    reasoning: [...reasoningByIndex.entries()].sort(([a], [b]) => a - b).map(([, text]) => text).join(''),
    finishReason,
    ...usage === undefined ? {} : { usage },
    ...failure === undefined ? {} : { failure },
    toolCalls: [...toolCalls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call),
  }
}

/**
 * 构造一条流式分片（标准 OpenAI chunk）。
 * @param id - 补全 id（同一次回答内保持不变）。
 * @param model - 对外模型标识。
 * @param created - 创建时间（秒）。
 * @param delta - 增量字段。
 * @param finishReason - 结束原因；未结束时为 `null`。
 * @returns 分片对象。
 */
export function makeChunk(
  id: string,
  model: string,
  created: number,
  delta: Record<string, unknown>,
  finishReason: string | null,
): OpenAiChunk {
  return {
    id,
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  }
}

/**
 * 一条 SSE 数据行。
 * @param payload - 要发送的对象，或 `[DONE]` 终止标记。
 * @returns 序列化后的 SSE 文本。
 */
export function sseLine(payload: unknown): string {
  return `data: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}\n\n`
}

/**
 * 把任意异常映射为标准 OpenAI 错误对象与 HTTP 状态码。
 *
 * 需求 AC-04：错误信息可定位到「提供方/模型」。因此归因（provider/model）
 * 由调用方通过 `attribution` 传入并前置到消息里——桥不解析宿主错误文本去
 * 猜提供方，那会在文案变化时静默失效。
 * @param error - 捕获到的异常。
 * @param attribution - 本次请求定位到的「提供方/模型」；未解析出时省略。
 * @returns 状态码与标准错误体。
 */
export function toOpenAiError(
  error: unknown,
  attribution?: string,
): { status: number, body: { error: { message: string, type: string, code: string | null } } } {
  const prefix = attribution === undefined ? '' : `${attribution}: `
  // 宿主错误：带稳定 code（HarnessError 家族），按 code 分类。
  const code = (error as { code?: unknown })?.code
  const message = error instanceof Error ? error.message : String(error)
  if (typeof code === 'string' && code.length > 0) {
    if (code === 'NO_ADAPTER' || code === 'UNKNOWN_PROVIDER' || code === 'MISSING_CREDENTIAL' || code === 'INVALID_CREDENTIAL') {
      return {
        status: 400,
        body: {
          error: {
            message: `${prefix}${message}（请在 DSH Web 设置中确认该提供方已登录/已配置，或改用 /v1/models 列出的其它模型）`,
            type: 'invalid_request_error',
            code,
          },
        },
      }
    }
    if (code === 'QUOTA' || code === 'ACCOUNT_QUOTA') {
      return { status: 429, body: { error: { message: `${prefix}${message}`, type: 'insufficient_quota', code } } }
    }
    if (code === 'CONTEXT_WINDOW_EXCEEDED') {
      return { status: 400, body: { error: { message: `${prefix}${message}`, type: 'invalid_request_error', code } } }
    }
    return { status: 502, body: { error: { message: `${prefix}${message}`, type: 'upstream_error', code } } }
  }
  return { status: 502, body: { error: { message: `${prefix}${message}`, type: 'upstream_error', code: null } } }
}
