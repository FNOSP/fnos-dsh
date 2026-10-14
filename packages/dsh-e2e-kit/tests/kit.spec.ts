import { describe, expect, it } from 'vitest'
import { samePage, selectTab, type BrowserTab } from '../src/tab-policy.ts'
import { actUntil } from '../src/verify.ts'
import { connectTarget } from '../src/connect.ts'
import { DEFAULT_BRIDGE_PORT, PORT_PROBE_LIMIT, findBridgePort } from '../src/env.ts'

/**
 * 共享测试装配层的行为约束。
 *
 * 这些断言都对应**实测踩过的坑**（FNOS-013 的 BUG-03/BUG-05 与标签页纪律），
 * 不是实现细节——改动它们意味着重新引入那些坑。
 */

describe('samePage：同源同路径视为同一页', () => {
  it('忽略查询串差异（DSH Web 的 ?token= 会随重启变化）', () => {
    // 若按完整 URL 比较，token 变化后复用会失效、每次测试都新开页（实测确认）。
    expect(samePage('http://127.0.0.1:8070/?token=aaa', 'http://127.0.0.1:8070/?token=bbb')).toBe(true)
    expect(samePage('http://127.0.0.1:8070/?token=aaa', 'http://127.0.0.1:8070/')).toBe(true)
  })

  it('不同路径不算同一页', () => {
    expect(samePage('http://127.0.0.1:8070/settings', 'http://127.0.0.1:8070/')).toBe(false)
  })

  it('不同端口/主机不算同一页', () => {
    expect(samePage('http://127.0.0.1:8070/', 'http://127.0.0.1:8080/')).toBe(false)
    expect(samePage('http://127.0.0.1:8070/', 'http://localhost:8070/')).toBe(false)
  })

  it('无法解析的 URL 退化为字面比较（不误判为可复用）', () => {
    expect(samePage('about:blank', 'http://127.0.0.1:8070/')).toBe(false)
    expect(samePage('about:blank', 'about:blank')).toBe(true)
  })
})

describe('selectTab：先查后复用的选择顺序', () => {
  const target = 'http://127.0.0.1:8070/?token=new'

  it('已打开目标页 → 绑它（不新开）', () => {
    const tabs: BrowserTab[] = [
      { id: '1', url: 'https://example.com/' },
      { id: '2', url: 'http://127.0.0.1:8070/?token=old' },
    ]
    expect(selectTab(tabs, target)).toEqual({ reuseTabId: '2', reason: 'existing' })
  })

  it('当前活动页即目标页 → 复用（reason=active）', () => {
    const tabs: BrowserTab[] = [{ id: '9', url: 'http://127.0.0.1:8070/', currentActiveTab: true }]
    expect(selectTab(tabs, target)).toEqual({ reuseTabId: '9', reason: 'active' })
  })

  it('目标是别的已开页（非活动）→ reason=existing（与 active 区分）', () => {
    const tabs: BrowserTab[] = [
      { id: '1', url: 'https://example.com/', currentActiveTab: true },
      { id: '2', url: 'http://127.0.0.1:8070/?token=x' },
    ]
    expect(selectTab(tabs, target)).toEqual({ reuseTabId: '2', reason: 'existing' })
  })

  it('都没有 → 需要新开（reuseTabId 为 undefined）', () => {
    const tabs: BrowserTab[] = [{ id: '1', url: 'https://example.com/' }]
    expect(selectTab(tabs, target)).toEqual({ reuseTabId: undefined, reason: 'new' })
  })

  it('空列表 → 新开', () => {
    expect(selectTab([], target).reason).toBe('new')
  })
})

