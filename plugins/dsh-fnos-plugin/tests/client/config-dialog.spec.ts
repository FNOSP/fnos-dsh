import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * fnOS 配置弹框：左菜单 + 右主体。
 *
 * 原先授权目录与依赖修复挂在插件详情页，随页面滚动、找一条路径要翻很长。改为
 * 收进「更多」菜单打开的弹框后，详情页不再保留这两块——同一份设置只出现在一个
 * 地方，不会出现两处都能改、状态却不同步。
 *
 * 官方设置弹框占用 `settings.shell`（single 槽位，插件无法往里加条目），因此
 * 这里按同样的视觉形态自建，而不是复用。
 */
const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8')
const DIALOG = read('../../src/components/FnosConfigDialog.tsx')
const ENTRY = read('../../src/components/FnosConfigMenuEntry.tsx')
const SCSS = read('../../src/styles/index.scss')
const LOCALES = read('../../src/client/locales.ts')

describe('fnOS 配置弹框', () => {
  it('挂在「更多」菜单，菜单项文案是「飞牛 OS」', () => {
    expect(ENTRY).toContain('MenuItemButton')
    expect(LOCALES).toContain("configMenuEntry: '飞牛 OS'")
    // 第一行带分隔线，与上面的面板导航分开。
    expect(ENTRY).toContain('separatorBefore')
  })

  it('先关菜单再开弹框（避免 portaled 浮层抢焦点）', () => {
    const open = ENTRY.slice(ENTRY.indexOf('const openConfig'), ENTRY.indexOf('return ('))
    expect(open).toContain('onDismiss?.()')
    expect(open.indexOf('onDismiss?.()')).toBeLessThan(open.indexOf('setOpen(true)'))
  })

  it('左侧菜单 + 右侧主体，两个分组', () => {
    expect(DIALOG).toContain('dsh-fnos-config-nav')
    expect(DIALOG).toContain('dsh-fnos-config-panel')
    expect(DIALOG).toContain("id: 'directories'")
    expect(DIALOG).toContain("id: 'repair'")
  })

  it('两段配置复用原组件，不复制实现', () => {
    expect(DIALOG).toContain('AuthorizedDirectoriesCard')
    expect(DIALOG).toContain('DependencyRepairCard')
  })

  it('菜单项有可访问的当前态与键盘可达性', () => {
    // aria-current 标出当前分组；用原生 button 保证 Tab/Enter 默认可用。
    expect(DIALOG).toContain('aria-current')
    expect(DIALOG).toContain('<button')
    expect(DIALOG).toContain('type="button"')
  })

  it('弹框没有默认底部按钮（配置自行保存，不需要确认/取消）', () => {
    expect(DIALOG).toContain('footer={null}')
  })

  it('样式用 DSH 语义变量，亮暗主题都可读', () => {
    const block = SCSS.slice(SCSS.indexOf('.dsh-fnos-config-body'))
    expect(block).toContain('--dsw-alias-border-l2')
    expect(block).toContain('--dsw-alias-interactive-bg-hover')
    // 右侧独立滚动，不把弹框撑到视口外。
    expect(block).toContain('max-height')
    expect(block).toContain('overflow-y: auto')
  })

  it('八种语言都有四个新文案键', () => {
    expect(LOCALES).toContain("configDialogTitle: 'fnOS settings'")
    expect(LOCALES).toContain("configDialogTitle: '飞牛 OS 设置'")
    expect(LOCALES).toContain("configSectionDirectories: '授权目录'")
    expect(LOCALES).toContain("configSectionRepair: '依赖修复'")
  })
})
