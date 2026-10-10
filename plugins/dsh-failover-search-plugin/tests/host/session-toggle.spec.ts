import { describe, expect, it } from 'vitest'
import { FailoverSearchProvider } from '../../src/host/failover-provider.ts'
import { SessionToggleStore, shouldBypassFailover, TOGGLE_DEFAULT_ENABLED, activeSessionEnabled, runWithSession, shouldBypassActiveSession } from '../../src/host/session-toggle.ts'

describe('FNOS-010-12 会话级开关状态store', () => {
  it('默认开启（AC-01：全新会话首次使用的默认状态）', () => {
    const store = new SessionToggleStore()
    expect(TOGGLE_DEFAULT_ENABLED).toBe(true)
    expect(store.isEnabled('session-a')).toBe(true)
    expect(store.isEnabled('从未出现过的会话')).toBe(true)
  })

  it('按会话独立：A 关闭不影响 B（AC-04）', () => {
    const store = new SessionToggleStore()
    store.setEnabled('session-a', false)

    expect(store.isEnabled('session-a')).toBe(false)
    expect(store.isEnabled('session-b')).toBe(true)
    expect(store.isEnabled('session-c')).toBe(true)
  })

  it('切换可来回（关闭后再开启）', () => {
    const store = new SessionToggleStore()
    store.setEnabled('s', false)
    expect(store.isEnabled('s')).toBe(false)
    store.setEnabled('s', true)
    expect(store.isEnabled('s')).toBe(true)
  })

  it('重复设置同一会话为同值不产生额外副作用', () => {
    const store = new SessionToggleStore()
    store.setEnabled('s', false)
    store.setEnabled('s', false)
    expect(store.isEnabled('s')).toBe(false)
  })

  it('清除某会话状态后回到默认值（会话结束后不留状态）', () => {
    const store = new SessionToggleStore()
    store.setEnabled('s', false)
    store.clear('s')
    expect(store.isEnabled('s')).toBe(true)
  })

  it('订阅者只在状态真正变化时收到通知（防跨会话串扰的重复渲染）', () => {
    const store = new SessionToggleStore()
    const seen: string[] = []
    store.subscribe((sessionId, enabled) => seen.push(`${sessionId}:${enabled}`))

    store.setEnabled('a', false)
    store.setEnabled('a', false) // 同值，不应重复通知
    store.setEnabled('b', false)
    store.setEnabled('a', true)

    expect(seen).toEqual(['a:false', 'b:false', 'a:true'])
  })

  it('取消订阅后不再收到通知', () => {
    const store = new SessionToggleStore()
    let count = 0
    const unsubscribe = store.subscribe(() => { count += 1 })
    store.setEnabled('a', false)
    unsubscribe()
    store.setEnabled('b', false)
    expect(count).toBe(1)
  })
})

describe('FNOS-010-12 门控判定', () => {
  it('开关开启：不绕过（走本插件，与引入前一致，AC-02）', () => {
    expect(shouldBypassFailover(true)).toBe(false)
  })

  it('开关关闭：绕过（该会话不接入本插件，AC-03）', () => {
    expect(shouldBypassFailover(false)).toBe(true)
  })

  it('无会话身份时按默认开启处理（不意外绕过，AC-01）', () => {
    const store = new SessionToggleStore()
    // 后台任务、无 agent 的调用：保守地不绕过，避免静默丢失三方能力。
    expect(shouldBypassFailover(store.isEnabled(undefined))).toBe(false)
  })
})

