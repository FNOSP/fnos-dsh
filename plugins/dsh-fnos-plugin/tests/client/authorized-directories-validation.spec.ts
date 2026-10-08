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
 * 最后一类最容易写错：桥接缺失或调用超时如果被当成「没权限」，用户重启一次
 * 插件就会丢掉全部授权目录。
 *
 * 注意应答结构：fnOS 的 SDK 返回 `AppBridgeResponse`，`code: 0` 才是成功。
 * 早期用例按 `{ ok: boolean }` 构造替身，替身与实现一起错，因此没能拦住
 * 「每个可移除目录都被判为无权限并删除」这个缺陷。
 */

/** 成功应答：`code: 0`。 */
const accepted = (): FnosAuthorizeResult => ({ code: 0, msg: 'ok', data: [] })
/** 明确拒绝：非 0 业务码，例如普通用户调用共享目录接口得到 `code: 1`。 */
const declined = (msg = 'not applicable'): FnosAuthorizeResult => ({ code: 1, msg })

/** 用映射表搭一个 SDK 替身；值可以是应答、`undefined`、抛错或永不 settle 的哨兵。 */
function sdkStub(
  shared: Record<string, FnosAuthorizeResult | 'throw' | 'hang'>,
  user: Record<string, FnosAuthorizeResult | 'throw' | 'hang'> = {},
): AuthorizeCapableSdk {
  const call = (table: Record<string, FnosAuthorizeResult | 'throw' | 'hang'>) => async (path: string): Promise<FnosAuthorizeResult> => {
    const value = table[path]
    if (value === 'throw') throw new Error(`bridge failed for ${path}`)
    if (value === 'hang') return new Promise<undefined>(() => {})
    return value
  }
  return { authorizeSharedFile: call(shared), authorizeUserFile: call(user) }
}

describe('validateAuthorizedDirectories', () => {
  it('keeps a directory that the shared-directory check accepts', async () => {
    const outcome = await validateAuthorizedDirectories(sdkStub({ '/vol1/share': accepted() }), ['/vol1/share'])

    expect(outcome).toEqual({ available: true, valid: ['/vol1/share'], invalid: [] })
  })

  it('falls back to the user-directory check when the shared check declines', async () => {
    // 用户目录必然不满足共享目录接口，这正是「单个接口拒绝不足以判定无权限」。
    const outcome = await validateAuthorizedDirectories(
      sdkStub({ '/vol1/mine': declined('仅管理员可进行此操作') }, { '/vol1/mine': accepted() }),
      ['/vol1/mine'],
    )

    expect(outcome).toEqual({ available: true, valid: ['/vol1/mine'], invalid: [] })
  })

  it('evicts a directory that both checks decline', async () => {
    const outcome = await validateAuthorizedDirectories(
      sdkStub({ '/vol1/gone': declined() }, { '/vol1/gone': declined() }),
      ['/vol1/gone'],
    )

    expect(outcome).toEqual({ available: true, valid: [], invalid: ['/vol1/gone'] })
  })

  it('separates valid from invalid entries in one pass', async () => {
    const outcome = await validateAuthorizedDirectories(
      sdkStub({ '/vol1/keep': accepted(), '/vol1/drop': declined() }, { '/vol1/drop': declined() }),
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
    const outcome = await validateAuthorizedDirectories(
      sdkStub({ '/vol1/a': accepted(), '/vol1/b': 'throw' }),
      ['/vol1/a', '/vol1/b'],
    )

    expect(outcome.available).toBe(false)
    expect(outcome.invalid).toEqual([])
    expect(outcome.valid).toContain('/vol1/b')
  })

  it('treats a call that never settles as unavailable instead of invalid', async () => {
    // SDK 的桥接调用没有超时：授权确认框出现而用户未操作时会永久挂起。
    // 挂起必须按「问不到」处理，否则界面停在加载中且目录可能被判为无权限。
    const outcome = await validateAuthorizedDirectories(
      sdkStub({ '/vol1/slow': 'hang' }),
      ['/vol1/slow'],
      20,
    )

    expect(outcome.available).toBe(false)
    expect(outcome.invalid).toEqual([])
    expect(outcome.valid).toEqual(['/vol1/slow'])
  })

  it('stops probing the second endpoint after a timeout', async () => {
    const outcome = await validateAuthorizedDirectories(
      sdkStub({ '/vol1/slow': 'hang' }, { '/vol1/slow': accepted() }),
      ['/vol1/slow'],
      20,
    )

    // 第一个接口超时即判定整体不可用，不再等第二个接口。
    expect(outcome.available).toBe(false)
    expect(outcome.valid).toEqual(['/vol1/slow'])
  })

  it('reports available with no work for an empty list', async () => {
    const outcome = await validateAuthorizedDirectories(sdkStub({}), [])

    expect(outcome).toEqual({ available: true, valid: [], invalid: [] })
  })

  it('does not call the user check when the shared check already accepts', async () => {
    let userCalls = 0
    const sdk: AuthorizeCapableSdk = {
      authorizeSharedFile: async () => accepted(),
      authorizeUserFile: async () => { userCalls += 1; return accepted() },
    }

    await validateAuthorizedDirectories(sdk, ['/vol1/a'])

    expect(userCalls).toBe(0)
  })
})
