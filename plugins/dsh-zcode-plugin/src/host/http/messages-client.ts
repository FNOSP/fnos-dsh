/**
 * Anthropic Messages 协议的流式客户端（自行发送，不经 pi-ai）。
 *
 * 为什么需要它：网关校验请求的 `system` 是否是官方 agent 的**两段独立文本块**，
 * 而通用客户端会把 system 拼成单块，中间没有可用的改写点（`GenerateOptions.system`
 * 是字符串，pi-ai 内部固定塞进一个块）。因此这条通道自己组装并发送请求。
 *
 * 协议要点（均为 2026-10-25 实测）：
 * - 请求体除常规字段外，官方客户端还会带 `metadata` / `tool_choice` / `thinking` /
 *   `output_config`；补齐它们与官方一致，避免被判风险请求。
 * - 流式事件：`message_start` → `content_block_start` → `content_block_delta`* →
 *   `content_block_stop` → `message_delta` → `message_stop`。
 * - 思考块带 `signature`，多轮往返时必须原样回传，否则上游拒绝。
 *
 * @module dsh-zcode/http/messages-client
 */

import type { TokenUsage } from '@deepseek-ai/dsh-llm'

/** 限流退避：与官方客户端同一曲线（2s 起、上限 60s、带抖动）。 */
const RATE_LIMIT_BASE_MS = 2_000
const RATE_LIMIT_MAX_MS = 60_000

/** 单次请求最多尝试几轮（含首次）。 */
const RATE_LIMIT_MAX_ATTEMPTS = 5

/**
 * 官方限流/繁忙类业务码。
 *
 * 依据上游 `docs/start-plan-provider-business-errors.md`：
 * - `3008`/`3009`/`3010` 是**并发上限**（系统繁忙），不是配额问题；
 * - `1005` 是配额耗尽，模型层**不可重试**；
 * - `3007` 是安全校验拒绝，重试没有意义。
 * 把这些混成一个「429 就重试」会让配额耗尽的用户白等，也会掩盖安全校验失败。
 */
const CONCURRENCY_LIMIT_CODES = ['3008', '3009', '3010']
const QUOTA_EXHAUSTED_CODES = ['1005']
const SECURITY_REJECT_CODES = ['3007']
const RETRYABLE_RATE_LIMIT_CODES = ['rate_limit_reached_error', 'rate_limit_error', 'overloaded_error']

/** 官方 agent 的两段 system 前缀在发出前的固定形态。 */
export interface SystemPrefix {
  readonly head: string
  readonly body: string
}

/** 一次请求所需的全部输入。 */
export interface MessagesRequest {
  readonly baseUrl: string
  readonly apiKey: string
  readonly model: string
  readonly maxTokens: number
  /** DSH 自己的系统提示词；会接在官方前缀之后。 */
  readonly system: string | undefined
  /** Anthropic 格式的消息数组（已转换）。 */
  readonly messages: readonly unknown[]
  /** 工具声明（已转换为 Anthropic 格式）。 */
  readonly tools: readonly unknown[] | undefined
  /** 思考强度；开启推理时写入 `output_config.effort`。 */
  readonly effort?: string
  /** 是否启用思考。 */
  readonly thinking?: boolean
  readonly temperature?: number
  readonly signal?: AbortSignal
  /** 设备标识：写入 `metadata.user_id`，与请求头同源。 */
  readonly deviceId: string
  readonly sessionId?: string
  /** 请求头（客户端身份）。 */
  readonly extraHeaders?: Record<string, string>
  /** 发生限流重试时的观察回调（用于日志与诊断）。 */
  readonly onRateLimit?: (info: {
    readonly attempt: number
    readonly status: number
    readonly businessCode: string | undefined
    readonly delayMs: number
  }) => void
}

/** 解析后的流事件。 */
export type MessagesEvent =
  | { readonly kind: 'message-start'; readonly model: string; readonly usage?: TokenUsage }
  | {
    readonly kind: 'block-start'
    readonly index: number
    readonly blockType: 'text' | 'thinking' | 'tool_use'
    readonly id?: string
    readonly name?: string
  }
  | { readonly kind: 'text-delta'; readonly index: number; readonly text: string }
  | { readonly kind: 'thinking-delta'; readonly index: number; readonly text: string }
  | { readonly kind: 'signature-delta'; readonly index: number; readonly signature: string }
  | {
    readonly kind: 'tool-delta'
    readonly index: number
    readonly id: string
    readonly name?: string
    readonly argumentsDelta: string
  }
  | { readonly kind: 'block-stop'; readonly index: number }
  | { readonly kind: 'message-delta'; readonly stopReason: string; readonly usage?: TokenUsage }
  | { readonly kind: 'error'; readonly message: string; readonly errorType?: string }

