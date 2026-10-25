import { describe, expect, it } from 'vitest'

import { toAnthropicMessages, toAnthropicTools } from '../../../src/host/http/translate.ts'
import type { ContentBlock, RequestMessage } from '@deepseek-ai/dsh-llm'

const imageRef = {
  attachmentId: 'att-1',
  mediaType: 'image/png',
  bytes: 1200,
  width: 480,
  height: 220,
} as Extract<ContentBlock, { type: 'image' }>['attachment']

function imageMessage(): RequestMessage {
  return {
    role: 'user',
    content: [{ type: 'image', attachment: imageRef }],
  } as unknown as RequestMessage
}

/**
 * 图片块曾经被静默丢弃（`readImage` 一直没接线），表现为模型答非所问但没有任何
 * 报错。这组用例锁定「图片确实进到请求里」。
 */
describe('图片输入', () => {
  it('图片块转换成 Anthropic base64 image 块', async () => {
    const messages = await toAnthropicMessages([imageMessage()], async () => ({
      mediaType: 'image/png',
      data: 'AAAA',
    }))

    const blocks = messages[0]?.content as { type: string; source?: unknown }[]
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'AAAA' },
    })
  })

  it('没有接图片读取能力时不产生空块（也不编造占位）', async () => {
    const messages = await toAnthropicMessages([imageMessage()])
    expect(messages).toHaveLength(0)
  })

  it('读取失败时跳过该图，不影响同一消息里的文本', async () => {
    const message = {
      role: 'user',
      content: [
        { type: 'text', text: '描述这张图' },
        { type: 'image', attachment: imageRef },
      ],
    } as unknown as RequestMessage
    const messages = await toAnthropicMessages([message], async () => undefined)

    const blocks = messages[0]?.content as { type: string }[]
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.type).toBe('text')
  })
})

describe('消息与工具转换', () => {
  it('文本消息原样转成 user 文本块', async () => {
    const messages = await toAnthropicMessages([
      { role: 'user', content: [{ type: 'text', text: '你好' }] } as unknown as RequestMessage,
    ])
    expect(messages[0]).toEqual({ role: 'user', content: [{ type: 'text', text: '你好' }] })
  })

  it('system 消息不进 messages（由 system 字段单独承载）', async () => {
    const messages = await toAnthropicMessages([
      { role: 'system', content: [{ type: 'text', text: '规则' }] } as unknown as RequestMessage,
    ])
    expect(messages).toHaveLength(0)
  })

  it('工具声明转成 input_schema', () => {
    const tools = toAnthropicTools([
      { name: 'Bash', description: 'run', parameters: { type: 'object', properties: {} } },
    ])
    expect(tools).toEqual([
      { name: 'Bash', description: 'run', input_schema: { type: 'object', properties: {} } },
    ])
    expect(toAnthropicTools([])).toBeUndefined()
  })
})
