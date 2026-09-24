import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { srcPath } from './paths.ts'
import { guardRpc, describeRpcError, RPC_TRANSPORT_ERROR_CODE } from '../src/client/rpc.ts'
import { startLoginPolling } from '../src/client/login-polling.ts'
import { CODEBUDDY_AUTH_CHANNEL } from '../src/contracts/constants.ts'

/**
 * `ConnectionRpc.call` 声明为 `Promise<RpcResult<T>>`——一个说明成功与否的结果
 * 信封。整个客户端的调用点都按这个契约写：只判 `result.ok`，把拒绝当成不可能。
 *
 * 但真实实现在传输失败时会**拒绝**（`dsh-client-connection` 的 `async call` 对
 * 不可达主机、非 2xx、rpcId 不匹配都直接 `throw`）。于是 `await` 之后的收尾语句
 * 被整段跳过：`setLoading(false)` 不执行（按钮永久转圈且不报错）、浮动 promise
 * 变成没人看的未处理拒绝、登录轮询循环在第一跳就静默死掉。
 *
 * `guardRpc` 在唯一取 rpc 的地方把这层契约补回来。这组用例同时盯住「拦住」与
 * 「不改变既有语义」两件事。
 */

describe('guardRpc：把传输拒绝收敛成结果信封', () => {
  it('传输拒绝 → { ok: false }，带上 code 与出错的端点', async () => {
    const raw = { call: vi.fn().mockRejectedValue(new Error('Failed to fetch')) }
    const rpc = guardRpc(raw as never)

    const result = await rpc.call(CODEBUDDY_AUTH_CHANNEL, 'accounts', {})

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error.code).toBe(RPC_TRANSPORT_ERROR_CODE)
    expect(result.error.message).toBe('Failed to fetch')
    // 端点要带上：`describeRpcError` 只渲染 `code: message`，没有它就看不出是哪次调用挂了。
    expect(result.error.details).toEqual({ channel: CODEBUDDY_AUTH_CHANNEL, endpoint: 'accounts' })
  })

  it('非 Error 抛出物也能渲染，不产生 "undefined"', async () => {
    const raw = { call: vi.fn().mockRejectedValue('socket closed') }
    const rpc = guardRpc(raw as never)

    const result = await rpc.call(CODEBUDDY_AUTH_CHANNEL, 'status', {})

    if (result.ok) throw new Error('unreachable')
    expect(result.error.message).toBe('socket closed')
  })

  it('成功信封原样透传（不包一层、不改 value）', async () => {
    const value = { accounts: [] }
    const raw = { call: vi.fn().mockResolvedValue({ ok: true, value }) }
    const rpc = guardRpc(raw as never)

    await expect(rpc.call(CODEBUDDY_AUTH_CHANNEL, 'accounts', {})).resolves.toEqual({ ok: true, value })
  })

  it('服务端自己的失败信封原样透传，不被误判成传输错误', async () => {
    const envelope = { ok: false, error: { code: 'invalid-request', message: 'bad payload', details: {} } }
    const raw = { call: vi.fn().mockResolvedValue(envelope) }
    const rpc = guardRpc(raw as never)

    await expect(rpc.call(CODEBUDDY_AUTH_CHANNEL, 'growthRun', {})).resolves.toEqual(envelope)
  })

  it('四个参数（含 AbortSignal）都传给底层 call', async () => {
    const raw = { call: vi.fn().mockResolvedValue({ ok: true, value: {} }) }
    const rpc = guardRpc(raw as never)
    const controller = new AbortController()

    await rpc.call(CODEBUDDY_AUTH_CHANNEL, 'tokenStats', { a: 1 }, controller.signal)

    expect(raw.call).toHaveBeenCalledWith(CODEBUDDY_AUTH_CHANNEL, 'tokenStats', { a: 1 }, controller.signal)
  })

  it('describeRpcError 能把传输失败渲染成可读文案', async () => {
    const raw = { call: vi.fn().mockRejectedValue(new Error('Failed to fetch')) }
    const rpc = guardRpc(raw as never)

    const result = await rpc.call(CODEBUDDY_AUTH_CHANNEL, 'accounts', {})

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(describeRpcError(result)).toBe('transport: Failed to fetch')
  })
})

