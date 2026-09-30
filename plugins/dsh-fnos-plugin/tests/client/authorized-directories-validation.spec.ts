import { describe, expect, it } from 'vitest'
import {
  validateAuthorizedDirectories,
  type AuthorizeCapableSdk,
  type FnosAuthorizeResult,
} from '../../src/client/services/authorized-directories-validation.ts'

/**
 * 授权目录的逐项权限校验（FNOS-009-10）。
 *
 * 这些用例覆盖三类结论：单项通过、单项不通过、以及**整体不可用**。
 * 最后一类最容易写错：桥接缺失时返回 `undefined`，如果把它当成「没权限」，
 * 用户重启一次插件就会丢掉全部授权目录。
 */

/** 用映射表搭一个 SDK 替身；值可以是应答、`undefined`，或抛错的哨兵。 */
function sdkStub(
  shared: Record<string, FnosAuthorizeResult | 'throw'>,
  user: Record<string, FnosAuthorizeResult | 'throw'> = {},
): AuthorizeCapableSdk {
  const call = (table: Record<string, FnosAuthorizeResult | 'throw'>) => async (path: string): Promise<FnosAuthorizeResult> => {
    const value = table[path]
    if (value === 'throw') throw new Error(`bridge failed for ${path}`)
    return value
  }
  return { authorizeSharedFile: call(shared), authorizeUserFile: call(user) }
}

describe('validateAuthorizedDirectories', () => {
  it('keeps a directory that the shared-directory check accepts', async () => {
    const outcome = await validateAuthorizedDirectories(sdkStub({ '/vol1/share': { ok: true } }), ['/vol1/share'])

    expect(outcome).toEqual({ available: true, valid: ['/vol1/share'], invalid: [] })
  })

  it('falls back to the user-directory check when the shared check declines', async () => {
    const outcome = await validateAuthorizedDirectories(
      sdkStub({ '/vol1/mine': { ok: false } }, { '/vol1/mine': { ok: true } }),
      ['/vol1/mine'],
    )

    expect(outcome).toEqual({ available: true, valid: ['/vol1/mine'], invalid: [] })
  })

  it('evicts a directory that both checks decline', async () => {
    const outcome = await validateAuthorizedDirectories(
      sdkStub({ '/vol1/gone': { ok: false } }, { '/vol1/gone': { ok: false } }),
      ['/vol1/gone'],
    )

    expect(outcome).toEqual({ available: true, valid: [], invalid: ['/vol1/gone'] })
  })

  it('separates valid from invalid entries in one pass', async () => {
    const outcome = await validateAuthorizedDirectories(
      sdkStub(
        { '/vol1/keep': { ok: true }, '/vol1/drop': { ok: false } },
        { '/vol1/drop': { ok: false } },
      ),
      ['/vol1/keep', '/vol1/drop'],
    )

    expect(outcome.available).toBe(true)
    expect(outcome.valid).toEqual(['/vol1/keep'])
    expect(outcome.invalid).toEqual(['/vol1/drop'])
  })

  it('skips eviction and keeps every path when the bridge answers undefined', async () => {
    const outcome = await validateAuthorizedDirectories(sdkStub({ '/vol1/a': undefined }), ['/vol1/a', '/vol1/b'])

    expect(outcome.available).toBe(false)
    expect(outcome.invalid).toEqual([])
    // 关键：桥接不可用时一个都不能剔除，否则重启即丢目录。
    expect(outcome.valid).toEqual(['/vol1/a', '/vol1/b'])
  })

  it('skips eviction when the bridge rejects mid-call', async () => {
    const outcome = await validateAuthorizedDirectories(sdkStub({ '/vol1/a': { ok: true }, '/vol1/b': 'throw' }), ['/vol1/a', '/vol1/b'])

    expect(outcome.available).toBe(false)
    expect(outcome.invalid).toEqual([])
    expect(outcome.valid).toContain('/vol1/b')
  })

  it('reports available with no work for an empty list', async () => {
    const outcome = await validateAuthorizedDirectories(sdkStub({}), [])

    expect(outcome).toEqual({ available: true, valid: [], invalid: [] })
  })

  it('does not call the user check when the shared check already accepts', async () => {
    let userCalls = 0
    const sdk: AuthorizeCapableSdk = {
      authorizeSharedFile: async () => ({ ok: true }),
      authorizeUserFile: async () => { userCalls += 1; return { ok: true } },
    }

    await validateAuthorizedDirectories(sdk, ['/vol1/a'])

    expect(userCalls).toBe(0)
  })
})
