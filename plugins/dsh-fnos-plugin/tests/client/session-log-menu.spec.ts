import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * FNOS-042：Session 日志菜单对齐官方默认结构。
 *
 * 官方 DSH 的会话头部菜单是「下载 Session 日志 / 反馈」。本插件此前把
 * 「导出到电脑」「导出到 NAS」平铺成两个同级项，与官方不一致；现在改成
 * 下载日志为父项、两种落点作为它的子菜单，并补上指向本仓库的反馈入口。
 *
 * 这里断言源码契约：菜单结构、图标复用与反馈地址。真正打开子菜单的行为由
 * `@deepseek-ai/dsh-client-ui-primitives` 的 `Menu` 负责——它对子项调用
 * `onSelect?.(sub.id)`，因此子项 id 必须与处理分支一一对应。
 */

const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8')

const ACTION = read('../../src/components/FnosSessionLogHeaderAction.tsx')
const LOCALES = read('../../src/client/locales.ts')

describe('FNOS-042 Session 日志菜单结构', () => {
  it('第一项是「下载 Session 日志」，两种落点挂在它的子菜单里', () => {
    expect(ACTION).toContain("id: 'download'")
    expect(ACTION).toContain("label: t('sessionLogDownload')")
    expect(ACTION).toContain('submenu: [')
    // 子项仍用自己的 id 回调。
    expect(ACTION).toContain("id: 'computer'")
    expect(ACTION).toContain("id: 'nas'")
  })

  it('不再把两个导出项平铺成同级条目', () => {
    // 顶层现在只有 copy / download / feedback 三项；computer 与 nas 必须留在
    // download 的 submenu 里，不能成为并列的顶层项。
    const sub = ACTION.slice(ACTION.indexOf("submenu: ["), ACTION.indexOf(']', ACTION.indexOf("submenu: [")))
    // 两个导出项必须在 submenu 里。
    expect(sub).toContain("id: 'computer'")
    expect(sub).toContain("id: 'nas'")
  })

  it('刷新与重启已移到侧栏底部下拉菜单，不再占用会话头部', () => {
    /*
      它们都是应用级动作（整页重载 / 整个 Web 进程重启），与「当前会话」无关。
      原先常驻在会话头部菜单里，既挤占头部又放错了层级；现在由侧栏底部
      「飞牛 OS」下拉菜单承载（`FnosFooterEntry` + `services/web-actions.ts`）。
    */
    const start = ACTION.indexOf('const menuItems: MenuEntry[] = [')
    // 终点取菜单数组收尾（`  ]` 后跟空行 + 下一段注释）：子菜单里也有 `  ]`
    // 结尾的行，用裸的 `  ]\n` 会在 `submenu: [...]` 处提前截断，
    // 于是后面那几个同级项被判成缺失。
    const end = ACTION.indexOf('  ]\n\n  /**', start)
    const block = ACTION.slice(start, end === -1 ? undefined : end)
    const at = (id: string): number => block.indexOf(`id: '${id}'`)
    expect(at('copy')).toBeGreaterThan(-1)
    expect(at('download')).toBeGreaterThan(-1)
    expect(at('feedback')).toBeGreaterThan(-1)
    expect(at('refresh')).toBe(-1)
    expect(block).not.toContain('restartItem')
    expect(ACTION).not.toContain('restartWeb')
    expect(ACTION).not.toContain('restarting')
  })

  it('第二项是反馈，指向本仓库', () => {
    expect(ACTION).toContain("id: 'feedback'")
    expect(ACTION).toContain("label: t('sessionLogFeedback')")
    expect(ACTION).toContain("const FEEDBACK_URL = 'https://github.com/FNOSP/fnos-dsh'")
    expect(ACTION).toMatch(/window\.open\(FEEDBACK_URL, '_blank', 'noopener,noreferrer'\)/u)
  })

  it('图标复用官方图标集', () => {
    expect(ACTION).toContain('IconDownloadOutlineRegular')
    expect(ACTION).toContain('IconFolderOpenOutlineRegular')
    // 官方「反馈」用的纸飞机。
    expect(ACTION).toContain('IconPaperPlaneOutlineRegular')
    // 不使用自绘 SVG。
    expect(ACTION).not.toContain('<svg')
  })

  it('子项 id 都有对应处理分支', () => {
    expect(ACTION).toContain("if (id === 'computer') void exportToComputer(sessionId)")
    expect(ACTION).toContain("else if (id === 'nas') openNasDialog()")
    expect(ACTION).toContain("else if (id === 'feedback') openFeedbackPage()")
  })

  it('文案键中英文都存在', () => {
    expect(LOCALES.match(/sessionLogDownload: /gu)?.length ?? 0).toBe(2)
    expect(LOCALES.match(/sessionLogFeedback: /gu)?.length ?? 0).toBe(2)
    expect(LOCALES).toContain("sessionLogDownload: '下载 Session 日志'")
    expect(LOCALES).toContain("sessionLogFeedback: '反馈'")
  })
})

describe('FNOS-042 二级菜单定位', () => {
  // 官方 Menu 没有子菜单方向/边界的 props，子菜单默认渲染在右侧。而且它的类名
  // 被 CSS Modules 哈希过（真机上是 `_submenu_4ub78_8`），**写 `.submenu` 完全
  // 匹配不到**——上一版就是这样静默失效、子菜单依旧向右溢出。
  // 因此这里断言「属性包含 submenu」+ 本菜单 `listClassName` 前缀的写法。
  const STYLE = read('../../src/styles/index.scss')

  it('给菜单挂了 listClassName 作为样式钩子', () => {
    expect(ACTION).toContain('listClassName="dsh-fnos-session-log-menu"')
  })

  /*
    **不再覆盖子菜单的定位，交给官方 CSS anchor 逻辑。**

    这里曾用 `left/right: calc(100% + 10px)` 把二级卡片硬钉在父卡片左侧。官方
    改版后子菜单改为 `position-anchor` + `anchor(right)` 定位，并用
    `position-try-fallbacks` 在右侧放不下时自动翻到左侧；写死 `left/right` 会与
    `anchor()` 冲突，表现为二级卡片错位、与父卡片不同高（真机截图确认过）。

    因此守卫反转：本菜单不得再出现任何对子菜单定位的覆盖。
  */
  it('不覆盖子菜单定位（交给官方 anchor 与自动翻转）', () => {
    expect(STYLE).not.toMatch(/\.dsh-fnos-session-log-menu \[class\*='submenu'\]/u)
    expect(STYLE).not.toContain('right: calc(100% + 10px) !important;')
    expect(STYLE).not.toContain('right: -10px !important;')
  })

  it('不再依赖裸类名（哈希化后必然失效）', () => {
    // 反例守卫：出现过 `.dsh-fnos-session-log-menu .submenu {` 就说明又写回了死选择器。
    expect(STYLE).not.toContain('.dsh-fnos-session-log-menu .submenu {')
    // 也不允许出现无作用域的裸 `.submenu {`，那会影响 DSH 其它菜单。
    expect(STYLE).not.toMatch(/^\.submenu \{/mu)
  })
})
