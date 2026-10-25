import { describe, expect, it, vi } from 'vitest'

import {
  buildMessagesBody,
  parseEvent,
  streamMessages,
  isRetryableRateLimit,
  normalizeTaskId,
  rateLimitDelayMs,
  toUsage,
  type MessagesRequest,
} from '../../../src/host/http/messages-client.ts'
import { START_PLAN_PREFIX_BODY, START_PLAN_PREFIX_HEAD } from '../../../src/host/start-plan-prefix.ts'

const prefix = { head: START_PLAN_PREFIX_HEAD, body: START_PLAN_PREFIX_BODY }

function request(overrides: Partial<MessagesRequest> = {}): MessagesRequest {
  return {
    baseUrl: 'https://zcode.z.ai/api/v1/zcode-plan/anthropic',
    apiKey: 'jwt-test',
    model: 'GLM-5.3-Flash',
    maxTokens: 1024,
    system: 'DSH 自己的提示词',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    tools: undefined,
    deviceId: 'device-1',
    ...overrides,
  }
}

/**
 * 网关按内容校验 system：必须是官方**两段独立文本块**，单块无论怎么拼都被拒。
 * 这组用例锁死请求体形状，避免将来"优化"成单块。
 */
describe('buildMessagesBody', () => {
  it('system 是两个独立文本块，且第一段逐字等于官方身份行', () => {
    const body = buildMessagesBody(request(), prefix)
    const system = body.system as { type: string; text: string }[]

    expect(system).toHaveLength(2)
    expect(system[0]?.text).toBe(START_PLAN_PREFIX_HEAD)
    // 第二段必须以官方原文开头，DSH 内容接在其后。
    expect(system[1]?.text.startsWith(START_PLAN_PREFIX_BODY)).toBe(true)
    expect(system[1]?.text.endsWith('DSH 自己的提示词')).toBe(true)
  })

  it('没有 DSH 提示词时第二段就是官方原文本身', () => {
    const body = buildMessagesBody(request({ system: undefined }), prefix)
    const system = body.system as { text: string }[]
    expect(system[1]?.text).toBe(START_PLAN_PREFIX_BODY)
  })

  it('补齐官方客户端会发的四个附加字段', () => {
    const body = buildMessagesBody(request(), prefix)
    expect(body.tool_choice).toEqual({ type: 'auto' })
    expect(body.thinking).toEqual({ type: 'enabled' })
    expect(body.output_config).toEqual({ effort: 'max' })
    expect(typeof body.metadata).toBe('object')
    // device_id 必须进 metadata，网关用它把请求关联到设备。
    const userId = (body.metadata as { user_id: string }).user_id
    expect(JSON.parse(userId)).toMatchObject({ device_id: 'device-1' })
  })

  it('effort 跟随所选思考等级', () => {
    const body = buildMessagesBody(request({ effort: 'high' }), prefix)
    expect(body.output_config).toEqual({ effort: 'high' })
  })

  it('没有工具声明时不发 tools 字段', () => {
    expect(buildMessagesBody(request(), prefix).tools).toBeUndefined()
    const withTools = buildMessagesBody(request({ tools: [{ name: 'x' }] }), prefix)
    expect(withTools.tools).toHaveLength(1)
  })
})

/** 事件解析决定流式内容与工具调用能否正确落到 DSH 的块上。 */
describe('parseEvent', () => {
  it('文本增量', () => {
    expect(parseEvent('{"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"你好"}}'))
      .toEqual({ kind: 'text-delta', index: 1, text: '你好' })
  })

  it('思考增量与签名分开解析', () => {
    expect(parseEvent('{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"想"}}'))
      .toEqual({ kind: 'thinking-delta', index: 0, text: '想' })
    expect(parseEvent('{"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"sig"}}'))
      .toEqual({ kind: 'signature-delta', index: 0, signature: 'sig' })
  })

  it('工具调用块起始带 id 与名字', () => {
    expect(parseEvent(JSON.stringify({
      type: 'content_block_start',
      index: 2,
      content_block: { type: 'tool_use', id: 'call_1', name: 'Bash' },
    }))).toEqual({ kind: 'block-start', index: 2, blockType: 'tool_use', id: 'call_1', name: 'Bash' })
  })

  it('工具参数按片段返回', () => {
    expect(parseEvent(JSON.stringify({
      type: 'content_block_delta',
      index: 2,
      delta: { type: 'input_json_delta', partial_json: '{"a":1' },
    }))).toMatchObject({ kind: 'tool-delta', index: 2, argumentsDelta: '{"a":1' })
  })

  it('message_delta 给出停止原因与用量', () => {
    expect(parseEvent(JSON.stringify({
      type: 'message_delta',
      delta: { stop_reason: 'tool_use' },
      usage: { output_tokens: 12 },
    }))).toMatchObject({ kind: 'message-delta', stopReason: 'tool_use' })
  })

  it('ping / message_stop 等不产生事件', () => {
    expect(parseEvent('{"type":"ping"}')).toBeUndefined()
    expect(parseEvent('{"type":"message_stop"}')).toBeUndefined()
    expect(parseEvent('不是 JSON')).toBeUndefined()
  })
})

