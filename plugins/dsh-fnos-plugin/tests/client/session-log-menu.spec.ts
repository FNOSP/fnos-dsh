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
    // 顶层允许 refresh / download / feedback / restart 四项；computer 与 nas 必须
    // 留在 download 的 submenu 里，不能成为并列的顶层项。
    const topLevel = ACTION.slice(ACTION.indexOf('const menuItems: MenuItem[] = ['), ACTION.indexOf(']\n\n  const refreshPage'))
    const topIds = Array.from(topLevel.matchAll(/^\s{4}\{ id: '([a-z]+)'/gmu)).map(m => m[1])
    expect(topIds).toEqual(['refresh', 'feedback'])
    expect(topIds).not.toContain('computer')
    expect(topIds).not.toContain('nas')
  })

  it('刷新在最上面、重启在反馈下面（用户指定顺序）', () => {
    const start = ACTION.indexOf('const menuItems: MenuItem[] = [')
    const block = ACTION.slice(start, ACTION.indexOf('const refreshPage'))
    // 用出现位置比较，避免受跨行排版影响。
    const at = (id: string): number => block.indexOf(`id: '${id}'`)
    expect(at('refresh')).toBeGreaterThan(-1)
    expect(at('download')).toBeGreaterThan(-1)
    expect(at('feedback')).toBeGreaterThan(-1)
    // 刷新在最上面。
    expect(at('refresh')).toBeLessThan(at('download'))
    expect(at('refresh')).toBeLessThan(at('feedback'))
    // 重启在反馈下面。
    expect(block).toContain('restartItem')
    const restartDecl = ACTION.indexOf('const restartItem: MenuItem =')
    expect(restartDecl).toBeGreaterThan(-1)
    // 数组里 restart 排在 feedback 之后。
    expect(block.indexOf('restartItem,')).toBeGreaterThan(at('feedback'))
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

describe('FNOS-042 二级菜单固定向左', () => {
  // 官方 Menu 没有子菜单方向/边界的 props，子菜单默认渲染在右侧。而且它的类名
  // 被 CSS Modules 哈希过（真机上是 `_submenu_4ub78_8`），**写 `.submenu` 完全
  // 匹配不到**——上一版就是这样静默失效、子菜单依旧向右溢出。
  // 因此这里断言「属性包含 submenu」+ 本菜单 `listClassName` 前缀的写法。
  const STYLE = read('../../src/styles/index.scss')

  it('给菜单挂了 listClassName 作为样式钩子', () => {
    expect(ACTION).toContain('listClassName="dsh-fnos-session-log-menu"')
  })

  it('用属性选择器定位哈希类名，翻到左侧', () => {
    expect(STYLE).toContain(".dsh-fnos-session-log-menu [class*='submenu'] {")
    expect(STYLE).toContain('right: calc(100% + 10px) !important;')
  })

  it('指针命中桥一起翻，否则悬停子菜单会闪退', () => {
    expect(STYLE).toContain(".dsh-fnos-session-log-menu [class*='submenu']::before {")
    expect(STYLE).toContain('right: -10px !important;')
  })

  it('不再依赖裸类名（哈希化后必然失效）', () => {
    // 反例守卫：出现过 `.dsh-fnos-session-log-menu .submenu {` 就说明又写回了死选择器。
    expect(STYLE).not.toContain('.dsh-fnos-session-log-menu .submenu {')
    // 也不允许出现无作用域的裸 `.submenu {`，那会影响 DSH 其它菜单。
    expect(STYLE).not.toMatch(/^\.submenu \{/mu)
  })
})