describe('actUntil：不采信 act 自述', () => {
  it('第一次就生效 → 只尝试一次', async () => {
    let calls = 0
    const result = await actUntil({
      act: async () => { calls += 1; return '已点击' },
      check: async () => true,
      label: 'x',
      settleMs: 0,
      log: () => {},
    })
    expect(result).toEqual({ ok: true, attempts: 1, said: ['已点击'] })
    expect(calls).toBe(1)
  })

  it('第一次未生效、第二次生效 → 重试一次后通过', async () => {
    // 这是实测遇到的真实情形：点击坐标落在按钮内，但目标行为未发生。
    let checks = 0
    const result = await actUntil({
      act: async () => '已成功点击',
      check: async () => { checks += 1; return checks > 1 },
      label: 'x',
      settleMs: 0,
      log: () => {},
    })
    expect(result.ok).toBe(true)
    expect(result.attempts).toBe(2)
  })

  it('始终未生效 → 报告失败（不返回成功）', async () => {
    const result = await actUntil({
      act: async () => '已成功点击',
      check: async () => false,
      label: 'x',
      retries: 1,
      settleMs: 0,
      log: () => {},
    })
    expect(result.ok).toBe(false)
    expect(result.attempts).toBe(2)
  })

  it('保留每次的自述便于诊断（自述与结果可能不一致）', async () => {
    const result = await actUntil({
      act: async () => '已成功点击左侧边栏的插件菜单项',
      check: async () => false,
      label: 'x',
      settleMs: 0,
      log: () => {},
    })
    expect(result.said[0]).toContain('已成功点击')
    expect(result.ok).toBe(false)
  })
})

describe('findBridgePort：端口自动探测', () => {
  it('探测不到服务时返回 undefined（不抛错，由调用方决定提示）', async () => {
    // 用一个极不可能有服务的区间，避免依赖真实环境。
    const port = await findBridgePort({ from: 59990, limit: 3 })
    expect(port).toBeUndefined()
  })

  it('默认起点与探测上限有明确常量（与插件一致）', () => {
    expect(DEFAULT_BRIDGE_PORT).toBe(8787)
    expect(PORT_PROBE_LIMIT).toBe(20)
  })
})

describe('僵尸页面的判定（复用页失效时的降级依据）', () => {
  // 实测背景：实例重启后遗留的页会被浏览器冻结/丢弃，此时任何 evaluateJavaScript
  // 都会挂到 Midscene 自身的 30s 超时，把整轮测试拖垮（3 个用例全部 not run）。
  // 共享包据此在 setup 里先探活、不可用就换一个新页。
  it('首页导航会保留查询串：token 必须传给目标页', () => {
    const target = 'http://127.0.0.1:8070/?token=abc'
    const url = new URL(target)
    expect(url.searchParams.get('token')).toBe('abc')
  })

  it('samePage 在 token 变化后仍判定为同一页（避免重复开页）', () => {
    expect(samePage('http://127.0.0.1:8070/?token=old', 'http://127.0.0.1:8070/?token=new')).toBe(true)
  })
})

describe('connectTarget：探测脚本也必须复用（治理漏洞的堵法）', () => {
  /** 造一个假的 Agent，记录它被调用了哪些方法。 */
  const fakeAgent = (tabs: readonly { id: string, url?: string, currentActiveTab?: boolean }[]) => {
    const calls: string[] = []
    return {
      calls,
      agent: {
        getBrowserTabList: async () => tabs,
        setActiveTabId: async (id: string) => { calls.push(`setActiveTabId:${id}`) },
        connectCurrentTab: async () => { calls.push('connectCurrentTab') },
        connectNewTabWithUrl: async (url: string) => { calls.push(`connectNewTabWithUrl:${url}`) },
      } as never,
    }
  }

  it('目标页已打开 → 绑它，绝不新开', async () => {
    const { agent, calls } = fakeAgent([{ id: '9', url: 'http://127.0.0.1:8070/?token=old' }])
    const result = await connectTarget(agent, 'http://127.0.0.1:8070/?token=new')
    expect(result).toMatchObject({ reused: true, tabId: '9', reason: 'existing' })
    expect(calls).toEqual(['setActiveTabId:9'])
    // 关键：没有任何新开页的调用。
    expect(calls.some(c => c.startsWith('connectNewTabWithUrl'))).toBe(false)
  })

  it('目标页没打开 → 才新开（并报告 reused=false）', async () => {
    const { agent, calls } = fakeAgent([{ id: '1', url: 'https://example.com/' }])
    const result = await connectTarget(agent, 'http://127.0.0.1:8070/')
    expect(result.reused).toBe(false)
    expect(calls.some(c => c.startsWith('connectNewTabWithUrl'))).toBe(true)
  })

  it('allowNewTab=false 时目标页不存在就报错（用于「只许复用」的场景）', async () => {
    const { agent, calls } = fakeAgent([])
    await expect(connectTarget(agent, 'http://127.0.0.1:8070/', { allowNewTab: false }))
      .rejects.toThrow(/不允许新开/u)
    expect(calls).toEqual([])
  })

  it('复用判定忽略查询串（DSH Web 的 token 会随重启变化）', async () => {
    const { agent } = fakeAgent([{ id: '7', url: 'http://127.0.0.1:8070/' }])
    const result = await connectTarget(agent, 'http://127.0.0.1:8070/?token=brand-new')
    expect(result.reused).toBe(true)
  })
})

