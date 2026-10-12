/**
 * OpenAI 请求词汇 ↔ harness 请求词汇转换（FNOS-013-03）。
 *
 * 桥收到的是标准 OpenAI 结构（`messages` 里角色为
 * `system`/`user`/`assistant`/`tool`，内容可以是字符串或内容块数组，
 * 图片以 `image_url` 的数据 URI 形式给出）。这里把它翻译成
 * `GenerateOptions` 所需的 `RequestMessage[]`。
 *
 * 图片的处理方式是本模块的关键决策：harness 的 `ImageBlock` 引用的是
 * **持久附件**（`ImageAttachmentRef`），而桥收到的是内联数据 URI。因此桥在
 * 转换时把数据 URI 交给宿主的附件服务落成一个一次性附件，再以标准
 * `ImageBlock` 引用它——不自定义任何绕过附件的通道（那会绕过宿主的图片策略
 * 与计费口径）。PNG/JPEG/WebP/GIF 四类受支持，其余类型拒绝（附件服务同样只
 * 接受这四类）。
 */
import type { ContentBlock, RequestMessage, ToolCallId, ToolSchema } from '@deepseek-ai/dsh-llm'
import type { AttachmentStore, ImageMediaType } from '@deepseek-ai/dsh-attachment'

/** 桥接受的图片媒体类型（与宿主附件服务一致）。 */
const IMAGE_MEDIA_TYPES: readonly ImageMediaType[] = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

/** 转换阶段的失败：带可读原因，供 HTTP 层映射为标准错误。 */
export class RequestConversionError extends Error {
  /**
   * @param message - 面向调用者的说明。
   * @param status - 建议的 HTTP 状态码。
   * @param code - 标准 OpenAI 错误码。
   */
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message)
    this.name = 'RequestConversionError'
  }
}

/** OpenAI 文本内容块。 */
interface OpenAiTextPart {
  type: 'text'
  text?: unknown
}

/** OpenAI 图片内容块。 */
interface OpenAiImagePart {
  type: 'image_url'
  image_url?: { url?: unknown }
}

/** OpenAI 其它内容块（识别不出具体类型时按无内容处理）。 */
interface OpenAiOtherPart {
  type: string
}

/** OpenAI 内容块（文本 / 图片 / 其它）。 */
type OpenAiContentPart = OpenAiTextPart | OpenAiImagePart | OpenAiOtherPart

/** 判断是否为文本块。 */
function isTextPart(part: OpenAiContentPart): part is OpenAiTextPart {
  return part.type === 'text'
}

/** 判断是否为图片块。 */
function isImagePart(part: OpenAiContentPart): part is OpenAiImagePart {
  return part.type === 'image_url'
}

/** OpenAI 单条消息（宽松解析：只读取关心的字段）。 */
interface OpenAiMessage {
  role?: unknown
  content?: unknown
  tool_call_id?: unknown
  tool_calls?: unknown
}

/** 转换所需的外部依赖。 */
export interface ConversionContext {
  /** 宿主附件服务；图片落盘用。 */
  readonly attachments: AttachmentStore | undefined
  /** 所选模型是否支持图片输入（宿主元数据）。 */
  readonly supportsImage: boolean
}

/**
 * 解析 `data:` URI 为媒体类型与字节。
 *
 * 只接受 `data:<mediaType>;base64,<payload>` 形式——这是 OpenAI 客户端传内联
 * 图片的唯一标准形式；远程 URL 形式不被接受，因为它会让桥变成任意 URL 的
 * 抓取器（应当由客户端自己取回后以内联形式给出）。
 * @param url - `image_url` 字段的值。
 * @returns 媒体类型与字节；不是受支持的数据 URI 时为 `undefined`。
 */
export function parseDataUri(url: string): { mediaType: ImageMediaType, data: Uint8Array } | undefined {
  const match = /^data:([a-z]+\/[a-z0-9.+-]+);base64,(.*)$/isu.exec(url.trim())
  if (match === null) return undefined
  const mediaType = match[1]!.toLowerCase() as ImageMediaType
  if (!IMAGE_MEDIA_TYPES.includes(mediaType)) return undefined
  try {
    const data = Buffer.from(match[2]!, 'base64')
    if (data.byteLength === 0) return undefined
    return { mediaType, data: new Uint8Array(data) }
  } catch {
    return undefined
  }
}

/**
 * 把一条 OpenAI 消息的内容转换为 harness 内容块。
 * @param message - 原始消息。
 * @param index - 消息序号（错误信息定位用）。
 * @param context - 转换依赖。
 * @returns 内容块数组。
 */
async function contentBlocks(
  message: OpenAiMessage,
  index: number,
  context: ConversionContext,
): Promise<ContentBlock[]> {
  const content = message.content
  if (typeof content === 'string') {
    return content.length === 0 ? [] : [{ type: 'text', text: content }]
  }
  if (!Array.isArray(content)) return []

  const blocks: ContentBlock[] = []
  const pendingImages: { mediaType: ImageMediaType, data: Uint8Array }[] = []
  for (const part of content as OpenAiContentPart[]) {
    if (part === null || typeof part !== 'object') continue
    if (isTextPart(part) && typeof part.text === 'string' && part.text.length > 0) {
      blocks.push({ type: 'text', text: part.text })
      continue
    }
    if (isImagePart(part)) {
      const url = part.image_url?.url
      if (typeof url !== 'string') {
        throw new RequestConversionError(`messages[${index}]: image_url.url must be a string`, 400, 'invalid_request_error')
      }
      if (!context.supportsImage) {
        throw new RequestConversionError(
          `messages[${index}]: the selected model does not accept image input; choose a model with "vision": true from /v1/models`,
          400,
          'invalid_request_error',
        )
      }
      const parsed = parseDataUri(url)
      if (parsed === undefined) {
        throw new RequestConversionError(
          `messages[${index}]: image_url.url must be a base64 data URI of type png/jpeg/webp/gif`,
          400,
          'invalid_request_error',
        )
      }
      pendingImages.push(parsed)
    }
  }

  if (pendingImages.length > 0) {
    if (context.attachments === undefined) {
      throw new RequestConversionError(
        'image input requires the DSH attachment service, which is unavailable in this profile',
        503,
        'service_unavailable',
      )
    }
    const refs = await context.attachments.saveImages(
      pendingImages.map(image => ({ data: image.data, mediaType: image.mediaType })),
    )
    // 图片块按原顺序追加：OpenAI 客户端把图片放在哪一段就落在哪一段之后，
    // 顺序对视觉理解有影响（先图后文与先文后图会得到不同回答）。
    for (const ref of refs) blocks.push({ type: 'image', attachment: ref })
  }
  return blocks
}

