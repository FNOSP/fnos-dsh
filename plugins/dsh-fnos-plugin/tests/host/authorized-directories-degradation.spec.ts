import { describe, expect, it, vi } from 'vitest'

const { callFnOsApi } = vi.hoisted(() => ({ callFnOsApi: vi.fn() }))
vi.mock('../../src/api/fnos-api.ts', () => ({ callFnOsApi }))

import { loadAuthorizedDirectoriesWithPersisted } from '../../src/host/authorized-directories.ts'

/**
 * 实时查询失败时的持久化降级（FNOS-009-09-AC-02）。
 *
 * 这是整个需求里最不能写错的一条路径：fnOS 的 ACL 查询是瞬时接口，重启应用、
 * volume 短暂离线或网关抖动都会让它失败。失败时如果直接把异常抛给调用方，
 * 卡片就会走 `refresh-failed` 分支，用户看到「无法加载授权目录」并且**列表为空**
 * ——那正是需求要消除的「不因接口瞬时失败而丢列表」。
 *
 * `loadAuthorizedDirectoriesWithPersisted` 与既有的 `loadAuthorizedDirectories`
 * 的差别就在这里：它先拿到持久化列表，实时查询失败只让它退化成空数组，而不会
 * 抹掉持久化项。下面的用例同时钉住「不丢数据」与「确实没有兜底数据时仍然报错」
 * 两个方向，避免把降级做成无条件吞异常。
 */

/** 只提供 `requestLanguage` 需要的请求头。 */
function fakeRequest(headers: Record<string, string> = {}): never {
  return { headers: { 'accept-language': 'zh-CN', ...headers } } as never
}

/** 清空所有影响只读共享路径的环境变量，让用例与开发机环境无关。 */
function clearFnosEnvironment(): void {
  vi.stubEnv('TRIM_DATA_ACCESSIBLE_PATHS', '')
  vi.stubEnv('TRIM_DATA_SHARE_PATHS', '')
  vi.stubEnv('TRIM_APPDEST_VOL', '')
  vi.stubEnv('TRIM_APPDEST', '')
  vi.stubEnv('TRIM_PKGHOME', '')
}

describe('loadAuthorizedDirectoriesWithPersisted', () => {
  it('keeps the persisted list when the live ACL query fails', async () => {
    clearFnosEnvironment()
    callFnOsApi.mockRejectedValue(new Error('ACL API unavailable'))

    const directories = await loadAuthorizedDirectoriesWithPersisted(fakeRequest(), ['/vol4/kept', '/vol2/other'])

    // 关键断言：列表非空，且顺序仍是持久化顺序。
    expect(directories.map(entry => entry.path)).toEqual(['/vol4/kept', '/vol2/other'])
    expect(directories.every(entry => entry.removable)).toBe(true)
  })

  it('hands the persisted paths their readable names when the live query fails', async () => {
    clearFnosEnvironment()
    // 路径转换接口与 ACL 接口一起挂掉：语义名必须回退到本地规则，而不是整页失败。
    callFnOsApi.mockRejectedValue(new Error('fnOS API unavailable'))

    const directories = await loadAuthorizedDirectoriesWithPersisted(fakeRequest(), ['/vol4/kept'])

    expect(directories).toEqual([
      { path: '/vol4/kept', semanticPath: '存储空间4/kept', removable: true },
    ])
  })

  it('still reports the failure when there is nothing persisted to fall back to', async () => {
    clearFnosEnvironment()
    callFnOsApi.mockRejectedValue(new Error('ACL API unavailable'))

    // 没有任何兜底数据时必须继续抛出：静默返回空列表会把「接口坏了」伪装成
    // 「用户还没授权过任何目录」，让故障无法被发现。
    await expect(loadAuthorizedDirectoriesWithPersisted(fakeRequest(), [])).rejects.toThrow('ACL API unavailable')
  })

  it('merges live additions behind the persisted entries when the query succeeds', async () => {
    clearFnosEnvironment()
    callFnOsApi.mockResolvedValue({ result: [] })

    const directories = await loadAuthorizedDirectoriesWithPersisted(fakeRequest(), ['/vol4/kept'], ['/vol4/kept', '/vol4/new'])

    // 持久化项优先，实时新增去重后追加（09-AC-01：持久化列表在前）。
    expect(directories.map(entry => entry.path)).toEqual(['/vol4/kept', '/vol4/new'])
  })

  it('does not resurrect a persisted entry that the live query no longer reports as removable', async () => {
    clearFnosEnvironment()
    vi.stubEnv('TRIM_DATA_SHARE_PATHS', '/vol4/shared')
    callFnOsApi.mockResolvedValue({ result: [] })

    const directories = await loadAuthorizedDirectoriesWithPersisted(fakeRequest(), ['/vol4/mine'], ['/vol4/mine'])

    // 只读共享路径不可移除；用户自己的持久化项照常可移除。
    expect(directories).toEqual([
      { path: '/vol4/mine', semanticPath: '存储空间4/mine', removable: true },
      { path: '/vol4/shared', semanticPath: '存储空间4/shared', removable: false },
    ])
  })
})
