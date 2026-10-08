import { describe, expect, it } from 'vitest'
import { evictInvalidAuthorizedDirectories } from '../../src/client/services/authorized-directories-eviction.ts'
import type { AuthorizedDirectory } from '../../src/contracts/authorized-directories-contract.ts'

/**
 * 失效授权目录的剔除（FNOS-009-10）。
 *
 * 判定依据是 Host 侧用**无交互**查询接口标注的 `valid`，因此这里全部是纯函数
 * 用例：不需要 DOM，也不需要 SDK 替身。
 *
 * 关键约束：`valid === undefined` 表示「无法判定」，必须保留。把「问不到」
 * 当成「没权限」会连用户的有效授权记录一起删掉。
 */

/** 只读的应用共享路径：不属于用户授权，不参与剔除。 */
const readOnly: AuthorizedDirectory = { path: '/vol1/@appshare/app', semanticPath: '应用共享', removable: false }
const readOnlyValid: AuthorizedDirectory = { ...readOnly, valid: true }

const alive: AuthorizedDirectory = { path: '/vol4/mine', semanticPath: '我的目录', removable: true, valid: true }
const gone: AuthorizedDirectory = { path: '/vol4/gone', semanticPath: '已失效', removable: true, valid: false }
const unknown: AuthorizedDirectory = { path: '/vol4/unknown', semanticPath: '无法判定', removable: true }

describe('evictInvalidAuthorizedDirectories', () => {
  it('keeps every entry when all are valid', () => {
    const result = evictInvalidAuthorizedDirectories([alive, readOnlyValid])

    expect(result.directories).toEqual([alive, readOnlyValid])
    expect(result.evicted).toBe(false)
    expect(result.noticeKey).toBeUndefined()
  })

  it('evicts only the entries marked invalid', () => {
    const result = evictInvalidAuthorizedDirectories([alive, gone, readOnlyValid])

    expect(result.directories).toEqual([alive, readOnlyValid])
    expect(result.evicted).toBe(true)
    // 判定是确定的，不附带降级提示。
    expect(result.noticeKey).toBeUndefined()
  })

  it('keeps entries whose validity could not be decided', () => {
    // Host 的查询接口不可用时不给 valid；此时一个都不能删。
    const result = evictInvalidAuthorizedDirectories([unknown, readOnly])

    expect(result.directories).toEqual([unknown, readOnly])
    expect(result.evicted).toBe(false)
    expect(result.noticeKey).toBe('validateUnavailable')
  })

  it('still evicts the known-invalid entries when another entry is undecidable', () => {
    // 混合场景：能判定的照常剔除，判不了的保留并提示降级。
    const result = evictInvalidAuthorizedDirectories([alive, gone, unknown])

    expect(result.directories).toEqual([alive, unknown])
    expect(result.evicted).toBe(true)
    expect(result.noticeKey).toBe('validateUnavailable')
  })

  it('never evicts read-only application shares', () => {
    // 只读项即使没有 valid 也不参与剔除，因此不触发降级提示。
    const result = evictInvalidAuthorizedDirectories([readOnly])

    expect(result.directories).toEqual([readOnly])
    expect(result.evicted).toBe(false)
    expect(result.noticeKey).toBeUndefined()
  })

  it('preserves display order after eviction', () => {
    const a: AuthorizedDirectory = { path: '/vol4/a', semanticPath: 'A', removable: true, valid: true }
    const b: AuthorizedDirectory = { path: '/vol4/b', semanticPath: 'B', removable: true, valid: false }
    const c: AuthorizedDirectory = { path: '/vol4/c', semanticPath: 'C', removable: true, valid: true }

    const result = evictInvalidAuthorizedDirectories([a, b, c])

    expect(result.directories.map(item => item.path)).toEqual(['/vol4/a', '/vol4/c'])
  })

  it('reports no work for an empty list', () => {
    const result = evictInvalidAuthorizedDirectories([])

    expect(result).toEqual({ directories: [], evicted: false })
  })
})