describe('connectTarget 的 activate 选项（静默绑定，不抢前台）', () => {
  /** 假 Agent：page 代理与顶层方法分别记录，用来区分两条调用路径。 */
  const fakeAgent = (tabs: readonly { id: string, url?: string, currentActiveTab?: boolean }[]) => {
    const top: string[] = []
    const viaPage: string[] = []
    return {
      top,
      viaPage,
      agent: {
        getBrowserTabList: async () => tabs,
        setActiveTabId: async (id: string) => { top.push(`top:setActiveTabId:${id}`) },
        connectCurrentTab: async () => { top.push('top:connectCurrentTab') },
        connectNewTabWithUrl: async (url: string, o?: unknown) => {
          top.push(`top:connectNewTabWithUrl:${url}:${JSON.stringify(o ?? null)}`)
        },
        page: {
          setActiveTabId: async (id: unknown, o?: unknown) => {
            viaPage.push(`page:setActiveTabId:${String(id)}:${JSON.stringify(o ?? null)}`)
          },
        },
      } as never,
    }
  }

  it('默认（activate 省略）走顶层包装，保持既有行为', async () => {
    const { agent, top, viaPage } = fakeAgent([{ id: '9', url: 'http://127.0.0.1:8070/' }])
    const r = await connectTarget(agent, 'http://127.0.0.1:8070/')
    expect(r.reused).toBe(true)
    expect(top).toEqual(['top:setActiveTabId:9'])
    // 未走 page 代理，说明没改变默认路径。
    expect(viaPage).toEqual([])
  })

  it('activate:false 走 page 代理并带 {activate:false}，且 tabId 必须是数字', async () => {
    const { agent, top, viaPage } = fakeAgent([{ id: '9', url: 'http://127.0.0.1:8070/' }])
    const r = await connectTarget(agent, 'http://127.0.0.1:8070/', { activate: false })
    expect(r.reused).toBe(true)
    // 关键：不经顶层包装（那会丢掉第二个参数），而是经 page 代理。
    expect(top).toEqual([])
    // 关键：id 传数字。传字符串会让浏览器侧存下字符串 tabId，
    // 后续所有调用报 `expected integer, found string`。
    expect(viaPage).toEqual(['page:setActiveTabId:9:{"activate":false}'])
  })

  it('新开页时把 activateTab 透传给底层', async () => {
    const { agent, top } = fakeAgent([])
    await connectTarget(agent, 'http://127.0.0.1:8070/', { activate: false })
    expect(top.some(c => c.includes('"activateTab":false'))).toBe(true)
  })
})

describe('defineBridgeSetup 默认静默（不抢用户前台）', () => {
  // 这条盯住「默认值」这个易错点：`connectTarget` 自身的缺省是 true
  // （保持其独立调用者既有行为），若 defineBridgeSetup 也把 undefined 透传下去，
  // 就会静默变成「切前台」——注释写着默认静默、行为却在打断用户。实测踩过：
  // 一次 e2e 运行把用户正在看的 NAS 页面抢到前台。
  //
  // defineBridgeSetup 内部 new AgentOverChromeBridge()，无法注入替身，因此这里用
  // 源码契约断言：静默默认必须是显式的 `?? false`，而不是依赖上游缺省。
  it('源码里静默默认是显式的 activate ?? false（不是靠不传）', async () => {
    const { readFile } = await import('node:fs/promises')
    const src = await readFile(new URL('../src/project.ts', import.meta.url), 'utf8')
    // 绑定复用页：必须显式传 activate，且默认落在 false。
    expect(src).toMatch(/activate:\s*options\.activate\s*\?\?\s*false/)
    // 僵尸页兜底新开页同样不能抢前台。
    expect(src).toMatch(/activateTab:\s*options\.activate\s*\?\?\s*false/)
    // 反向断言：不得出现「透传 undefined 靠上游缺省」的写法。
    expect(src).not.toMatch(/options\.activate === undefined \? \{\} : \{ activate: options\.activate \}/)
  })
})

