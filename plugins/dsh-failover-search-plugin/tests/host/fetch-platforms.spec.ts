import { describe, expect, it, vi } from 'vitest'
import { createTinyfishFetchAdapter, createTavilyExtractAdapter, normalizeExtractedText } from '../../src/host/fetch-platforms.ts'

const TINYFISH_ENDPOINT = 'https://api.fetch.tinyfish.ai'
const TAVILY_ENDPOINT = 'https://api.tavily.com/extract'

/** 抓取 fetch 的极简桩：记录请求并回放响应。 */
function stubFetch(handler: (url: string, init: RequestInit) => Promise<{ status: number, json?: unknown, text?: string }>) {
  const calls: { url: string, init: RequestInit }[] = []
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    const r = await handler(url, init)
    return new Response(r.text ?? JSON.stringify(r.json ?? {}), { status: r.status })
  }) as unknown as typeof fetch
  return { fn, calls }
}

describe('FNOS-010-11 TinyFish Fetch 适配', () => {
  it('POST 官方端点，body 为 urls 数组，key 走 X-API-Key 头', async () => {
    const { fn, calls } = stubFetch(async () => ({ status: 200, json: { results: [{ url: 'https://example.com', text: 'hello' }] } }))
    const adapter = createTinyfishFetchAdapter({ apiKey: 'sk-x', endpoint: TINYFISH_ENDPOINT, fetchImpl: fn })

    const result = await adapter.fetch({ url: 'https://example.com' })
    expect(calls[0]?.url).toBe(TINYFISH_ENDPOINT)
    const init = calls[0]?.init
    expect(init?.method).toBe('POST')
    expect((init?.headers as Record<string, string>)['X-API-Key']).toBe('sk-x')
    expect(JSON.parse(String(init?.body))).toEqual({ urls: ['https://example.com'] })
    expect(result.body).toEqual({ kind: 'text', content: 'hello' })
  })

  it('结果条目缺失时抛可读的 PROVIDER_ERROR（不静默返回空）', async () => {
    const { fn } = stubFetch(async () => ({ status: 200, json: { results: [] } }))
    const adapter = createTinyfishFetchAdapter({ apiKey: 'sk-x', endpoint: TINYFISH_ENDPOINT, fetchImpl: fn })

    await expect(adapter.fetch({ url: 'https://example.com' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
  })

  it('failed_results 优先透出平台侧原因', async () => {
    const { fn } = stubFetch(async () => ({ status: 200, json: { results: [], failed_results: [{ url: 'https://example.com', error: 'render timeout' }] } }))
    const adapter = createTinyfishFetchAdapter({ apiKey: 'sk-x', endpoint: TINYFISH_ENDPOINT, fetchImpl: fn })

    await expect(adapter.fetch({ url: 'https://example.com' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR', message: expect.stringContaining('render timeout') })
  })

  it('非 2xx 抛 PROVIDER_ERROR 且不含 key（脱敏）', async () => {
    const { fn } = stubFetch(async () => ({ status: 401, text: '{"error":"bad key sk-secret-value"}' }))
    const adapter = createTinyfishFetchAdapter({ apiKey: 'sk-secret-value', endpoint: TINYFISH_ENDPOINT, fetchImpl: fn })

    await expect(adapter.fetch({ url: 'https://example.com' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
    // 响应体里确实带了 key（平台会回显鉴权头内容），脱敏后不得出现在错误信息里。
    await expect(adapter.fetch({ url: 'https://example.com' }).catch(e => String(e.message))).resolves.not.toContain('sk-secret-value')
  })
})

describe('FNOS-010-11 Tavily Extract 适配', () => {
  it('POST extract 端点，key 走 Bearer 头', async () => {
    const { fn, calls } = stubFetch(async () => ({ status: 200, json: { results: [{ url: 'https://example.com', raw_content: 'hello' }] } }))
    const adapter = createTavilyExtractAdapter({ apiKey: 'tvly-x', endpoint: 'https://api.tavily.com/extract', fetchImpl: fn })

    const result = await adapter.fetch({ url: 'https://example.com' })
    expect(calls[0]?.url).toBe(TAVILY_ENDPOINT)
    expect((calls[0]?.init?.headers as Record<string, string>).Authorization).toBe('Bearer tvly-x')
    expect(result.body).toEqual({ kind: 'text', content: 'hello' })
  })

  it('raw_content 缺失按失败处理并透出 failed_results 原因', async () => {
    const { fn } = stubFetch(async () => ({ status: 200, json: { results: [], failed_results: [{ url: 'https://example.com' }] } }))
    const adapter = createTavilyExtractAdapter({ apiKey: 'tvly-x', endpoint: TAVILY_ENDPOINT, fetchImpl: fn })

    await expect(adapter.fetch({ url: 'https://example.com' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
  })
})

describe('FNOS-010-11 正文归一', () => {
  it('空正文视为失败（平台 200 但没有可用内容）', () => {
    expect(() => normalizeExtractedText('', 'tinyfish')).toThrow(/empty/i)
  })

  it('非空正文原样返回', () => {
    expect(normalizeExtractedText('real content', 'tinyfish')).toBe('real content')
  })
})

describe('FNOS-010-11 Tavily 错误信息脱敏', () => {
  it('401 响应回显 key 时，错误信息不得含 key 明文', async () => {
    const { fn } = stubFetch(async () => ({ status: 401, text: '{"error":"bad key tvly-secret-value"}' }))
    const adapter = createTavilyExtractAdapter({ apiKey: 'tvly-secret-value', endpoint: TAVILY_ENDPOINT, fetchImpl: fn })

    await expect(adapter.fetch({ url: 'https://example.com' }).catch(e => String(e.message))).resolves.not.toContain('tvly-secret-value')
  })
})

describe('FNOS-010-11 available() 脱离实例调用安全', () => {
  it('available 作为裸函数传递后仍可调用（不依赖 this）', () => {
    const adapter = createTinyfishFetchAdapter({ apiKey: 'sk-x', endpoint: TINYFISH_ENDPOINT })
    const detached = adapter.available
    // 复合 provider 把 available 取出后单独调用，this 会丢失；
    // 实现必须绑定实例，否则抛 "Cannot read private member"。
    expect(() => detached()).not.toThrow()
    expect(detached()).toBe(true)
  })

  it('Tavily 侧同样安全', () => {
    const adapter = createTavilyExtractAdapter({ apiKey: 'tvly-x', endpoint: TAVILY_ENDPOINT })
    const detached = adapter.available
    expect(detached()).toBe(true)
  })
})

describe('FNOS-010-11 fetch() 脱离实例调用安全', () => {
  it('fetch 作为裸函数传递后仍可工作（复合 provider 会取出后调用）', async () => {
    const { fn } = stubFetch(async () => ({ status: 200, json: { results: [{ url: 'https://example.com', text: 'detached ok' }] } }))
    const adapter = createTinyfishFetchAdapter({ apiKey: 'sk-x', endpoint: TINYFISH_ENDPOINT, fetchImpl: fn })
    const detached = adapter.fetch

    const result = await detached({ url: 'https://example.com' })
    expect(result.body).toEqual({ kind: 'text', content: 'detached ok' })
  })

  it('Tavily 侧 fetch 同样安全', async () => {
    const { fn } = stubFetch(async () => ({ status: 200, json: { results: [{ url: 'https://example.com', raw_content: 'tavily detached' }] } }))
    const adapter = createTavilyExtractAdapter({ apiKey: 'tvly-x', endpoint: TAVILY_ENDPOINT, fetchImpl: fn })
    const detached = adapter.fetch

    const result = await detached({ url: 'https://example.com' })
    expect(result.body).toEqual({ kind: 'text', content: 'tavily detached' })
  })
})
