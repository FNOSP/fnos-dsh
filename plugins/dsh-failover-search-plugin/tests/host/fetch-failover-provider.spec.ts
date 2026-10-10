import { describe, expect, it, vi } from 'vitest'
import { WebError } from '@deepseek-ai/dsh-web'
import { CompositeFetchProvider } from '../../src/host/fetch-failover-provider.ts'
import type { FetchBackend } from '../../src/host/fetch-failover-provider.ts'

/** 构造一个按脚本行动的本地跳：成功返回或抛指定错误。 */
function localBackend(script: () => Promise<{ url: string, statusCode: number, body: { kind: 'html', content: string }, truncated: false }>): FetchBackend {
  return { fetch: script }
}

const okResult = (url = 'https://example.com') => ({
  url,
  statusCode: 200,
  body: { kind: 'html' as const, content: '<html>ok</html>' },
  truncated: false as const,
})

/** 平台跳：断言收到的 url，返回正文字符串。 */
function platformBackend(name: string, impl: (url: string) => Promise<string>): FetchBackend {
  return {
    fetch: async (request) => {
      const text = await impl(request.url)
      return { url: request.url, statusCode: 200, body: { kind: 'text', content: text }, truncated: false }
    },
  }
}

/** 永不可用的平台（available()=false）。 */
const unavailableBackend: FetchBackend = {
  available: () => false,
  fetch: async () => { throw new Error('should not be called') },
}