describe('toUsage', () => {
  it('映射缓存读写字段', () => {
    expect(toUsage({
      input_tokens: 10,
      output_tokens: 20,
      cache_read_input_tokens: 5,
      cache_creation_input_tokens: 3,
    })).toEqual({
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 5,
      cacheWriteTokens: 3,
    })
  })

  it('缺失字段不编造 0', () => {
    const usage = toUsage({ input_tokens: 1, output_tokens: 2 })
    expect(usage).toEqual({ inputTokens: 1, outputTokens: 2 })
    expect('cacheReadTokens' in usage).toBe(false)
  })
})

/** 用假的 fetch 验证整条流的解析与错误处理。 */
describe('streamMessages', () => {
  function sseFetch(chunks: string[], status = 200): typeof fetch {
    return (async () => new Response(
      new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder()
          for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
          controller.close()
        },
      }),
      { status },
    )) as unknown as typeof fetch
  }

  it('按行解析出事件序列', async () => {
    const fetchImpl = sseFetch([
      'event: message_start\ndata: {"type":"message_start","message":{"model":"glm","usage":{"input_tokens":7}}}\n\n',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"通"}}\n\n',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"了"}}\n\n',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":3}}\n\n',
    ])
    const events = []
    for await (const event of streamMessages(request(), prefix, fetchImpl)) events.push(event)

    expect(events.map(event => event.kind)).toEqual([
      'message-start',
      'text-delta',
      'text-delta',
      'message-delta',
    ])
    expect(events.filter(event => event.kind === 'text-delta').map(event => (event as { text: string }).text).join(''))
      .toBe('通了')
  })

  it('分块跨越 TCP 边界时仍能正确拼出事件', async () => {
    const fetchImpl = sseFetch([
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_del',
      'ta","text":"跨块"}}\n\n',
    ])
    const events = []
    for await (const event of streamMessages(request(), prefix, fetchImpl)) events.push(event)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ kind: 'text-delta', text: '跨块' })
  })

  it('3012 给出可操作说明，而不是裸业务码', async () => {
    const fetchImpl = (async () => new Response(
      '{"code":3012,"msg":"request has been blocked due to unusual activity."}',
      { status: 405 },
    )) as unknown as typeof fetch

    await expect((async () => {
      for await (const _event of streamMessages(request(), prefix, fetchImpl)) { /* 消费 */ }
    })()).rejects.toThrow(/3012/)
  })

  it('其它 HTTP 失败带状态码与响应片段', async () => {
    const fetchImpl = (async () => new Response('boom', { status: 500 })) as unknown as typeof fetch
    await expect((async () => {
      for await (const _event of streamMessages(request(), prefix, fetchImpl)) { /* 消费 */ }
    })()).rejects.toThrow(/HTTP 500/)
  })
})

/** 上游校验请求任务 ID 长度（6–64），过短会被直接拒绝。 */
describe('normalizeTaskId', () => {
  it('长度合法时原样返回', () => {
    expect(normalizeTaskId('sess-abcdef', 'device-fallback')).toBe('sess-abcdef')
  })

  it('没有会话标识时用设备标识', () => {
    expect(normalizeTaskId(undefined, 'device-fallback')).toBe('device-fallback')
  })

  it('过短时补齐到合法长度，而不是让请求失败', () => {
    const id = normalizeTaskId('d', 'device-fallback')
    expect(id.length).toBeGreaterThanOrEqual(6)
    expect(id.length).toBeLessThanOrEqual(64)
  })

  it('过长时截断到 64', () => {
    expect(normalizeTaskId('x'.repeat(200), 'device').length).toBe(64)
  })

  it('极短的设备标识也不会产出非法长度', () => {
    const id = normalizeTaskId('a', 'b')
    expect(id.length).toBeGreaterThanOrEqual(6)
  })
})

