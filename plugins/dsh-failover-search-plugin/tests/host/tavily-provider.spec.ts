import { describe, expect, it } from 'vitest'
import { TavilyAdapter, TavilyUsageAdapter } from '../../src/host/tavily-provider.ts'

/** 真实 Tavily 搜索响应样本（2026-10-09 实测；该版本无 usage 字段）。 */
function tavilyBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    query: 'deepseek harness',
    follow_up_questions: null,
    answer: null,
    images: [],
    results: [
      {
        url: 'https://deepseek-code.com/plugins/deepseek-harness-deepseek-ai',
        title: 'deepseek-harness — DeepSeek Harness Plugin',
        content: 'DeepSeek Harness ( dsh ) is an open-source agent harness developed by DeepSeek AI.',
        score: 0.9377661,
        raw_content: null,
        id: 'ff95e5-00',
      },
    ],
    response_time: 1.25,
    request_id: 'abc',
    ...overrides,
  })
}

/** 真实 Tavily 用量响应样本（2026-10-09 实测）。 */
function tavilyUsageBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    key: { usage: 0, limit: null, search_usage: 0, crawl_usage: 0, extract_usage: 0, map_usage: 0, research_usage: 0 },
    account: {
      current_plan: 'Researcher',
      plan_usage: 167,
      plan_limit: 1000,
      search_usage: 0,
      crawl_usage: 0,
      extract_usage: 0,
      map_usage: 0,
      research_usage: 0,
      paygo_usage: 0,
      paygo_limit: null,
    },
    ...overrides,
  })
}

