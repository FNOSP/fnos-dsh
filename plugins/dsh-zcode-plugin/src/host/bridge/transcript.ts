/**
 * 把 DSH 的请求消息压成一段纯文本交给 agent。
 *
 * 这条通道里真正的工具执行者是 ZCode agent 自己，DSH 的工具 schema 不参与请求；
 * 因此这里只投递对话正文，并在首轮附一段「工具归属」说明，避免模型照着 DSH
 * 系统提示里的工具清单编造调用文本。
 *
 * @module dsh-zcode/bridge/transcript
 */

/** 单条请求消息的结构视图（只取本模块需要的字段）。 */
export interface BridgeMessageLike {
  readonly role?: unknown
  readonly content?: unknown
}

/** 从内容块里抽出的纯文本片段。 */
interface Extracted {
  readonly text: string
  /** 图片在消息内的出现序号（从 1 开始），用于与后续路径列表对齐。 */
  readonly imageCount: number
}

/** 判断值是否为普通对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 角色名归一：DSH 的 `system` 在这个通道里按「系统提示」呈现。 */
function roleLabel(role: unknown): string {
  if (role === 'user') return '用户'
  if (role === 'assistant') return '助手'
  if (role === 'system') return '系统'
  return '上下文'
}

/** 把一个内容块投影成文本。 */
function blockText(block: unknown, imageIndex: number): { text: string; images: number } {
  if (typeof block === 'string') return { text: block, images: 0 }
  if (!isRecord(block)) return { text: '', images: 0 }
  const type = block.type
  if (type === 'text') {
    const value = block.text
    return { text: typeof value === 'string' ? value : '', images: 0 }
  }
  if (type === 'reasoning') {
    // 历史里的思考内容对后续轮次没有价值，且会显著放大上下文。
    return { text: '', images: 0 }
  }
  if (type === 'image') {
    return { text: `[图片 #${String(imageIndex)}]`, images: 1 }
  }
  if (type === 'file') {
    const name = block.name
    return { text: `[文件${typeof name === 'string' ? `：${name}` : ''}]`, images: 0 }
  }
  if (type === 'tool-call') {
    const name = block.name
    const args = block.arguments
    const rendered = typeof args === 'string' ? args : JSON.stringify(args ?? {})
    return {
      text: `[上一次工具调用 ${typeof name === 'string' ? name : 'unknown'}：${rendered.slice(0, 4_000)}]`,
      images: 0,
    }
  }
  if (type === 'tool-addition' || type === 'tool-removal') return { text: '', images: 0 }
  return { text: '', images: 0 }
}

/** 提取一条消息的文本与图片数量。 */
export function extractMessage(message: BridgeMessageLike): Extracted {
  const content = message.content
  if (typeof content === 'string') return { text: content, imageCount: 0 }
  if (!Array.isArray(content)) return { text: '', imageCount: 0 }
  const parts: string[] = []
  let images = 0
  for (const block of content) {
    const projected = blockText(block, images + 1)
    images += projected.images
    if (projected.text !== '') parts.push(projected.text)
  }
  return { text: parts.join('\n'), imageCount: images }
}

/** 最后一条用户消息的正文。 */
export function lastUserText(messages: readonly BridgeMessageLike[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role !== 'user') continue
    const text = extractMessage(message).text.trim()
    if (text !== '') return text
  }
  return ''
}

/** 第一条用户消息的正文（用于本地生成会话标题）。 */
export function firstUserText(messages: readonly BridgeMessageLike[]): string {
  for (const message of messages) {
    if (message.role !== 'user') continue
    const text = extractMessage(message).text.trim()
    if (text !== '') return text
  }
  return ''
}

/** 首轮重放用的完整对话文本。 */
export function flattenConversation(messages: readonly BridgeMessageLike[]): string {
  const lines: string[] = []
  for (const message of messages) {
    const { text } = extractMessage(message)
    const trimmed = text.trim()
    if (trimmed === '') continue
    lines.push(`【${roleLabel(message.role)}】${trimmed}`)
  }
  return lines.join('\n\n')
}

/** 标题指令的特征词：出现这些说明这段文本是指令而不是人话。 */
const TITLE_INSTRUCTION = /(?:generate the session title|json array of human messages|create a concise title)/i

/** 在一段文本里找「人话 JSON 数组」并取出第一条正文；找不到返回 undefined。 */
function humanTextFromJsonArray(text: string): string | undefined {
  let start = text.indexOf('[')
  while (start !== -1) {
    const end = text.lastIndexOf(']')
    if (end > start) {
      let parsed: unknown
      try {
        parsed = JSON.parse(text.slice(start, end + 1))
      } catch {
        parsed = undefined
      }
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          if (!isRecord(entry)) continue
          const value = extractMessage({ role: entry.role, content: entry.content }).text.trim()
          if (value !== '') return value
        }
      }
    }
    start = text.indexOf('[', start + 1)
  }
  return undefined
}

