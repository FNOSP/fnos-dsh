import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_OPENCODE_PREFERENCES, normalizePreferences } from '../../src/contracts/preferences.ts'
import { OPENCODE_ROUTES } from '../../src/contracts/routes.ts'
import { createPreferencesStore } from '../../src/client/services/preferences-data.ts'

/** 构造最小 Response 替身；只实现本次请求用到的字段。 */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

describe('偏好归一化（客户端与服务端共用契约）', () => {
  it('合法字段原样保留', () => {
    expect(normalizePreferences({
      usageVisibility: 'always',
      refreshMinutes: 30,
      hiddenModels: ['a', 'b'],
    })).toEqual({ usageVisibility: 'always', refreshMinutes: 30, hiddenModels: ['a', 'b'], endpointPlan: 'auto' })
  })

  it('非法显隐策略回落 auto', () => {
    expect(normalizePreferences({ usageVisibility: 'sometimes' }).usageVisibility).toBe(DEFAULT_OPENCODE_PREFERENCES.usageVisibility)
    expect(normalizePreferences({ usageVisibility: 1 }).usageVisibility).toBe('auto')
  })

  it('刷新间隔取整并夹到 0..240', () => {
    expect(normalizePreferences({ refreshMinutes: 2.6 }).refreshMinutes).toBe(3)
    expect(normalizePreferences({ refreshMinutes: -5 }).refreshMinutes).toBe(0)
    expect(normalizePreferences({ refreshMinutes: 9999 }).refreshMinutes).toBe(240)
    expect(normalizePreferences({ refreshMinutes: '15' }).refreshMinutes).toBe(DEFAULT_OPENCODE_PREFERENCES.refreshMinutes)
    expect(normalizePreferences({ refreshMinutes: Number.NaN }).refreshMinutes).toBe(DEFAULT_OPENCODE_PREFERENCES.refreshMinutes)
  })

  it('隐藏列表去重并过滤非法项', () => {
    expect(normalizePreferences({ hiddenModels: ['a', 'a', '', 42, 'b'] }).hiddenModels).toEqual(['a', 'b'])
    expect(normalizePreferences({ hiddenModels: 'a' }).hiddenModels).toEqual([])
  })

  it('整体非法输入回落到默认值', () => {
    expect(normalizePreferences(undefined)).toEqual(DEFAULT_OPENCODE_PREFERENCES)
    expect(normalizePreferences(null)).toEqual(DEFAULT_OPENCODE_PREFERENCES)
    expect(normalizePreferences([])).toEqual(DEFAULT_OPENCODE_PREFERENCES)
  })
})

describe('偏好 store', () => {
  it('首次读取走 GET preferences，并按契约归一化', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({
      usageVisibility: 'off',
      refreshMinutes: 5,
      hiddenModels: ['x', 'x'],
    }))
    vi.stubGlobal('fetch', fetchMock)
    const store = createPreferencesStore()

    expect(store.getSnapshot()).toEqual({ value: DEFAULT_OPENCODE_PREFERENCES, loaded: false })
    await expect(store.ensureLoaded()).resolves.toEqual({
      usageVisibility: 'off',
      refreshMinutes: 5,
      hiddenModels: ['x'],
      endpointPlan: 'auto',
    })
    expect(store.getSnapshot().loaded).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [path, init] = fetchMock.mock.calls[0] ?? []
    expect(path).toBe(OPENCODE_ROUTES.preferences)
    expect((init as RequestInit | undefined)?.method).toBe('GET')
  })

  it('并发读取共享同一个请求', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({}))
    vi.stubGlobal('fetch', fetchMock)
    const store = createPreferencesStore()
    await Promise.all([store.ensureLoaded(), store.ensureLoaded(), store.ensureLoaded()])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('保存乐观更新，写入后以服务端返回值为准', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValueOnce(jsonResponse({ hiddenModels: [] }))
    const store = createPreferencesStore()
    await store.ensureLoaded()

    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    let resolveSave: (value: Response) => void = () => undefined
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => { resolveSave = resolve }))

    const saving = store.save({ usageVisibility: 'off', hiddenModels: ['gpt-5'] })
    // 请求在途时快照已经是新值（开关/设置立即生效）。
    expect(store.getSnapshot().value.usageVisibility).toBe('off')
    expect(store.getSnapshot().value.hiddenModels).toEqual(['gpt-5'])
    expect(listener).toHaveBeenCalledTimes(1)

    resolveSave(jsonResponse({ usageVisibility: 'off', refreshMinutes: 15, hiddenModels: ['gpt-5'], endpointPlan: 'go' }))
    await expect(saving).resolves.toEqual({
      usageVisibility: 'off',
      refreshMinutes: 15,
      hiddenModels: ['gpt-5'],
      endpointPlan: 'go',
    })

    const [path, init] = fetchMock.mock.calls[1] ?? []
    expect(path).toBe(OPENCODE_ROUTES.preferences)
    expect((init as RequestInit | undefined)?.method).toBe('PUT')
    expect(JSON.parse(String((init as RequestInit | undefined)?.body))).toEqual({
      usageVisibility: 'off',
      hiddenModels: ['gpt-5'],
    })
    unsubscribe()
  })

  it('保存失败回滚并抛出宿主文案', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValueOnce(jsonResponse({ usageVisibility: 'auto', refreshMinutes: 15, hiddenModels: [] }))
    const store = createPreferencesStore()
    await store.ensureLoaded()
    const before = store.getSnapshot().value

    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'save failed' }, 500))
    await expect(store.save({ refreshMinutes: 30 })).rejects.toThrow('save failed')
    expect(store.getSnapshot().value).toEqual(before)
  })

  it('读取失败时不置 loaded，并允许之后重试', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'offline' }, 503))
    const store = createPreferencesStore()

    await expect(store.ensureLoaded()).rejects.toThrow('offline')
    expect(store.getSnapshot()).toEqual({ value: DEFAULT_OPENCODE_PREFERENCES, loaded: false })

    fetchMock.mockResolvedValueOnce(jsonResponse({ usageVisibility: 'always' }))
    await expect(store.reload()).resolves.toMatchObject({ usageVisibility: 'always' })
    expect(store.getSnapshot().loaded).toBe(true)
  })
})
