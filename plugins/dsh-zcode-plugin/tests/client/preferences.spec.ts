import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPreferencesStore } from '../../src/client/services/preferences-data.ts'
import {
  DEFAULT_ZCODE_PREFERENCES,
  normalizePreferences,
} from '../../src/contracts/preferences.ts'
import { shouldShowCapsule } from '../../src/client/services/capsule-visibility.ts'
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
    expect(shouldShowCapsule('auto', { providerId: ZCODE_PROVIDER })).toBe(true)
    expect(shouldShowCapsule('auto', { providerId: 'dsh-opencode' })).toBe(false)
    expect(shouldShowCapsule('auto', undefined)).toBe(false)
  })

  it('always 恒显示，off 恒隐藏', () => {
    expect(shouldShowCapsule('always', undefined)).toBe(true)
    expect(shouldShowCapsule('off', { providerId: ZCODE_PROVIDER })).toBe(false)
  })
})