describe('FNOS-010-12 门控上下文的传递（AsyncLocalStorage）', () => {
  it('在 runWith 作用域内读到该会话状态，作用域外回到默认', () => {
    const store = new SessionToggleStore()
    store.setEnabled('a', false)

    expect(activeSessionEnabled(store)).toBe(true) // 作用域外：默认
    runWithSession('a', store, () => {
      expect(activeSessionEnabled(store)).toBe(false)
    })
    runWithSession('b', store, () => {
      expect(activeSessionEnabled(store)).toBe(true)
    })
    expect(activeSessionEnabled(store)).toBe(true)
  })

  it('异步边界内仍能读到状态（provider 内部 await 之后仍有效）', async () => {
    const store = new SessionToggleStore()
    store.setEnabled('a', false)

    await runWithSession('a', store, async () => {
      await new Promise(resolve => setTimeout(resolve, 5))
      expect(activeSessionEnabled(store)).toBe(false)
      await Promise.resolve()
      expect(activeSessionEnabled(store)).toBe(false)
    })
  })

  it('嵌套作用域以最内层为准', () => {
    const store = new SessionToggleStore()
    store.setEnabled('a', false)
    store.setEnabled('b', true)

    runWithSession('a', store, () => {
      expect(activeSessionEnabled(store)).toBe(false)
      runWithSession('b', store, () => {
        expect(activeSessionEnabled(store)).toBe(true)
      })
      expect(activeSessionEnabled(store)).toBe(false)
    })
  })

  it('无会话身份时不误判为关闭（保守地不绕过）', () => {
    const store = new SessionToggleStore()
    runWithSession(undefined, store, () => {
      expect(activeSessionEnabled(store)).toBe(true)
    })
  })
})

describe('FNOS-010-12 门控与 provider 的配合（AC-03 核心）', () => {
  it('关闭时判定为绕过：三方适配器零调用（配额零消耗）', async () => {
    const store = new SessionToggleStore()
    store.setEnabled('sess-off', false)
    let tinyfishCalls = 0
    let officialCalls = 0

    const provider = new FailoverSearchProvider({
      readSettings: () => ({
        tinyfishAccounts: [{ key: 'sk-t', label: 'tinyfish-1' }],
        tavilyAccounts: [],
        sourceOrder: ['tinyfish', 'tavily', 'deepseek-official'],
        timeoutMs: 15000,
        samePlatformRetry: true,
        usageRefreshMinutes: 5,
        requestProbe: true,
      }) as never,
      adapters: {
        tinyfish: [{
          platform: 'tinyfish',
          search: async () => { tinyfishCalls += 1; return { sources: [{ url: 'https://tf.example' }], truncated: false } },
        } as never],
        tavily: [],
      },
      official: {
        id: 'deepseek-official',
        available: () => true,
        search: async () => { officialCalls += 1; return { sources: [{ url: 'https://official.example' }], truncated: false } },
      },
      usage: { snapshot: () => [], isFresh: () => true, locallyLimited: () => false },
      onAttempt: () => {},
      // 门控：关闭该会话时强制只走官方。
      shouldBypass: () => shouldBypassActiveSession(store),
    })

    const result = await runWithSession('sess-off', store, () => provider.search({ query: 'x' }))

    expect(result.sources[0]?.url).toBe('https://official.example')
    expect(tinyfishCalls).toBe(0) // AC-03：三方零调用
    expect(officialCalls).toBe(1)
  })

  it('开启时行为与引入前一致（走三方，AC-02 基线）', async () => {
    const store = new SessionToggleStore() // 默认开启
    let tinyfishCalls = 0
    let officialCalls = 0

    const provider = new FailoverSearchProvider({
      readSettings: () => ({
        tinyfishAccounts: [{ key: 'sk-t', label: 'tinyfish-1' }],
        tavilyAccounts: [],
        sourceOrder: ['tinyfish', 'tavily', 'deepseek-official'],
        timeoutMs: 15000,
        samePlatformRetry: true,
        usageRefreshMinutes: 5,
        requestProbe: true,
      }) as never,
      adapters: {
        tinyfish: [{
          platform: 'tinyfish',
          search: async () => { tinyfishCalls += 1; return { sources: [{ url: 'https://tf.example' }], truncated: false } },
        } as never],
        tavily: [],
      },
      official: {
        id: 'deepseek-official',
        available: () => true,
        search: async () => { officialCalls += 1; return { sources: [{ url: 'https://official.example' }], truncated: false } },
      },
      usage: { snapshot: () => [], isFresh: () => true, locallyLimited: () => false },
      onAttempt: () => {},
      shouldBypass: () => shouldBypassActiveSession(store),
    })

    const result = await runWithSession('sess-on', store, () => provider.search({ query: 'x' }))

    expect(result.sources[0]?.url).toBe('https://tf.example')
    expect(tinyfishCalls).toBe(1)
    expect(officialCalls).toBe(0)
  })

  it('无门控回调时行为不变（向后兼容，不破坏既有测试）', async () => {
    let tinyfishCalls = 0
    const provider = new FailoverSearchProvider({
      readSettings: () => ({
        tinyfishAccounts: [{ key: 'sk-t', label: 'tinyfish-1' }],
        tavilyAccounts: [],
        sourceOrder: ['tinyfish', 'tavily', 'deepseek-official'],
        timeoutMs: 15000,
        samePlatformRetry: true,
        usageRefreshMinutes: 5,
        requestProbe: true,
      }) as never,
      adapters: {
        tinyfish: [{
          platform: 'tinyfish',
          search: async () => { tinyfishCalls += 1; return { sources: [{ url: 'https://tf.example' }], truncated: false } },
        } as never],
        tavily: [],
      },
      official: { id: 'deepseek-official', available: () => true, search: async () => ({ sources: [], truncated: false }) },
      usage: { snapshot: () => [], isFresh: () => true, locallyLimited: () => false },
      onAttempt: () => {},
    })

    await provider.search({ query: 'x' })
    expect(tinyfishCalls).toBe(1)
  })
})

