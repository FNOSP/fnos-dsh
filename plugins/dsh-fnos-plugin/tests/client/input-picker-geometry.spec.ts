import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * FNOS-034-01 / FNOS-034-03：选择器浮层的几何与关闭出口。
 *
 * 这里断言的是源码里的几何契约而不是渲染结果——面板宽度依赖运行时的
 * CSS 自定义属性（`--dsh-composer-card-max-width`），在没有真实卡片的环境里
 * 渲染出来只会是 0 宽。真正要防的回归是：
 *
 *  1. 有人把固定像素宽度写回来（面板就不再跟随卡片）；
 *  2. 定位不再贴齐锚点（就与斜杠指令面板错位）；
 *  3. 某个关闭出口被删掉（用户被困在面板里）。
 */

const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8')

const STYLE = read('../../src/styles/index.scss')
const PANEL = read('../../src/components/FnosAuthorizedPathPicker.tsx')

/**
 * 取出某个类名的规则体。
 *
 * 同名选择器在样式表里会出现多次（顶部的树内部横向兜底、底部的布局规则），
 * 因此 `match` 用来挑出要断言的那一条；不传则取第一条。
 */
function ruleBody(selector: string, match?: RegExp): string {
  let from = 0
  while (from < STYLE.length) {
    const start = STYLE.indexOf(`${selector} {`, from)
    if (start < 0) break
    const open = STYLE.indexOf('{', start)
    let depth = 0
    for (let index = open; index < STYLE.length; index += 1) {
      if (STYLE[index] === '{') depth += 1
      else if (STYLE[index] === '}') {
        depth -= 1
        if (depth === 0) {
          const body = STYLE.slice(open + 1, index)
          if (match === undefined || match.test(body)) return body
          from = index + 1
          break
        }
      }
    }
    if (from <= start) break
  }
  throw new Error(`样式里找不到规则 ${selector}${match === undefined ? '' : `（含 ${String(match)}）`}`)
}

describe('FNOS-034-01-AC-02 浮层几何贴齐输入卡片', () => {
  const body = ruleBody('.dsh-fnos-path-panel')

  it('左右对齐锚点（left/right 都为 0），宽度随卡片自适应', () => {
    expect(body).toMatch(/left:\s*0;/u)
    expect(body).toMatch(/right:\s*0;/u)
  })

  it('浮在输入卡片上沿之上', () => {
    expect(body).toMatch(/bottom:\s*calc\(100% \+ 4px\);/u)
  })

  it('不写任何固定像素宽度', () => {
    // 纯数字 px 宽度、或原来那套 560px 视口算式都必须没有。
    expect(body).not.toMatch(/\bwidth:\s*\d+px/u)
    expect(body).not.toContain('560px')
    expect(body).not.toContain('100vw')
  })

  it('层级高于卡片内容，且绝对定位在锚点内', () => {
    expect(body).toMatch(/position:\s*absolute;/u)
    expect(body).toMatch(/z-index:\s*\d+;/u)
  })
})

describe('FNOS-034-01-AC-03 最大高度按可用空间钳制', () => {
  it('面板用锚定的最大高度，而不是另一个固定上限', () => {
    expect(PANEL).toContain('useAnchoredMaxHeight')
    expect(PANEL).toContain('style={{ maxHeight }}')
  })

  it('顶部留出会话头部的安全距离', () => {
    // 上游斜杠菜单用 84（头部 76 + 8）；选择器保持一致，避免两处面板高度不同。
    expect(PANEL).toMatch(/PANEL_TOP_MARGIN\s*=\s*84/u)
  })

  it('树区自己滚动，标题栏固定', () => {
    const tree = ruleBody('.dsh-fnos-path-panel-tree', /flex:\s*1;/u)
    expect(tree).toMatch(/overflow:\s*auto;/u)
    expect(ruleBody('.dsh-fnos-path-panel-header')).toMatch(/flex:\s*none;/u)
  })
})

