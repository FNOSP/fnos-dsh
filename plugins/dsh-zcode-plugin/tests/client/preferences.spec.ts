import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPreferencesStore } from '../../src/client/services/preferences-data.ts'
import {
  DEFAULT_ZCODE_PREFERENCES,
  normalizePreferences,
} from '../../src/contracts/preferences.ts'
import { ZCODE_ANTHROPIC_BASE_URLS } from '../../src/contracts/identity.ts'
import {
  readSelectedModel,
  readSelectedProvider,
  shouldShowCapsule,
} from '../../src/client/services/capsule-visibility.ts'
import { ZCODE_PROVIDER } from '../../src/contracts/identity.ts'

function mockFetch(handler: (url: string, init?: RequestInit) => Response): void {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init)))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('偏好规范化', () => {
  it('缺省值与非法值都回落默认', () => {
    expect(normalizePreferences(undefined)).toEqual(DEFAULT_ZCODE_PREFERENCES)
    expect(normalizePreferences({ usageVisibility: 'bogus' })).toMatchObject({ usageVisibility: 'auto' })
    expect(normalizePreferences({ refreshMinutes: 'x' })).toMatchObject({ refreshMinutes: 15 })
  })

  it('隐藏列表去重并拒绝非字符串', () => {
    expect(normalizePreferences({ hiddenModels: ['a', 'a', 1, '', 'b'] }).hiddenModels).toEqual(['a', 'b'])
  })

  it('刷新间隔夹到合法区间', () => {
    expect(normalizePreferences({ refreshMinutes: 9_999 }).refreshMinutes).toBe(240)
    expect(normalizePreferences({ refreshMinutes: -3 }).refreshMinutes).toBe(0)
  })
})

describe('偏好 store', () => {
  it('首次读取后 loaded 为 true', async () => {
    mockFetch(() => new Response(JSON.stringify({ usageVisibility: 'always', refreshMinutes: 5, hiddenModels: [] })))
    const store = createPreferencesStore()
    expect(store.getSnapshot().loaded).toBe(false)
    const value = await store.ensureLoaded()
    expect(value.usageVisibility).toBe('always')
    expect(store.getSnapshot().loaded).toBe(true)
  })

  it('保存是乐观更新，失败时回滚', async () => {
    mockFetch(() => new Response(JSON.stringify(DEFAULT_ZCODE_PREFERENCES)))
    const store = createPreferencesStore()
    await store.ensureLoaded()

    mockFetch(() => new Response(JSON.stringify({ ...DEFAULT_ZCODE_PREFERENCES, usageVisibility: 'off' })))
    await store.save({ usageVisibility: 'off' })
    expect(store.getSnapshot().value.usageVisibility).toBe('off')

    mockFetch(() => new Response(JSON.stringify({ error: 'boom' }), { status: 500 }))
    await expect(store.save({ usageVisibility: 'always' })).rejects.toThrow(/boom/u)
    // 回滚到上一份成功值。
    expect(store.getSnapshot().value.usageVisibility).toBe('off')
  })

  it('相同值不触发订阅者', async () => {
    mockFetch(() => new Response(JSON.stringify(DEFAULT_ZCODE_PREFERENCES)))
    const store = createPreferencesStore()
    await store.ensureLoaded()
    const listener = vi.fn()
    store.subscribe(listener)
    mockFetch(() => new Response(JSON.stringify(DEFAULT_ZCODE_PREFERENCES)))
    await store.save({})
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('胶囊显隐策略', () => {
  it('auto 只在选中本插件路由时显示', () => {
    expect(shouldShowCapsule('auto', ZCODE_PROVIDER)).toBe(true)
    expect(shouldShowCapsule('auto', 'dsh-opencode')).toBe(false)
    expect(shouldShowCapsule('auto', undefined)).toBe(false)
  })

  it('always 恒显示，off 恒隐藏', () => {
    expect(shouldShowCapsule('always', undefined)).toBe(true)
    expect(shouldShowCapsule('off', ZCODE_PROVIDER)).toBe(false)
  })

  it('未登录时不显示（没有可展示的额度）', () => {
    expect(shouldShowCapsule('always', ZCODE_PROVIDER, false)).toBe(false)
    expect(shouldShowCapsule('auto', ZCODE_PROVIDER, false)).toBe(false)
  })
})

describe('会话模型选择投影', () => {
  it('优先取 next（用户刚选的），其次 lastUsed（上次真正用过的）', () => {
    expect(readSelectedProvider({ next: { provider: ZCODE_PROVIDER } })).toBe(ZCODE_PROVIDER)
    expect(readSelectedProvider({ lastUsed: { provider: ZCODE_PROVIDER } })).toBe(ZCODE_PROVIDER)
    expect(readSelectedProvider({
      next: { provider: 'a' },
      lastUsed: { provider: 'b' },
    })).toBe('a')
  })

  it('next 为 null 时退回 lastUsed（两者都是可空字段）', () => {
    expect(readSelectedProvider({
      next: null,
      lastUsed: { provider: ZCODE_PROVIDER },
    })).toBe(ZCODE_PROVIDER)
  })

  it('投影缺失或字段为空时返回 undefined，不臆测', () => {
    expect(readSelectedProvider(undefined)).toBeUndefined()
    expect(readSelectedProvider({})).toBeUndefined()
    expect(readSelectedProvider({ next: {} })).toBeUndefined()
    expect(readSelectedProvider({ next: { provider: '' } })).toBeUndefined()
    expect(readSelectedProvider({ next: null, lastUsed: null })).toBeUndefined()
    expect(readSelectedModel({ lastUsed: { model: 'GLM-5.3' } })).toBe('GLM-5.3')
  })

  it('auto 用 next 判定：切到本插件模型后即刻可见', () => {
    // 回归：早前读不存在的 `pending` 就退回 `lastUsed`，而 lastUsed 仍是别的
    // 供应商，于是切到本插件模型后胶囊依然不出现。
    const projection = {
      next: { provider: ZCODE_PROVIDER, model: 'GLM-5.3' },
      lastUsed: { provider: 'dsh-opencode', model: 'Beam Free' },
    }
    expect(shouldShowCapsule('auto', readSelectedProvider(projection))).toBe(true)
  })
})

describe('端点策略偏好', () => {
  it('默认 Start Plan', () => {
    expect(DEFAULT_ZCODE_PREFERENCES.endpointPlan).toBe('start-plan')
    expect(normalizePreferences(undefined).endpointPlan).toBe('start-plan')
  })

  it('可切到 ultra，非法值回落默认', () => {
    expect(normalizePreferences({ endpointPlan: 'ultra' }).endpointPlan).toBe('ultra')
    expect(normalizePreferences({ endpointPlan: 'bogus' }).endpointPlan).toBe('start-plan')
    expect(normalizePreferences({ endpointPlan: 1 }).endpointPlan).toBe('start-plan')
  })

  it('两种策略对应不同的端点前缀', () => {
    expect(ZCODE_ANTHROPIC_BASE_URLS['start-plan']).toBe('https://zcode.z.ai/api/v1/zcode-plan/anthropic')
    expect(ZCODE_ANTHROPIC_BASE_URLS.ultra).toBe('https://zcode.z.ai/api/v1/ultra/anthropic')
  })
})
