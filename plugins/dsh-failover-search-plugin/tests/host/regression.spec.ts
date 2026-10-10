/**
 * 回归用例 TC-052 / TC-054：本轮改动不得破坏既有行为。
 *
 * 背景：FNOS-010-11 新增了复合 fetch provider，并把组合行的 `fetchProvider` 从
 * `http` 改指本插件。这类「接管既有能力」的改动风险在于**回归**——本地抓取语义
 * 是否被悄悄改变、搜索链路是否被新 provider 干扰。本文件把这些基线钉成断言。
 *
 * 基线来源：dsh-v0.2.0-rc.2 的 `dsh-web-fetch-http` 默认行为与 FNOS-010-01 的既有
 * 搜索实现。基线值改动时本文件会失败，属于**有意的**——那意味着重新定义了行为，
 * 应当同步更新需求与用例。
 */
import { describe, expect, it, vi } from 'vitest'
import { WebError } from '@deepseek-ai/dsh-web'
import { CompositeFetchProvider } from '../../src/host/fetch-failover-provider.ts'
import type { FetchBackend } from '../../src/host/fetch-failover-provider.ts'
import { FailoverSearchProvider } from '../../src/host/failover-provider.ts'
import type { SourceAdapter } from '../../src/contracts/types.ts'
import { TAVILY_PLATFORM_ID, TINYFISH_PLATFORM_ID } from '../../src/contracts/constants.ts'
import { SessionToggleStore, runWithSession, shouldBypassActiveSession } from '../../src/host/session-toggle.ts'

const settings = (overrides: Record<string, unknown> = {}) => ({
  tinyfishAccounts: [{ key: 'sk-t', label: 'tinyfish-1' }],
  tavilyAccounts: [{ key: 'tvly-t', label: 'tavily-1' }],
  sourceOrder: ['tinyfish', 'tavily', 'deepseek-official'],
  timeoutMs: 15000,
  samePlatformRetry: true,
  usageRefreshMinutes: 5,
  requestProbe: true,
  ...overrides,
}) as never

/** 搜索适配器桩：记录调用并返回固定结果。 */
function searchAdapter(platform: string, impl?: () => Promise<never>): SourceAdapter & { calls: number } {
  const adapter = {
    platform: platform as SourceAdapter['platform'],
    calls: 0,
    async search(_request: { query: string }) {
      adapter.calls += 1
      if (impl !== undefined) await impl()
      return {
        sources: [{ url: `https://${platform}.example/a`, title: `${platform} hit` }],
        truncated: false,
      }
    },
  }
  return adapter as unknown as SourceAdapter & { calls: number }
}