describe('FNOS-034-03 浮层有三个收起出口', () => {
  it('AC-01 点击输入卡片外部收起', () => {
    expect(PANEL).toContain("document.addEventListener('pointerdown', onPointerDown, true)")
    // 卡片内部不关闭：点回草稿继续输入时不该被顺手关掉。
    expect(PANEL).toContain("closest('[data-composer-card]')")
  })

  it('AC-02 按 Esc 收起', () => {
    expect(PANEL).toContain("event.key === 'Escape'")
    expect(PANEL).toContain("document.addEventListener('keydown', onKeyDown)")
  })

  it('AC-03 再点工具栏图标收起（同一 store 的 toggle）', () => {
    const button = read('../../src/components/FnosInputPickerButton.tsx')
    expect(button).toContain('store.toggle(sessionId')
    expect(button).toContain('aria-expanded={open}')
  })

  it('收起时监听器被移除，不残留全局监听', () => {
    expect(PANEL).toContain("document.removeEventListener('pointerdown', onPointerDown, true)")
    expect(PANEL).toContain("document.removeEventListener('keydown', onKeyDown)")
  })

  it('弹层打开时不因点外部销毁整个面板', () => {
    // Modal 与 Dropdown 都由 Semi portal 到 body，`panelRef.contains(target)`
    // 对它们恒为 false——弹框里点一下就会被判成「点了面板外部」。
    expect(PANEL).toContain('const floatingOpen = createTarget !== undefined || contextMenu !== undefined')
  })

  it('两个全局关闭监听在弹层打开期间都不注册', () => {
    // 点外部与 Esc 两条路径都要让路：否则 Esc 会同时关掉弹框和面板。
    const guards = PANEL.match(/if \(!open \|\| floatingOpen\) return/gu) ?? []
    expect(guards).toHaveLength(2)
  })

  it('弹层收起后恢复外部点击关闭', () => {
    // 让路只针对「弹层开着」这一段；依赖数组必须带上 floatingOpen 才能重新挂载。
    expect(PANEL).toMatch(/\[open, floatingOpen, close\]/u)
  })
})

describe('选择器不再使用下拉弹层', () => {
  it('面板与按钮都不再渲染 TreeSelect', () => {
    expect(PANEL).not.toContain('TreeSelect')
    expect(read('../../src/components/FnosInputPickerButton.tsx')).not.toContain('TreeSelect')
  })

  it('按钮只翻转 store，不再承载弹层内容', () => {
    const button = read('../../src/components/FnosInputPickerButton.tsx')
    expect(button).not.toContain('loadData')
    expect(button).not.toContain('requestAuthorizedEntries')
  })

  it('不引入定时轮询', () => {
    expect(PANEL).not.toContain('setInterval')
    expect(PANEL).not.toContain('visibilitychange')
  })
})

describe('FNOS-034 层级永远低于斜杠指令面板', () => {
  it('面板 z-index 必须比指令面板的 100 低一级', () => {
    // 上游 ui-input-trigger 的 MenuView.module.css 用 100。面板取 99，
    // 两者同时出现时指令面板稳定在上；一旦有人把 100 写回来，同级就退化成
    // 「谁后渲染谁在上」，层级不再可预期。
    const body = ruleBody('.dsh-fnos-path-panel', /position:\s*absolute;/u)
    expect(body).toMatch(/z-index:\s*99;/u)
    expect(body).not.toMatch(/z-index:\s*100;/u)
  })
})

describe('FNOS-034 面板不再提供搜索', () => {
  it('Tree 不开启 filterTreeNode，也不带搜索占位符', () => {
    expect(PANEL).not.toContain('filterTreeNode')
    expect(PANEL).not.toContain('searchPlaceholder')
  })
})

