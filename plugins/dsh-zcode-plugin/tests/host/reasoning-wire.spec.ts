import { afterEach, describe, expect, it, vi } from 'vitest'
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy'
import { toPiModel } from '../../src/host/provider.ts'
import { toModel } from '../../src/host/catalog.ts'

/**
 * 抓取真实发往网关的请求体，确认「用户在 DSH 里选的思考等级」真的落在
 * `output_config.effort` 上。
 *
 * 这条测试存在的理由：ZCode 用 `output_config.effort`（low/high/max）表达思考
 * 强度，而 pi-ai 只有在模型带 `compat.forceAdaptiveThinking` 时才走这条分支；
 * 否则会退回 `budget_tokens`，网关收不到 effort —— 界面上选了「Max」也等于
 * 没选。只断言 `thinkingLevelMap` 是测不出这个的，必须看请求体。
 */

interface Captured {
  readonly url: string
  readonly body: Record<string, unknown>
}

let captured: Captured | undefined

/** 桩 fetch：记录请求体，返回一个立即结束的 SSE 流。 */
function stubFetch(): void {
  captured = undefined
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    let body: Record<string, unknown> = {}
    try {
      body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    } catch {
      body = {}
    }
    captured = { url, body }
    return new Response('event: message_stop\ndata: {"type":"message_stop"}\n\n', {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })
  }))
}

afterEach(() => {
  vi.unstubAllGlobals()
  captured = undefined
})

/** 被测的流入口：pi-ai 的 Anthropic Messages 实现。 */
const streams = anthropicMessagesApi()

async function drain(stream: unknown): Promise<void> {
  const iterable = stream as { [Symbol.asyncIterator]?: () => AsyncIterator<unknown> }
  if (typeof iterable[Symbol.asyncIterator] !== 'function') return
  for await (const _event of iterable as AsyncIterable<unknown>) void _event
}

const flash = toModel({
  id: 'GLM-5.3-Flash',
  family: 'bigmodel',
  clientModel: {
    modelId: 'GLM-5.3-Flash',
    name: 'GLM-5.3-Flash',
    contextWindow: 1_000_000,
    maxCompletionTokens: 128_000,
    reasoningLevels: ['low', 'high', 'max'],
    supportsImage: true,
  },
})

describe('思考等级落到 output_config.effort', () => {
  it('选 max 时请求体带 output_config.effort = max', async () => {
    stubFetch()
    await drain((streams.streamSimple as (m: unknown, c: unknown, o: unknown) => unknown)(
      toPiModel(flash),
      { messages: [{ role: 'user', content: 'hi' }] },
      { apiKey: 'tok', reasoning: 'max' },
    ))

    expect(captured).toBeDefined()
    expect(captured?.url).toContain('/v1/messages')
    const body = captured?.body as {
      output_config?: { effort?: string }
      thinking?: { type?: string; budget_tokens?: number }
    }
    expect(body.output_config?.effort).toBe('max')
    expect(body.thinking?.type).toBe('adaptive')
    // 关键：不能退回 budget 形态。
    expect(body.thinking?.budget_tokens).toBeUndefined()
  })

  it('选 low 时 effort = low', async () => {
    stubFetch()
    await drain((streams.streamSimple as (m: unknown, c: unknown, o: unknown) => unknown)(
      toPiModel(flash),
      { messages: [{ role: 'user', content: 'hi' }] },
      { apiKey: 'tok', reasoning: 'low' },
    ))
    const body = captured?.body as { output_config?: { effort?: string } }
    expect(body.output_config?.effort).toBe('low')
  })

  it('请求体确实打到 Start Plan 的 anthropic 端点', async () => {
    stubFetch()
    await drain((streams.streamSimple as (m: unknown, c: unknown, o: unknown) => unknown)(
      toPiModel(flash),
      { messages: [{ role: 'user', content: 'hi' }] },
      { apiKey: 'tok', reasoning: 'high' },
    ))
    // pi-ai 会因 anthropic-beta 头追加 `?beta=true`；只断言路径前缀与端点归属。
    expect(captured?.url.startsWith('https://zcode.z.ai/api/v1/zcode-plan/anthropic/v1/messages')).toBe(true)
  })

  it('图片输入被编码成 anthropic image 内容块', async () => {
    stubFetch()
    await drain((streams.streamSimple as (m: unknown, c: unknown, o: unknown) => unknown)(
      toPiModel(flash),
      {
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: '这张图是什么' },
            { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' },
          ],
        }],
      },
      { apiKey: 'tok' },
    ))
    const body = captured?.body as { messages?: { content?: unknown }[] }
    const content = body.messages?.[0]?.content
    expect(Array.isArray(content)).toBe(true)
    const blocks = content as { type: string; source?: { type?: string; media_type?: string; data?: string } }[]
    const image = blocks.find(block => block.type === 'image')
    expect(image).toBeDefined()
    expect(image?.source?.type).toBe('base64')
    expect(image?.source?.media_type).toBe('image/png')
    expect(image?.source?.data).toBe('aGVsbG8=')
  })
})
