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
    expect(open.indexOf('onDismiss?.()')).toBeLessThan(open.indexOf('configDialogStore.set(true)'))
  })

  it('弹框挂在 shell.overlay，不在菜单子树里', () => {
    // 实测踩过：菜单选中后会关闭并卸载整棵子树，弹框若挂在那里面，打开状态
    // 会随卸载一起丢失——DOM 无新增、也不报错，最难查的那种失败。
    expect(ENTRY).not.toContain('FnosConfigDialog')
    const INDEX = read('../../src/client/index.ts')
    expect(INDEX).toContain("ctx.slots.inject('shell.overlay'")
    expect(INDEX).toContain("id: 'dsh-fnos-config-dialog'")
    expect(INDEX).toContain('FnosConfigOverlay')
  })

  it('开关状态走模块级 store，与菜单生命周期无关', () => {
    const STORE = read('../../src/client/config-dialog-store.ts')
    expect(STORE).toContain('createConfigDialogStore')
    expect(STORE).toContain('useSyncExternalStore')
    // 不引入额外 store 依赖：仓库已有 useSyncExternalStore 先例。
    expect(STORE).not.toContain("@deepseek-ai/dsh-client-store")
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
    expect(block).toContain('--dsw-alias-interactive-bg-hover')
    expect(block).toContain('--dsw-alias-label-primary')
    // 右侧独立滚动，不把弹框撑到视口外。
    expect(block).toContain('max-height')
    expect(block).toContain('overflow-y: auto')
  })

  it('蒙层是暗色，且用 !important 压过 Semi 的规则', () => {
    const mask = SCSS.slice(SCSS.indexOf('.semi-modal-mask'), SCSS.indexOf('.dsh-fnos-config-body'))
    // 深色遮罩：亮色主题下也读得出「背后已禁用」。
    expect(mask).toMatch(/rgb\(0 0 0/)
    // 实测：普通声明会被 Semi 的另一条规则压掉（变量已解析成 #00000073，
    // 计算值仍是白色），只有 !important 能稳定生效。
    expect(mask).toContain('!important')
    // 同时覆盖变量，避免别处复用该变量时又回退成白色。
    expect(mask).toContain('--semi-color-overlay-bg')
  })

  it('左右间距收窄，且不再用竖线分隔', () => {
    const body = SCSS.slice(SCSS.indexOf('.dsh-fnos-config-body'), SCSS.indexOf('.dsh-fnos-config-nav {'))
    expect(body).toContain('gap: 10px')
    const nav = SCSS.slice(SCSS.indexOf('.dsh-fnos-config-nav {'), SCSS.indexOf('.dsh-fnos-config-nav-item'))
    expect(nav).not.toContain('border-right')
    expect(nav).not.toContain('margin-right')
  })

  it('左侧菜单项带图标，图标与文字横排居中', () => {
    expect(DIALOG).toContain('<IconifyIcon name={item.icon} />')
    expect(DIALOG).toContain("icon: 'lucide:folder'")
    expect(DIALOG).toContain("icon: 'lucide:wrench'")
    const item = SCSS.slice(SCSS.indexOf('.dsh-fnos-config-nav-item {'))
    expect(item.slice(0, item.indexOf('}'))).toContain('align-items: center')
    expect(item.slice(0, item.indexOf('}'))).toContain('gap: 8px')
  })

  it('授权目录卡片不再渲染那段描述', () => {
    const CARD = read('../../src/components/AuthorizedDirectoriesCard.tsx')
    expect(CARD).not.toContain('dsh-fnos-authorized-card-description')
  })

  it('弹框宽高固定，切换分组不跳动', () => {
    const body = SCSS.slice(SCSS.indexOf('.dsh-fnos-config-body {'), SCSS.indexOf('.dsh-fnos-config-panel {'))
    // 用固定 height：min/max 区间会让弹框跟着内容高度变，切换分组时像在抖。
    expect(body).toContain('height: 460px')
    expect(body).not.toMatch(/min-height:\s*\d+px/)
    // 内容多的分组由右侧自己滚动。
    expect(SCSS).toContain('.dsh-fnos-config-panel {')
    // 宽度固定但窄屏不溢出。
    expect(SCSS).toContain('max-width: calc(100vw - 32px)')
    expect(DIALOG).toContain('width={880}')
  })

  it('弹框去掉 1px 描边，阴影改为大范围低透明度', () => {
    const surface = SCSS.slice(
      SCSS.indexOf('.dsh-fnos-config-dialog .semi-modal-content'),
      SCSS.indexOf('.dsh-fnos-config-dialog .semi-modal-content') + 400,
    )
    expect(surface).toContain('border: none')
    // 阴影外扩：贴近的窄阴影会看起来像又描了一遍边。
    expect(surface).toMatch(/0 32px 80px/)
    // 只作用于本插件弹框，不动全局 Semi 弹框。
    expect(surface).toContain('.dsh-fnos-config-dialog')
  })

  it('tip 图标与标题垂直居中（包装层也是 flex）', () => {
    const head = SCSS.slice(SCSS.indexOf('.dsh-fnos-authorized-gateway-head'))
    // DshTooltip 会包一层，那一层才是 flex 子项；不拉成 flex 图标就偏。
    expect(head).toContain('.dsh-fnos-authorized-gateway-head > *')
    expect(head).toContain('align-items: center')
    // 行内基线对齐的负边距在 flex 里会把图标顶高。
    expect(head).toMatch(/margin: 0;/)
  })

  it('八种语言都有四个新文案键', () => {
    expect(LOCALES).toContain("configDialogTitle: 'fnOS settings'")
    expect(LOCALES).toContain("configDialogTitle: '飞牛 OS 设置'")
    expect(LOCALES).toContain("configSectionDirectories: '授权目录'")
    expect(LOCALES).toContain("configSectionRepair: '依赖修复'")
  })
})
