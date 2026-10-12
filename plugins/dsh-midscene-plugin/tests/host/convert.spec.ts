import { describe, expect, it } from 'vitest'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import { convertMessages, convertTools, parseDataUri, RequestConversionError } from '../../src/host/convert.ts'

/**
 * OpenAI 请求词汇 → harness 请求词汇（FNOS-013-03）。
 *
 * 覆盖角色映射、图片数据 URI 解析与能力门控、工具调用透传，以及错误情形
 * （AC-01/02/03/04 的转换侧）。
 */

/** 1×1 PNG 的最小合法数据 URI。 */
const PNG_DATA_URI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='

/** 记录调用的附件服务替身。 */
function fakeAttachments(): { store: AttachmentStore, calls: number } {
  const state = { calls: 0 }
  const store = {
    saveImages: async (inputs: readonly { data: Uint8Array, mediaType: string }[]) => {
      state.calls += 1
      return inputs.map((input, index) => ({
        attachmentId: `att-${index}` as never,
        mediaType: input.mediaType,
        bytes: input.data.byteLength,
        width: 1,
        height: 1,
      }))
    },
  } as unknown as AttachmentStore
  return {
    store,
    get calls() { return state.calls },
  } as { store: AttachmentStore, calls: number }
}

describe('parseDataUri', () => {
  it('解析受支持的 base64 数据 URI', () => {
    const parsed = parseDataUri(PNG_DATA_URI)
    expect(parsed?.mediaType).toBe('image/png')
    expect(parsed?.data.byteLength).toBeGreaterThan(0)
  })

  it('接受 jpeg/webp/gif 三类', () => {
    for (const mediaType of ['image/jpeg', 'image/webp', 'image/gif']) {
      const parsed = parseDataUri(`data:${mediaType};base64,AAAA`)
      expect(parsed?.mediaType, mediaType).toBe(mediaType)
    }
  })

  it('拒绝远程 URL（桥不做任意 URL 抓取）', () => {
    expect(parseDataUri('https://example.com/a.png')).toBeUndefined()
  })

  it('拒绝非图片类型与非法 base64 结构', () => {
    expect(parseDataUri('data:text/plain;base64,AAAA')).toBeUndefined()
    expect(parseDataUri('data:image/png,notbase64')).toBeUndefined()
    expect(parseDataUri('data:image/png;base64,' )).toBeUndefined()
  })
})

