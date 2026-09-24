import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CodeBuddyAuthService } from '../src/host/auth-service.ts'
import { CodeBuddySession } from '../src/host/session.ts'

/**
 * `startLogin` 里的 pending 条目回收不能泄漏未处理拒绝。
 *
 * `void promise.finally(cb)` 丢弃的是**新** promise，而它会带着与源 promise
 * 相同的拒绝原因一起拒绝。源 promise 的拒绝由 `pollLogin` 的 `await` 处理，
 * 派生出来的那个没人管——在 dsh 的 fail-loud 策略下（`installFailLoud` 对
 * `unhandledRejection` 直接 `process.exit(1)`），一次逃逸就会带走整个宿主进程。
 *
 * 这条路径此前**没有**被 `deferred-rejection.spec.ts` 覆盖：那个文件只盯
 * `session.ts` 的两处同构写法，而 `auth-service.ts` 的 `startLogin` 是第三处。
 *
 * 用例直接驱动真实实现：让 `runLogin` 必然拒绝，再断言没有任何未处理拒绝逃逸。
 */

vi.mock('../src/host/storage.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/host/storage.ts')>()
  return {
    ...actual,
    loadAutoSwitchConfig: async () => ({ enabled: false, thresholdPct: 10 }),
    loadAutoCheckinConfig: async () => ({ enabled: false }),
    loadAutoTravelConfig: async () => ({ enabled: false }),
  }
})

let workdir: string | undefined

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  delete process.env.DSH_CODEBUDDY_AUTH_FILE
  if (workdir !== undefined) {
    rmSync(workdir, { recursive: true, force: true })
    workdir = undefined
  }
})

function useTempAuthFile(): string {
  workdir = mkdtempSync(join(tmpdir(), 'codebuddy-pending-'))
  const path = join(workdir, 'codebuddy-auth.json')
  process.env.DSH_CODEBUDDY_AUTH_FILE = path
  return path
}

/** 捕获本用例期间逃逸的未处理拒绝。 */
async function withUnhandledCapture(run: () => Promise<void>): Promise<unknown[]> {
  const seen: unknown[] = []
  const onUnhandled = (reason: unknown): void => { seen.push(reason) }
  process.on('unhandledRejection', onUnhandled)
  try {
    await run()
    // 让 microtask 队列先排空，派生 promise 的拒绝才会浮现。
    await new Promise(resolve => setTimeout(resolve, 0))
    await new Promise(resolve => setTimeout(resolve, 0))
  } finally {
    process.off('unhandledRejection', onUnhandled)
  }
  return seen
}

/** 最小可用的宿主 Context：RPC 注册走 no-op，偏好读取由上面的 mock 固定为关。 */
function stubContext(): unknown {
  const ctx = {
    logger: { warn: () => {}, info: () => {} },
    connection: { rpc: { handle: () => () => {} } },
    effect: (fn: () => () => void): void => { fn() },
    inject: (_services: string[], callback: (ctx: unknown) => void): void => { callback(ctx) },
  }
  return ctx
}

/** 握手端点成功应答，让 `startLogin` 走到「登记 pending + 挂 finally」那一步。 */
function stubAuthStateOk(): void {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    code: 0,
    data: { state: 'handshake-1', authUrl: 'https://example.invalid/login' },
  }), { status: 200, headers: { 'content-type': 'application/json' } })))
}

describe('startLogin 的 pending 回收不泄漏未处理拒绝', () => {
  it('runLogin 拒绝时派生 promise 不逃逸，且条目仍被回收', async () => {
    useTempAuthFile()
    stubAuthStateOk()
    const service = new CodeBuddyAuthService(stubContext() as never, new CodeBuddySession())

    /**
     * 让 `runLogin` 必然拒绝。
     *
     * 刻意不依赖它当前「内部 try/catch 全兜住」的实现细节——那正是本用例要防
     * 的假设：`startLogin` 对 `pending.promise` 的拒绝负有责任，无论它今天是否
     * 会拒绝。这里从原型上换掉它，模拟一次逃逸的拒绝。
     */
    const proto = Object.getPrototypeOf(service) as { runLogin: (...args: unknown[]) => Promise<unknown> }
    vi.spyOn(proto, 'runLogin').mockRejectedValue(new Error('login handshake failed'))

    const leaked = await withUnhandledCapture(async () => {
      const start = await service.startLogin()
      expect(start.state).toBe('handshake-1')
      // 调用方（pollLogin）像生产路径那样处理源 promise 的拒绝。
      await service.pollLogin(start.state).catch(() => undefined)
    })

    expect(leaked).toEqual([])
  })

  it('pollLogin 对未知 state 返回未完成，而不是抛错', async () => {
    useTempAuthFile()
    const service = new CodeBuddyAuthService(stubContext() as never, new CodeBuddySession())
    // 客户端轮询可能比条目多活一拍；此时必须是「未完成」而非异常。
    await expect(service.pollLogin('gone')).resolves.toEqual({ done: false })
  })
})

describe('startLogin 的 pending 表不无界增长', () => {
  it('握手落定后条目被回收，同一 state 不再可查', async () => {
    useTempAuthFile()
    stubAuthStateOk()
    const service = new CodeBuddyAuthService(stubContext() as never, new CodeBuddySession())
    const proto = Object.getPrototypeOf(service) as { runLogin: (...args: unknown[]) => Promise<unknown> }

    /**
     * 用手动落定的 promise 占住「登录仍在进行」这段窗口。
     *
     * 不能 mockResolvedValue：那样 promise 在 `startLogin` 返回前就已落定，
     * finally 的回收早就跑完了，根本观察不到「进行中仍在表里」这一半。
     */
    let settle!: (value: unknown) => void
    const gate = new Promise((resolve) => { settle = resolve })
    vi.spyOn(proto, 'runLogin').mockReturnValue(gate)

    const start = await service.startLogin()
    // 进行中：条目在表里，客户端能查到同一个登录链接（host 会补上客户端版本参数）。
    expect(await service.loginLink(start.state)).toContain('https://example.invalid/login')

    settle(undefined)
    // 让 finally 的回调跑完。
    await new Promise(resolve => setTimeout(resolve, 0))
    await new Promise(resolve => setTimeout(resolve, 0))
    // 落定后：条目被回收，表不会无界增长。
    expect(await service.loginLink(start.state)).toBeUndefined()
  })
})
