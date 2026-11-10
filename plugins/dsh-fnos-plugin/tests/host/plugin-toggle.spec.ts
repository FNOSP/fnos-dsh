import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parsePatchEntries } from '../../src/host/plugin-toggle.ts'

/**
 * 插件启用/禁用：解析 profile patch。
 *
 * 「禁用」与「卸载」是两件事——禁用只加 `disabled: true`，模块与配置都还在。
 * 卡片式界面要正确显示状态，前提是这里的解析准确。
 */
const TOGGLE = readFileSync(new URL('../../src/host/plugin-toggle.ts', import.meta.url), 'utf8')
const PANEL = readFileSync(new URL('../../src/components/InstalledPluginsPanel.tsx', import.meta.url), 'utf8')
const ROUTES = readFileSync(new URL('../../src/host/gateway-proxy-routes.ts', import.meta.url), 'utf8')

describe('patch 解析', () => {
  it('读出条目与 disabled 状态', () => {
    const text = `- id: plugin-market
  name: "@deepseek-ai/dsh-plugin-market"
  config:
    indexes: []
- id: ui-settings-general
  name: "@deepseek-ai/dsh-client-ui-settings-general"
  disabled: true
`
    const entries = parsePatchEntries(text)
    expect(entries).toEqual([
      { id: 'plugin-market', name: '@deepseek-ai/dsh-plugin-market', enabled: true },
      { id: 'ui-settings-general', name: '@deepseek-ai/dsh-client-ui-settings-general', enabled: false },
    ])
  })

  it('没有 disabled 视为启用', () => {
    const entries = parsePatchEntries('- id: a\n  name: x\n')
    expect(entries[0]?.enabled).toBe(true)
  })

  it('忽略没有 name 的条目（不是插件挂载）', () => {
    expect(parsePatchEntries('- id: alone\n  config: {}\n')).toEqual([])
  })

  it('解析失败不猜，返回空', () => {
    expect(parsePatchEntries('')).toEqual([])
    expect(parsePatchEntries('not yaml at all')).toEqual([])
  })
})

describe('禁用写入', () => {
  it('原子写：先临时文件再 rename', () => {
    // 半个 YAML 会让整个 profile 起不来。
    expect(TOGGLE).toContain('writeAtomic')
    expect(TOGGLE).toContain('rename')
  })

  it('按 entry id 改，而不是按包名', () => {
    // 一个包可能对应多条组合条目（服务端/客户端分开挂载）。
    expect(TOGGLE).toContain('entry.id === currentId')
  })
})

describe('卡片式界面', () => {
  it('用卡片而不是表格行', () => {
    expect(PANEL).toContain('dsh-fnos-cards')
    expect(PANEL).toContain('dsh-fnos-card')
  })

  it('有启用开关、卸载与更新', () => {
    expect(PANEL).toContain('DshSwitch')
    expect(PANEL).toContain('toggleEnabled')
    expect(PANEL).toContain("t('uninstall')")
    expect(PANEL).toContain("t('pluginInstallAction')")
  })

  it('内置插件不允许卸载（删了要重装整个应用才能恢复）', () => {
    expect(PANEL).toContain('plugin.bundled ? null :')
  })

  it('禁用态有视觉区分', () => {
    expect(PANEL).toContain('dsh-fnos-card--off')
    expect(PANEL).toContain("t('pluginDisabled')")
  })
})

describe('接口', () => {
  it('启用/卸载都是 POST + 同源 + 包名校验', () => {
    expect(ROUTES).toContain('FNOS_PLUGIN_TOGGLE_ROUTE')
    expect(ROUTES).toContain('FNOS_PLUGIN_REMOVE_ROUTE')
    expect(ROUTES).toContain('invalid-enabled')
    expect(ROUTES).toContain('validName')
  })
})