describe('convertMessages', () => {
  it('字符串内容的 user 消息转为 harness 消息（AC-01）', async () => {
    const { store } = fakeAttachments()
    const result = await convertMessages(
      [{ role: 'user', content: '你好' }],
      { attachments: store, supportsImage: false },
    )
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0]!.role).toBe('user')
    expect(result.messages[0]!.content).toEqual([{ type: 'text', text: '你好' }])
  })

  it('system 角色抽到 system 字段而不是消息列表（harness 契约）', async () => {
    const { store } = fakeAttachments()
    const result = await convertMessages(
      [
        { role: 'system', content: '你是助手。' },
        { role: 'user', content: '问题' },
      ],
      { attachments: store, supportsImage: false },
    )
    expect(result.system).toBe('你是助手。')
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0]!.role).toBe('user')
  })

  it('多条 system 消息合并', async () => {
    const { store } = fakeAttachments()
    const result = await convertMessages(
      [{ role: 'system', content: 'A' }, { role: 'developer', content: 'B' }],
      { attachments: store, supportsImage: false },
    )
    expect(result.system).toBe('A\n\nB')
  })

  it('图片经附件服务落盘并转为 ImageBlock（AC-03）', async () => {
    const attachments = fakeAttachments()
    const result = await convertMessages(
      [{
        role: 'user',
        content: [
          { type: 'text', text: '看这张图' },
          { type: 'image_url', image_url: { url: PNG_DATA_URI } },
        ],
      }],
      { attachments: attachments.store, supportsImage: true },
    )
    const content = result.messages[0]!.content
    expect(content[0]).toEqual({ type: 'text', text: '看这张图' })
    expect(content[1]).toMatchObject({ type: 'image' })
    // 桥不自定义绕过附件的通道：图片必须经 saveImages 落成受管附件。
    expect(attachments.calls).toBe(1)
  })

  it('模型不支持图片时返回明确错误（AC-02 的能力门控）', async () => {
    const { store } = fakeAttachments()
    await expect(convertMessages(
      [{ role: 'user', content: [{ type: 'image_url', image_url: { url: PNG_DATA_URI } }] }],
      { attachments: store, supportsImage: false },
    )).rejects.toThrow(/does not accept image input/)
  })

  it('附件服务缺席时图片请求给出明确错误而不是崩溃', async () => {
    await expect(convertMessages(
      [{ role: 'user', content: [{ type: 'image_url', image_url: { url: PNG_DATA_URI } }] }],
      { attachments: undefined, supportsImage: true },
    )).rejects.toThrow(/attachment service/)
  })

  it('assistant 的 tool_calls 转为 tool-call 块', async () => {
    const { store } = fakeAttachments()
    const result = await convertMessages(
      [{
        role: 'assistant',
        content: '让我查一下',
        tool_calls: [{ id: 'call_1', function: { name: 'search', arguments: '{"q":"x"}' } }],
      }],
      { attachments: store, supportsImage: false },
    )
    const blocks = result.messages[0]!.content
    expect(blocks[0]).toEqual({ type: 'text', text: '让我查一下' })
    expect(blocks[1]).toMatchObject({ type: 'tool-call', id: 'call_1', name: 'search', arguments: '{"q":"x"}' })
  })

  it('tool 结果消息要求 tool_call_id', async () => {
    const { store } = fakeAttachments()
    const result = await convertMessages(
      [{ role: 'tool', tool_call_id: 'call_1', content: '结果' }],
      { attachments: store, supportsImage: false },
    )
    expect(result.messages[0]).toMatchObject({ role: 'tool', toolCallId: 'call_1' })
    await expect(convertMessages(
      [{ role: 'tool', content: '结果' }],
      { attachments: store, supportsImage: false },
    )).rejects.toThrow(/tool_call_id/)
  })

  it('空内容消息被跳过（harness 不接受零内容请求）', async () => {
    const { store } = fakeAttachments()
    const result = await convertMessages(
      [{ role: 'user', content: '' }, { role: 'user', content: 'hi' }],
      { attachments: store, supportsImage: false },
    )
    expect(result.messages).toHaveLength(1)
  })

  it('messages 非数组时拒绝', async () => {
    const { store } = fakeAttachments()
    await expect(convertMessages('nope', { attachments: store, supportsImage: false }))
      .rejects.toBeInstanceOf(RequestConversionError)
  })

  it('未知角色被拒绝并指出消息序号', async () => {
    const { store } = fakeAttachments()
    await expect(convertMessages(
      [{ role: 'user', content: 'a' }, { role: 'robot', content: 'b' }],
      { attachments: store, supportsImage: false },
    )).rejects.toThrow(/messages\[1\]/)
  })
})

describe('convertTools', () => {
  it('把 function.parameters 平移到 harness 工具 schema', () => {
    const tools = convertTools([{
      type: 'function',
      function: { name: 'search', description: '搜索', parameters: { type: 'object', properties: { q: { type: 'string' } } } },
    }])
    expect(tools).toEqual([{
      name: 'search',
      description: '搜索',
      parameters: { type: 'object', properties: { q: { type: 'string' } } },
    }])
  })

  it('未提供或空数组时返回 undefined（不发送空 tools 字段）', () => {
    expect(convertTools(undefined)).toBeUndefined()
    expect(convertTools([])).toBeUndefined()
  })

  it('跳过没有名字的条目，其余照常保留', () => {
    const tools = convertTools([
      { type: 'function', function: { parameters: {} } },
      { type: 'function', function: { name: 'ok', description: '', parameters: {} } },
    ])
    expect(tools?.map(tool => tool.name)).toEqual(['ok'])
  })
})
