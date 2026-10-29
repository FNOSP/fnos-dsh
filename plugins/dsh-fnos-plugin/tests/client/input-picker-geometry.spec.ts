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
  it('工具栏有新建入口，提供文件夹与文件两种选择', () => {
    expect(PANEL).toContain("t('createFolder')")
    expect(PANEL).toContain("t('createFile')")
    expect(PANEL).toContain('dsh-fnos-path-panel-action')
  })

  it('右键目录可打开新建弹框；命中文件不提供新建', () => {
    expect(PANEL).toContain('onContextMenu={handleContextMenu}')
    expect(PANEL).toContain("if (entry !== undefined && entry.kind !== 'directory') return")
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
  it('用 scrollWidth/clientWidth 判断是否真的溢出', () => {
    // 无条件包 Tooltip 会让「名字放得下」的行也弹提示，是实机反馈的问题。
    expect(PANEL).toContain('element.scrollWidth > element.clientWidth')
  })

  it('未溢出时不渲染 Tooltip，溢出了才渲染', () => {
    expect(PANEL).toMatch(/return truncated\s*\n?\s*\? <Tooltip/u)
    expect(PANEL).toMatch(/:\s*content/u)
  })

  it('面板宽度变化后重新测量（ResizeObserver）', () => {
    expect(PANEL).toContain('ResizeObserver')
    expect(PANEL).toContain("observer?.observe(element)")
  })

  it('字体加载完成后重新测量，避免首帧误判', () => {
    expect(PANEL).toContain("fonts?.addEventListener('loadingdone', measure)")
  })

  it('标签容器允许收缩，否则省略号永不出现、判断恒为假', () => {
    const label = ruleBody('.dsh-fnos-tree-node-label', /display:\s*inline-flex;/u)
    expect(label).toMatch(/min-width:\s*0;/u)
    // `min-width: max-content` 会把文本撑到内容宽度，省略号永远不触发。
    expect(label).not.toContain('min-width: max-content')
    const text = ruleBody('.dsh-fnos-tree-node-label-text')
    expect(text).toMatch(/text-overflow:\s*ellipsis;/u)
    expect(text).toMatch(/min-width:\s*0;/u)
  })
})