describe('assertInPage：让页面内精确判定真正能失败', () => {
  // 这组测试盯住一个会造成**假阳性**的事实：Midscene 的 `javascript` 步骤无法让用例
  // 失败——它底层是 CDP `Runtime.evaluate`，页面异常被放在 `exceptionDetails` 里返回，
  // 而 Midscene 不检查该字段（实测：throw / Promise.reject / 语法错误三种都被吞）。
  // 所以把 `javascript` 当断言用会得到「全绿但什么都没校验」。
  const makeContext = (raw: unknown) => ({ agent: { evaluateJavaScript: async () => raw } }) as never

  it('判定成立时通过，并把 detail 记进摘要', async () => {
    const { assertInPage } = await import('../src/assert-node.ts')
    const result = await assertInPage.execute({
      input: { label: '探针', script: 'ignored' },
      context: makeContext({ result: { value: JSON.stringify({ ok: true, verdict: { pass: true, detail: '四项齐备' } }) } }),
    } as never)
    // execute 的返回类型是 `void | NodeResult`，这里断言的是实际实现必返回结果。
    expect((result as { data: unknown }).data).toEqual({ passed: true, detail: '四项齐备' })
  })

  it('判定不成立时抛错（这是 javascript 步骤做不到的）', async () => {
    const { assertInPage } = await import('../src/assert-node.ts')
    await expect(assertInPage.execute({
      input: { label: '模块图', script: 'ignored' },
      context: makeContext({ result: { value: JSON.stringify({ ok: true, verdict: { pass: false, detail: '仍含 dsh-midscene' } }) } }),
    } as never)).rejects.toThrow(/模块图.*仍含 dsh-midscene/)
  })

  it('页面内异常会被识别为失败，而不是当成通过', async () => {
    const { assertInPage } = await import('../src/assert-node.ts')
    await expect(assertInPage.execute({
      input: { label: '脚本异常', script: 'ignored' },
      context: makeContext({ result: { value: JSON.stringify({ ok: false, message: 'boom' }) } }),
    } as never)).rejects.toThrow(/脚本异常.*boom/)
  })

  it('CDP 抛出的页面异常（包装层之外的语法错误）也会失败', async () => {
    const { assertInPage } = await import('../src/assert-node.ts')
    await expect(assertInPage.execute({
      input: { label: '语法错误', script: 'ignored' },
      context: makeContext({ exceptionDetails: { exception: { description: 'SyntaxError: bad' } } }),
    } as never)).rejects.toThrow(/语法错误.*SyntaxError/)
  })

  it('脚本返回非约定形态时报错，不静默放过', async () => {
    const { assertInPage } = await import('../src/assert-node.ts')
    await expect(assertInPage.execute({
      input: { label: '形态错误', script: 'ignored' },
      context: makeContext({ result: { value: JSON.stringify({ ok: true, verdict: '随便一个字符串' }) } }),
    } as never)).rejects.toThrow(/必须返回/)
  })

  it('回传非 JSON 时报错（说明页面侧没按约定包装）', async () => {
    const { assertInPage } = await import('../src/assert-node.ts')
    await expect(assertInPage.execute({
      input: { label: '非 JSON', script: 'ignored' },
      context: makeContext({ result: { value: 'not-json' } }),
    } as never)).rejects.toThrow(/不是合法 JSON/)
  })
})

describe('page-script：页面脚本的回传约定', () => {
  const envelope = (value: unknown) => ({ result: { value } })

  it('包装后能取回 JSON 判定（对象经 JSON.stringify 回传）', async () => {
    const { wrapPageScript, readPageVerdict } = await import('../src/page-script.ts')
    const wrapped = wrapPageScript('(() => ({ pass: true, detail: "ok" }))()')
    // 包装必须含 JSON.stringify —— CDP 默认不序列化返回值（只回 objectId 句柄）。
    expect(wrapped).toContain('JSON.stringify')
    const verdict = readPageVerdict(
      envelope(JSON.stringify({ ok: true, verdict: { pass: true, detail: 'ok' } })), 't',
    )
    expect(verdict).toEqual({ pass: true, detail: 'ok' })
  })

  it('页面内异常被识别为失败（而不是当成通过）', async () => {
    const { readPageVerdict } = await import('../src/page-script.ts')
    expect(() => readPageVerdict(
      envelope(JSON.stringify({ ok: false, message: 'boom' })), 't',
    )).toThrow(/boom/)
  })

  it('CDP 的 exceptionDetails 会被检查（包装层之外的语法错误）', async () => {
    const { readPageVerdict } = await import('../src/page-script.ts')
    expect(() => readPageVerdict(
      { exceptionDetails: { exception: { description: 'SyntaxError: x' } } }, 't',
    )).toThrow(/SyntaxError/)
  })

  it('非约定形态报错而非静默放过', async () => {
    const { readPageVerdict } = await import('../src/page-script.ts')
    expect(() => readPageVerdict(envelope(JSON.stringify({ ok: true, verdict: 'str' })), 't'))
      .toThrow(/必须返回/)
    expect(() => readPageVerdict(envelope('not-json'), 't')).toThrow(/不是合法 JSON/)
    expect(() => readPageVerdict(envelope(123), 't')).toThrow(/未回传字符串/)
  })
})