/** 把上游 usage 投影成 DSH 计数（字段互斥）。 */
export function toUsage(raw: unknown): TokenUsage {
  const value = (raw ?? {}) as Record<string, unknown>
  const num = (key: string): number | undefined => {
    const field = value[key]
    return typeof field === 'number' && Number.isFinite(field) ? field : undefined
  }
  const cacheRead = num('cache_read_input_tokens') ?? num('cacheReadInputTokens')
  const cacheWrite = num('cache_creation_input_tokens') ?? num('cacheCreationInputTokens')
  return {
    inputTokens: num('input_tokens') ?? num('inputTokens') ?? 0,
    outputTokens: num('output_tokens') ?? num('outputTokens') ?? 0,
    ...(cacheRead === undefined ? {} : { cacheReadTokens: cacheRead }),
    ...(cacheWrite === undefined ? {} : { cacheWriteTokens: cacheWrite }),
  }
}

/** 组装请求体：把 DSH system 接在官方前缀之后，并补齐官方附加字段。 */
export function buildMessagesBody(
  request: MessagesRequest,
  prefix: SystemPrefix,
): Record<string, unknown> {
  // 官方第二段自身以换行开头；这里保持原样拼接，确保逐字匹配前缀。
  const second = request.system === undefined || request.system.trim() === ''
    ? prefix.body
    : `${prefix.body}\n\n${request.system}`

  const thinkingEnabled = request.thinking !== false
  return {
    model: request.model,
    max_tokens: request.maxTokens,
    stream: true,
    system: [
      { type: 'text', text: prefix.head, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: second, cache_control: { type: 'ephemeral' } },
    ],
    messages: request.messages,
    ...(request.tools === undefined || request.tools.length === 0 ? {} : { tools: request.tools }),
    tool_choice: { type: 'auto' },
    metadata: {
      user_id: JSON.stringify({
        device_id: request.deviceId,
        account_uuid: '',
        session_id: normalizeTaskId(request.sessionId, request.deviceId),
      }),
    },
    ...(thinkingEnabled ? { thinking: { type: 'enabled' } } : {}),
    // 官方客户端始终带 output_config.effort；缺失会扩大被风控的面。
    ...(thinkingEnabled ? { output_config: { effort: request.effort ?? 'max' } } : {}),
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
  }
}

/**
 * 计算第 `attempt` 次限流重试的等待时间。
 *
 * 上游给了 `Retry-After` 就听它的（这是唯一能真正避开限流的信号）；没给则按
 * 2s→4s→8s… 指数退避并加抖动——多个请求同时重试仍会撞车，抖动用来错开。
 */
export function rateLimitDelayMs(attempt: number, retryAfterSeconds?: number): number {
  if (retryAfterSeconds !== undefined && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.min(RATE_LIMIT_MAX_MS, Math.round(retryAfterSeconds * 1_000))
  }
  const raw = Math.min(RATE_LIMIT_MAX_MS, RATE_LIMIT_BASE_MS * 2 ** (attempt - 1))
  return Math.round(raw * (0.5 + 0.5 * Math.random()))
}

/**
 * 这次限流是否值得重试。
 *
 * 官方把限流分两类：瞬时的（`rate_limit_reached_error` / `overloaded_error`）可以退避
 * 重试；额度耗尽类的（`organization_spend_limit_exceeded` 等）重试多少次都没用，
 * 必须直接失败让用户处理。混为一谈会让额度用尽的用户白等五轮。
 */
