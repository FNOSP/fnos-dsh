import { describe, expect, it } from 'vitest'
import { Config, readSettings } from '../../src/contracts/config.ts'
import {
  DEFAULT_FAILOVER_ORDER,
  DEFAULT_HOST_TIMEOUT_MS,
  DEFAULT_PROBE_ENABLED,
  DEFAULT_SAME_PLATFORM_RETRY,
  DEFAULT_USAGE_REFRESH_MINUTES,
  FAILOVER_PROVIDER_ID,
  OFFICIAL_SOURCE_ID,
  TAVILY_PLATFORM_ID,
  TINYFISH_PLATFORM_ID,
} from '../../src/contracts/constants.ts'

/** 按 schema 解析一次输入，返回脱去 volatile 引用的普通取值。 */
function resolve(input: Record<string, unknown>): Record<string, unknown> {
  const parsed = Config(input) as Record<string, { get?: () => unknown }>
  return Object.fromEntries(
    Object.entries(parsed).map(([key, value]) => [key, typeof value?.get === 'function' ? value.get() : value]),
  )
}

describe('FNOS-010 配置结构契约', () => {
  it('默认值符合需求「配置项说明」章节', () => {
    const resolved = resolve({ tinyfishAccounts: [], tavilyAccounts: [] })

    expect(resolved.timeoutMs).toBe(DEFAULT_HOST_TIMEOUT_MS)
    expect(resolved.samePlatformRetry).toBe(DEFAULT_SAME_PLATFORM_RETRY)
    expect(resolved.usageRefreshMinutes).toBe(DEFAULT_USAGE_REFRESH_MINUTES)
    expect(resolved.requestProbe).toBe(DEFAULT_PROBE_ENABLED)
    expect(resolved.sourceOrder).toEqual([...DEFAULT_FAILOVER_ORDER])
    expect(resolved.tinyfishAccounts).toEqual([])
    expect(resolved.tavilyAccounts).toEqual([])
  })

  it('命名定义取值稳定（FNOS-010-10：提供方 id 与配置命名空间一致）', () => {
    // 搜索提供方 id 必须等于组合行 id / 配置命名空间，否则 patch 的
    // `searchProvider` 指不到已注册的提供方。
    expect(FAILOVER_PROVIDER_ID).toBe('dsh-failover-search')
    expect(TINYFISH_PLATFORM_ID).toBe('tinyfish')
    expect(TAVILY_PLATFORM_ID).toBe('tavily')
    expect(OFFICIAL_SOURCE_ID).toBe('deepseek-official')
  })

  it('账号列表项携带 key 与可选备注名', () => {
    const resolved = resolve({
      tinyfishAccounts: [{ key: 'tf-key' }, { key: 'tf-key-2', label: 'tinyfish-2' }],
      tavilyAccounts: [],
    }) as { tinyfishAccounts: readonly { key: string, label?: string }[] }

    expect(resolved.tinyfishAccounts).toHaveLength(2)
    expect(resolved.tinyfishAccounts[0]?.key).toBe('tf-key')
    expect(resolved.tinyfishAccounts[1]?.label).toBe('tinyfish-2')
  })

  it('每个顶层字段都是 volatile 引用（保存后下一次搜索即生效的前提）', () => {
    const parsed = Config({ tinyfishAccounts: [], tavilyAccounts: [] }) as Record<string, unknown>

    for (const field of ['tinyfishAccounts', 'tavilyAccounts', 'sourceOrder', 'timeoutMs', 'samePlatformRetry', 'usageRefreshMinutes', 'requestProbe']) {
      const value = parsed[field] as { get?: unknown }
      expect(typeof value?.get, `${field} 必须是 volatile 引用`).toBe('function')
    }
  })

  it('超时为正整数，刷新间隔限制在 1–60 分钟', () => {
    expect(() => resolve({ tinyfishAccounts: [], tavilyAccounts: [], timeoutMs: 0 })).toThrow()
    expect(() => resolve({ tinyfishAccounts: [], tavilyAccounts: [], usageRefreshMinutes: 0 })).toThrow()
    expect(() => resolve({ tinyfishAccounts: [], tavilyAccounts: [], usageRefreshMinutes: 61 })).toThrow()
    expect(resolve({ tinyfishAccounts: [], tavilyAccounts: [], usageRefreshMinutes: 60 }).usageRefreshMinutes).toBe(60)
  })

  it('来源顺序为三来源排列，官方搜索不可移除', () => {
    const resolved = resolve({
      tinyfishAccounts: [],
      tavilyAccounts: [],
      sourceOrder: [OFFICIAL_SOURCE_ID, TAVILY_PLATFORM_ID, TINYFISH_PLATFORM_ID],
    }) as { sourceOrder: readonly string[] }

    expect([...resolved.sourceOrder]).toEqual([OFFICIAL_SOURCE_ID, TAVILY_PLATFORM_ID, TINYFISH_PLATFORM_ID])
    // 官方搜索是链尾兜底，枚举不含其它取值。
    expect(() => resolve({ tinyfishAccounts: [], tavilyAccounts: [], sourceOrder: ['bing'] })).toThrow()
  })

  it('key 字段声明为 secret 角色，不随配置表单回显', () => {
    // role('secret') 是宿主脱敏的唯一判据：schema 必须能识别该角色，
    // 否则 key 明文会随 settings describe 一起跨线。
    const item = Config.dict?.tinyfishAccounts?.inner
    expect(item?.dict?.key?.meta?.role).toBe('secret')
  })

  it('readSettings 在缺省配置面上给出与 schema 默认值一致的取值', () => {
    expect(readSettings(undefined)).toEqual({
      tinyfishAccounts: [],
      tavilyAccounts: [],
      sourceOrder: [...DEFAULT_FAILOVER_ORDER],
      timeoutMs: DEFAULT_HOST_TIMEOUT_MS,
      samePlatformRetry: DEFAULT_SAME_PLATFORM_RETRY,
      usageRefreshMinutes: DEFAULT_USAGE_REFRESH_MINUTES,
      requestProbe: DEFAULT_PROBE_ENABLED,
    })
  })
})
