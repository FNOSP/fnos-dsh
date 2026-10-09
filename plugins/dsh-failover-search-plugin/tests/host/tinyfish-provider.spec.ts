import { describe, expect, it, vi } from 'vitest'
import { TinyFishAdapter } from '../../src/host/tinyfish-provider.ts'

/** 真实 TinyFish 搜索响应样本（2026-10-09 实测，字段结构一致）。 */
function tinyfishBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    query: 'deepseek harness',
    total_results: 2,
    page: 0,
    results: [
      {
        position: 1,
        site_name: 'www.deepseek.com',
        title: 'DeepSeek Harness | Explore the limits of intelligence',
        snippet: 'Use DeepSeek Harness to work with documents.',
        url: 'https://www.deepseek.com/en/harness/',
        date: 'Nov 13, 2025',
      },
      {
        position: 2,
        site_name: 'github.com',
        title: 'DeepSeek Harness: Everything is a Plugin.',
        snippet: 'An open-source agent harness developed by DeepSeek AI.',
        url: 'https://github.com/deepseek-ai/deepseek-harness',
      },
    ],
    ...overrides,
  })
}

/** 构造一个记录请求并返回给定响应的 fetch。 */
function stubFetch(body: string, status = 200): { fetch: typeof fetch, calls: { url: string, init: RequestInit | undefined }[] } {
  const calls: { url: string, init: RequestInit | undefined }[] = []
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    return new Response(body, { status, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
  return { fetch: fetchImpl, calls }
}

describe('FNOS-010-01/02/05 TinyFish 适配', () => {
  it('用 X-API-Key 头请求搜索端点并带上 query', async () => {
    const { fetch, calls } = stubFetch(tinyfishBody())
    const adapter = new TinyFishAdapter({ fetch })

    await adapter.search({ query: 'deepseek harness' }, 'tf-test-key')

    expect(calls[0]?.url).toContain('https://api.search.tinyfish.ai')
    expect(calls[0]?.url).toContain('query=deepseek+harness')
    expect((calls[0]?.init?.headers as Record<string, string>)['X-API-Key']).toBe('tf-test-key')
  })

  it('把 TinyFish 字段映射到接缝词表（url/title/snippet/publishedAt）', async () => {
    const { fetch } = stubFetch(tinyfishBody())
    const adapter = new TinyFishAdapter({ fetch })

    const result = await adapter.search({ query: 'deepseek harness' }, 'k')

    expect(result.sources).toHaveLength(2)
    expect(result.sources[0]).toEqual({
      url: 'https://www.deepseek.com/en/harness/',
      title: 'DeepSeek Harness | Explore the limits of intelligence',
      snippet: 'Use DeepSeek Harness to work with documents.',
      publishedAt: '2025-11-13T00:00:00.000Z',
    })
    // 来源未返回日期时省略 publishedAt，而不是发明一个值。
    expect(result.sources[1]).not.toHaveProperty('publishedAt')
    // TinyFish 不提供摘要答案；content 保持未设置。
    expect(result.content).toBeUndefined()
    // 截断由接缝负责，来源侧不做上限判断。
    expect(result.truncated).toBe(false)
  })

  it('缺少 url 的条目被跳过（接缝要求 source 一定有 URL）', async () => {
    const { fetch } = stubFetch(JSON.stringify({
      results: [{ title: 'no url' }, { url: 'https://example.com', title: 'ok' }],
    }))
    const adapter = new TinyFishAdapter({ fetch })

    const result = await adapter.search({ query: 'q' }, 'k')

    expect(result.sources).toHaveLength(1)
    expect(result.sources[0]?.url).toBe('https://example.com')
  })

  it('非 2xx 响应抛错并带上状态码（供转移链判定失败）', async () => {
    const { fetch } = stubFetch('{"error":"rate limited"}', 429)
    const adapter = new TinyFishAdapter({ fetch })

    await expect(adapter.search({ query: 'q' }, 'k')).rejects.toThrow(/429/u)
  })

  it('返回体不是 JSON 时抛错而不是静默返回空结果', async () => {
    const { fetch } = stubFetch('<html>gateway error</html>', 200)
    const adapter = new TinyFishAdapter({ fetch })

    await expect(adapter.search({ query: 'q' }, 'k')).rejects.toThrow()
  })

  it('响应缺少 results 数组时按空来源返回，不抛错', async () => {
    const { fetch } = stubFetch(JSON.stringify({ query: 'q' }))
    const adapter = new TinyFishAdapter({ fetch })

    await expect(adapter.search({ query: 'q' }, 'k')).resolves.toEqual({ sources: [], truncated: false })
  })

  it('相对重定向 URL 还原成绝对地址（上游会返回 Google 风格的 /url?q= 包装）', async () => {
    // 实测（2026-10-09）：同一 key 下部分查询返回的是
    // `/url?opi=…&q=https://real-target&sa=U&ved=…` 这样的相对地址——它指向搜索平台
    // 自己的重定向端点，不是文档站点。接缝要求 source 一定有可引用的 URL，把这种
    // 相对地址原样透传会让搜索卡片里的链接指向错误主机。
    const { fetch } = stubFetch(JSON.stringify({
      results: [
        { url: '/url?opi=89978449&q=https://www.deepseek.com/en/harness/&sa=U&ved=2ahUKEwi', title: 'A', snippet: 's' },
        // 目标本身含百分号编码时按原样解码一次。
        { url: '/url?q=https://news.ycombinator.com/item%3Fid%3D49285244&sa=U', title: 'B', snippet: 's' },
        // 已经绝对地址的条目不受影响。
        { url: 'https://github.com/deepseek-ai/deepseek-harness', title: 'C', snippet: 's' },
      ],
    }))
    const adapter = new TinyFishAdapter({ fetch })

    const result = await adapter.search({ query: 'q' }, 'k')

    expect(result.sources.map(source => source.url)).toEqual([
      'https://www.deepseek.com/en/harness/',
      'https://news.ycombinator.com/item?id=49285244',
      'https://github.com/deepseek-ai/deepseek-harness',
    ])
  })

  it('无法还原的相对地址条目被跳过，而不是产生坏链接', async () => {
    const { fetch } = stubFetch(JSON.stringify({
      results: [
        { url: '/url?opi=89978449&sa=U', title: '没有目标参数', snippet: 's' },
        { url: '/relative/without-target', title: '陌生相对路径', snippet: 's' },
        { url: 'https://ok.example', title: 'ok', snippet: 's' },
      ],
    }))
    const adapter = new TinyFishAdapter({ fetch })

    const result = await adapter.search({ query: 'q' }, 'k')

    expect(result.sources.map(source => source.url)).toEqual(['https://ok.example'])
  })

  it('用户中止时抛 WEB_ABORTED，供转移链直接上抛而不换来源', async () => {
    const abort = new AbortController()
    const fetchImpl = vi.fn(async (_input: unknown, init?: RequestInit) => {
      // 模拟请求悬挂：只在信号中止时拒绝。
      await new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })
      return new Response('{}')
    }) as unknown as typeof fetch
    const adapter = new TinyFishAdapter({ fetch: fetchImpl })

    const pending = adapter.search({ query: 'q' }, 'k', abort.signal)
    abort.abort()
    await expect(pending).rejects.toMatchObject({ code: 'WEB_ABORTED' })
  })
})
