import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { srcPath } from './paths.ts'

/**
 * 详情页区块的布局与样式。
 *
 * 这里原先验证「后台面板必须用 Semi Layout 组件表达」——左 Sider 导航、固定
 * header、单一滚动 Content 的整套骨架。配置入口迁到插件管理页的组合包详情页
 * 之后，那套外壳整体删除（`shell.overlay` / hash 路由 / `DshNav` / 返回按钮），
 * 因此本文件改为验证两件事：
 *
 *  1. **外壳确实不再存在**——JSX 里没有 `<DshLayout>` / `<DshNav>`，样式里没有
 *     固定 header 与视图滚动容器。留着那些规则只会在后续改动时误导读者。
 *  2. **两块内容仍在**——账号管理与 Token 统计在详情页里直接渲染，不靠
 *     `route` 选页、不靠 `visited` 惰性挂载、不用 `hidden` 切页。
 *
 * 详情页自己负责页面标题与整体滚动：插件不要在这里再造滚动容器，多一层
 * `overflow` 会让内层滚动与页面滚动打架（这正是面板时代必须显式约束
 * `min-height: 0` 的原因）。
 */
const PANEL = readFileSync(
  srcPath('client/panel.tsx'),
  'utf8',
)
const PANEL_SCSS = readFileSync(
  srcPath('styles/panel-shell.scss'),
  'utf8',
)

/** Token 页样式（token-updated / 窄屏覆盖等已随拆分迁出 panel-shell.scss）。 */
const TOKEN_SCSS = readFileSync(
  srcPath('styles/token-panel.scss'),
  'utf8',
)

/** 面板外壳样式：panel-toolbar / panel-views / panel-main 等规则已随拆分
 *  从 index.scss 迁入 panel-shell.scss（PANEL_SCSS 读取的就是它）。 */
const SHELL_SCSS = PANEL_SCSS

describe('Token 空状态视觉与操作', () => {
  it('使用彩色 CodeBuddy Logo，不再显示命令符号', () => {
    const emptyStart = PANEL.indexOf("if (!hasAnyActivity)")
    const empty = PANEL.slice(emptyStart, PANEL.indexOf("const cacheRateOf", emptyStart))
    expect(empty).toContain('<CodeBuddyLogo size={64} />')
    expect(empty).not.toContain('DshIconCommand size="extra-large"')
  })

  it('移除仅统计已保存会话的提示，并给刷新动作独立的居中容器', () => {
    expect(PANEL).not.toContain('tokenNoDataHint')
    expect(PANEL).toContain('dsh-codebuddy-token-empty-action')
    expect(TOKEN_SCSS).toMatch(/\.dsh-codebuddy-token-empty-action\s*\{[^}]*display:\s*flex/)
    expect(TOKEN_SCSS).toMatch(/\.dsh-codebuddy-token-empty-action\s*\{[^}]*justify-content:\s*center/)
  })
})

describe('详情页区块不再有面板外壳', () => {
  const shell = PANEL.slice(PANEL.indexOf('export function CodeBuddyDetailSection'))

  it('不再使用 Semi Layout 的 Sider / Header / Content 三段式外壳', () => {
    // 原先的管理面板是「左 Sider 导航 + 右 Header/Content」，现已整体移除：
    // 两块内容在插件详情页里就是普通 section，详情页自己负责标题与滚动。
    expect(shell).not.toContain('<DshLayout')
    expect(shell).not.toContain('<DshNav')
    expect(shell).not.toContain('DshIconArrowLeft')
  })

  it('不再有 hash 路由控制器与返回按钮', () => {
    // `panel-route.ts` 已删除。剥掉注释后再断言：文件里有解释"曾经是 hash 路由"
    // 的注释，那是正当的历史说明，不该被当成残留代码。
    const code = PANEL.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^[ \t]*\/\/.*$/gmu, '')
    expect(code).not.toContain('PanelRouteController')
    expect(code).not.toContain('#/codebuddy')
    expect(code).not.toContain("t('back')")
  })

  it('账号管理与 Token 统计都在详情页里直接渲染（不再靠 route 选页）', () => {
    expect(shell).toContain('<AccountsPage')
    expect(shell).toContain('<TokenStatsPage')
    // 不再有 `visited` 惰性挂载与 `hidden` 切页。
    expect(shell).not.toContain('visited')
    expect(shell).not.toContain('hidden=')
  })

  it('详情页样式不再包含外壳几何（fixed header / 视图滚动容器）', () => {
    // 这些规则服务的元素已不存在；留着只会在后续改动时误导读者。
    expect(SHELL_SCSS).not.toMatch(/\.dsh-codebuddy-panel-views\s*\{/)
    expect(SHELL_SCSS).not.toMatch(/\.dsh-codebuddy-panel-toolbar\s*\{/)
    expect(SHELL_SCSS).not.toMatch(/\.dsh-codebuddy-panel-nav\s*\{/)
    expect(SHELL_SCSS).not.toMatch(/\.dsh-codebuddy-panel-main\s*\{/)
  })

  it('详情页样式确实定义了区块与折叠容器', () => {
    expect(SHELL_SCSS).toMatch(/\.dsh-codebuddy-detail\s*\{/)
    expect(SHELL_SCSS).toMatch(/\.dsh-codebuddy-detail-section\s*\{/)
    expect(SHELL_SCSS).toMatch(/\.dsh-codebuddy-detail-summary\s*\{/)
  })
})