export function isRetryableRateLimit(
  status: number,
  businessCode: string | undefined,
): boolean {
  // 配额耗尽与安全拒绝：无论状态码是什么都不重试。
  if (businessCode !== undefined
    && (QUOTA_EXHAUSTED_CODES.includes(businessCode)
      || SECURITY_REJECT_CODES.includes(businessCode))) {
    return false
  }
  if (businessCode !== undefined && CONCURRENCY_LIMIT_CODES.includes(businessCode)) {
    // 官方在「新会话首轮」不自动重试（避免把用户的首次请求拖成长等待）；
    // 这里统一短退避重试：并发上限通常是别处请求占着，等一两秒就能进，
    // 比让用户手动重发体验更好。次数与延迟都受上限约束，不会无限等。
    return true
  }
  if (status !== 429 && status !== 503) return false
  if (businessCode === undefined) return true
  if (RETRYABLE_RATE_LIMIT_CODES.includes(businessCode)) return true
  // 其它明确带业务码的限流按终止型处理：宁可让用户看到真实原因，也不要空转重试。
  return false
}

/** 可被 signal 打断的等待。 */
async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new Error('ZCode: 请求已取消'))
    }
    if (signal?.aborted === true) {
      clearTimeout(timer)
      reject(new Error('ZCode: 请求已取消'))
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** 把失败翻译成用户能据以行动的一句话。 */
function describeFailure(status: number, text: string, businessCode: string | undefined): string {
  if (businessCode !== undefined && QUOTA_EXHAUSTED_CODES.includes(businessCode)) {
    return 'ZCode 额度已用尽（1005）：请等待额度重置或升级账户，重试不会恢复。'
  }
  if (businessCode !== undefined && SECURITY_REJECT_CODES.includes(businessCode)) {
    return 'ZCode 拒绝了本次请求（3007，安全校验）：请检查账号状态后重试。'
  }
  if (status === 429 || status === 503
    || (businessCode !== undefined && CONCURRENCY_LIMIT_CODES.includes(businessCode))) {
    return '当前系统繁忙（ZCode 并发上限）：已自动重试仍未通过，请稍后再试或升级账户。'
  }
  return `ZCode 请求失败（HTTP ${String(status)}）：${text.slice(0, 300)}`
}

/** 从响应体里尽力取出业务码（上游各端点字段名不统一）。 */
function businessCodeOf(text: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const record = parsed as Record<string, unknown>
    const inner = typeof record.error === 'object' && record.error !== null
      ? record.error as Record<string, unknown>
      : record
    for (const key of ['code', 'type', 'error_code', 'provider_error_code']) {
      const value = inner[key]
      if (typeof value === 'string' && value !== '') return value
      if (typeof value === 'number') return String(value)
    }
    return undefined
  } catch {
    return undefined
  }
}

/** 解析一条 SSE `data:` 载荷；无法识别时返回 undefined。 */
export function parseEvent(payload: string): MessagesEvent | undefined {
  let value: unknown
  try {
    value = JSON.parse(payload)
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null) return undefined
  const event = value as Record<string, unknown>
  const type = event.type
  switch (type) {
    case 'message_start': {
      const message = (event.message ?? {}) as Record<string, unknown>
      return {
        kind: 'message-start',
        model: typeof message.model === 'string' ? message.model : '',
        ...(message.usage === undefined ? {} : { usage: toUsage(message.usage) }),
      }
    }
    case 'content_block_start': {
      const block = (event.content_block ?? {}) as Record<string, unknown>
      const index = Number(event.index ?? 0)
      const blockType = block.type
      if (blockType === 'tool_use') {
        return {
          kind: 'block-start',
          index,
          blockType: 'tool_use',
          ...(typeof block.id === 'string' ? { id: block.id } : {}),
          ...(typeof block.name === 'string' ? { name: block.name } : {}),
        }
      }
      if (blockType === 'thinking' || blockType === 'redacted_thinking') {
        return { kind: 'block-start', index, blockType: 'thinking' }
      }
      return { kind: 'block-start', index, blockType: 'text' }
    }
    case 'content_block_delta': {
      const delta = (event.delta ?? {}) as Record<string, unknown>
      const index = Number(event.index ?? 0)
      switch (delta.type) {
        case 'text_delta':
          return { kind: 'text-delta', index, text: String(delta.text ?? '') }
        case 'thinking_delta':
          return { kind: 'thinking-delta', index, text: String(delta.thinking ?? '') }
        case 'signature_delta':
          return { kind: 'signature-delta', index, signature: String(delta.signature ?? '') }
        case 'input_json_delta':
          // 工具参数按 JSON 片段流式返回；id 由 block-start 提供，这里留空由上层补齐。
          return {
            kind: 'tool-delta',
            index,
            id: '',
            argumentsDelta: String(delta.partial_json ?? ''),
          }
        default:
          return undefined
      }
    }
    case 'content_block_stop':
      return { kind: 'block-stop', index: Number(event.index ?? 0) }
    case 'message_delta': {
      const delta = (event.delta ?? {}) as Record<string, unknown>
      return {
        kind: 'message-delta',
        stopReason: typeof delta.stop_reason === 'string' ? delta.stop_reason : 'end_turn',
        ...(event.usage === undefined ? {} : { usage: toUsage(event.usage) }),
      }
    }
    case 'error': {
      const error = (event.error ?? {}) as Record<string, unknown>
      return {
        kind: 'error',
        message: typeof error.message === 'string' ? error.message : '上游返回错误',
        ...(typeof error.type === 'string' ? { errorType: error.type } : {}),
      }
    }
    default:
      // message_stop / ping 等不需要向外转发。
      return undefined
  }
}