/**
 * 转换 OpenAI `messages` 为 harness 请求消息。
 *
 * 角色映射：`system`/`developer` → harness 的 `system` 由 `GenerateOptions.system`
 * 承载（OpenAI 里 system 常在 messages 中，harness 用独立字段），因此本函数把
 * system 文本抽出交给调用方；`user` → `RequestUserInput`；`assistant` → 带
 * `tool_calls` 的 assistant 消息；`tool` → 工具结果消息。
 * @param raw - OpenAI `messages` 数组。
 * @param context - 转换依赖。
 * @returns 转换结果：system 文本 + harness 消息。
 */
export async function convertMessages(
  raw: unknown,
  context: ConversionContext,
): Promise<{ system: string | undefined, messages: RequestMessage[] }> {
  if (!Array.isArray(raw)) {
    throw new RequestConversionError('messages must be an array', 400, 'invalid_request_error')
  }
  const messages: RequestMessage[] = []
  const systemParts: string[] = []

  for (const [index, item] of (raw as OpenAiMessage[]).entries()) {
    if (item === null || typeof item !== 'object') {
      throw new RequestConversionError(`messages[${index}] must be an object`, 400, 'invalid_request_error')
    }
    const role = item.role
    if (role === 'system' || role === 'developer') {
      const text = typeof item.content === 'string'
        ? item.content
        : (await contentBlocks(item, index, { ...context, supportsImage: false }))
            .filter((block): block is { type: 'text', text: string } => block.type === 'text')
            .map(block => block.text)
            .join('\n')
      if (text.length > 0) systemParts.push(text)
      continue
    }
    if (role === 'user') {
      const content = await contentBlocks(item, index, context)
      // 空内容的消息跳过：harness 不接受零内容的请求消息。
      if (content.length > 0) messages.push({ role: 'user', content })
      continue
    }
    if (role === 'assistant') {
      const content = await contentBlocks(item, index, { ...context, supportsImage: false })
      const blocks: ContentBlock[] = [...content]
      if (Array.isArray(item.tool_calls)) {
        for (const call of item.tool_calls as { id?: unknown, function?: { name?: unknown, arguments?: unknown } }[]) {
          const id = typeof call?.id === 'string' ? call.id : undefined
          const name = typeof call?.function?.name === 'string' ? call.function.name : undefined
          const args = call?.function?.arguments
          if (id === undefined || name === undefined) continue
          blocks.push({
            type: 'tool-call',
            id: id as ToolCallId,
            name,
            arguments: typeof args === 'string' ? args : JSON.stringify(args ?? {}),
          })
        }
      }
      if (blocks.length > 0) {
        messages.push({
          role: 'assistant',
          id: `bridge-${index}` as never,
          source: { type: 'model', provider: 'bridge', model: 'bridge' } as never,
          content: blocks,
        } as RequestMessage)
      }
      continue
    }
    if (role === 'tool') {
      const toolCallId = typeof item.tool_call_id === 'string' ? item.tool_call_id : undefined
      if (toolCallId === undefined) {
        throw new RequestConversionError(`messages[${index}]: tool message requires tool_call_id`, 400, 'invalid_request_error')
      }
      const text = typeof item.content === 'string' ? item.content : ''
      messages.push({
        role: 'tool',
        id: `bridge-tool-${index}` as never,
        toolCallId: toolCallId as ToolCallId,
        source: { type: 'tool', name: 'bridge' } as never,
        content: [{ type: 'text', text }],
      } as RequestMessage)
      continue
    }
    throw new RequestConversionError(
      `messages[${index}]: unsupported role ${String(role)}`,
      400,
      'invalid_request_error',
    )
  }

  return {
    system: systemParts.length === 0 ? undefined : systemParts.join('\n\n'),
    messages,
  }
}

/**
 * 转换 OpenAI `tools` 为 harness 工具 schema。
 *
 * 只做字段重命名（`function.parameters` → `parameters`）；不做 schema 校验——
 * 宿主与提供方会在各自边界校验，桥代做只会产生与真实原因不一致的错误。
 * @param raw - OpenAI `tools` 数组。
 * @returns 工具 schema 列表；未提供时 `undefined`。
 */
export function convertTools(raw: unknown): ToolSchema[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  const tools: ToolSchema[] = []
  for (const item of raw as { type?: unknown, function?: { name?: unknown, description?: unknown, parameters?: unknown } }[]) {
    const name = item?.function?.name
    if (typeof name !== 'string' || name.length === 0) continue
    tools.push({
      name,
      description: typeof item.function?.description === 'string' ? item.function.description : '',
      parameters: (item.function?.parameters ?? { type: 'object', properties: {} }) as Record<string, unknown>,
    })
  }
  return tools.length === 0 ? undefined : tools
}
