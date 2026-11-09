import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * 刷新 / 重启从侧栏独立按钮移入「更多」菜单。
 *
 * 理由是这两个低频动作在侧栏底部常驻占位；而「更多」菜单本就是「更多操作」的
 * 容器——官方 entry-customization 也往这里放「浏览其他插件」「创建你的插件」
 * 两个非面板动作，因此不是滥用槽位。
 */
const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8')
const INDEX = read('../../src/client/index.ts')
const MENU = read('../../src/components/FnosWebActionsMenu.tsx')

describe('刷新 / 重启移入「更多」菜单', () => {
  it('注册到 sidebar.panellist.actions，不再占 sidebar.footer.action', () => {
    expect(INDEX).toContain("ctx.slots.inject('sidebar.panellist.actions'")
    expect(INDEX).toContain("id: 'dsh-fnos-web-actions'")
    expect(INDEX).not.toContain("ctx.slots.inject('sidebar.footer.action'")
    expect(INDEX).not.toContain('dsh-fnos-web-restart')
  })

  it('用官方 MenuItemButton，与既有菜单行同形', () => {
    expect(MENU).toContain('MenuItemButton')
    expect(MENU).toContain("@deepseek-ai/dsh-client-ui-primitives")
    // 第一行前加分隔线：与上面的面板导航行分开。
    expect(MENU).toContain('separatorBefore')
  })

  it('保留两条动作的原始行为', () => {
    expect(MENU).toContain('window.location.reload()')
    expect(MENU).toContain('/__fnos-gateway/control/web/restart')
    expect(MENU).toContain("headers: { 'x-requested-with': 'fetch' }")
    expect(MENU).toContain('credentials: \'same-origin\'')
  })

  it('只在 fnOS iframe 内渲染', () => {
    expect(MENU).toContain('isEmbeddedFnosFrame')
  })

  it('执行前关闭菜单（重载会打断渲染）', () => {
    const refresh = MENU.slice(MENU.indexOf('const refresh = useCallback'), MENU.indexOf('const restart = useCallback'))
    expect(refresh).toContain('onDismiss?.()')
    expect(refresh.indexOf('onDismiss?.()')).toBeLessThan(refresh.indexOf('window.location.reload()'))
  })

  it('重启失败在行内显示，不弹窗打断菜单', () => {
    expect(MENU).toContain('webRestartFailed')
    expect(MENU).not.toContain('DshModal')
    expect(MENU).not.toContain('alert(')
  })

  it('旧的独立按钮组件与其样式已删除', () => {
    expect(INDEX).not.toContain('FnosWebRestartAction')
    const theme = read('../../../../packages/dsh-semi-ui/src/theme.scss')
    expect(theme).not.toContain('dsh-fnos-web-actions')
    expect(theme).not.toContain('dsh-fnos-web-refresh')
  })
})
