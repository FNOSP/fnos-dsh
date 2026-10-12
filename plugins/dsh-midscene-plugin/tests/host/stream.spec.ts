import { describe, expect, it } from 'vitest'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { aggregateStream, makeChunk, sseLine, toFinishReason, toOpenAiError } from '../../src/host/stream.ts'

/**
 * 流式聚合与错误映射（FNOS-013-03）。
 *
 * 覆盖 AC-01（非流式聚合结果完整）、AC-02（流式分片格式）与 AC-04（错误
 * 携带「提供方/模型」归因）。
 */

/** 把分片数组包成异步可迭代流。 */
async function* streamOf(chunks: readonly StreamChunk[]): AsyncIterable<StreamChunk> {
  for (const chunk of chunks) yield chunk
}

describe('aggregateStream', () => {
  it('拼接文本分片为完整回答（AC-01）', async () => {
    const answer = await aggregateStream(streamOf([
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: '你好' },
      { type: 'text-delta', index: 0, text: '，世界' },
      { type: 'finish', reason: { kind: 'stop' } },
    ]))
    expect(answer.text).toBe('你好，世界')
    expect(answer.finishReason).toEqual({ kind: 'stop' })
  })

  it('按 index 归位多块文本，不因交错而错序', async () => {
    const answer = await aggregateStream(streamOf([
      { type: 'text-delta', index: 0, text: 'A1' },
      { type: 'text-delta', index: 1, text: 'B1' },
      { type: 'text-delta', index: 0, text: 'A2' },
      { type: 'finish', reason: { kind: 'stop' } },
    ]))
    expect(answer.text).toBe('A1A2B1')
  })

  it('推理内容与可见文本分开聚合', async () => {
    const answer = await aggregateStream(streamOf([
      { type: 'reasoning-delta', index: 0, text: '想' },
      { type: 'reasoning-delta', index: 0, text: '一下' },
      { type: 'text-delta', index: 1, text: '答案' },
      { type: 'finish', reason: { kind: 'stop' } },
    ]))
    expect(answer.reasoning).toBe('想一下')
    expect(answer.text).toBe('答案')
  })

  it('工具调用参数按 index 累积增量', async () => {
    const answer = await aggregateStream(streamOf([
      { type: 'tool-call-delta', index: 0, id: 'call_1' as never, name: 'search', argumentsDelta: '{"q"' },
      { type: 'tool-call-delta', index: 0, id: 'call_1' as never, argumentsDelta: ':"x"}' },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ]))
    expect(answer.toolCalls).toEqual([{ id: 'call_1', name: 'search', arguments: '{"q":"x"}' }])
  })

  it('token 用量映射为标准字段', async () => {
    const answer = await aggregateStream(streamOf([
      { type: 'usage', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ]))
    expect(answer.usage).toEqual({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 })
  })

  it('宿主未给 totalTokens 时由输入输出求和', async () => {
    const answer = await aggregateStream(streamOf([
      { type: 'usage', usage: { inputTokens: 7, outputTokens: 3 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ]))
    expect(answer.usage?.total_tokens).toBe(10)
  })

  it('空流给出空文本与默认结束原因', async () => {
    const answer = await aggregateStream(streamOf([]))
    expect(answer.text).toBe('')
    expect(answer.finishReason).toEqual({ kind: 'stop' })
    expect(answer.usage).toBeUndefined()
  })
})

describe('toFinishReason', () => {
  it('映射已知结束原因为 OpenAI 词汇', () => {
    expect(toFinishReason({ kind: 'stop' })).toBe('stop')
    expect(toFinishReason({ kind: 'tool-calls' })).toBe('tool_calls')
    expect(toFinishReason({ kind: 'max-tokens' })).toBe('length')
  })

  it('未知原因回落 stop（客户端只需知道正常结束）', () => {
    expect(toFinishReason({ kind: 'something-new' } as never)).toBe('stop')
    expect(toFinishReason(undefined as never)).toBe('stop')
  })
})

describe('makeChunk / sseLine', () => {
  it('分片是标准 OpenAI chunk 形态（AC-02）', () => {
    const chunk = makeChunk('id-1', 'codebuddy/glm', 100, { content: 'hi' }, null)
    expect(chunk).toMatchObject({
      id: 'id-1',
      object: 'chat.completion.chunk',
      created: 100,
      model: 'codebuddy/glm',
      choices: [{ index: 0, delta: { content: 'hi' }, finish_reason: null }],
    })
  })

  it('SSE 行以 data: 开头、双换行收尾', () => {
    expect(sseLine({ a: 1 })).toBe('data: {"a":1}\n\n')
    expect(sseLine('[DONE]')).toBe('data: [DONE]\n\n')
  })
})

describe('toOpenAiError', () => {
  it('错误信息前置「提供方/模型」归因（AC-04）', () => {
    const mapped = toOpenAiError(new Error('boom'), 'codebuddy/glm-5.3-flash')
    expect(mapped.body.error.message).toContain('codebuddy/glm-5.3-flash')
    expect(mapped.status).toBe(502)
  })

  it('无归因时不加前缀', () => {
    const mapped = toOpenAiError(new Error('boom'))
    expect(mapped.body.error.message).toBe('boom')
  })

  it('凭据类错误映射为 400 并附配置指引', () => {
    const error = Object.assign(new Error('missing credential'), { code: 'MISSING_CREDENTIAL' })
    const mapped = toOpenAiError(error, 'p/m')
    expect(mapped.status).toBe(400)
    expect(mapped.body.error.code).toBe('MISSING_CREDENTIAL')
    expect(mapped.body.error.message).toContain('设置')
  })

  it('额度错误映射为 429', () => {
    const error = Object.assign(new Error('quota'), { code: 'QUOTA' })
    expect(toOpenAiError(error, 'p/m').status).toBe(429)
  })

  it('其它宿主错误映射为 502 且保留稳定 code', () => {
    const error = Object.assign(new Error('provider down'), { code: 'PROVIDER_UNAVAILABLE' })
    const mapped = toOpenAiError(error, 'p/m')
    expect(mapped.status).toBe(502)
    expect(mapped.body.error.code).toBe('PROVIDER_UNAVAILABLE')
  })

  it('非 Error 值也能得到可读消息', () => {
    expect(toOpenAiError('plain string').body.error.message).toBe('plain string')
  })
})
