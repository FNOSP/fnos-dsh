import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decideReactiveTarget } from '../src/host/switch-policy.ts'
import { srcPath } from './paths.ts'

/**
 * 多会话并发下的**被动换号**（额度耗尽 → 换账号重试）。
 *
 * 场景：账号 A 额度耗尽（HTTP 429 + 业务码 6004），两个会话几乎同时发请求。
 *
 *  1. 会话 1 把当前账号从 A 切到 B（B 健康）并成功；
 *  2. 会话 2 此刻**重新读到**的当前账号已经是 B —— 但它真正被拒的账号是 A。
 *
 * 决策函数要求 `failedId` 是**真正被拒的那个账号**。旧实现在
 * `failoverToNextAccount` 里重新读 `activeAccountSummary()` 并把结果当 `failedId`，
 * 于是健康的 B 被当成「已经失败」而排除：
 *
 *  - 3 个账号：级联切到更差的 C（健康账号被白白跳过）；
 *  - 2 个账号：没有未尝试过的账号 → 放弃 → 抛 QUOTA（外层不可重试）→ 会话失败。
 *
 * 这里用**两个并发请求**做端到端断言，而不是检查源码文本——文本断言只能证明
 * 「写了某句话」，证明不了「并发下真的不再失败」。
 */

const NS = 'codebuddy-auth.json'
function scratch(): void {
  const dir = mkdtempSync(join(tmpdir(), 'cb-conc-'))
  process.env.DSH_CODEBUDDY_AUTH_FILE = join(dir, NS)
}
afterEach(() => { delete process.env.DSH_CODEBUDDY_AUTH_FILE })

const tok = (n: string) => ({ accessToken: n, refreshToken: 'r', expiresIn: 3600, refreshExpiresIn: 7200, domain: 'd' })

/** 429 + 业务码 6004：账号×模型额度耗尽，必须换账号。 */
const quota = (): Response => new Response(JSON.stringify({ code: 6004, msg: '您的使用量已超出频率限制' }), {
  status: 429, headers: { 'content-type': 'application/json' },
})
const ok = (): Response => new Response(
  'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n',
  { status: 200, headers: { 'content-type': 'text/event-stream' } },
)

interface Harness {
  adapter: { stream: (o: unknown) => AsyncIterable<unknown> }
  ids: string[]
  /** 每个账号被请求的次数。 */
  hits: Map<string, number>
  /** 当前活动账号 id，供测试编排时序。 */
  activeIdNow: () => Promise<string | undefined>
  restore: () => void
}

/**
 * 造一个 adapter：给定的「耗尽账号」一律 429+6004，其余账号成功。
 * @param exhausted - 视为额度耗尽的账号序号（对应账号文档顺序）。
 * @param gate - 每次业务请求前的等待点，供测试制造并发窗口。
 */