describe('clickInPage：小控件按选择器点击', () => {
  const context = (responses: unknown[]) => {
    let i = 0
    return {
      agent: { evaluateJavaScript: async () => responses[Math.min(i++, responses.length - 1)] },
    } as never
  }
  const ok = (verdict: unknown) => ({ result: { value: JSON.stringify({ ok: true, verdict }) } })

  it('选择器未命中时明确报错（不静默通过）', async () => {
    const { clickInPage } = await import('../src/click-node.ts')
    await expect(clickInPage.execute({
      input: { label: '点按钮', selector: '.nope' },
      context: context([ok({ pass: false, detail: '选择器未命中任何元素：.nope' })]),
    } as never)).rejects.toThrow(/无法点击.*未命中/)
  })

  it('点击后核实生效则成功', async () => {
    const { clickInPage } = await import('../src/click-node.ts')
    const result = await clickInPage.execute({
      input: { label: '点按钮', selector: '.pill', check: 'ignored', settleMs: 0 },
      context: context([ok({ pass: true }), ok({ pass: true, detail: 'aria-pressed=false' })]),
    } as never)
    expect((result as { data: { attempts: number } }).data.attempts).toBe(1)
  })

  it('点击未生效会重试，全部失败后报错并指出真因（不是含糊的断言失败）', async () => {
    const { clickInPage } = await import('../src/click-node.ts')
    await expect(clickInPage.execute({
      input: { label: '点按钮', selector: '.pill', check: 'ignored', retries: 1, settleMs: 0 },
      context: context([
        ok({ pass: true }), ok({ pass: false, detail: 'aria-pressed=true' }),
        ok({ pass: true }), ok({ pass: false, detail: 'aria-pressed=true' }),
      ]),
    } as never)).rejects.toThrow(/核实仍未通过/)
  })
})

describe('actUntil：交互 + 核实 + 重试（BUG-03 规避）', () => {
  it('交互未生效时重试，最终生效即成功', async () => {
    const { actUntil: actNode } = await import('../src/act-node.ts')
    let calls = 0
    const ctx = {
      agent: {
        aiAct: async () => { calls += 1; return '已点击' },
        evaluateJavaScript: async () => ({
          // 第一次核实失败，第二次成功
          result: { value: JSON.stringify({ ok: true, verdict: { pass: calls > 1, detail: `pressed=${calls > 1}` } }) },
        }),
      },
    } as never
    const result = await actNode.execute({
      input: { label: '切换', act: '点一下', check: 'ignored', retries: 1, settleMs: 0 },
      context: ctx,
    } as never)
    expect((result as { data: { attempts: number } }).data.attempts).toBe(2)
  })

  it('重试用尽后报错，并说明是点击可靠性问题（不冒充功能缺陷）', async () => {
    const { actUntil: actNode } = await import('../src/act-node.ts')
    const ctx = {
      agent: {
        aiAct: async () => '已成功点击按钮',
        evaluateJavaScript: async () => ({
          result: { value: JSON.stringify({ ok: true, verdict: { pass: false, detail: 'aria-pressed=true' } }) },
        }),
      },
    } as never
    await expect(actNode.execute({
      input: { label: '切换', act: '点一下', check: 'ignored', retries: 1, settleMs: 0 },
      context: ctx,
    } as never)).rejects.toThrow(/点击可靠性问题.*BUG-03/s)
  })
})

