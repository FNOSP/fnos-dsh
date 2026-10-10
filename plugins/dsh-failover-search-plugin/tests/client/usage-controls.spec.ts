import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { refreshButtonState } from '../../src/client/usage-view.ts'

/** 读取用量区块源码（运行时解析路径，不写死本机绝对路径）。 */
async function readUsageSection(): Promise<string> {
  return await readFile(new URL('../../src/client/usage-section.tsx', import.meta.url), 'utf8')
}

describe('FNOS-010-08-AC-05 用量区块交互控件清单', () => {
  it('区块必须提供手动刷新入口（本次遗漏的控件）', async () => {
    const source = await readUsageSection()

    // 用户反馈「刷新按钮功能丢失」的回归点：该入口此前从未实现，
    // 用例只断言了数据呈现，没有断言控件存在——这里把控件钉死。
    expect(source).toMatch(/RefreshButton|onRefresh/u)
    expect(source).toContain('dsh-failover-usage__refresh')
  })

  it('刷新入口带可访问名称（不是纯图标按钮）', async () => {
    const source = await readUsageSection()

    // 可访问名称取自动态文案键（空闲 `refresh` / 刷新中 `refreshing`）。
    expect(source).toMatch(/aria-label=\{t\(view\.labelKey\)\}/u)
    // 两个文案键都必须在 locale 里存在，否则可访问名称会退化成空串。
    const locales = await readFile(new URL('../../src/client/locales.ts', import.meta.url), 'utf8')
    expect(locales).toMatch(/refresh: '/u)
    expect(locales).toMatch(/refreshing: '/u)
  })

  it('刷新入口在加载、就绪、失败三种状态下都渲染（三态可见）', async () => {
    const source = await readUsageSection()

    // 三个分支各出现一次刷新入口；失败态下可见才能重试。
    const occurrences = source.match(/<RefreshButton/gu) ?? []
    expect(occurrences.length).toBeGreaterThanOrEqual(3)
  })
})

describe('FNOS-010-08-AC-04 刷新按钮状态机', () => {
  it('空闲态：可点击且文案为「刷新」', () => {
    expect(refreshButtonState('idle')).toEqual({ disabled: false, busy: false, labelKey: 'refresh' })
  })

  it('刷新中：禁用且呈加载态，且文案切换为「刷新中」', () => {
    // 禁用是为了「不可重复触发」——重复点击会打出多余的平台端点请求。
    expect(refreshButtonState('refreshing')).toEqual({ disabled: true, busy: true, labelKey: 'refreshing' })
  })

  it('失败后回到可点击（可重试），但保留刷新中不可点的语义不残留', () => {
    expect(refreshButtonState('idle').disabled).toBe(false)
  })
})

describe('FNOS-010-08-AC-04 刷新契约（新增端点，不改只读语义）', () => {
  it('刷新走独立端点：`usage` 保持只读，不得变成「读也顺带刷新」', async () => {
    const rpc = await readFile(new URL('../../src/contracts/usage-rpc.ts', import.meta.url), 'utf8')

    // 只读端点被搜索链路与其他读取方复用；让它附带刷新会在每次读取时都打平台端点。
    expect(rpc).toMatch(/FAILOVER_USAGE_ENDPOINT = 'usage'/u)
    expect(rpc).toMatch(/FAILOVER_REFRESH_ENDPOINT = 'refresh'/u)
  })

  it('宿主为刷新端点注册 handler，并调用既有 refreshUsage', async () => {
    const host = await readFile(new URL('../../src/index.ts', import.meta.url), 'utf8')

    expect(host).toContain('FAILOVER_REFRESH_ENDPOINT')
    expect(host).toMatch(/refreshUsage\(\)/u)
  })
})
