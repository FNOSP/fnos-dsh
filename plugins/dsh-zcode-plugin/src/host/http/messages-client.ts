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

  const response = await fetchImpl(`${request.baseUrl.replace(/\/+$/u, '')}/v1/messages`, {
    method: 'POST',
    headers,
    body,
    ...(request.signal === undefined ? {} : { signal: request.signal }),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    // 3012 是网关的内容校验拒绝，给出可操作的说明而不是裸业务码。
    if (text.includes('3012')) {
      throw new Error(
        'ZCode 网关拒绝了本次请求（3012）：Start Plan 端点会校验请求里的系统提示词，'
        + '当前前缀可能已与上游版本不一致，需要重新采集官方提示词。',
      )
    }
    throw new Error(`ZCode 请求失败（HTTP ${String(response.status)}）：${text.slice(0, 300)}`)
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