describe('guardRpc 真的接在客户端取 rpc 的那一处', () => {
  /**
   * 上面几组用例驱动的是 `guardRpc` 本身，删掉接线它们照样全绿——而接线才是
   * 这个修复生效的地方。这里盯源码结构：`src/client/index.tsx` 是插件**唯一**
   * 取 `ctx.connection.rpc` 的地方（挂载点、面板、抽屉都从这里拿），因此只要
   * 它被包住，全客户端就都被包住了。
   */
  const INDEX = readFileSync(srcPath('client/index.tsx'), 'utf8')

  it('唯一的 rpc 取值点被 guardRpc 包住', () => {
    expect(INDEX).toContain('guardRpc(')
    // 取值与包裹必须在同一行：拆成两行时容易只包住其中一条路径。
    expect(INDEX).toMatch(/const rpc = guardRpc\(\(ctx\.get\('connection'\)/)
  })

  it('没有绕过 guard 的第二处 rpc 取值', () => {
    // `ctx.get('connection')` 只应出现在被包住的那一行。
    const acquisitions = INDEX.match(/ctx\.get\('connection'\)/g) ?? []
    expect(acquisitions).toHaveLength(1)
  })
})

describe('登录轮询在传输失败下不会静默死掉', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('底层 call 拒绝时，轮询继续直到截止时间并如实报超时', async () => {
    /**
     * 修复前的行为：`await rpc.call` 抛出 → `tick` 拒绝 → `void tick()` 变成
     * 未处理拒绝，循环就此停住，`onDone` / `onTimeout` / `onFailed` 一个都不
     * 触发。用户看到的是「一直正在登录」，而失败的真正原因从未上报。
     *
     * 修复后：拒绝被收敛成 `{ ok: false }`，循环按既有语义走到截止时间并报超时。
     */
    const leaked: unknown[] = []
    const onUnhandled = (reason: unknown): void => { leaked.push(reason) }
    process.on('unhandledRejection', onUnhandled)

    /**
     * 把 `window.setTimeout` 换成同步排空的队列：轮询循环自己不递归调用，
     * 每次 tick 只排下一跳，因此「反复放行队列」就等于把 10 分钟压成立即完成。
     */
    let queued: Array<() => void> = []
    vi.stubGlobal('window', {
      setTimeout: (fn: () => void) => { queued.push(fn); return 0 },
    })

    /**
     * 循环的截止判断读 `Date.now()`，而上面把等待压成了同步——真实墙钟几乎不走，
     * 500 跳也跨不过 10 分钟的截止线。这里把时钟也一并接管，每跳推进一个轮询
     * 间隔，让「跳到截止」这件事在测试里真实发生。
     */
    const startedWallClock = Date.now()
    let virtualNow = startedWallClock
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => virtualNow)

    const raw = { call: vi.fn().mockRejectedValue(new Error('Failed to fetch')) }
    const rpc = guardRpc(raw as never)
    const onDone = vi.fn()
    const onTimeout = vi.fn()

    try {
      startLoginPolling(rpc as never, 'state-1', onDone, onTimeout)
      /**
       * 轮询间隔 1.5s、截止 10 分钟：放行 500 跳足以跨过截止时间。
       *
       * 顺序很关键：`tick` 的第一跳在 `await rpc.call` 处挂起，它排下一跳是在
       * 这个 await 落定**之后**。所以每轮必须先排空微任务让 tick 走到
       * `window.setTimeout`，才能从队列里取到下一跳；先看队列长度会误判成空。
       */
      for (let hop = 0; hop < 500; hop += 1) {
        // 先让挂起的 tick 落定并排好下一跳。
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
        const next = queued.shift()
        queued = []
        if (next === undefined) break
        virtualNow += 1_500
        next()
      }
    } finally {
      nowSpy.mockRestore()
      process.off('unhandledRejection', onUnhandled)
    }

    expect(onDone).not.toHaveBeenCalled()
    // 关键：循环活到了截止时间，而不是在第一跳就消失。
    expect(onTimeout).toHaveBeenCalled()
    // 且没有任何未处理拒绝逃逸。
    expect(leaked).toEqual([])
  })
})