/**
 * 限流是可恢复的：官方客户端会退避重试，而不是把失败直接抛给用户。
 * 但「额度耗尽」类的限流重试没有意义，必须区分——否则用户会白等五轮。
 */
describe('限流与重试', () => {
  it('Retry-After 优先，并按上限截断', () => {
    expect(rateLimitDelayMs(1, 3)).toBe(3_000)
    // 上游给一个离谱的大值时要截断，否则用户会等几分钟。
    expect(rateLimitDelayMs(1, 9_999)).toBe(60_000)
  })

  it('没有 Retry-After 时按指数退避，且不超过上限', () => {
    expect(rateLimitDelayMs(1)).toBeGreaterThanOrEqual(1_000)
    expect(rateLimitDelayMs(1)).toBeLessThanOrEqual(2_000)
    expect(rateLimitDelayMs(10)).toBeLessThanOrEqual(60_000)
  })

  it('并发上限可重试，配额耗尽与安全拒绝不可重试', () => {
    expect(isRetryableRateLimit(429, undefined)).toBe(true)
    expect(isRetryableRateLimit(429, 'rate_limit_reached_error')).toBe(true)
    expect(isRetryableRateLimit(503, 'overloaded_error')).toBe(true)
    // 3008/3009/3010 是并发上限（系统繁忙），等一会儿能进。
    for (const code of ['3008', '3009', '3010']) {
      expect(isRetryableRateLimit(429, code)).toBe(true)
    }
    // 1005 配额耗尽、3007 安全拒绝：重试只会让用户白等。
    expect(isRetryableRateLimit(429, '1005')).toBe(false)
    expect(isRetryableRateLimit(429, '3007')).toBe(false)
    // 非限流状态不该进这条路径。
    expect(isRetryableRateLimit(400, undefined)).toBe(false)
  })

  it('3008 并发上限重试后成功', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      if (calls === 1) return new Response('{"error":{"code":"3008"}}', { status: 429 })
      return new Response(
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"进"}}\n\n',
        { status: 200 },
      )
    }) as unknown as typeof fetch
    const events = []
    for await (const event of streamMessages(request(), prefix, fetchImpl)) events.push(event)
    expect(calls).toBe(2)
    expect(events[0]).toMatchObject({ kind: 'text-delta', text: '进' })
  })

  it('429 后会重试，第二次成功则整个请求成功', async () => {
    let calls = 0
    const seen: { attempt: number; status: number; delayMs: number }[] = []
    const fetchImpl = (async () => {
      calls += 1
      if (calls === 1) {
        return new Response('{"error":{"code":"rate_limit_reached_error"}}', { status: 429 })
      }
      return new Response(
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"好"}}\n\n',
        { status: 200 },
      )
    }) as unknown as typeof fetch

    const events = []
    for await (const event of streamMessages(
      { ...request(), onRateLimit: info => seen.push(info) },
      prefix,
      fetchImpl,
    )) events.push(event)

    expect(calls).toBe(2)
    expect(seen).toHaveLength(1)
    expect(seen[0]?.status).toBe(429)
    expect(events[0]).toMatchObject({ kind: 'text-delta', text: '好' })
  })

  it('额度耗尽不重试，直接给出可行动的说明', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      return new Response('{"error":{"code":"1005"}}', { status: 429 })
    }) as unknown as typeof fetch

    await expect((async () => {
      for await (const _e of streamMessages(request(), prefix, fetchImpl)) { /* 消费 */ }
    })()).rejects.toThrow(/额度已用尽/)
    // 关键：只请求一次，不让用户等五轮。
    expect(calls).toBe(1)
  })

  it('重试用尽后给出「系统繁忙」说明，而不是裸状态码', async () => {
    // 用假时钟跳过真实等待：否则 5 轮指数退避会跑满 30 秒。
    vi.useFakeTimers()
    try {
      let calls = 0
      const fetchImpl = (async () => {
        calls += 1
        return new Response('{"error":{"code":"rate_limit_error"}}', { status: 429 })
      }) as unknown as typeof fetch

      const pending = (async () => {
        for await (const _e of streamMessages(request(), prefix, fetchImpl)) { /* 消费 */ }
      })()
      const settled = expect(pending).rejects.toThrow(/系统繁忙/)
      // 反复推进时钟，直到重试次数用尽。
      for (let i = 0; i < 12; i += 1) await vi.advanceTimersByTimeAsync(60_000)
      await settled
      expect(calls).toBe(5)
    } finally {
      vi.useRealTimers()
    }
  })
})