/**
 * 从 DSH 的会话标题请求里取出真实的用户消息正文。
 *
 * DSH 的标题提供方把「英文指令」和「人话 JSON 数组」一起发给模型（分别可能落在
 * 同一条用户消息、不同消息或系统提示里）。直接取文本会把指令当成标题——实测事故
 * 就是这样产生 `Generate the session tit` 这种标题。因此这里只在整份请求里找
 * JSON 数组；确实找不到时返回空串，让调用方交回默认标题，而不是造一个垃圾标题。
 */
export function titleSourceText(
  messages: readonly BridgeMessageLike[],
  system?: string,
): string {
  const candidates: string[] = []
  for (const message of messages) {
    if (message.role !== 'user') continue
    candidates.push(extractMessage(message).text)
  }
  if (typeof system === 'string' && system !== '') candidates.push(system)
  for (const text of candidates) {
    const value = humanTextFromJsonArray(text)
    if (value !== undefined && !TITLE_INSTRUCTION.test(value)) return value
  }
  // 没有任何人话 JSON 时，只在文本确定不是指令的情况下才用它当标题。
  const first = firstUserText(messages)
  return TITLE_INSTRUCTION.test(first) ? '' : first
}

/** 首轮重放时附在整段对话前面的硬规则（首因位置）。 */
export const BRIDGE_TOOL_RULE = `【工具归属 · 最高优先级】
你正在 ZCode agent 运行时里执行这次对话。你可用的工具只有本运行时自带的原生工具（Bash、Read、Write、Edit、Glob、Grep、web 检索等），需要实际操作时直接调用它们。
下面历史里出现的 DSH（宿主应用）工具清单属于宿主，在本运行时中不存在：不要调用、不要模仿其调用格式，也不要把 <antml:invoke> 之类的调用标记写进回复正文。
需要运行命令一律通过 Bash；需要读文件用 Read。`

/** 首轮重放时附在末尾的补充说明（近因位置）。 */
export const BRIDGE_TOOL_NOTE = `【补充】本次对话由宿主桥接层转发：宿主侧的会话历史会整段带来，你只需按上面的工具归属规则行动。回答用中文，除非用户使用其他语言。`

/** 伪工具调用标记：正文里一旦出现就说明模型把调用写进了文本。 */
const LEAK_TAG = /<(?:antml:|function_calls\b)/

/** 判断一段增量是否已经开始泄漏伪调用标记。 */
export function looksLikeLeakedCall(text: string): boolean {
  return LEAK_TAG.test(text)
}

/**
 * 把整段的伪调用块压成占位符（用于思考流，避免标签渣进入思考块）。
 */
export function sanitizeLeakedCalls(text: string): string {
  if (!LEAK_TAG.test(text)) return text
  const PLACEHOLDER = '〔工具调用标记已拦截〕'
  return text
    // 已闭合的完整调用块：整块换成占位符（只删标签会把参数正文留在回复里）。
    .replace(/<antml:[\s\S]*?<\/antml:[^>]*>/g, PLACEHOLDER)
    // 流式半段（还没等到闭合）：从开标签一路替换到结尾，避免参数漏出。
    .replace(/<antml:[\s\S]*$/, PLACEHOLDER)
    // 落单的开/闭标签。
    .replace(/<\/?antml:[^>]*>/g, '')
    .replace(/<\/?function_calls[^>]*>/g, '')
}

/**
 * 把 DSH 的模型 id 映射成 agent registry 里的规范 id。
 *
 * DSH 侧目录 id 来自额度接口（全小写，如 `glm-5.3-flash`），而 agent 的
 * registry 用发行包里的书写形态（`GLM-5.3-Flash`）。两者只差大小写与分隔符，
 * 精确匹配失败会让 `session/setModel` 报「Provider Registry 中不存在 Model」。
 */
export const ZCODE_AGENT_MODEL_IDS: readonly string[] = [
  'GLM-5.3',
  'GLM-5.3-Flash',
  'GLM-5.2',
  'GLM-5-Turbo',
]

/** id 归一：去掉大小写与分隔符差异。 */
export function normalizeModelKey(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9.]/g, '')
}

/** 映射到 agent 规范 id；没有对应项时原样返回。 */
export function agentModelId(modelId: string): string {
  const key = normalizeModelKey(modelId)
  return ZCODE_AGENT_MODEL_IDS.find(candidate => normalizeModelKey(candidate) === key) ?? modelId
}