/** 记录请求的 fetch 替身。 */
function stubFetch(body: string, status = 200) {
  const calls: { url: string, init: RequestInit | undefined }[] = []
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    return new Response(body, { status, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
  return { fetch: fetchImpl, calls }
}

describe('FNOS-010-01/05 Tavily 适配', () => {
  it('用 Bearer 头 POST 搜索端点，并透传 max_results', async () => {
    const { fetch, calls } = stubFetch(tavilyBody())
    const adapter = new TavilyAdapter({ fetch })

    await adapter.search({ query: 'deepseek harness', maxResults: 5 }, 'tvly-key')

    expect(calls[0]?.url).toBe('https://api.tavily.com/search')
    expect(calls[0]?.init?.method).toBe('POST')
    expect((calls[0]?.init?.headers as Record<string, string>).Authorization).toBe('Bearer tvly-key')
    const sent = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>
    expect(sent.query).toBe('deepseek harness')
    // 来源侧请求级裁剪：Tavily 支持 max_results，按接缝上限透传以省 credit 与延迟。
    expect(sent.max_results).toBe(5)
    expect(sent.search_depth).toBe('basic')
    // 第一版不开启 include_answer（省 credit 与延迟）。
    expect(sent.include_answer).toBeUndefined()
  })

  it('未指定 maxResults 时不发送 max_results，交由平台默认值', async () => {
    const { fetch, calls } = stubFetch(tavilyBody())
    const adapter = new TavilyAdapter({ fetch })

    await adapter.search({ query: 'q' }, 'k')

    const sent = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>
    expect(sent.max_results).toBeUndefined()
  })

  it('把 Tavily 字段映射到接缝词表（content → snippet）', async () => {
    const { fetch } = stubFetch(tavilyBody())
    const adapter = new TavilyAdapter({ fetch })

    const result = await adapter.search({ query: 'q' }, 'k')

    expect(result.sources).toEqual([{
      url: 'https://deepseek-code.com/plugins/deepseek-harness-deepseek-ai',
      title: 'deepseek-harness — DeepSeek Harness Plugin',
      snippet: 'DeepSeek Harness ( dsh ) is an open-source agent harness developed by DeepSeek AI.',
    }])
    expect(result.truncated).toBe(false)
  })

  it('published_date 为 RFC2822 时转成 ISO', async () => {
    const { fetch } = stubFetch(tavilyBody({
      results: [{ url: 'https://example.com/a', title: 'A', content: 'x', published_date: 'Wed, 16 Aug 2026 12:00:00 GMT' }],
    }))
    const adapter = new TavilyAdapter({ fetch })

    const result = await adapter.search({ query: 'q' }, 'k')

    expect(result.sources[0]?.publishedAt).toBe('2026-08-16T12:00:00.000Z')
  })

  it('include_answer 未开启时不把 answer 映射成 content', async () => {
    const { fetch } = stubFetch(tavilyBody({ answer: '一段摘要' }))
    const adapter = new TavilyAdapter({ fetch })

    const result = await adapter.search({ query: 'q' }, 'k')

    // 第一版不开启 include_answer：即使响应带 answer 也不是本次请求要的东西。
    expect(result.content).toBeUndefined()
  })

  it('非 2xx 抛错并带上状态码', async () => {
    const { fetch } = stubFetch('{"detail":"unauthorized"}', 401)
    const adapter = new TavilyAdapter({ fetch })

    await expect(adapter.search({ query: 'q' }, 'k')).rejects.toThrow(/401/u)
  })
})

describe('FNOS-010-08 Tavily 用量适配', () => {
  it('映射 key 层与 account 层用量', async () => {
    const { fetch, calls } = stubFetch(tavilyUsageBody())
    const adapter = new TavilyUsageAdapter({ fetch })

    const usage = await adapter.fetchUsage('tvly-key')

    expect(calls[0]?.url).toBe('https://api.tavily.com/usage')
    expect((calls[0]?.init?.headers as Record<string, string>).Authorization).toBe('Bearer tvly-key')
    expect(usage.error).toBeUndefined()
    expect(usage.details.plan).toBe('Researcher')
    expect(usage.details.planUsage).toBe('167 / 1000')
    expect(usage.details.keyUsage).toBe('0')
  })

  it('key 层 limit 为 null 时不虚构上限（当前档位没有 key 级硬上限）', async () => {
    const { fetch } = stubFetch(tavilyUsageBody())
    const adapter = new TavilyUsageAdapter({ fetch })

    const usage = await adapter.fetchUsage('k')

    expect(usage.details.keyUsage).toBe('0')
    expect(usage.details.keyUsage).not.toContain('null')
  })

  it('账户套餐耗尽时标记 exhausted，供请求前探测排除该账户全部 key', async () => {
    const { fetch } = stubFetch(tavilyUsageBody({
      account: { current_plan: 'Researcher', plan_usage: 1000, plan_limit: 1000 },
    }))
    const adapter = new TavilyUsageAdapter({ fetch })

    const usage = await adapter.fetchUsage('k')

    expect(usage.exhausted).toBe(true)
  })

  it('配额未耗尽标记为未触限', async () => {
    const { fetch } = stubFetch(tavilyUsageBody())
    const adapter = new TavilyUsageAdapter({ fetch })

    const usage = await adapter.fetchUsage('k')

    expect(usage.exhausted).toBe(false)
  })

  it('plan_limit 缺失或为 null 时不做触限判定', async () => {
    const { fetch } = stubFetch(tavilyUsageBody({
      account: { current_plan: 'Researcher', plan_usage: 167, plan_limit: null },
    }))
    const adapter = new TavilyUsageAdapter({ fetch })

    const usage = await adapter.fetchUsage('k')

    expect(usage.exhausted).toBeUndefined()
  })

  it('用量端点失败时返回带 error 的快照而不抛出（展示层容错）', async () => {
    const { fetch } = stubFetch('{"detail":"boom"}', 500)
    const adapter = new TavilyUsageAdapter({ fetch })

    const usage = await adapter.fetchUsage('k')

    expect(usage.error).toContain('500')
    expect(usage.details).toEqual({})
  })

  it('钱包/用量文本中不出现 key', async () => {
    const { fetch } = stubFetch(tavilyUsageBody())
    const adapter = new TavilyUsageAdapter({ fetch })

    const usage = await adapter.fetchUsage('tvly-dev-SECRETVALUE')

    expect(JSON.stringify(usage)).not.toContain('SECRETVALUE')
  })
})