describe('FNOS-010-11 复合抓取提供方', () => {
  it('本地成功：原样返回，平台零调用（AC-01 行为零变化）', async () => {
    const platform = { fetch: vi.fn() }
    const provider = new CompositeFetchProvider({
      id: 'dsh-failover-search',
      local: localBackend(async () => okResult()),
      platforms: [{ platform: 'tinyfish', backend: platform as unknown as FetchBackend }],
    })

    const result = await provider.fetch({ url: 'https://example.com' })
    expect(result.statusCode).toBe(200)
    expect(result.body).toEqual({ kind: 'html', content: '<html>ok</html>' })
    expect(platform.fetch).not.toHaveBeenCalled()
  })

  it('本地失败且 TinyFish 可用：转 TinyFish，返回 text 正文（AC-01）', async () => {
    const provider = new CompositeFetchProvider({
      id: 'dsh-failover-search',
      local: localBackend(async () => { throw new WebError('blocked', 'WEB_INVALID_URL') }),
      platforms: [
        { platform: 'tinyfish', backend: platformBackend('tinyfish', async () => 'platform content') },
      ],
    })

    const result = await provider.fetch({ url: 'https://example.com' })
    expect(result.body).toEqual({ kind: 'text', content: 'platform content' })
    expect(result.statusCode).toBe(200)
  })

  it('本地失败、TinyFish 不可用：转 Tavily（AC-02 次序）', async () => {
    const provider = new CompositeFetchProvider({
      id: 'dsh-failover-search',
      local: localBackend(async () => { throw new WebError('timeout', 'WEB_FETCH_TIMEOUT') }),
      platforms: [
        { platform: 'tinyfish', backend: unavailableBackend },
        { platform: 'tavily', backend: platformBackend('tavily', async () => 'tavily content') },
      ],
    })

    const result = await provider.fetch({ url: 'https://example.com' })
    expect(result.body).toEqual({ kind: 'text', content: 'tavily content' })
  })

  it('本地失败、TinyFish 也失败：落到 Tavily（AC-02 平台间转移）', async () => {
    const provider = new CompositeFetchProvider({
      id: 'dsh-failover-search',
      local: localBackend(async () => { throw new WebError('err', 'WEB_PROVIDER_ERROR') }),
      platforms: [
        { platform: 'tinyfish', backend: { fetch: async () => { throw new WebError('tiny down', 'WEB_PROVIDER_ERROR') } } },
        { platform: 'tavily', backend: platformBackend('tavily', async () => 'tavily content') },
      ],
    })

    const result = await provider.fetch({ url: 'https://example.com' })
    expect(result.body).toEqual({ kind: 'text', content: 'tavily content' })
  })

  it('本地失败、无可用平台：按最后一个错误抛出（AC-02 不静默）', async () => {
    const provider = new CompositeFetchProvider({
      id: 'dsh-failover-search',
      local: localBackend(async () => { throw new WebError('local down', 'WEB_PROVIDER_ERROR') }),
      platforms: [{ platform: 'tinyfish', backend: unavailableBackend }],
    })

    await expect(provider.fetch({ url: 'https://example.com' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR', message: expect.stringContaining('local down') })
  })

  it('本地失败、平台全失败：错误码取本地、消息聚合各跳原因（AC-02 不吞细节）', async () => {
    const provider = new CompositeFetchProvider({
      id: 'dsh-failover-search',
      local: localBackend(async () => { throw new WebError('local down', 'WEB_PROVIDER_ERROR') }),
      platforms: [
        { platform: 'tinyfish', backend: { fetch: async () => { throw new WebError('tiny down', 'WEB_PROVIDER_ERROR') } } },
        { platform: 'tavily', backend: { fetch: async () => { throw new WebError('tavily down', 'WEB_PROVIDER_ERROR') } } },
      ],
    })

    await expect(provider.fetch({ url: 'https://example.com' })).rejects.toMatchObject({
      code: 'WEB_PROVIDER_ERROR',
      message: expect.stringContaining('tavily down'),
    })
  })

  it('用户中止直抛 WEB_ABORTED，不转平台（AC-03）', async () => {
    const platform = { fetch: vi.fn() }
    const provider = new CompositeFetchProvider({
      id: 'dsh-failover-search',
      local: localBackend(async () => { throw new WebError('aborted', 'WEB_ABORTED') }),
      platforms: [{ platform: 'tinyfish', backend: platform as unknown as FetchBackend }],
    })

    await expect(provider.fetch({ url: 'https://example.com' })).rejects.toMatchObject({ code: 'WEB_ABORTED' })
    expect(platform.fetch).not.toHaveBeenCalled()
  })

  it('available() 反映本地与任一平台的可用性（本地可用即可用）', () => {
    const provider = new CompositeFetchProvider({
      id: 'dsh-failover-search',
      local: { available: () => true, fetch: async () => okResult() },
      platforms: [{ platform: 'tinyfish', backend: unavailableBackend }],
    })
    expect(provider.available()).toBe(true)
  })

  it('平台 backend 缺省 available()=true（无显式声明的适配默认可用）', async () => {
    const provider = new CompositeFetchProvider({
      id: 'dsh-failover-search',
      local: localBackend(async () => { throw new WebError('down', 'WEB_PROVIDER_ERROR') }),
      platforms: [{ platform: 'tinyfish', backend: platformBackend('tinyfish', async () => 'ok') }],
    })
    // 未显式实现 available 的 backend 视为可用（探测按需进行，fetch 本身就是探测）。
    const result = await provider.fetch({ url: 'https://example.com' })
    expect(result.body).toEqual({ kind: 'text', content: 'ok' })
  })
})

describe('FNOS-010-11 逐跳事件（诊断用）', () => {
  it('本地失败→平台成功：事件序列为 local failed → tinyfish succeeded', async () => {
    const events: { platform: string, outcome: string }[] = []
    const provider = new CompositeFetchProvider({
      id: 'dsh-failover-search',
      local: localBackend(async () => { throw new WebError('blocked', 'WEB_INVALID_URL') }),
      platforms: [{ platform: 'tinyfish', backend: platformBackend('tinyfish', async () => 'ok') }],
      onHop: e => events.push({ platform: e.platform, outcome: e.outcome }),
    })

    await provider.fetch({ url: 'https://example.com' })
    expect(events).toEqual([
      { platform: 'local', outcome: 'failed' },
      { platform: 'tinyfish', outcome: 'succeeded' },
    ])
  })

  it('不可用的平台记 skipped（与 failed 区分：没试过 vs 试了失败）', async () => {
    const events: { platform: string, outcome: string }[] = []
    const provider = new CompositeFetchProvider({
      id: 'dsh-failover-search',
      local: localBackend(async () => { throw new WebError('blocked', 'WEB_INVALID_URL') }),
      platforms: [
        { platform: 'tinyfish', backend: unavailableBackend },
        { platform: 'tavily', backend: platformBackend('tavily', async () => 'ok') },
      ],
      onHop: e => events.push({ platform: e.platform, outcome: e.outcome }),
    })

    await provider.fetch({ url: 'https://example.com' })
    expect(events).toEqual([
      { platform: 'local', outcome: 'failed' },
      { platform: 'tinyfish', outcome: 'skipped' },
      { platform: 'tavily', outcome: 'succeeded' },
    ])
  })

  it('本地成功：只记一条 succeeded，平台无事件', async () => {
    const events: { platform: string, outcome: string }[] = []
    const provider = new CompositeFetchProvider({
      id: 'dsh-failover-search',
      local: localBackend(async () => okResult()),
      platforms: [{ platform: 'tinyfish', backend: platformBackend('tinyfish', async () => 'ok') }],
      onHop: e => events.push({ platform: e.platform, outcome: e.outcome }),
    })

    await provider.fetch({ url: 'https://example.com' })
    expect(events).toEqual([{ platform: 'local', outcome: 'succeeded' }])
  })
})