describe('FNOS-010-12 宿主接线契约（防回归）', () => {
  it('插件声明 tools 依赖——否则 tools/pre-execute 订阅不生效、门控静默失效', async () => {
    const source = await import('node:fs/promises')
      .then(fs => fs.readFile(new URL('../../src/index.ts', import.meta.url), 'utf8'))

    // 真实缺陷：inject 只有 ['web'] 时，开关关闭但三方仍被调用（Cordis 按 inject
    // 门控服务与其事件）。这条断言防止该缺陷再次出现。
    const match = /export const inject = \[([^\]]*)\]/u.exec(source)
    expect(match).not.toBeNull()
    const declared = (match?.[1] ?? '').split(',').map(entry => entry.trim().replaceAll("'", ''))
    expect(declared).toContain('tools')
    expect(declared).toContain('web')
  })

  it('门控挂在 tools/execute（而非 pre-execute）并把会话身份放进作用域', async () => {
    const source = await import('node:fs/promises')
      .then(fs => fs.readFile(new URL('../../src/index.ts', import.meta.url), 'utf8'))

    // 必须是 tools/execute：它是 around-dispatch 水位钩子，`next()` 就是派发动作，
    // 包住 next() 的作用域才覆盖得到工具执行。`tools/pre-execute` 只返回决定、注册表
    // 之后另起调用链派发，作用域会丢失——实测过「钩子读到关闭、provider 读到开启」。
    expect(source).toContain("ctx.on('tools/execute'")
    expect(source).not.toContain("ctx.on('tools/pre-execute'")
    expect(source).toMatch(/runWithSession\(/u)
    // 只包装网页工具，其余调用原样放行（不做无谓包装）。
    expect(source).toMatch(/web_search/u)
    expect(source).toMatch(/web_fetch/u)
  })

  it('两个 provider 都挂了门控（搜索与抓取都受开关控制）', async () => {
    const source = await import('node:fs/promises')
      .then(fs => fs.readFile(new URL('../../src/index.ts', import.meta.url), 'utf8'))

    const bypassRefs = source.match(/shouldBypass: \(\) => shouldBypassActiveSession\(toggle\)/gu) ?? []
    expect(bypassRefs.length).toBe(2)
  })
})
