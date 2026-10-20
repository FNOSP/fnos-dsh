import { describe, expect, it, vi } from 'vitest'
import { loopbackOriginFor, patchAccountSignIn } from '../../src/host/login-origin-bridge.ts'

/**
 * 账号登录回调 origin 改写。
 *
 * 背景：账号服务与平台都只接受 loopback 回调，经 fnOS 网关访问时页面 origin 是
 * 网关地址，登录会立即失败且没有可见原因。这里把回调目标换成 DSH 所在机器的
 * loopback，让授权码指向「运行 DSH 的机器」。
 *
 * 关键约束：**本机访问必须不受影响**——传入的 origin 已是 loopback 时不改写。
 */

/** 最小可观测的账号服务替身：只记录收到的 callbackOrigin。 */
function fakeAccount(): { startSignIn: ReturnType<typeof vi.fn>, calls: string[], sources: string[] } {
  const calls: string[] = []
  const sources: string[] = []
  const startSignIn = vi.fn(async (_client: unknown, origin: string, source: string) => {
    calls.push(origin)
    sources.push(source)
    return { ok: true }
  })
  return { startSignIn, calls, sources }
}

describe('loopbackOriginFor', () => {
  it('由监听端口生成 loopback origin', () => {
    expect(loopbackOriginFor(3080)).toBe('http://127.0.0.1:3080')
    expect(loopbackOriginFor(8070)).toBe('http://127.0.0.1:8070')
  })

  it('端口未知或非法时不给值（避免改写成一个同样会被拒的地址）', () => {
    expect(loopbackOriginFor(undefined)).toBeUndefined()
    expect(loopbackOriginFor(0)).toBeUndefined()
    expect(loopbackOriginFor(-1)).toBeUndefined()
    expect(loopbackOriginFor(70_000)).toBeUndefined()
    expect(loopbackOriginFor(1.5)).toBeUndefined()
  })
})

describe('patchAccountSignIn', () => {
  it('非 loopback 的 origin 被改写成本机 loopback', async () => {
    const account = fakeAccount()
    patchAccountSignIn(account as never, 'http://127.0.0.1:3080')
    await account.startSignIn({}, 'http://192.168.0.17:5666', 'web')
    expect(account.calls).toEqual(['http://127.0.0.1:3080'])
  })

  it('已是 loopback 的 origin 原样透传（本机访问行为不变）', async () => {
    const account = fakeAccount()
    patchAccountSignIn(account as never, 'http://127.0.0.1:3080')
    await account.startSignIn({}, 'http://127.0.0.1:8070', 'web')
    expect(account.calls).toEqual(['http://127.0.0.1:8070'])
  })

  it('localhost 与 [::1] 也算 loopback，不改写', async () => {
    const account = fakeAccount()
    patchAccountSignIn(account as never, 'http://127.0.0.1:3080')
    await account.startSignIn({}, 'http://localhost:3080', 'web')
    await account.startSignIn({}, 'http://[::1]:3080', 'web')
    expect(account.calls).toEqual(['http://localhost:3080', 'http://[::1]:3080'])
  })

  it('保留 loginSource，不改变其它调用形态', async () => {
    const account = fakeAccount()
    patchAccountSignIn(account as never, 'http://127.0.0.1:3080')
    await account.startSignIn({}, 'https://example.com', 'desktop')
    // 补丁替换了方法本身，不能再用 toHaveBeenCalledWith 断言；改看替身收到什么。
    expect(account.calls).toEqual(['http://127.0.0.1:3080'])
    expect(account.sources).toEqual(['desktop'])
  })

  it('卸载后恢复原方法', async () => {
    const account = fakeAccount()
    const restore = patchAccountSignIn(account as never, 'http://127.0.0.1:3080')
    restore()
    await account.startSignIn({}, 'http://192.168.0.17:5666', 'web')
    expect(account.calls).toEqual(['http://192.168.0.17:5666'])
  })
})
