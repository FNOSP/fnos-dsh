import { describe, expect, it } from 'vitest'
import { samePage, selectTab, type BrowserTab } from '../src/tab-policy.ts'
import { actUntil } from '../src/verify.ts'
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