async function harness(exhausted: readonly number[], gate?: () => Promise<void>): Promise<Harness> {
  const { buildAccountEntry, saveStorage, loadStorage } = await import('../src/host/storage.ts')
  const { CodeBuddySession } = await import('../src/host/session.ts')
  const { CodeBuddyAdapter } = await import('../src/host/adapter.ts')
  const es = ['A', 'B', 'C'].map((n, i) => buildAccountEntry(tok(`t${i}`) as never, { uid: `u${i}`, nickname: n } as never, {}))
  await saveStorage({ activeId: es[0]!.id, accounts: es })
  const session = new CodeBuddySession()
  const stored = (await loadStorage())!.accounts
  const ids = stored.map(e => e.id)
  // 用**落盘后**的 accessToken 做索引：buildAccountEntry 会包装/编码 token。
  const tokenToIndex = new Map(stored.map((e, i) => [e.auth.accessToken, i]))

  const hits = new Map<string, number>()
  const original = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    // 只拦截聊天端点；模型目录 / 配置 / 计量等其他端点一律返回空壳 JSON，
    // 否则它们会落进下面的「额度耗尽」分支，把测试变成另一回事。
    if (!url.includes('/chat/completions')) {
      return new Response(JSON.stringify({ data: [], models: [], config: {} }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    }
    // 用 token 反查是哪個账号（每个账号一个独立 accessToken）
    const hdrs = (init?.headers ?? {}) as Record<string, string>
    const bearer = String(hdrs.authorization ?? hdrs.Authorization ?? '').replace('Bearer ', '')
    const idx = tokenToIndex.get(bearer)
    if (idx === undefined) return ok()
    hits.set(String(idx), (hits.get(String(idx)) ?? 0) + 1)
    // 只有**耗尽账号**才需要过闸门：制造「两个会话都先撞上 A」的确定性窗口。
    if (gate !== undefined && exhausted.includes(idx)) await gate()
    return exhausted.includes(idx) ? quota() : ok()
  }) as typeof fetch

  const adapter = new CodeBuddyAdapter({
    session,
    options: () => ({ baseURL: 'https://example.invalid', defaultContextWindow: 1, defaultMaxTokens: 1, streamIdleTimeoutMs: 1000 }),
    autoSwitch: () => true,
  }) as unknown as Harness['adapter']
  return {
    adapter, ids, hits,
    activeIdNow: async () => (await loadStorage())?.activeId,
    restore: () => { globalThis.fetch = original },
  }
}

/** 跑一次完整流，返回 chunk 数或抛出的错误。 */
async function run(h: Harness): Promise<{ chunks: number } | { error: string, code: string | undefined }> {
  let chunks = 0
  try {
    for await (const _ of h.adapter.stream({
      provider: 'codebuddy', model: 'm',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    })) chunks += 1
    return { chunks }
  } catch (error) {
    return { error: (error as Error).message, code: (error as { code?: string }).code }
  }
}

describe('决策层：failedId 必须是真正的被拒者', () => {
  const c = (id: string, pct: number) => ({ id, nickname: id, credentialValid: true, remainingPct: pct })

  it('真凶 A 时选中健康的当前账号 B（切换退化为原地重试）', () => {
    const decision = decideReactiveTarget({ candidates: [c('A', 0), c('B', 80), c('C', 70)], failedId: 'A', triedIds: ['A'] })
    expect(decision.kind).toBe('switch')
    expect((decision as { targetId: string }).targetId).toBe('B')
  })

  it('误用当下 current（B）会把健康的 B 排除 → 级联到 C', () => {
    const decision = decideReactiveTarget({ candidates: [c('A', 0), c('B', 80), c('C', 70)], failedId: 'B', triedIds: ['A'] })
    expect(decision.kind).toBe('switch')
    expect((decision as { targetId: string }).targetId).toBe('C')
  })

  it('两个账号 + 误用当下 current → 直接放弃（这就是会话失败的原因）', () => {
    const decision = decideReactiveTarget({ candidates: [c('A', 0), c('B', 80)], failedId: 'B', triedIds: ['A'] })
    expect(decision.kind).toBe('stay')
  })
})

