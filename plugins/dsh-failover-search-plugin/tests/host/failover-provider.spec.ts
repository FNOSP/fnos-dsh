import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web'
import { FailoverSearchProvider } from '../../src/host/failover-provider.ts'
import type { AccountUsage, SourceAdapter } from '../../src/contracts/types.ts'
import { OFFICIAL_SOURCE_ID, TAVILY_PLATFORM_ID, TINYFISH_PLATFORM_ID } from '../../src/contracts/constants.ts'
import type { FailoverSearchSettings } from '../../src/contracts/config.ts'

/** 一个记录调用并返回固定结果/抛错的可编程来源适配器。 */
function stubAdapter(platform: 'tinyfish' | 'tavily', behaviour: (key: string) => Promise<WebSearchResult> | WebSearchResult) {
  const calls: string[] = []
  const adapter: SourceAdapter = {
    platform,
    search: async (request: WebSearchRequest, key: string): Promise<WebSearchResult> => {
      calls.push(key)
      void request
      return behaviour(key)
    },
  }
  return { adapter, calls }
}

/** 构造一次搜索的配置取值。 */
function settings(overrides: Partial<FailoverSearchSettings> = {}): FailoverSearchSettings {
  return {
    tinyfishAccounts: [],
    tavilyAccounts: [],
    sourceOrder: [TINYFISH_PLATFORM_ID, TAVILY_PLATFORM_ID, OFFICIAL_SOURCE_ID],
    timeoutMs: 15000,
    samePlatformRetry: true,
    usageRefreshMinutes: 5,
    requestProbe: true,
    ...overrides,
  }
}

/** 官方兜底级的替身：记录是否被调用。 */
function officialStub(result: WebSearchResult | Error) {
  const calls: WebSearchRequest[] = []
  return {
    calls,
    provider: {
      id: OFFICIAL_SOURCE_ID,
      available: () => true,
      search: async (request: WebSearchRequest): Promise<WebSearchResult> => {
        calls.push(request)
        if (result instanceof Error) throw result
        return result
      },
    },
  }
}

const ok = (marker: string): WebSearchResult => ({ sources: [{ url: `https://${marker}.example` }], truncated: false })

