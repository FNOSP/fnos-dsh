import { describe, expect, it, vi } from 'vitest'
import { UsageStore } from '../../src/host/usage-store.ts'
import type { FailoverSearchSettings } from '../../src/contracts/config.ts'
import type { UsageAdapter, UsageReading } from '../../src/contracts/types.ts'
import { OFFICIAL_SOURCE_ID, TAVILY_PLATFORM_ID, TINYFISH_PLATFORM_ID } from '../../src/contracts/constants.ts'

/** 可编程的用量适配器替身；读数身份与时间由存储层盖章，这里只报告读数。 */
function stubUsage(
  platform: 'tinyfish' | 'tavily',
  behaviour?: (key: string) => Promise<UsageReading> | UsageReading,
) {
  const calls: string[] = []
  const adapter: UsageAdapter = {
    platform,
    fetchUsage: async (key: string): Promise<UsageReading> => {
      calls.push(key)
      if (behaviour !== undefined) return await behaviour(key)
      return { exhausted: false, details: {} }
    },
  }
  return { adapter, calls }
}

/** 构造一次刷新用的配置。 */
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

/** 构造一个受控时钟，便于断言新鲜度而不 sleep。 */
function clock(start = 0) {
  let current = start
  return {
    now: () => new Date(current),
    advance: (ms: number) => { current += ms },
  }
}

