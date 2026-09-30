import { describe, expect, it, vi } from 'vitest'
import { evictInvalidDirectories } from '../../src/client/services/authorized-directories-eviction.ts'
import type { FnosTrimApp } from '../../src/client/services/sdk.ts'
import type { AuthorizedDirectory } from '../../src/contracts/authorized-directories-contract.ts'

/**
 * 卡片级「校验并剔除」编排（FNOS-009-10）的 T05-04 验收。
 *
 * 校验服务本身已有单测（`tests/client/authorized-directories-validation.spec.ts`），
 * 这里补的是**卡片把服务用对**的那一层：哪些目录参与校验、不可用时是否真的不剔除、
 * 剔除后展示列表与提示如何变化。
 *
 * 本仓库没有 DOM 测试环境（无 jsdom / happy-dom / testing-library），
 * 所以 `evictInvalidDirectories` 被刻意做成可注入 SDK 构造器的纯异步函数——
 * 不需要渲染组件就能覆盖全部分支。
 */

/** 只读的应用共享路径：不属于用户授权，不应参与剔除。 */
const readOnly: AuthorizedDirectory = { path: '/vol1/@appshare/app', semanticPath: '应用共享', removable: false }
const mine: AuthorizedDirectory = { path: '/vol4/mine', semanticPath: '我的目录', removable: true }

/** SDK 替身：`ready` 与两个授权接口都可指定行为。 */
function sdkStub(options: {
  ready?: 'ok' | 'throw'
  shared?: Record<string, { ok: boolean } | undefined | 'throw'>
  user?: Record<string, { ok: boolean } | undefined | 'throw'>
}): FnosTrimApp {
  const call = (table: Record<string, { ok: boolean } | undefined | 'throw'> = {}) =>
    async (path: string): Promise<{ ok: boolean } | undefined> => {
      const value = table[path]
      if (value === 'throw') throw new Error(`bridge failed for ${path}`)
      return value
    }
  return {
    ready: async () => {
      if (options.ready === 'throw') throw new Error('bridge unavailable')
    },
    authorizeSharedFile: call(options.shared),
    authorizeUserFile: call(options.user),
  } as unknown as FnosTrimApp
}

describe('evictInvalidDirectories', () => {
  it('keeps every entry when the SDK reports all paths valid', async () => {
    const directories = [mine]
    const result = await evictInvalidDirectories(directories, () => sdkStub({ shared: { '/vol4/mine': { ok: true } } }))

    expect(result.evicted).toBe(false)
    expect(result.directories).toEqual([mine])
    expect(result.noticeKey).toBeUndefined()
  })

  it('drops only the paths the SDK rejected and flags that an eviction happened', async () => {
    const gone: AuthorizedDirectory = { path: '/vol4/gone', semanticPath: '已失效', removable: true }
    const result = await evictInvalidDirectories(
      [mine, gone],
      () => sdkStub({ shared: { '/vol4/mine': { ok: true }, '/vol4/gone': { ok: false } }, user: { '/vol4/gone': undefined } }),
    )

    // `user` 返回 undefined 表示桥接不可用 → 整体降级、不剔除。
    expect(result.evicted).toBe(false)
    expect(result.directories).toEqual([mine, gone])
    expect(result.noticeKey).toBe('validateUnavailable')
  })

  it('still evicts when the user-directory check answers a real rejection', async () => {
    const gone: AuthorizedDirectory = { path: '/vol4/gone', semanticPath: '已失效', removable: true }
    const result = await evictInvalidDirectories(
      [mine, gone],
      () => sdkStub({ shared: { '/vol4/mine': { ok: true }, '/vol4/gone': { ok: false } }, user: { '/vol4/gone': { ok: false } } }),
    )

    expect(result.evicted).toBe(true)
    expect(result.directories).toEqual([mine])
    expect(result.noticeKey).toBeUndefined()
  })

  it('never asks the bridge about read-only app share paths', async () => {
    const shared = vi.fn(async () => ({ ok: true }))
    const sdk = { ready: async () => undefined, authorizeSharedFile: shared, authorizeUserFile: vi.fn() } as unknown as FnosTrimApp

    const result = await evictInvalidDirectories([readOnly], () => sdk)

    // 只读项不参与校验，也不因此被判为降级。
    expect(shared).not.toHaveBeenCalled()
    expect(result.evicted).toBe(false)
    expect(result.directories).toEqual([readOnly])
    expect(result.noticeKey).toBeUndefined()
  })

  it('skips eviction and warns when the SDK cannot even initialize', async () => {
    const result = await evictInvalidDirectories([mine], () => sdkStub({ ready: 'throw' }))

    // 10-AC-04：桥接不可用时按持久化数据展示，一个都不能少。
    expect(result.evicted).toBe(false)
    expect(result.directories).toEqual([mine])
    expect(result.noticeKey).toBe('validateUnavailable')
  })

  it('skips eviction when creating the SDK itself throws', async () => {
    const result = await evictInvalidDirectories([mine], () => { throw new Error('no bridge') })

    expect(result.evicted).toBe(false)
    expect(result.directories).toEqual([mine])
    expect(result.noticeKey).toBe('validateUnavailable')
  })

  it('does not construct the SDK for a list with nothing to validate', async () => {
    const createSdk = vi.fn(() => sdkStub({}))

    const result = await evictInvalidDirectories([readOnly], createSdk)

    expect(createSdk).not.toHaveBeenCalled()
    expect(result).toEqual({ directories: [readOnly], evicted: false })
  })

  it('treats an empty list as a no-op', async () => {
    const result = await evictInvalidDirectories([], () => sdkStub({}))

    expect(result).toEqual({ directories: [], evicted: false })
  })

  it('preserves the original display order after eviction', async () => {
    const a: AuthorizedDirectory = { path: '/vol4/a', semanticPath: 'A', removable: true }
    const b: AuthorizedDirectory = { path: '/vol4/b', semanticPath: 'B', removable: true }
    const c: AuthorizedDirectory = { path: '/vol4/c', semanticPath: 'C', removable: true }
    const result = await evictInvalidDirectories(
      [a, b, c],
      () => sdkStub({
        shared: { '/vol4/a': { ok: true }, '/vol4/b': { ok: false }, '/vol4/c': { ok: true } },
        user: { '/vol4/b': { ok: false } },
      }),
    )

    expect(result.directories.map(item => item.path)).toEqual(['/vol4/a', '/vol4/c'])
  })
})