describe('FNOS-010-01/02/03 复合提供方的转移链', () => {
  let tinyfish: ReturnType<typeof stubAdapter>
  let tavily: ReturnType<typeof stubAdapter>
  let official: ReturnType<typeof officialStub>

  beforeEach(() => {
    tinyfish = stubAdapter(TINYFISH_PLATFORM_ID, () => ok('tinyfish'))
    tavily = stubAdapter(TAVILY_PLATFORM_ID, () => ok('tavily'))
    official = officialStub(ok('official'))
  })

  /** 构造提供方并注入当前替身。 */
  function build(config: FailoverSearchSettings) {
    return new FailoverSearchProvider({
      readSettings: () => config,
      adapters: { tinyfish: [tinyfish.adapter], tavily: [tavily.adapter] },
      official: official.provider,
      onAttempt: () => undefined,
    })
  }

  it('提供方 id 与配置命名空间一致（patch 的 searchProvider 指向它）', () => {
    const provider = build(settings())
    expect(provider.id).toBe('dsh-failover-search')
  })

  it('FNOS-010-01-AC-01：仅配置 TinyFish 时结果由 TinyFish 返回，官方未被调用', async () => {
    const provider = build(settings({ tinyfishAccounts: [{ key: 'tf-1' }] }))

    const result = await provider.search({ query: 'q' })

    expect(result.sources[0]?.url).toBe('https://tinyfish.example')
    expect(official.calls).toHaveLength(0)
    expect(tavily.calls).toHaveLength(0)
  })

  it('FNOS-010-01-AC-02：两个三方 key 都配置时取顺序最高的来源', async () => {
    const provider = build(settings({
      tinyfishAccounts: [{ key: 'tf-1' }],
      tavilyAccounts: [{ key: 'tv-1' }],
    }))

    const result = await provider.search({ query: 'q' })

    expect(result.sources[0]?.url).toBe('https://tinyfish.example')
    expect(tavily.calls).toHaveLength(0)
  })

  it('FNOS-010-02-AC-01：最高优先来源失败时转移，同一查询由下一来源完成', async () => {
    tinyfish = stubAdapter(TINYFISH_PLATFORM_ID, () => { throw new WebError('429 限流', 'WEB_PROVIDER_ERROR') })
    const provider = build(settings({
      tinyfishAccounts: [{ key: 'tf-1' }],
      tavilyAccounts: [{ key: 'tv-1' }],
    }))

    const result = await provider.search({ query: 'q' })

    expect(result.sources[0]?.url).toBe('https://tavily.example')
    expect(official.calls).toHaveLength(0)
  })

  it('FNOS-010-02-AC-02：未配置 key 的来源被直接跳过，不产生请求', async () => {
    const provider = build(settings({ tavilyAccounts: [{ key: 'tv-1' }] }))

    const result = await provider.search({ query: 'q' })

    expect(tinyfish.calls).toHaveLength(0)
    expect(result.sources[0]?.url).toBe('https://tavily.example')
  })

  it('FNOS-010-02-AC-03：全部来源失败且官方也失败时抛出明确错误，不返回空结果', async () => {
    tinyfish = stubAdapter(TINYFISH_PLATFORM_ID, () => { throw new WebError('tinyfish down', 'WEB_PROVIDER_ERROR') })
    tavily = stubAdapter(TAVILY_PLATFORM_ID, () => { throw new WebError('tavily down', 'WEB_PROVIDER_ERROR') })
    official = officialStub(new Error('official down'))
    const provider = build(settings({
      tinyfishAccounts: [{ key: 'tf-1' }],
      tavilyAccounts: [{ key: 'tv-1' }],
    }))

    await expect(provider.search({ query: 'q' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
  })

  it('FNOS-010-03-AC-01：不配置任何三方 key 时直接使用官方搜索', async () => {
    const provider = build(settings())

    const result = await provider.search({ query: 'q' })

    expect(result.sources[0]?.url).toBe('https://official.example')
    expect(official.calls).toHaveLength(1)
  })

  it('FNOS-010-03-AC-02：三方全部失败时回落官方，凭据缺失保留 CREDENTIAL_MISSING 语义', async () => {
    tinyfish = stubAdapter(TINYFISH_PLATFORM_ID, () => { throw new WebError('down', 'WEB_PROVIDER_ERROR') })
    official = officialStub(new WebError('请配置 DEEPSEEK_API_KEY', 'WEB_PROVIDER_CREDENTIAL_MISSING'))
    const provider = build(settings({ tinyfishAccounts: [{ key: 'tf-1' }] }))

    await expect(provider.search({ query: 'q' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' })
    expect(official.calls).toHaveLength(1)
  })

  it('用户中止直接上抛 WEB_ABORTED，不触发向下一来源转移', async () => {
    tinyfish = stubAdapter(TINYFISH_PLATFORM_ID, () => { throw new WebError('搜索已取消', 'WEB_ABORTED') })
    const provider = build(settings({
      tinyfishAccounts: [{ key: 'tf-1' }],
      tavilyAccounts: [{ key: 'tv-1' }],
    }))

    await expect(provider.search({ query: 'q' })).rejects.toMatchObject({ code: 'WEB_ABORTED' })
    expect(tavily.calls).toHaveLength(0)
  })

  it('一次搜索最多把已配置来源各尝试一遍，不做跨来源无限重试', async () => {
    tinyfish = stubAdapter(TINYFISH_PLATFORM_ID, () => { throw new WebError('down', 'WEB_PROVIDER_ERROR') })
    tavily = stubAdapter(TAVILY_PLATFORM_ID, () => { throw new WebError('down', 'WEB_PROVIDER_ERROR') })
    official = officialStub(new Error('down'))
    const provider = build(settings({
      tinyfishAccounts: [{ key: 'tf-1' }],
      tavilyAccounts: [{ key: 'tv-1' }],
    }))

    await expect(provider.search({ query: 'q' })).rejects.toThrow()
    expect(tinyfish.calls).toHaveLength(1)
    expect(tavily.calls).toHaveLength(1)
    expect(official.calls).toHaveLength(1)
  })

  it('来源顺序可调整：Tavily 排前时先请求 Tavily', async () => {
    const provider = build(settings({
      tinyfishAccounts: [{ key: 'tf-1' }],
      tavilyAccounts: [{ key: 'tv-1' }],
      sourceOrder: [TAVILY_PLATFORM_ID, TINYFISH_PLATFORM_ID, OFFICIAL_SOURCE_ID],
    }))

    const result = await provider.search({ query: 'q' })

    expect(result.sources[0]?.url).toBe('https://tavily.example')
    expect(tinyfish.calls).toHaveLength(0)
  })

  it('available()：任一平台有可用账号或兜底级可用即为真', () => {
    expect(build(settings({ tinyfishAccounts: [{ key: 'k' }] })).available()).toBe(true)
    expect(build(settings()).available()).toBe(true)
  })

  it('available()：账号都被请求前探测排除且兜底级不可用时为假', () => {
    const provider = new FailoverSearchProvider({
      readSettings: () => settings({ tinyfishAccounts: [{ key: 'k', label: 'tinyfish-1' }] }),
      adapters: { tinyfish: [tinyfish.adapter], tavily: [tavily.adapter] },
      official: { id: OFFICIAL_SOURCE_ID, available: () => false, search: async () => ok('x') },
      usage: {
        snapshot: () => [
          { platform: TINYFISH_PLATFORM_ID, accountLabel: 'tinyfish-1', fetchedAt: new Date(0).toISOString(), exhausted: true, details: {} },
        ],
        isFresh: () => true,
      },
      onAttempt: () => undefined,
    })

    expect(provider.available()).toBe(false)
  })

  it('available()：配置了账号但无用量信息时仍为真（探测缺失不构成不可用）', () => {
    const provider = build(settings({ tinyfishAccounts: [{ key: 'k' }] }))

    expect(provider.available()).toBe(true)
  })

  it('available() 不产生网络调用（接缝要求廉价本地检查）', () => {
    const fetchSpy = vi.fn()
    const provider = build(settings({ tinyfishAccounts: [{ key: 'k' }] }))

    provider.available()

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('每次调用开始时快照一次配置：保存后的新配置在下一次搜索生效', async () => {
    let current = settings({ tinyfishAccounts: [{ key: 'tf-1' }] })
    const provider = new FailoverSearchProvider({
      readSettings: () => current,
      adapters: { tinyfish: [tinyfish.adapter], tavily: [tavily.adapter] },
      official: official.provider,
      onAttempt: () => undefined,
    })

    await provider.search({ query: 'q' })
    current = settings({ tavilyAccounts: [{ key: 'tv-1' }] })
    await provider.search({ query: 'q' })

    expect(tinyfish.calls).toHaveLength(1)
    expect(tavily.calls).toHaveLength(1)
  })

  it('每级尝试写一条脱敏事件：含平台/账号代号/结局，不含 key 或 query 全文', async () => {
    tinyfish = stubAdapter(TINYFISH_PLATFORM_ID, () => { throw new WebError('down', 'WEB_PROVIDER_ERROR') })
    const events: unknown[] = []
    const provider = new FailoverSearchProvider({
      readSettings: () => settings({ tinyfishAccounts: [{ key: 'tf-SECRET', label: 'tinyfish-1' }], tavilyAccounts: [{ key: 'tv-1' }] }),
      adapters: { tinyfish: [tinyfish.adapter], tavily: [tavily.adapter] },
      official: official.provider,
      onAttempt: event => events.push(event),
    })

    await provider.search({ query: '超级机密的查询内容' })

    const serialized = JSON.stringify(events)
    expect(serialized).not.toContain('tf-SECRET')
    expect(serialized).not.toContain('超级机密的查询内容')
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ platform: TINYFISH_PLATFORM_ID, account: 'tinyfish-1', outcome: 'failed' })
    expect(events[1]).toMatchObject({ platform: TAVILY_PLATFORM_ID, outcome: 'succeeded' })
  })

  it('账号未配备注名时事件使用平台-序号代号', async () => {
    tinyfish = stubAdapter(TINYFISH_PLATFORM_ID, () => { throw new WebError('down', 'WEB_PROVIDER_ERROR') })
    const events: { account?: string }[] = []
    const provider = new FailoverSearchProvider({
      readSettings: () => settings({ tinyfishAccounts: [{ key: 'a' }, { key: 'b' }], tavilyAccounts: [{ key: 'tv-1' }] }),
      adapters: { tinyfish: [tinyfish.adapter], tavily: [tavily.adapter] },
      official: official.provider,
      onAttempt: event => events.push(event as { account?: string }),
    })

    await provider.search({ query: 'q' })

    expect(events[0]?.account).toBe('tinyfish-1')
  })

  it('FNOS-010-05-AC-02：maxResults 交由接缝截断，来源侧原样返回', async () => {
    // 接缝负责最终截断；提供方不重复实现上限规则，只保证结果可被截断。
    const many: WebSearchResult = {
      sources: Array.from({ length: 12 }, (_v, index) => ({ url: `https://tinyfish.example/${index}` })),
      truncated: false,
    }
    tinyfish = stubAdapter(TINYFISH_PLATFORM_ID, () => many)
    const provider = build(settings({ tinyfishAccounts: [{ key: 'tf-1' }] }))

    const result = await provider.search({ query: 'q', maxResults: 3 })

    expect(result.sources).toHaveLength(12)
  })
})

describe('FNOS-010-07/09 账号池与请求前探测', () => {
  it('FNOS-010-07-AC-01：同平台多账号按轮转均摊，不集中消耗单一账号', async () => {
    const tinyfish = stubAdapter(TINYFISH_PLATFORM_ID, key => ok(`tf-${key}`))
    const official = officialStub(ok('official'))
    const provider = new FailoverSearchProvider({
      readSettings: () => settings({ tinyfishAccounts: [{ key: 'a' }, { key: 'b' }, { key: 'c' }] }),
      adapters: { tinyfish: [tinyfish.adapter], tavily: [] },
      official: official.provider,
      onAttempt: () => undefined,
    })

    for (let index = 0; index < 6; index += 1) await provider.search({ query: 'q' })

    // 6 次请求在 3 个账号间各 2 次：轮转均摊的分布可解释且均匀。
    expect(tinyfish.calls).toEqual(['a', 'b', 'c', 'a', 'b', 'c'])
  })

  it('FNOS-010-07-AC-02：账号失败时先尝试同平台其它账号，再落到下一平台', async () => {
    const calls: string[] = []
    const tinyfish: SourceAdapter = {
      platform: TINYFISH_PLATFORM_ID,
      search: async (_request, key) => {
        calls.push(`tf:${key}`)
        if (key === 'a') throw new WebError('429 限流', 'WEB_PROVIDER_ERROR')
        return ok('tinyfish-b')
      },
    }
    const tavily = stubAdapter(TAVILY_PLATFORM_ID, (key) => { calls.push(`tv:${key}`); return ok('tavily') })
    const official = officialStub(ok('official'))
    const provider = new FailoverSearchProvider({
      readSettings: () => settings({ tinyfishAccounts: [{ key: 'a' }, { key: 'b' }], tavilyAccounts: [{ key: 'tv-1' }] }),
      adapters: { tinyfish: [tinyfish], tavily: [tavily.adapter] },
      official: official.provider,
      onAttempt: () => undefined,
    })

    const result = await provider.search({ query: 'q' })

    // 同平台账号 a 失败 → 同平台账号 b 成功；tavily 未被请求（平台顺序不乱序）。
    expect(calls).toEqual(['tf:a', 'tf:b'])
    expect(result.sources[0]?.url).toBe('https://tinyfish-b.example')
  })

  it('同平台重试关闭时账号失败直接落到下一平台', async () => {
    const calls: string[] = []
    const tinyfish: SourceAdapter = {
      platform: TINYFISH_PLATFORM_ID,
      search: async (_request, key) => { calls.push(`tf:${key}`); throw new WebError('down', 'WEB_PROVIDER_ERROR') },
    }
    const tavily = stubAdapter(TAVILY_PLATFORM_ID, (key) => { calls.push(`tv:${key}`); return ok('tavily') })
    const official = officialStub(ok('official'))
    const provider = new FailoverSearchProvider({
      readSettings: () => settings({
        tinyfishAccounts: [{ key: 'a' }, { key: 'b' }],
        tavilyAccounts: [{ key: 'tv-1' }],
        samePlatformRetry: false,
      }),
      adapters: { tinyfish: [tinyfish], tavily: [tavily.adapter] },
      official: official.provider,
      onAttempt: () => undefined,
    })

    await provider.search({ query: 'q' })

    expect(calls).toEqual(['tf:a', 'tv:tv-1'])
  })

  it('单账号配置退化为直连', async () => {
    const tinyfish = stubAdapter(TINYFISH_PLATFORM_ID, key => ok(`tf-${key}`))
    const official = officialStub(ok('official'))
    const provider = new FailoverSearchProvider({
      readSettings: () => settings({ tinyfishAccounts: [{ key: 'only' }] }),
      adapters: { tinyfish: [tinyfish.adapter], tavily: [] },
      official: official.provider,
      onAttempt: () => undefined,
    })

    await provider.search({ query: 'q' })
    await provider.search({ query: 'q' })

    expect(tinyfish.calls).toEqual(['only', 'only'])
  })

  it('FNOS-010-09-AC-01：快照显示额度已满的账号在请求前被跳过，不发出注定失败的请求', async () => {
    const tinyfish = stubAdapter(TINYFISH_PLATFORM_ID, () => { throw new WebError('429 限流', 'WEB_PROVIDER_ERROR') })
    const exhausted: AccountUsage = {
      platform: TINYFISH_PLATFORM_ID,
      accountLabel: 'tinyfish-1',
      fetchedAt: new Date(0).toISOString(),
      exhausted: true,
      details: {},
    }
    const official = officialStub(ok('official'))
    const provider = new FailoverSearchProvider({
      readSettings: () => settings({ tinyfishAccounts: [{ key: 'a', label: 'tinyfish-1' }, { key: 'b', label: 'tinyfish-2' }], tavilyAccounts: [{ key: 'tv-1' }] }),
      adapters: { tinyfish: [tinyfish.adapter], tavily: [] },
      official: official.provider,
      usage: { snapshot: () => [exhausted], isFresh: () => true },
      onAttempt: () => undefined,
    })

    const result = await provider.search({ query: 'q' })

    // 账号 a 被探测跳过（无请求），账号 b 请求失败，最终官方兜底。
    expect(tinyfish.calls).toEqual(['b'])
    expect(result.sources[0]?.url).toBe('https://official.example')
  })

  it('FNOS-010-09-AC-02：快照过期时按无用量信息执行，不阻塞搜索', async () => {
    const tinyfish = stubAdapter(TINYFISH_PLATFORM_ID, () => ok('tinyfish'))
    const official = officialStub(ok('official'))
    const provider = new FailoverSearchProvider({
      readSettings: () => settings({ tinyfishAccounts: [{ key: 'a', label: 'tinyfish-1' }] }),
      adapters: { tinyfish: [tinyfish.adapter], tavily: [] },
      official: official.provider,
      usage: {
        snapshot: () => [{ platform: TINYFISH_PLATFORM_ID, accountLabel: 'tinyfish-1', fetchedAt: new Date(0).toISOString(), exhausted: true, details: {} }],
        isFresh: () => false,
      },
      onAttempt: () => undefined,
    })

    const result = await provider.search({ query: 'q' })

    expect(tinyfish.calls).toEqual(['a'])
    expect(result.sources[0]?.url).toBe('https://tinyfish.example')
  })

  it('FNOS-010-09-AC-02：没有快照时不排除任何账号', async () => {
    const tinyfish = stubAdapter(TINYFISH_PLATFORM_ID, () => ok('tinyfish'))
    const official = officialStub(ok('official'))
    const provider = new FailoverSearchProvider({
      readSettings: () => settings({ tinyfishAccounts: [{ key: 'a' }] }),
      adapters: { tinyfish: [tinyfish.adapter], tavily: [] },
      official: official.provider,
      usage: { snapshot: () => [], isFresh: () => true },
      onAttempt: () => undefined,
    })

    await provider.search({ query: 'q' })

    expect(tinyfish.calls).toEqual(['a'])
  })

  it('FNOS-010-09-AC-03：快照恢复后账号重新参与均摊', async () => {
    const tinyfish = stubAdapter(TINYFISH_PLATFORM_ID, key => ok(`tf-${key}`))
    const official = officialStub(ok('official'))
    let exhaustedNow = true
    const provider = new FailoverSearchProvider({
      readSettings: () => settings({ tinyfishAccounts: [{ key: 'a', label: 'tinyfish-1' }, { key: 'b', label: 'tinyfish-2' }] }),
      adapters: { tinyfish: [tinyfish.adapter], tavily: [] },
      official: official.provider,
      usage: {
        snapshot: () => [
          { platform: TINYFISH_PLATFORM_ID, accountLabel: 'tinyfish-1', fetchedAt: new Date(0).toISOString(), exhausted: exhaustedNow, details: {} },
          { platform: TINYFISH_PLATFORM_ID, accountLabel: 'tinyfish-2', fetchedAt: new Date(0).toISOString(), exhausted: false, details: {} },
        ],
        isFresh: () => true,
      },
      onAttempt: () => undefined,
    })

    await provider.search({ query: 'q' })
    exhaustedNow = false
    await provider.search({ query: 'q' })

    // 第一次只有 b 参与；恢复后 a 重新进入轮转。
    expect(tinyfish.calls).toEqual(['b', 'a'])
  })

  it('请求前探测关闭时即使快照标记已满也不跳过', async () => {
    const tinyfish = stubAdapter(TINYFISH_PLATFORM_ID, () => ok('tinyfish'))
    const official = officialStub(ok('official'))
    const provider = new FailoverSearchProvider({
      readSettings: () => settings({ tinyfishAccounts: [{ key: 'a', label: 'tinyfish-1' }], requestProbe: false }),
      adapters: { tinyfish: [tinyfish.adapter], tavily: [] },
      official: official.provider,
      usage: {
        snapshot: () => [{ platform: TINYFISH_PLATFORM_ID, accountLabel: 'tinyfish-1', fetchedAt: new Date(0).toISOString(), exhausted: true, details: {} }],
        isFresh: () => true,
      },
      onAttempt: () => undefined,
    })

    await provider.search({ query: 'q' })

    expect(tinyfish.calls).toEqual(['a'])
  })

  it('本地限流窗口记满的账号在请求前被跳过（TinyFish 无服务端配额可查）', async () => {
    const tinyfish = stubAdapter(TINYFISH_PLATFORM_ID, () => ok('tinyfish'))
    const official = officialStub(ok('official'))
    const provider = new FailoverSearchProvider({
      readSettings: () => settings({ tinyfishAccounts: [{ key: 'a', label: 'tinyfish-1' }, { key: 'b', label: 'tinyfish-2' }] }),
      adapters: { tinyfish: [tinyfish.adapter], tavily: [] },
      official: official.provider,
      usage: {
        snapshot: () => [],
        isFresh: () => true,
        // 本地记账已经判定账号 a 触限（不代表服务端额度）。
        locallyLimited: label => label === 'tinyfish-1',
      },
      onAttempt: () => undefined,
    })

    await provider.search({ query: 'q' })

    expect(tinyfish.calls).toEqual(['b'])
  })
})

describe('FNOS-010-05 结果呈现与截断', () => {
  it('三方结果原样透传 sources（标题/链接/摘要/日期由适配层归一）', async () => {
    const tinyfish = stubAdapter(TINYFISH_PLATFORM_ID, () => ({
      sources: [
        { url: 'https://a.example', title: 'A', snippet: '摘要 A', publishedAt: '2026-08-16T00:00:00.000Z' },
        { url: 'https://b.example', title: 'B', snippet: '摘要 B' },
      ],
      truncated: false,
    }))
    const official = officialStub(ok('official'))
    const provider = new FailoverSearchProvider({
      readSettings: () => settings({ tinyfishAccounts: [{ key: 'k' }] }),
      adapters: { tinyfish: [tinyfish.adapter], tavily: [] },
      official: official.provider,
      onAttempt: () => undefined,
    })

    const result = await provider.search({ query: 'q', maxResults: 10 })

    expect(result.sources[0]?.publishedAt).toBe('2026-08-16T00:00:00.000Z')
    // 无日期的来源不显示错误或占位乱码：字段就是缺席的。
    expect(result.sources[1]).not.toHaveProperty('publishedAt')
  })

  it('不跨来源合并结果：首个成功的来源结果直接返回', async () => {
    const tinyfish = stubAdapter(TINYFISH_PLATFORM_ID, () => ({ sources: [{ url: 'https://a.example' }], truncated: false }))
    const tavily = stubAdapter(TAVILY_PLATFORM_ID, () => ({ sources: [{ url: 'https://b.example' }], truncated: false }))
    const official = officialStub(ok('official'))
    const provider = new FailoverSearchProvider({
      readSettings: () => settings({ tinyfishAccounts: [{ key: 'k' }], tavilyAccounts: [{ key: 'k2' }] }),
      adapters: { tinyfish: [tinyfish.adapter], tavily: [tavily.adapter] },
      official: official.provider,
      onAttempt: () => undefined,
    })

    const result = await provider.search({ query: 'q' })

    expect(result.sources).toHaveLength(1)
    expect(tavily.calls).toHaveLength(0)
  })
})
