/**
 * DSH 请求 → Anthropic Messages 的格式转换。
 *
 * 只做纯数据搬运，不发请求、不读环境，便于直接对拍断言。
 *
 * @module dsh-zcode/http/translate
 */

import type { ContentBlock, RequestMessage, ToolSchema } from '@deepseek-ai/dsh-llm'

/** 一条 Anthropic 消息。 */
export interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: readonly unknown[]
}

/** 从消息里取出纯文本（system 消息或拼接用）。 */
export function messageText(message: RequestMessage): string {
  const content = message.content
  if (typeof content === 'string') return content
  return content
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('')
}

/** 取出首条 system 消息的文本；没有则返回 undefined。 */
export function leadingSystem(messages: readonly RequestMessage[]): string | undefined {
  const first = messages[0]
  if (first === undefined || first.role !== 'system') return undefined
  const text = messageText(first)
  return text.trim() === '' ? undefined : text
}

/**
 * 把 DSH 消息转换成 Anthropic 消息数组。
 *
 * - system 消息由调用方单独放进 `system` 字段，这里跳过；
 * - `tool-call` 块转成 `tool_use`；
 * - 工具结果消息转成带 `tool_result` 块的 user 消息（Anthropic 要求如此）；
 * - 图片块转成 base64 image 块（由调用方提供读取字节的能力）。
 */
export async function toAnthropicMessages(
  messages: readonly RequestMessage[],
  readImage?: (block: Extract<ContentBlock, { type: 'image' }>) => Promise<{ mediaType: string; data: string } | undefined>,
): Promise<AnthropicMessage[]> {
  const result: AnthropicMessage[] = []
  for (const message of messages) {
    if (message.role === 'system' || message.role === 'developer') continue

    if (message.role === 'tool') {
      // 工具结果必须挂在 user 消息里；相邻的多条结果合并进同一条。
      const block = {
        type: 'tool_result',
        tool_use_id: String(message.toolCallId),
        content: messageText(message),
        ...(message.isError === true ? { is_error: true } : {}),
      }
      const last = result.at(-1)
      if (last !== undefined && last.role === 'user' && isToolResultOnly(last)) {
        (last.content as unknown[]).push(block)
      } else {
        result.push({ role: 'user', content: [block] })
      }
      continue
    }

    const content: readonly ContentBlock[] = typeof message.content === 'string'
      ? [{ type: 'text' as const, text: message.content }]
      : message.content
    const blocks: unknown[] = []
    for (const item of content) {
      switch (item.type) {
        case 'text':
          if (item.text !== '') blocks.push({ type: 'text', text: item.text })
          break
        case 'reasoning':
          // 思考块由 replayState 负责跨轮回传；普通历史里不重放，避免签名缺失报错。
          break
        case 'tool-call':
          blocks.push({
            type: 'tool_use',
            id: String(item.id),
            name: item.name,
            input: parseArguments(item.arguments),
          })
          break
        case 'image': {
          const image = readImage === undefined ? undefined : await readImage(item)
          if (image !== undefined) {
            blocks.push({
              type: 'image',
              source: { type: 'base64', media_type: image.mediaType, data: image.data },
            })
          }
          break
        }
        default:
          // file / tool-addition / tool-removal 不进入模型请求。
          break
      }
    }
    if (blocks.length === 0) continue
    result.push({ role: message.role === 'assistant' ? 'assistant' : 'user', content: blocks })
  }
  return result
}

/** 工具参数是模型产出的 JSON 字符串；解析失败时给空对象而不是让请求失败。 */
function parseArguments(raw: string): unknown {
  const text = raw.trim()
  if (text === '') return {}
  try {
    return JSON.parse(text)
  } catch {
    return {}
  }
}

/** 这条 user 消息是否只承载工具结果（可继续追加）。 */
function isToolResultOnly(message: AnthropicMessage): boolean {
  return message.content.every(
    block => typeof block === 'object' && block !== null && (block as { type?: unknown }).type === 'tool_result',
  )
}

/** DSH 工具声明 → Anthropic tools。 */
export function toAnthropicTools(tools: readonly ToolSchema[] | undefined): readonly unknown[] | undefined {
  if (tools === undefined || tools.length === 0) return undefined
  return tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  }))
}

/** DSH 思考等级 → Anthropic `output_config.effort`。 */
export function toEffort(
  level: string | undefined,
  map?: Readonly<Record<string, string | null>>,
): string {
  // 目录映射是权威来源：它以同一份上游元数据生成，优先级高于下面的兜底表。
  if (level !== undefined && map !== undefined) {
    const mapped = map[level]
    if (typeof mapped === 'string') return mapped
  }
  switch (level) {
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