describe('FNOS-034 面板可新建文件夹与文件', () => {
  it('标题栏没有新建入口，新建只从右键菜单进入', () => {
    // 用户只要求右键新建。标题栏的「+」按钮是多余入口，已移除。
    expect(PANEL).not.toContain('dsh-fnos-path-panel-action')
    expect(PANEL).not.toContain('openCreateDialog')
    // 但菜单项文案仍在（右键菜单要用）。
    expect(PANEL).toContain("t('createFolder')")
    expect(PANEL).toContain("t('createFile')")
  })

  it('右键先弹上下文菜单，不直接开新建弹框', () => {
    expect(PANEL).toContain('onContextMenu={handleContextMenu}')
    // 右键只记录坐标与目标目录；弹框由菜单项触发（createFromContextMenu）。
    expect(PANEL).toContain('setContextMenu({ parent: key')
    expect(PANEL).toMatch(/handleContextMenu[\s\S]{0,600}setContextMenu/u)
    expect(PANEL).not.toMatch(/handleContextMenu[\s\S]{0,600}setCreateTarget/u)
    expect(PANEL).toContain('createFromContextMenu')
  })

  it('菜单自绘并落在鼠标坐标上，不再依赖 Semi Dropdown 定位', () => {
    // Semi Dropdown 的定位依赖锚点 rect 与容器坐标系，喂零尺寸锚点会被算到
    // 面板角落；custom 触发下它也不注册外部点击关闭。两点都必须自己接管。
    expect(PANEL).toContain('dsh-fnos-path-context-menu')
    expect(PANEL).toContain('style={{ left: contextMenu.x, top: contextMenu.y }}')
    expect(ruleBody('.dsh-fnos-path-context-menu')).toMatch(/position:\s*fixed;/u)
  })

  it('菜单落点被收进视口，不会顶出右下角', () => {
    expect(PANEL).toContain('clampMenuPosition')
    expect(PANEL).toMatch(/window\.innerWidth - MENU_WIDTH/u)
    expect(PANEL).toMatch(/window\.innerHeight - MENU_HEIGHT/u)
  })

  it('点击菜单外或按 Esc 自动收起菜单', () => {
    // 实机反馈的第二个问题：点面板别处菜单不消失。
    expect(PANEL).toMatch(/if \(contextMenu === undefined\) return/u)
    expect(PANEL).toContain('menuRef.current?.contains(event.target)')
    expect(PANEL).toContain("if (event.key === 'Escape') setContextMenu(undefined)")
    expect(PANEL).toContain("document.addEventListener('pointerdown', onPointerDown, true)")
  })

  it('命中文件不弹菜单（文件下无法再建条目）', () => {
    expect(PANEL).toContain("if (entry !== undefined && entry.kind !== 'directory') return")
  })

  it('菜单含新建文件夹与新建文件两项', () => {
    expect(PANEL).toMatch(/dsh-fnos-path-context-item[\s\S]{0,220}createFromContextMenu\('directory'\)/u)
    expect(PANEL).toMatch(/dsh-fnos-path-context-item[\s\S]{0,220}createFromContextMenu\('file'\)/u)
  })

  it('弹框收集名称并走宿主路由创建', () => {
    expect(PANEL).toContain('createAuthorizedEntry(createTarget.parent, name, createTarget.kind)')
    expect(PANEL).toContain('createDialogTitle')
    expect(PANEL).toContain('createDialogLabel')
  })

  it('创建成功后把新条目并进已展开的那一层（不整树重取）', () => {
    expect(PANEL).toContain('updateChildren')
    expect(PANEL).toContain('findChildren')
    // 整树重取会让已展开的节点收起，用户体验上像「刷新了一下」。
    expect(PANEL).not.toMatch(/await submitCreate[\s\S]{0,200}requestAuthorizedEntries\(\)/u)
  })

  it('错误按原因给出可操作文案，而不是统一「失败」', () => {
    expect(PANEL).toContain("case 'fnos-entry-exists': return t('createDialogExists')")
    expect(PANEL).toContain("case 'fnos-create-no-space': return t('createDialogNoSpace')")
    expect(PANEL).toContain("case 'fnos-create-read-only': return t('createDialogReadOnly')")
  })
})

describe('FNOS-034 气泡提示只在文本被省略时出现', () => {
  it('用 Semi Typography 的 ellipsis 承载省略与提示', () => {
    // 不再手写 scrollWidth 判定：Typography 内部用 isOverflowed 判断，
    // 只有真正溢出时才挂 tooltip（`noExpandText && overflowed && showTooltip`）。
    expect(PANEL).toContain('Typography.Text')
    expect(PANEL).toContain('ellipsis={{ showTooltip: true, rows: 1 }}')
  })

  it('不再自己量 scrollWidth，也不手写 Tooltip 分支', () => {
    expect(PANEL).not.toContain('scrollWidth >')
    expect(PANEL).not.toContain('ResizeObserver')
    expect(PANEL).not.toContain('loadingdone')
  })

  it('ellipsis 的 children 必须是纯文本（Semi 明确限制）', () => {
    // `ellipsis` 只支持 string children；传 ReactNode 会静默失效。
    // 从 JSX 起匹配，避免命中注释里说明性的 `<Typography.Text`。
    const jsx = PANEL.slice(PANEL.indexOf('<Typography.Text'))
    expect(jsx).toMatch(/^<Typography\.Text[\s\S]{0,200}>\s*\{name\}\s*<\/Typography\.Text>/u)
  })

  it('容器允许收缩，否则省略号永不出现、溢出判定恒为假', () => {
    const label = ruleBody('.dsh-fnos-tree-node-label', /display:\s*inline-flex;/u)
    expect(label).toMatch(/min-width:\s*0;/u)
    // `min-width: max-content` 会把文本撑到内容宽度，省略号永远不触发。
    expect(label).not.toContain('min-width: max-content')
  })

  it('不自定义 text-overflow，避免与 Typography 自带规则抵消', () => {
    const text = ruleBody('.dsh-fnos-tree-node-label-text')
    expect(text).not.toContain('text-overflow')
    expect(text).not.toContain('white-space')
  })
})