describe('端到端：两个会话并发撞上同一个耗尽账号', () => {
  it('两个账号：两个请求都应成功（旧实现在此必有一个抛 QUOTA）', async () => {
    scratch()
    // A（序号 0）耗尽。用一个闸门让两个请求都先打到 A，再各自换号。
    let arrival = 0
    const waiters: Array<() => void> = []
    const gate = (): Promise<void> => {
      arrival += 1
      // 两个都到达 A 之后一起放行；先到的那个等待。
      if (arrival >= 2) { for (const w of waiters.splice(0)) w(); return Promise.resolve() }
      return new Promise<void>(r => { waiters.push(r) })
    }
    const h = await harness([0], gate)
    try {
      const [r1, r2] = await Promise.all([run(h), run(h)])
      console.log('  请求 1:', JSON.stringify(r1))
      console.log('  请求 2:', JSON.stringify(r2))
      console.log('  各账号命中次数:', JSON.stringify(Object.fromEntries(h.hits)))
      expect(r1).toMatchObject({ chunks: expect.any(Number) })
      expect(r2).toMatchObject({ chunks: expect.any(Number) })
    } finally { h.restore() }
  }, 60_000)

  it('三个账号：第二次请求应直接用已健康的当前账号，不再额外切换', async () => {
    scratch()
    const h = await harness([0])
    try {
      // 两个请求**串行**：第一个把当前账号从 A 切到 B；第二个被拒的账号是 B
      // 吗？不是——第二个请求根本没失败，它直接用了健康的 B。
      // 这里要验的是**并发**：让两个请求都先撞上 A。
      const r1 = await run(h)
      console.log('  第 1 次:', JSON.stringify(r1))
      expect(r1).toMatchObject({ chunks: expect.any(Number) })
      // 健康账号 B 已被采用
      expect(h.hits.get('1')).toBeGreaterThanOrEqual(1)
      // 第三个账号 C 不该被用到：B 健康就不需要级联
      expect(h.hits.get('2') ?? 0).toBe(0)
    } finally { h.restore() }
  }, 60_000)

  it('并发 + 三个账号：健康账号不被跳过，C 完全不被触及', async () => {
    scratch()
    // 只 A 耗尽。若实现误把「当下 current」当被拒账号，两个并发请求会先切到 B、
    // 再有人把 B 当成「已失败」而排除 → 触碰 C。正确实现下 C 永远不该被命中。
    let arrival = 0
    const waiters: Array<() => void> = []
    const gate = (): Promise<void> => {
      arrival += 1
      if (arrival >= 2) { for (const w of waiters.splice(0)) w(); return Promise.resolve() }
      return new Promise<void>(r => { waiters.push(r) })
    }
    const h = await harness([0], gate)
    try {
      const [r1, r2] = await Promise.all([run(h), run(h)])
      console.log('  并发:', JSON.stringify(r1), JSON.stringify(r2))
      console.log('  各账号命中次数:', JSON.stringify(Object.fromEntries(h.hits)))
      expect(r1).toMatchObject({ chunks: expect.any(Number) })
      expect(r2).toMatchObject({ chunks: expect.any(Number) })
      // C（序号 2）是「更差的账号」：健康的 B 可用时**完全不该**被触及。
      expect(h.hits.get('2') ?? 0).toBe(0)
    } finally { h.restore() }
  }, 60_000)
})

/**
 * 并发保护依赖「宿主级单例」这个前提。
 *
 * `RunGuard` / `AccountLocks` 是**实例级**的（两个实例互不阻塞，见
 * `concurrency.spec.ts` 的用例）。它们之所以能挡住并发，是因为 `apply()` 每个
 * 进程只调用一次，所有会话共用同一个 `CodeBuddyAuthService` 实例——而不是因为
 * 原语本身是全局的。
 *
 * 一旦有人把 service 改成「按会话创建」，锁会**静默失效**：多会话又会同时切换
 * 账号，且没有任何报错。这条用例把这个前提钉在源码里，改坏了会立刻红。
 */