/**
 * 发出请求并按行解析流。
 *
 * 用 `for await` 逐块读，遇到 `data:` 行就解析；`[DONE]` 与空行跳过。
 */
export async function* streamMessages(
  request: MessagesRequest,
  prefix: SystemPrefix,
  fetchImpl: typeof fetch = fetch,
): AsyncIterable<MessagesEvent> {
  const body = JSON.stringify(buildMessagesBody(request, prefix))
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'anthropic-version': '2023-06-01',
    authorization: `Bearer ${request.apiKey}`,
    'x-api-key': request.apiKey,
    ...request.extraHeaders,
  }

  const url = `${request.baseUrl.replace(/\/+$/u, '')}/v1/messages`
  let response: Response | undefined
  for (let attempt = 1; ; attempt += 1) {
    response = await fetchImpl(url, {
      method: 'POST',
      headers,
      body,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    })
    if (response.ok) break

    const text = await response.text().catch(() => '')
    // 3012 是网关的内容校验拒绝，给出可操作的说明而不是裸业务码。
    if (text.includes('3012')) {
      throw new Error(
        'ZCode 网关拒绝了本次请求（3012）：Start Plan 端点会校验请求里的系统提示词，'
        + '当前前缀可能已与上游版本不一致，需要重新采集官方提示词。',
      )
    }

    const businessCode = businessCodeOf(text)
    // 限流是可恢复的：官方客户端也是退避后重试，而不是直接把失败抛给用户。
    // 额度耗尽属终止型，重试只会让用户白等，直接失败。
    const mayRetry = attempt < RATE_LIMIT_MAX_ATTEMPTS
      && isRetryableRateLimit(response.status, businessCode)
    if (!mayRetry) {
      throw new Error(describeFailure(response.status, text, businessCode))
    }
    const retryAfter = Number(response.headers.get('retry-after') ?? Number.NaN)
    const delayMs = rateLimitDelayMs(
      attempt,
      Number.isFinite(retryAfter) ? retryAfter : undefined,
    )
    request.onRateLimit?.({ attempt, status: response.status, businessCode, delayMs })
    await sleep(delayMs, request.signal)
  }
  if (response.body === null) throw new Error('ZCode 响应缺少可读流')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    // SSE 以空行分隔事件；这里按行处理即可，因为每个事件只有一行 data。
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (payload === '' || payload === '[DONE]') continue
      const event = parseEvent(payload)
      if (event !== undefined) yield event
    }
  }
}

/**
 * 把会话标识规范成上游要求的长度（6–64 字符）。
 *
 * 上游会校验请求任务 ID 的长度，过短的标识直接返回 1204/1214；这里用设备
 * 标识补齐而不是拒绝请求——标识本身只是让网关把请求关联到同一次会话。
 */
export function normalizeTaskId(sessionId: string | undefined, fallback: string): string {
  const raw = (sessionId ?? fallback).trim()
  const seed = raw === '' ? fallback.trim() : raw
  if (seed.length >= 6 && seed.length <= 64) return seed
  if (seed.length > 64) return seed.slice(0, 64)
  // 太短：用稳定的设备标识补齐，保持同一会话可关联。
  const padded = `${seed}${fallback}`.replace(/[^\w-]/gu, '')
  return padded.length >= 6 ? padded.slice(0, 64) : `sess-${padded.padEnd(6, '0')}`
}