describe('selectTab 在重复标签页中选页', () => {
  // 实测踩到：三个同 URL 标签里有一个停在登录页，而 `find()` 恰好取到它，于是
  // 「已登录」的测试被绑到登录页，用例报「当前显示的是登录页面」——诊断对但指向不了
  // 真因（选页选错了）。规则改为「优先当前活动页」。
  const TAB = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    url: 'http://192.168.0.110:5666/',
    ...extra,
  })

  it('有多个同 URL 标签时，优先选当前活动的那一个', async () => {
    const { selectTab } = await import('../src/tab-policy.ts')
    const result = selectTab([
      TAB('1'),
      TAB('2'),
      TAB('3', { currentActiveTab: true }),
    ], 'http://192.168.0.110:5666/')
    expect(result.reuseTabId).toBe('3')
    expect(result.reason).toBe('active')
  })

  it('没有活动页时退回列表顺序第一个（保持既有行为）', async () => {
    const { selectTab } = await import('../src/tab-policy.ts')
    const result = selectTab([TAB('1'), TAB('2')], 'http://192.168.0.110:5666/')
    expect(result.reuseTabId).toBe('1')
    expect(result.reason).toBe('existing')
  })

  it('无视查询串差异（token 会随实例重启变化）', async () => {
    const { selectTab } = await import('../src/tab-policy.ts')
    const result = selectTab([
      { id: '9', url: 'http://127.0.0.1:8070/?token=old', currentActiveTab: true },
    ], 'http://127.0.0.1:8070/?token=new')
    expect(result.reuseTabId).toBe('9')
  })
})

describe('禁止清除被测站点的会话数据（用户真实环境）', () => {
  // 被测页面是**用户正在使用的真实环境**，不是一次性沙箱。清掉登录 Cookie 会把用户
  // 从 NAS 上登出——实测发生过一次：测试运行后浏览器停在 fnOS 登录页，后续用例全部报
  // 「当前显示的是登录页面」，需要用户手动重新登录才能继续。
  //
  // 这条守卫扫描仓库内的测试代码与共享装配层，防止后来者顺手加一句
  // `localStorage.clear()` 之类的清理。
  const FORBIDDEN: Array<{ pattern: RegExp, why: string }> = [
    { pattern: /localStorage\.clear\s*\(/, why: 'localStorage.clear()' },
    { pattern: /sessionStorage\.clear\s*\(/, why: 'sessionStorage.clear()' },
    { pattern: /localStorage\.removeItem\s*\(/, why: 'localStorage.removeItem()' },
    { pattern: /sessionStorage\.removeItem\s*\(/, why: 'sessionStorage.removeItem()' },
    { pattern: /document\.cookie\s*=/, why: '改写 document.cookie' },
    { pattern: /clearBrowserCookies|clearDataForOrigin|clearBrowsingData/, why: 'CDP 清除浏览数据' },
  ]

  it('共享装配层与各测试用例中不含清除站点数据的调用', async () => {
    const { readdir, readFile } = await import('node:fs/promises')
    const { join } = await import('node:path')

    const roots = [
      new URL('../src', import.meta.url),
      new URL('../../../apps/fn-deepseek-harness/tests', import.meta.url),
      new URL('../../../plugins/dsh-codebuddy-plugin/tests', import.meta.url),
      new URL('../../../plugins/dsh-midscene-plugin/tests', import.meta.url),
      new URL('../../../plugins/dsh-failover-search-plugin/tests', import.meta.url),
    ]

    const offenders: string[] = []
    const walk = async (dir: string): Promise<void> => {
      let entries: Array<{ name: string, isDirectory: () => boolean }>
      try {
        entries = await readdir(dir, { withFileTypes: true }) as never
      } catch {
        return // 目录不存在（例如某插件尚未加 e2e）不是失败。
      }
      for (const entry of entries) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          // 生成物与依赖不扫：它们不是我们编写的代码。
          if (['node_modules', 'midscene_run', '.midscene', 'lib', 'dist'].includes(entry.name)) continue
          await walk(full)
          continue
        }
        if (!/\.(?:ts|tsx|mts|yaml|yml|mjs)$/.test(entry.name)) continue
        const text = await readFile(full, 'utf8')
        for (const { pattern, why } of FORBIDDEN) {
          if (pattern.test(text)) offenders.push(`${full.replace(process.cwd(), '.')} → ${why}`)
        }
      }
    }
    for (const root of roots) await walk(root.pathname)

    expect(offenders, `发现清除站点会话数据的调用（会登出用户）：\n${offenders.join('\n')}`).toEqual([])
  })
})