describe('并发保护的前提：宿主级单例', () => {
  it('apply() 只创建一份 session / auth service', () => {
    const index = readFileSync(srcPath('index.ts'), 'utf8')
    // 每个都只应 new 一次；出现两处说明有人在别的作用域又建了一份（锁即失效）。
    expect(index.match(/new CodeBuddySession\(/g) ?? []).toHaveLength(1)
    expect(index.match(/new CodeBuddyAuthService\(/g) ?? []).toHaveLength(1)
    // 两者都在 apply() 内创建（而不是模块顶层：顶层会在每次 import 时重建）
    const applyAt = index.indexOf('export async function apply(')
    expect(applyAt).toBeGreaterThan(-1)
    expect(index.indexOf('new CodeBuddySession(')).toBeGreaterThan(applyAt)
    expect(index.indexOf('new CodeBuddyAuthService(')).toBeGreaterThan(applyAt)
  })

  it('RunGuard 与 AccountLocks 是实例级（所以上面的前提必须成立）', async () => {
    const { RunGuard } = await import('../src/host/concurrency.ts')
    const a = new RunGuard('x')
    const b = new RunGuard('x')
    // 两个实例互不阻塞 —— 这正是「必须共用同一个 service」的原因。
    expect(a.tryAcquire()).toBeDefined()
    expect(b.tryAcquire()).toBeDefined()
  })
})

/**
 * 确定性复现「failedId 取错」导致的级联。
 *
 * 两个会话**并发**发出请求，都先打到耗尽的 A（用闸门保证两者都到齐）。然后：
 *
 *  - 会话 1 的 429 立刻返回 → 它把当前账号从 A 切到 B（健康）；
 *  - 会话 2 的 429 **挂住**，等当前账号确实不再是 A 之后才返回。
 *
 * 此时会话 2 的处境正是缺陷场景：它真正被拒的账号是 **A**（发出时用的就是 A），
 * 而它此刻重新读到的当前账号是 **B**。
 *
 *  - 旧实现传 `failedId = current.id = B`：B 被当成「已失败」排除 → 只剩 C →
 *    把一个健康账号换掉、切到更差的 C。而且 CAS 期望值 B 与实际相符，**会成功**
 *    ——所以这个缺陷不会被 CAS 分支掩盖，只有 failedId 正确才能避免。
 *  - 正确实现传冻结的「真凶 A」：决策看到健康的 B 可用 → 直接采用它重试；
 *    C 完全不被触及。
 *
 * 判据：**C 从未被请求过**。这是可证伪的——反转 failedId 就会变红。
 */
describe('确定性级联：失败响应晚于别人的切换', () => {
  it('不应把健康的当前账号换掉而级联到更差的 C', async () => {
    scratch()
    const h = await harness([0])
    try {
      const aId = h.ids[0]!
      let arrival = 0
      const waiters: Array<() => void> = []
      let firstQuotaDone = false
      const releaseSecond = (): void => { for (const w of waiters.splice(0)) w() }

      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (!url.includes('/chat/completions')) {
          return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
        }
        const hdrs = (init?.headers ?? {}) as Record<string, string>
        const bearer = String(hdrs.authorization ?? hdrs.Authorization ?? '').replace('Bearer ', '')
        const { loadStorage } = await import('../src/host/storage.ts')
        const stored = (await loadStorage())!.accounts
        const idx = stored.findIndex(e => e.auth.accessToken === bearer)
        h.hits.set(String(idx), (h.hits.get(String(idx)) ?? 0) + 1)

        if (idx !== 0) return ok()        // 非 A 账号一律成功
        arrival += 1
        if (arrival === 1) {
          // 会话 1：立刻失败，随后的切换会把当前账号变成 B
          firstQuotaDone = true
          releaseSecond()
          return quota()
        }
        // 会话 2：等会话 1 完成切换后再失败
        if (!firstQuotaDone) await new Promise<void>(r => { waiters.push(r) })
        for (let i = 0; i < 300; i += 1) {
          if (await h.activeIdNow() !== aId) return quota()
          await new Promise(r => setTimeout(r, 10))
        }
        return quota()
      }) as typeof fetch

      const [r1, r2] = await Promise.all([run(h), run(h)])
      console.log('  会话 1:', JSON.stringify(r1))
      console.log('  会话 2:', JSON.stringify(r2))
      console.log('  各账号命中次数:', JSON.stringify(Object.fromEntries(h.hits)))
      console.log('  最终当前账号序号:', h.ids.indexOf((await h.activeIdNow()) ?? ''))
      expect(r1).toMatchObject({ chunks: expect.any(Number) })
      expect(r2).toMatchObject({ chunks: expect.any(Number) })
      // 判据：更差的 C（序号 2）从未被触及。
      expect(h.hits.get('2') ?? 0).toBe(0)
    } finally { h.restore() }
  }, 60_000)
})
