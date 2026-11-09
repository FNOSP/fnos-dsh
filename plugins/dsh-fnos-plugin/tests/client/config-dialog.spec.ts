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

  it('入口用飞牛标记而不是通用设置齿轮', () => {
    // 这个入口代表「飞牛 OS」整体，齿轮会被误读成「应用设置」。
    expect(ENTRY).toContain('FnosMonoLogo')
    expect(ENTRY).not.toContain('lucide:settings-2')
  })

  it('飞牛标记自带黑白主题适配', () => {
    // mono 版本用 brightness(0) 变黑、暗色主题反转成白，亮暗下都读得清。
    const LOGO = read('../../src/components/FnosLogo.tsx')
    expect(LOGO).toContain('FnosMonoLogo')
    const css = SCSS.slice(SCSS.indexOf('.dsh-fnos-mono-logo'), SCSS.indexOf('.dsh-fnos-session-log-tree-label'))
    expect(css).toContain('brightness(0)')
    expect(css).toContain('data-ds-dark-theme')
    expect(css).toContain('invert(1)')
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
    // 高度由 flex 撑开（容器固定 800），切换分组时不变。
    expect(body).toContain('height: 100%')
    expect(body).not.toMatch(/min-height:\s*\d+px/)
    // 内容多的分组由右侧自己滚动。
    expect(SCSS).toContain('.dsh-fnos-config-panel {')
    // 宽度固定但窄屏不溢出。
    expect(SCSS).toContain('max-width: calc(100vw - 32px)')
    expect(DIALOG).toContain('width={800}')
  })

  it('尺寸对齐官方设置面板（实测 800×800）', () => {
    const surface = SCSS.slice(
      SCSS.indexOf('body[data-dsh-semi-theme] .semi-modal-content.dsh-fnos-config-dialog {'),
      SCSS.indexOf('/* header 右侧留出关闭按钮的位置'),
    )
    // 官方设置面板实测 800×800、圆角 28、无描边。
    expect(surface).toContain('height: 800px')
    expect(surface).toContain('border-radius: 28px')
    // header 固定 54，内容区由 flex 占满剩余（800 − 54 = 746，与官方一致）。
    expect(SCSS).toContain('height: 54px')
    expect(DIALOG).toContain('width={800}')
  })

  it('左侧对齐：body 不带内边距，起点只由 content 的 24px 提供', () => {
    const body = SCSS.slice(SCSS.indexOf('.dsh-fnos-config-body {'), SCSS.indexOf('.dsh-fnos-config-panel {'))
    // 之前这里给 12px，导航因此比标题右移 12px——两者都没对齐；后来改成
    // `padding: 10px 0`，又与父层 `.semi-modal-body` 的上下 10 叠加，
    // 标题下方实际变成 20。现在本层完全不设内边距，避免任何重复计算。
    expect(body).not.toMatch(/^\s*padding:/m)
    expect(body).toContain('box-sizing: border-box')
    // 切换分组时右缘不能因为有无滚动条而左右跳。
    const panel = SCSS.slice(SCSS.indexOf('.dsh-fnos-config-panel {'))
    expect(panel.slice(0, panel.indexOf('}'))).toContain('scrollbar-gutter: stable')
  })

  it('垂直留白只在 semi-modal-body 上设置一次', () => {
    const shellBody = SCSS.slice(
      SCSS.indexOf('.semi-modal-content.dsh-fnos-config-dialog .semi-modal-body {'),
      SCSS.indexOf('.semi-modal-content.dsh-fnos-config-dialog .semi-modal-body {') + 400,
    )
    // 弹框内的上下留白由这一层统一提供；左 0 让标题与左列导航共用 content 的 24px，
    // 右 0 让右列滚动条贴边。
    expect(shellBody).toContain('padding: 10px 0')
    expect(shellBody).toContain('flex: 1 1 auto')
    expect(shellBody).toContain('min-height: 0')
  })

  it('header 高度可由「上内边距 + 标题行高 + 下内边距」加出，无幻影空隙', () => {
    const headerRule = SCSS.slice(
      SCSS.indexOf('.semi-modal-content.dsh-fnos-config-dialog .semi-modal-header {'),
    )
    const rule = headerRule.slice(0, headerRule.indexOf('}'))
    // 20 + 24（标题行高 18px/24）+ 10 = 54，与官方 header 等高，
    // 内容盒正好等于标题行高，不再有 2px 无主空隙。
    expect(rule).toContain('padding: 20px 24px 10px 0')
    expect(rule).toContain('min-height: 54px')
    // 用 min-height 而非固定 height：标题换行时 header 可以长高，
    // 由 body 的 flex 收缩吸收，而不是把标题裁掉。
    // 用 `\n  height:` 定位，避免把 `min-height: 54px` 误判成固定高度。
    expect(rule).not.toMatch(/^\s*height:/m)
    // Semi 默认给 header 24px 外边距，归零才能让标题从顶部内边距开始。
    expect(rule).toContain('margin: 0')
  })

  it('弹框在视口里垂直居中（Semi 默认只给固定 80px 顶距）', () => {
    // Semi 的居中是 `.semi-modal { margin: 80px auto }`——顶部固定 80px，不随高度
    // 变化。于是矮弹框明显偏上：实测视口 859、确认框高 310 时顶部在 80，而居中
    // 应在 (859 − 310) / 2 ≈ 274。
    const wrap = SCSS.slice(
      SCSS.indexOf('body[data-dsh-semi-theme] .semi-modal-wrap {'),
      SCSS.indexOf('body[data-dsh-semi-theme] .semi-modal-wrap {') + 400,
    )
    expect(wrap).toContain('display: flex')
    expect(wrap).toContain('flex-direction: column')
    expect(wrap).toContain('align-items: center')
    // 用 margin auto 而不是 justify-content: center——center 在内容超高时会裁掉
    // 头部，滚到顶也看不到标题。
    const modal = SCSS.slice(SCSS.indexOf('body[data-dsh-semi-theme] .semi-modal {'))
    const modalRule = modal.slice(0, modal.indexOf('}'))
    expect(modalRule).toContain('margin-top: auto')
    expect(modalRule).toContain('margin-bottom: auto')
    expect(wrap).not.toContain('justify-content: center')
  })

  it('弹框不产生外层滚动条（modal 的 margin + 固定高会超出视口）', () => {
    // 实测：`.semi-modal` 自带 margin 80px，800 + 160 = 960 > 859 视口高，
    // `.semi-modal-wrap`（overflow: auto）于是长出滚动条。
    // `.semi-modal` 是 content 的**祖先**，选择器必须用 :has() 反向选，
    // 写成后代选择器实测命中不了（margin 仍是 80px）。
    expect(SCSS).toContain('max-height: calc(100vh - 48px)')
    const modalRule = SCSS.slice(SCSS.indexOf('.semi-modal:has(> .semi-modal-content.dsh-fnos-config-dialog) {'))
    // 与通用规则一致用 auto：视口高时均分剩余空间（居中），矮时归零配合
    // max-height 仍不出滚动条。写成固定数值会让两种弹框的居中表现不一致。
    expect(modalRule.slice(0, 300)).toContain('margin-top: auto')
    expect(modalRule.slice(0, 300)).toContain('margin-bottom: auto')
    // Semi 把 margin 写在内联样式里，必须 !important 才压得过。
    expect(modalRule.slice(0, 300)).toContain('!important')
  })

  it('高度由 flex 撑开，不硬编码 body 高度（否则底部被裁）', () => {
    const body = SCSS.slice(SCSS.indexOf('.dsh-fnos-config-body {'), SCSS.indexOf('.dsh-fnos-config-panel {'))
    expect(body).toContain('height: 100%')
    expect(body).toContain('min-height: 0')
    // content 是 flex 纵向容器，body 占满剩余高度。
    expect(SCSS).toContain('flex-direction: column')
    // header 的 margin 归零在「header 高度可加出」那条用例里断言。
  })

  it('类名用 modalContentClass，才会落在 semi-modal-content 上', () => {
    // 三个 class prop 只有第三个能用：
    // - className → 外层 .semi-modal-wrap；
    // - contentClassName → 被 Modal 内部覆盖成 `${animationClassName} ${modalContentClass}`，
    //   调用方传的值直接丢弃（实测 content 的 class 变成
    //   `"semi-modal-content  undefined"`）；
    // - modalContentClass → 唯一拼进 .semi-modal-content 的入口。
    expect(DIALOG).toContain('modalContentClass="dsh-fnos-config-dialog"')
    expect(DIALOG).not.toContain('contentClassName="dsh-fnos-config-dialog"')
    expect(DIALOG).not.toMatch(/^\s+className="dsh-fnos-config-dialog"$/m)
    // 样式侧用同元素复合选择器，不再是后代选择器。
    expect(SCSS).toContain('.semi-modal-content.dsh-fnos-config-dialog')
    expect(SCSS).not.toContain('.dsh-fnos-config-dialog .semi-modal-content')
  })

  it('弹框去掉 1px 描边，阴影改为大范围低透明度', () => {
    // 按整条规则定位：同类选择器出现两次（窄屏兜底 + 表面样式），只取带边框的那条。
    const surface = SCSS.slice(SCSS.indexOf('body[data-dsh-semi-theme] .semi-modal-content.dsh-fnos-config-dialog {'))
    expect(surface.slice(0, 300)).toContain('border: none')
    // 阴影外扩：贴近的窄阴影会看起来像又描了一遍边。
    expect(surface.slice(0, 300)).toMatch(/0 32px 80px/)
  })

  it('阴影规则用 body[data-dsh-semi-theme] 前缀压过共享主题层', () => {
    // 共享主题层有一条 (0,2,0) 的同名规则，且在本样式表之后加载；前缀对齐后
    // 权重更高才稳定生效。
    expect(SCSS).toContain('body[data-dsh-semi-theme] .semi-modal-content.dsh-fnos-config-dialog {')
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