describe('FNOS-010-08/09 用量快照缓存', () => {
  it('刷新后快照带获取时间与各账号用量', async () => {
    const tinyfish = stubUsage(TINYFISH_PLATFORM_ID)
    const tavily = stubUsage(TAVILY_PLATFORM_ID)
    const time = clock(Date.parse('2026-10-09T12:00:00Z'))
    const store = new UsageStore({
      adapters: { tinyfish: tinyfish.adapter, tavily: tavily.adapter },
      now: time.now,
    })

    await store.refresh(settings({
      tinyfishAccounts: [{ key: 'tf-1', label: 'tinyfish-1' }],
      tavilyAccounts: [{ key: 'tv-1', label: 'tavily-1' }],
    }))

    const snapshot = store.snapshot()
    expect(snapshot).toHaveLength(2)
    expect(snapshot.map(entry => entry.accountLabel).sort()).toEqual(['tavily-1', 'tinyfish-1'])
    expect(snapshot[0]?.fetchedAt).toBe('2026-10-09T12:00:00.000Z')
  })

  it('只查询配置里存在的账号，不为空平台发请求', async () => {
    const tinyfish = stubUsage(TINYFISH_PLATFORM_ID)
    const tavily = stubUsage(TAVILY_PLATFORM_ID)
    const store = new UsageStore({ adapters: { tinyfish: tinyfish.adapter, tavily: tavily.adapter } })

    await store.refresh(settings({ tinyfishAccounts: [{ key: 'tf-1' }] }))

    expect(tinyfish.calls).toHaveLength(1)
    expect(tavily.calls).toHaveLength(0)
  })

  it('key 增删触发刷新：新账号出现、移除账号从快照消失', async () => {
    const tinyfish = stubUsage(TINYFISH_PLATFORM_ID)
    const tavily = stubUsage(TAVILY_PLATFORM_ID)
    const store = new UsageStore({ adapters: { tinyfish: tinyfish.adapter, tavily: tavily.adapter } })

    await store.refresh(settings({ tinyfishAccounts: [{ key: 'a', label: 'a' }, { key: 'b', label: 'b' }] }))
    expect(store.snapshot().map(entry => entry.accountLabel).sort()).toEqual(['a', 'b'])

    await store.refresh(settings({ tinyfishAccounts: [{ key: 'a', label: 'a' }] }))
    expect(store.snapshot().map(entry => entry.accountLabel)).toEqual(['a'])
  })

  it('端点失败时该账号快照带 error，其它账号不受影响', async () => {
    const tinyfish = stubUsage(TINYFISH_PLATFORM_ID, key => {
      if (key === 'bad') return { details: {}, error: 'wallet 500' }
      return { details: { balance: '11.6 USD' } }
    })
    const store = new UsageStore({ adapters: { tinyfish: tinyfish.adapter } })

    await store.refresh(settings({ tinyfishAccounts: [{ key: 'good', label: 'good' }, { key: 'bad', label: 'bad' }] }))

    const snapshot = store.snapshot()
    // 读取失败被折成带 error 的快照，同批其它账号照常进入快照。
    expect(snapshot.map(entry => entry.accountLabel).sort()).toEqual(['bad', 'good'])
    expect(snapshot.find(entry => entry.accountLabel === 'bad')?.error).toBe('wallet 500')
    expect(snapshot.find(entry => entry.accountLabel === 'good')?.error).toBeUndefined()
    expect(snapshot.every(entry => typeof entry.fetchedAt === 'string')).toBe(true)
  })

  it('适配器抛错时存储层兜住，不阻断其余账号与搜索', async () => {
    const tinyfish = stubUsage(TINYFISH_PLATFORM_ID, key => {
      if (key === 'boom') throw new Error('unexpected')
      return { details: { balance: '11.6 USD' } }
    })
    const store = new UsageStore({ adapters: { tinyfish: tinyfish.adapter } })

    await expect(store.refresh(settings({ tinyfishAccounts: [{ key: 'boom', label: 'boom' }, { key: 'fine', label: 'fine' }] }))).resolves.toBeUndefined()

    const labels = store.snapshot().map(entry => entry.accountLabel).sort()
    expect(labels).toEqual(['boom', 'fine'])
    const failed = store.snapshot().find(entry => entry.accountLabel === 'boom')
    expect(failed?.error).toBeDefined()
  })

  it('快照在刷新周期内视为新鲜，超过周期后过期', async () => {
    const tinyfish = stubUsage(TINYFISH_PLATFORM_ID)
    const time = clock(Date.parse('2026-10-09T12:00:00Z'))
    const store = new UsageStore({ adapters: { tinyfish: tinyfish.adapter }, now: time.now })

    await store.refresh(settings({ tinyfishAccounts: [{ key: 'a' }], usageRefreshMinutes: 5 }))
    expect(store.isFresh()).toBe(true)

    time.advance(5 * 60 * 1000 - 1)
    expect(store.isFresh()).toBe(true)

    time.advance(2)
    expect(store.isFresh()).toBe(false)
  })

  it('从未刷新过时快照为空且不新鲜（探测退化为响应式转移）', () => {
    const store = new UsageStore({ adapters: {} })

    expect(store.snapshot()).toEqual([])
    expect(store.isFresh()).toBe(false)
  })

  it('本地限流记账：同一账号 30 次/分钟窗口内记满后判定为触限', () => {
    const time = clock(Date.parse('2026-10-09T12:00:00Z'))
    const store = new UsageStore({ adapters: {}, now: time.now })

    for (let index = 0; index < 30; index += 1) store.recordRequest(TINYFISH_PLATFORM_ID, 'tinyfish-1')

    expect(store.locallyLimited(TINYFISH_PLATFORM_ID, 'tinyfish-1')).toBe(true)
    // 其它账号各自独立计数（TinyFish 限流按 key 计）。
    expect(store.locallyLimited(TINYFISH_PLATFORM_ID, 'tinyfish-2')).toBe(false)
  })

  it('本地限流窗口滑动：一分钟前的记账不再计入', () => {
    const time = clock(Date.parse('2026-10-09T12:00:00Z'))
    const store = new UsageStore({ adapters: {}, now: time.now, limitPerMinute: 2 })

    store.recordRequest(TINYFISH_PLATFORM_ID, 'a')
    store.recordRequest(TINYFISH_PLATFORM_ID, 'a')
    expect(store.locallyLimited(TINYFISH_PLATFORM_ID, 'a')).toBe(true)

    time.advance(60_001)
    expect(store.locallyLimited(TINYFISH_PLATFORM_ID, 'a')).toBe(false)
  })

  it('Tavily 无本地限流上限（配额按账户计，由服务端用量端点反映）', () => {
    const store = new UsageStore({ adapters: {} })

    for (let index = 0; index < 100; index += 1) store.recordRequest(TAVILY_PLATFORM_ID, 'tavily-1')

    expect(store.locallyLimited(TAVILY_PLATFORM_ID, 'tavily-1')).toBe(false)
  })

  it('订阅者可收到快照更新（展示层只读订阅）', async () => {
    const tinyfish = stubUsage(TINYFISH_PLATFORM_ID)
    const store = new UsageStore({ adapters: { tinyfish: tinyfish.adapter } })
    const listener = vi.fn()
    store.subscribe(listener)

    await store.refresh(settings({ tinyfishAccounts: [{ key: 'a' }] }))

    expect(listener).toHaveBeenCalled()
  })

  it('取消订阅后不再收到更新', async () => {
    const tinyfish = stubUsage(TINYFISH_PLATFORM_ID)
    const store = new UsageStore({ adapters: { tinyfish: tinyfish.adapter } })
    const listener = vi.fn()
    const off = store.subscribe(listener)
    off()

    await store.refresh(settings({ tinyfishAccounts: [{ key: 'a' }] }))

    expect(listener).not.toHaveBeenCalled()
  })
})