describe('TC-052 回归：抓取兜底不破坏搜索链路', () => {
  it('搜索与抓取同时注册时互不干扰：搜索走三方、抓取走本地→平台', async () => {
    // 搜索侧：真实的复合 provider（三方优先，官方兜底）。
    const tinyfish = searchAdapter(TINYFISH_PLATFORM_ID)
    const officialCalls = { n: 0 }
    const search = new FailoverSearchProvider({
      readSettings: () => settings(),
      adapters: { tinyfish: [tinyfish], tavily: [searchAdapter(TAVILY_PLATFORM_ID)] },
      official: {
        id: 'deepseek-official',
        available: () => true,
        search: async () => {
          officialCalls.n += 1
          return { sources: [{ url: 'https://official.example/a' }], truncated: false }
        },
      },
      usage: { snapshot: () => [], isFresh: () => true, locallyLimited: () => false },
      onAttempt: () => {},
    })

    // 抓取侧：复合 provider（本地失败 → 平台兜底）。
    let platformFetches = 0
    const local: FetchBackend = { fetch: async () => { throw new WebError('blocked', 'WEB_INVALID_URL') } }
    const tinyfishFetch: FetchBackend = {
      fetch: async (req) => {
        platformFetches += 1
        return { url: req.url, statusCode: 200, body: { kind: 'text', content: 'fetched' }, truncated: false }
      },
    }
    const fetchProvider = new CompositeFetchProvider({
      id: 'dsh-failover-search',
      local,
      platforms: [{ platform: TINYFISH_PLATFORM_ID, backend: tinyfishFetch }],
    })

    // 交错执行 3 次搜索 + 2 次抓取：验证两链路互不阻塞、无 provider 冲突。
    for (let i = 0; i < 3; i += 1) {
      const result = await search.search({ query: `regression query ${i}` })
      expect(result.sources[0]?.url).toContain('tinyfish')
    }
    for (let i = 0; i < 2; i += 1) {
      const result = await fetchProvider.fetch({ url: `https://target.example/${i}` })
      expect(result.body).toEqual({ kind: 'text', content: 'fetched' })
    }

    // 基线可观察特征：搜索全部走三方（3 次），官方零调用；抓取全部走平台兜底（2 次）。
    expect(tinyfish.calls).toBe(3)
    expect(officialCalls.n).toBe(0)
    expect(platformFetches).toBe(2)
  })

  it('搜索与抓取可注册同名 id 而不冲突（两者是独立 store）', async () => {
    // 接缝把 search 与 fetch 存放在两个 Map 里，同 id 各注册一次是合法组合；
    // 本用例钉住「同 id 双注册」这一组合本身（回归：曾担心 provider id 冲突）。
    const search = new FailoverSearchProvider({
      readSettings: () => settings(),
      adapters: { tinyfish: [searchAdapter(TINYFISH_PLATFORM_ID)], tavily: [searchAdapter(TAVILY_PLATFORM_ID)] },
      official: { id: 'deepseek-official', available: () => false, search: async () => ({ sources: [], truncated: false }) },
      usage: { snapshot: () => [], isFresh: () => true, locallyLimited: () => false },
      onAttempt: () => {},
    })
    const fetchProvider = new CompositeFetchProvider({
      id: search.id,
      local: { fetch: async () => ({ url: 'x', statusCode: 200, body: { kind: 'text', content: 'ok' }, truncated: false }) },
      platforms: [],
    })

    expect(fetchProvider.id).toBe(search.id)
    // 两个 provider 各自可独立执行，互不影响。
    await expect(search.search({ query: 'x' })).resolves.toBeDefined()
    await expect(fetchProvider.fetch({ url: 'https://a.example' })).resolves.toBeDefined()
  })
})

describe('TC-054 回归：fetchProvider 接管后本地抓取语义不变', () => {
  it('本地成功时零平台调用（与接管前一致：不因兜底而多打平台）', async () => {
    const platform = { fetch: vi.fn() }
    const provider = new CompositeFetchProvider({
      id: 'dsh-failover-search',
      local: { fetch: async () => ({ url: 'https://a.example', statusCode: 200, body: { kind: 'html', content: '<p>hi</p>' }, truncated: false }) },
      platforms: [{ platform: TINYFISH_PLATFORM_ID, backend: platform as unknown as FetchBackend }],
    })

    const result = await provider.fetch({ url: 'https://a.example' })
    expect(platform.fetch).not.toHaveBeenCalled()
    // 基线特征：本地 provider 的 html body 原样透出（kind 不被改写）。
    expect(result.body.kind).toBe('html')
  })

  it('非 2xx 响应仍作为结果返回而非抛错（与本地 provider 语义一致）', async () => {
    // 官方 http provider 的契约：成功取到 4xx/5xx 也算 result，statusCode 如实透出。
    // 复合 provider 不得把这类响应误判为「本地失败」而转平台。
    let platformCalls = 0
    const provider = new CompositeFetchProvider({
      id: 'dsh-failover-search',
      local: { fetch: async () => ({ url: 'https://a.example', statusCode: 404, body: { kind: 'text', content: 'not found' }, truncated: false }) },
      platforms: [{ platform: TINYFISH_PLATFORM_ID, backend: { fetch: async () => { platformCalls += 1; throw new Error('should not reach') } } }],
    })

    const result = await provider.fetch({ url: 'https://a.example' })
    expect(result.statusCode).toBe(404)
    expect(platformCalls).toBe(0)
  })

  it('本地 provider 的 limits 与官方默认值逐项一致', async () => {
    // 基线：dsh-web-fetch-http 的 Config 默认值。接管后本地跳必须沿用同一组限制，
    // 否则「装上插件」会悄悄改变大小/超时/重定向语义（最隐蔽的回归）。
    const { Config } = await import('@deepseek-ai/dsh-web-fetch-http')
    const defaults = Config({})
    expect(defaults).toMatchObject({
      maxResponseBytes: 5e6,
      maxBodyChars: 1e5,
      timeoutMs: 3e4,
      maxRedirects: 5,
    })
    // 插件侧声明值与其一致（源码级核对，防止两边各自漂移）。
    const source = await import('node:fs/promises').then(fs => fs.readFile(new URL('../../src/index.ts', import.meta.url), 'utf8'))
    expect(source).toMatch(/maxResponseBytes: 5e6/u)
    expect(source).toMatch(/maxBodyChars: 1e5/u)
    expect(source).toMatch(/timeoutMs: 3e4/u)
    expect(source).toMatch(/maxRedirects: 5/u)
  })
})

describe('TC-053 回归：座位迁移后配置读写路径不变', () => {
  it('配置表单仍经 configForms 按插件入口 id 取得（与座位无关）', async () => {
    const source = await import('node:fs/promises')
      .then(fs => fs.readFile(new URL('../../src/client/index.tsx', import.meta.url), 'utf8'))

    // 基线：迁移前用 configForms.get(入口 id) 取共享表单；迁移后必须一致，
    // 否则会退化成「第二套配置存储」，用户的已存配置将读不到。
    expect(source).toContain("ctx.get('configForms')")
    expect(source).toContain('FAILOVER_SETTINGS_NAMESPACE')
    // 且不得出现第二套表单来源（例如自建 fetch 直写配置）。
    expect(source).not.toMatch(/fetch\(['"`]\/api\/.*settings/u)
  })

  it('账号写入仍走官方路径操作（增/删/改三类 op 齐备）', async () => {
    const { appendAccountOp, removeAccountOp, updateAccountOp } = await import('../../src/client/account-list.ts')

    // 基线：三类操作分别映射到 set（尾部插入）、unset（splice 移除）、逐字段 set。
    expect(appendAccountOp('tinyfishAccounts', 1, { key: 'k', label: 'l' })).toEqual({
      op: 'set', path: ['tinyfishAccounts', '1'], value: { key: 'k', label: 'l' },
    })
    expect(removeAccountOp('tinyfishAccounts', 0)).toEqual({ op: 'unset', path: ['tinyfishAccounts', '0'] })
    expect(updateAccountOp('tinyfishAccounts', 0, { label: 'new' })).toEqual({
      op: 'set', path: ['tinyfishAccounts', '0', 'label'], value: 'new',
    })
  })

  it('配置区仍渲染官方 SettingsForm 壳（保存/放弃由官方承载）', async () => {
    const source = await import('node:fs/promises')
      .then(fs => fs.readFile(new URL('../../src/client/config-section.tsx', import.meta.url), 'utf8'))

    // 基线：迁移前用官方 SettingsForm 承载保存/放弃与只读态；迁移后必须保持，
    // 否则用户会失去「已覆盖/重置」等官方交互。
    expect(source).toContain('SettingsForm')
    expect(source).toContain('onSave')
    expect(source).toContain('onDiscard')
  })
})

describe('TC-055/TC-056/TC-057 新功能边界与独立性', () => {
  it('TC-055 平台返回长正文原样透出（不做额外截断）', async () => {
    const long = 'x'.repeat(120_000)
    const provider = new CompositeFetchProvider({
      id: 'dsh-failover-search',
      local: { fetch: async () => { throw new WebError('blocked', 'WEB_INVALID_URL') } },
      platforms: [{
        platform: TINYFISH_PLATFORM_ID,
        backend: { fetch: async req => ({ url: req.url, statusCode: 200, body: { kind: 'text', content: long }, truncated: false }) },
      }],
    })

    const result = await provider.fetch({ url: 'https://long.example' })
    // 复合层不额外截断；截断策略由各跳自己决定并如实放在 truncated 标志上。
    expect(result.body.content.length).toBe(120_000)
    expect(result.truncated).toBe(false)
  })

  it('TC-055 平台返回空正文判为失败并抛可读错误（不静默返回空）', async () => {
    const { TinyfishFetchAdapter } = await import('../../src/host/fetch-platforms.ts')
    const adapter = new TinyfishFetchAdapter({
      apiKey: 'sk-x',
      endpoint: 'https://api.fetch.tinyfish.ai',
      fetchImpl: async () => new Response(JSON.stringify({ results: [{ url: 'https://a.example', text: '' }] }), { status: 200 }),
    })

    await expect(adapter.fetch({ url: 'https://a.example' })).rejects.toMatchObject({
      code: 'WEB_PROVIDER_ERROR',
      message: expect.stringContaining('empty'),
    })
  })

  it('TC-056 abort 在平台跳执行前也被拦截（不等本地失败）', async () => {
    const controller = new AbortController()
    controller.abort()
    let platformCalled = 0
    const provider = new CompositeFetchProvider({
      id: 'dsh-failover-search',
      local: { fetch: async () => { throw new WebError('blocked', 'WEB_INVALID_URL') } },
      platforms: [{ platform: TINYFISH_PLATFORM_ID, backend: { fetch: async () => { platformCalled += 1; throw new Error('nope') } } }],
    })

    await expect(provider.fetch({ url: 'https://a.example' }, controller.signal)).rejects.toMatchObject({ code: 'WEB_ABORTED' })
    expect(platformCalled).toBe(0)
  })

  it('TC-057 未配置平台不产生调用（可用性先于取回判断）', async () => {
    let tavilyCalled = 0
    const provider = new CompositeFetchProvider({
      id: 'dsh-failover-search',
      local: { fetch: async () => { throw new WebError('blocked', 'WEB_INVALID_URL') } },
      platforms: [
        { platform: TINYFISH_PLATFORM_ID, backend: { available: () => false, fetch: async () => { throw new Error('no key') } } },
        { platform: TAVILY_PLATFORM_ID, backend: { available: () => false, fetch: async () => { tavilyCalled += 1; throw new Error('no key') } } },
      ],
    })

    await expect(provider.fetch({ url: 'https://a.example' })).rejects.toBeDefined()
    expect(tavilyCalled).toBe(0)
  })

  it('TC-057 抓取失败不改变搜索结果（两面独立）', async () => {
    const search = new FailoverSearchProvider({
      readSettings: () => settings(),
      adapters: { tinyfish: [searchAdapter(TINYFISH_PLATFORM_ID)], tavily: [searchAdapter(TAVILY_PLATFORM_ID)] },
      official: { id: 'deepseek-official', available: () => false, search: async () => ({ sources: [], truncated: false }) },
      usage: { snapshot: () => [], isFresh: () => true, locallyLimited: () => false },
      onAttempt: () => {},
    })
    const fetchProvider = new CompositeFetchProvider({
      id: 'dsh-failover-search',
      local: { fetch: async () => { throw new WebError('down', 'WEB_PROVIDER_ERROR') } },
      platforms: [],
    })

    // 抓取先失败，随后的搜索必须照常成功。
    await expect(fetchProvider.fetch({ url: 'https://a.example' })).rejects.toBeDefined()
    const result = await search.search({ query: 'independent' })
    expect(result.sources.length).toBeGreaterThan(0)
  })
})

describe('FNOS-010-12 抓取侧门控（AC-03：关闭时不走三方兜底）', () => {
  it('关闭时会话的抓取只用本地跳，平台零调用', async () => {
    const store = new SessionToggleStore()
    store.setEnabled('sess-off', false)
    let platformCalls = 0

    const provider = new CompositeFetchProvider({
      id: 'dsh-failover-search',
      local: { fetch: async () => { throw new WebError('blocked', 'WEB_INVALID_URL') } },
      platforms: [{
        platform: TINYFISH_PLATFORM_ID,
        backend: { fetch: async () => { platformCalls += 1; throw new Error('should not reach') } },
      }],
      // 门控：关闭该会话时平台跳整体不可用。
      shouldBypass: () => shouldBypassActiveSession(store),
    })

    await runWithSession('sess-off', store, async () => {
      await expect(provider.fetch({ url: 'https://example.com' })).rejects.toBeDefined()
    })
    expect(platformCalls).toBe(0) // 三方零调用
  })

  it('开启时会话的抓取仍走平台兜底（行为不变，AC-02）', async () => {
    const store = new SessionToggleStore()
    let platformCalls = 0

    const provider = new CompositeFetchProvider({
      id: 'dsh-failover-search',
      local: { fetch: async () => { throw new WebError('blocked', 'WEB_INVALID_URL') } },
      platforms: [{
        platform: TINYFISH_PLATFORM_ID,
        backend: { fetch: async (req) => { platformCalls += 1; return { url: req.url, statusCode: 200, body: { kind: 'text', content: 'ok' }, truncated: false } } },
      }],
      shouldBypass: () => shouldBypassActiveSession(store),
    })

    const result = await runWithSession('sess-on', store, () => provider.fetch({ url: 'https://example.com' }))
    expect(result.body).toEqual({ kind: 'text', content: 'ok' })
    expect(platformCalls).toBe(1)
  })
})
