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
const DIALOG_LOCALES = read('../../src/client/locales.ts')

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
    // Modal 与 Popconfirm 都由 Semi portal 到 body，`panelRef.contains(target)`
    // 对它们恒为 false——弹框里点一下就会被判成「点了面板外部」。
    expect(PANEL).toMatch(/const floatingOpen = [\s\S]{0,160}createTarget !== undefined/u)
    expect(PANEL).toMatch(/const floatingOpen = [\s\S]{0,160}contextMenu !== undefined/u)
  })

  it('每个 portal 浮层的开关状态都纳入了 floatingOpen 守卫', () => {
    // 这条防的是「新增浮层却忘了加守卫」——删除 Modal 曾漏过一次，症状是
    // 弹框一打开、点一下就整个面板消失。做法：找出所有作为浮层开关的 state，
    // 要求每一个都出现在 floatingOpen 的表达式里。
    const guard = /const floatingOpen =([\s\S]{0,240})/u.exec(PANEL)?.[1] ?? ''
    expect(guard.length).toBeGreaterThan(0)
    // 面板里所有 portal 浮层的开关状态（新建弹框、右键菜单）。
    const floatingStates = ['createTarget', 'contextMenu']
    for (const state of floatingStates) {
      expect(guard).toContain(state)
    }
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
  it('标题栏没有「新建」入口：新建只从右键菜单进入', () => {
    // 标题栏的按钮是**授权**入口，不是新建入口。两者不要混淆：
    // 新建作用在某个具体目录上，必须由右键指定对象；授权是全局动作。
    expect(PANEL).not.toContain('openCreateDialog')
    const header = /className="dsh-fnos-path-panel-header"[\s\S]*?<\/div>/u.exec(PANEL)?.[0] ?? ''
    expect(header.length).toBeGreaterThan(0)
    expect(header).toContain('authorizeNewDirectory')
    expect(header).not.toContain('createFolder')
    expect(header).not.toContain('createFile')
    // 菜单项文案仍在（右键菜单要用）。
    expect(PANEL).toContain("t('createFolder')")
    expect(PANEL).toContain("t('createFile')")
  })

  it('标题栏提供授权入口，走 fnOS 原生选择器', () => {
    expect(PANEL).toContain('authorizeDirectory')
    expect(PANEL).toContain('pickAuthorizedDirectory')
    /*
      授权成功后必须同时刷新树与写持久化，缺一样都会导致「授权了但重装就丢」。

      这里不再用「相距若干字符」的窗口断言：授权链路现在有两套成功路径
      （宿主动调 / 独立浏览器页面走回调页），代码距离被合理拉开，写死窗口
      会让断言假红。改为断言「整个文件里两件事都做了」。
    */
    expect(PANEL).toContain('applyEntries')
    expect(PANEL).toContain('requestPersistAuthorizedDirectories')
    // 独立浏览器页面：必须订阅回调，否则授权完成后列表不刷新。
    expect(PANEL).toContain('listenFnosAppAuthResult')
  })

  it('标题栏两个按钮都是图标按钮，文案走 Tooltip 而非原生 title', () => {
    /*
      2026-11-12 变更：「新增授权」由文案按钮改为**图标 + Tooltip**。
      理由是它和关闭按钮同属头部动作，两个都是图标才成组；文字按钮会把标题挤窄。

      仍不用原生 `title`：原生气泡是浏览器自绘的浅灰直角小方块，与面板的玻璃
      磨砂浮层不是一套。用 `DshTooltip`。
    */
    const header = /className="dsh-fnos-path-panel-header"[\s\S]*?<\/div>/u.exec(PANEL)?.[0] ?? ''
    expect(header.length).toBeGreaterThan(0)
    expect(header).not.toContain('title=')
    // 授权：图标按钮 + Tooltip 文案 + 同文案的 aria-label。
    expect(header).toContain('dsh-fnos-path-panel-new')
    expect(header).toContain('IconPlus')
    expect(header).toContain("Tooltip content={t('authorizeNewDirectory')}")
    expect(header).toContain("aria-label={t('authorizeNewDirectory')}")
    // 关闭仍是无障碍可认的图标按钮。
    expect(header).toContain('dsh-fnos-path-panel-close')
    expect(header).toContain("aria-label={t('inputPickerClose')}")
  })

  it('右键先弹上下文菜单，不直接开新建弹框', () => {
    expect(PANEL).toContain('onContextMenu={handleContextMenu}')
    // 右键只记录目标条目与坐标；弹框由菜单项触发（createFromContextMenu）。
    expect(PANEL).toContain('setContextMenu({ path: entry.path')
    // 窗口放宽到 1200：这段里加了坐标估算的说明注释。
    expect(PANEL).toMatch(/handleContextMenu[\s\S]{0,1200}setContextMenu/u)
    expect(PANEL).not.toMatch(/handleContextMenu[\s\S]{0,1200}setCreateTarget/u)
    expect(PANEL).toContain('createFromContextMenu')
  })

  it('菜单自绘并落在鼠标坐标上，不再依赖 Semi Dropdown 定位', () => {
    // Semi Dropdown 的定位依赖锚点 rect 与容器坐标系，喂零尺寸锚点会被算到
    // 面板角落；custom 触发下它也不注册外部点击关闭。两点都必须自己接管。
    expect(PANEL).toContain('dsh-fnos-path-context-menu')
    expect(PANEL).toContain('style={{ left: contextMenu.x, top: contextMenu.y }}')
    expect(ruleBody('.dsh-fnos-path-context-menu')).toMatch(/position:\s*fixed;/u)
  })

  it('菜单经 Portal 挂到 body，否则 fixed 会被包含块劫持', () => {
    // 面板或其背景层带 `backdrop-filter` 时会成为 fixed 后代的包含块。菜单若
    // 留在面板内部，left/top 就不是视口坐标——实机表现为「右键在顶部，菜单却
    // 出现在面板右下角」。这一条是那次 bug 的防线。
    expect(PANEL).toContain('createPortal')
    expect(PANEL).toMatch(/document\.body,\s*\)\}/u)
  })

  it('磨砂背景单独成层，不写在面板根元素上', () => {
    // 背景写在根元素上会让整个面板成为 fixed 后代的包含块；上游 MenuSurface 同样
    // 把 material 拆成独立子层。
    expect(PANEL).toContain('dsh-fnos-path-panel-material')
    // 直接断言 material 规则体的声明，不从根元素规则反向推断——根元素规则附近的
    // 说明性注释里也提到 backdrop-filter，反向断言会误伤。
    const material = /\n\.dsh-fnos-path-panel-material \{([\s\S]*?)\n\}/u.exec(STYLE)?.[1] ?? ''
    expect(material.length).toBeGreaterThan(0)
    expect(material).toMatch(/backdrop-filter:\s*var\(--dsw-menu-backdrop-filter\)/u)
    expect(material).toMatch(/z-index:\s*-1;/u)
    expect(material).toMatch(/pointer-events:\s*none;/u)
  })

  it('磨砂填充用 surface-fill，而不是 macOS 上近不透明的 specific-menu', () => {
    // `--dsw-specific-menu` 在 darwin 上被覆盖成 0.94，是「没有 opaque backing
    // 的浮层」的保守值；用它就没有玻璃通透感。指令面板用的是 surface-fill
    // （0.58 浅色 / 0.45 深色）。
    const material = /\n\.dsh-fnos-path-panel-material \{([\s\S]*?)\n\}/u.exec(STYLE)?.[1] ?? ''
    expect(material).toContain('var(--dsw-menu-surface-fill)')
    expect(material).not.toContain('var(--dsw-specific-menu)')
  })

  it('菜单落点被收进视口，且用实测尺寸校正', () => {
    /*
      早前用写死的 `148 × 84` 估算菜单尺寸，但 6 项菜单实际接近 200px 高——窄屏上
      点靠近底部的条目，菜单下半截会掉出视口。

      现在两段式：先用保守估算定位（渲染前拿不到真实尺寸），渲染完成后
      `useLayoutEffect` 按实测宽高再校正一次。
    */
    expect(PANEL).toContain('clampMenuPosition')
    expect(PANEL).toMatch(/window\.innerWidth - width - margin/u)
    expect(PANEL).toMatch(/window\.innerHeight - height - margin/u)
    // 渲染后校正
    expect(PANEL).toContain('useLayoutEffect')
    expect(PANEL).toMatch(/getBoundingClientRect\(\)[\s\S]{0,200}clampMenuPosition/u)
  })

  it('只读路径不出现「删除」「重命名」', () => {
    /*
      应用共享目录（`@appshare` / `@apphome` / `@appdata` / `@appconf`）由 fnOS
      框架管理，宿主对它们返回 409。与其让用户点了才看到失败提示，不如不展示。

      判据是宿主给的 `removable`，与 `convertDirectories` 用同一套只读来源。
    */
    expect(PANEL).toMatch(/contextMenu\.removable \? \(/u)
    // 重命名与删除两处都要门控
    const guards = PANEL.match(/contextMenu\.removable/g) ?? []
    expect(guards.length).toBeGreaterThanOrEqual(2)

    const HOST = readFileSync(new URL('../../src/host/authorized-directories.ts', import.meta.url), 'utf8')
    // 宿主在根目录条目上真的填了这个字段
    expect(HOST).toMatch(/removable: !readOnly\.has\(/u)
  })

  it('客户端必须透传 removable，否则界面判不出只读路径', () => {
    /*
      宿主对应用共享目录返回 `removable: false`，界面据此隐藏「删除」「重命名」。

      `entriesFromResponse` 构造条目时漏掉这个字段的话，前端只能按「可删」处理——
      实测右键菜单里那两项照常出现，点下去才拿到 409。这条回归守的就是那一层。
    */
    const CLIENT = readFileSync(new URL('../../src/client/services/authorized-directories-client.ts', import.meta.url), 'utf8')
    expect(CLIENT).toMatch(/entry\.removable === false \? \{ removable: false \}/u)
  })

  it('新建/重命名弹框在窄屏收进视口，内边距收紧', () => {
    /*
      三个弹框（新建文件夹 / 新建文件 / 重命名）共用 `dsh-fnos-create-dialog`
      且 `width={454}`。Semi 把它写成 `.semi-modal` 的内联样式——窄屏下必须由
      **最外层** 的 `max-width` 收住（内容层收不回来）。

      实测（393px 视口）：弹框 369px（= 393 − 24），内边距从 24 收到 16，
      桌面端保持 454 / 24 不变。
    */
    const SCSS = readFileSync(new URL('../../src/styles/index.scss', import.meta.url), 'utf8')

    /*
      **这三个弹框带 `centered`，Semi 在居中模式下不生成 `.semi-modal` 包裹层**：
      `className` 直接落在内容元素上（祖先链是
      `.dsh-fnos-create-dialog > .semi-portal > body`）。

      所以 `:has(> .semi-modal-content…)` 那条选择器对它们不匹配——第一版就是这么
      写错的，窄屏下弹框仍按 454 撑开、左右贴边溢出，标题被切掉。

      正确做法是直接作用于元素自身。
    */
    expect(SCSS).toMatch(/\.dsh-fnos-create-dialog \{[^}]*max-width: calc\(100vw - 24px\)/u)
    expect(SCSS).toMatch(/\.dsh-fnos-create-dialog \{[^}]*margin-inline: auto/u)
    // 不能再依赖 :has 包裹层
    expect(SCSS).not.toContain(':has(> .semi-modal-content.dsh-fnos-create-dialog)')

    // 移动端内边距收紧 + 按钮不换行
    const mobile = SCSS.slice(SCSS.lastIndexOf('@media (max-width: 767px)'))
    expect(mobile).toContain('.dsh-fnos-create-dialog')
    expect(mobile).toMatch(/semi-modal-header \{[\s\S]{0,60}padding: 16px 16px 0/u)
    expect(mobile).toContain('flex-wrap: nowrap')
  })

  it('新建/重命名弹框的内层跟着外层收窄，标题与按钮不被切', () => {
    /*
      只给外层 `max-width` 不够。Semi 在 centered 模式下把内层 header / body /
      footer 的 `min-width` 留成 `auto`，它们的收缩底线是**内容宽度**——标题和
      footer 里的按钮仍按 454 排，内层撑到 422px、超出 369px 的容器，真机上
      标题左沿与「确定」右沿都被切掉。

      `min-width: 0` 才能解除这条收缩底线。

      **选择器不能带 `>`**：`dsh-fnos-create-dialog` 落在内容层上，header 在它
      内部的 `.semi-modal-content` 里（祖先链是
      `header → .semi-modal-content → .dsh-fnos-create-dialog`），直接子元素
      选择器一个都匹配不上。
    */
    // 精确取 `.dsh-fnos-create-dialog` 那一层块的规则体（内层规则嵌套在其中）。
    const dialog = ruleBody('.dsh-fnos-create-dialog', /min-width:\s*0/u)

    expect(dialog).toMatch(/\.semi-modal-header,\s*\.semi-modal-body,\s*\.semi-modal-footer \{[^}]*min-width: 0/u)
    expect(dialog).toMatch(/\.semi-modal-content \{[^}]*min-width: 0/u)
    expect(dialog).toMatch(/\.semi-modal-footer > div \{[^}]*min-width: 0/u)
    // 写成直接子元素就完全失效：header 在子层 `.semi-modal-content` 里
    expect(dialog).not.toMatch(/> \.semi-modal-(header|body|footer)\s*(,|\{)/u)
  })

  it('点击菜单外或按 Esc 自动收起菜单', () => {
    // 实机反馈的第二个问题：点面板别处菜单不消失。
    expect(PANEL).toMatch(/if \(contextMenu === undefined\) return/u)
    expect(PANEL).toContain('menuRef.current?.contains(event.target)')
    expect(PANEL).toContain("if (event.key === 'Escape') setContextMenu(undefined)")
    expect(PANEL).toContain("document.addEventListener('pointerdown', onPointerDown, true)")
  })

  it('文件也能右键（可删除），新建项只对目录显示', () => {
    // 删除对文件和目录都开放，因此右键不再按类型拦截。
    expect(PANEL).not.toContain("if (entry !== undefined && entry.kind !== 'directory') return")
    expect(PANEL).toContain("contextMenu.kind !== 'directory' ? null :")
  })

  it('菜单项带图标', () => {
    // 用户要求列表显示图标；三个菜单项各配一个语义图标。
    expect(PANEL).toMatch(/<IconFolder size="small" \/>\s*\{t\('createFolder'\)\}/u)
    expect(PANEL).toMatch(/<IconFile size="small" \/>\s*\{t\('createFile'\)\}/u)
    expect(PANEL).toMatch(/<IconDelete size="small" \/>\s*\{t\('deleteEntry'\)\}/u)
  })

  it('菜单含删除项，且用危险色区分', () => {
    expect(PANEL).toContain('confirmDeleteFromContextMenu')
    expect(ruleBody('.dsh-fnos-path-context-item')).toContain('&.is-danger')
    expect(ruleBody('.dsh-fnos-path-context-item')).toContain('dsw-alias-state-error-primary')
  })

  it('删除用 Popconfirm 就地确认，不再弹整块 Modal', () => {
    // 破坏性操作必须确认；但用 Popconfirm 比 Modal 轻，且不打断右键上下文。
    expect(PANEL).toContain('<Popconfirm')
      // 确定按钮与「新建文件夹」弹框同色（品牌蓝），不用 danger 红。
  expect(PANEL).toContain("okButtonProps={{ className: 'dsh-fnos-delete-confirm' }}")
  // 标题左侧的警告图标已去掉（Semi 默认图标与插件里其它弹框不一致）。
  expect(PANEL).toContain('icon={null}')
    expect(PANEL).toContain('onConfirm={() => { void confirmDeleteFromContextMenu() }}')
    // 旧的删除 Modal 已移除：不应再有 submitDelete / deleteTarget。
    expect(PANEL).not.toContain('submitDelete')
    // 旧 Modal 的 state 已删除；`deleteTargetRef` 是另一回事，删除链路的契约
    // 由 delete-entry-contract.spec.ts 覆盖。
    expect(PANEL).not.toContain('[deleteTarget, setDeleteTarget]')
  })

  it('删除成功后把条目从树与勾选中摘掉', () => {
    // 否则会留下指向已删路径的引用，发出去模型只会拿到不存在的路径。
    expect(PANEL).toContain('removeNode(current, target.path)')
    expect(PANEL).toContain('entries.current.delete(target.path)')
    expect(PANEL).toContain("current?.filter(path => path !== target.path)")
  })

  it('菜单含新建文件夹与新建文件两项', () => {
    expect(PANEL).toMatch(/dsh-fnos-path-context-item[\s\S]{0,220}createFromContextMenu\('directory'\)/u)
    expect(PANEL).toMatch(/dsh-fnos-path-context-item[\s\S]{0,220}createFromContextMenu\('file'\)/u)
  })

  it('弹框收集名称并走宿主路由创建', () => {
    expect(PANEL).toContain('createAuthorizedEntry(createTarget.parent, name, createTarget.kind)')
    expect(PANEL).toContain('createDialogTitle')
    // 标签按条目类型区分（文件夹/文件），并带必填标记。
    expect(PANEL).toContain('createDialogFolderLabel')
    expect(PANEL).toContain('createDialogFileLabel')
    expect(PANEL).toContain('dsh-fnos-create-required')
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

/**
 * 新建文件夹 / 新建文件的弹框：视觉对齐 fnOS「文件管理」的同名弹框。
 *
 * 关键约束是**按钮色调只在本插件内改**：DSH 亮色主题的主按钮是反色（深底白
 * 字），fnOS 用品牌蓝。可以覆盖，但作用域必须收在 `dsh-fnos-create-dialog`
 * 里，并且不能把色值下沉到共享包主题——否则所有插件的主按钮都会跟着变蓝。
 */
describe('FNOS-038 新建弹框的按钮色调只在本插件内覆盖', () => {
  /** 内层规则写在 `.dsh-fnos-create-dialog` 里，先取外层块再在块内断言。 */
  const dialog = ruleBody('.dsh-fnos-create-dialog')

  it('Modal 带上隔离用的类名', () => {
    expect(PANEL).toContain('className="dsh-fnos-create-dialog"')
  })

  it('品牌蓝定义在弹框作用域内，不写成全局变量', () => {
    expect(dialog).toContain('--dsh-fnos-create-brand: #06f;')
    expect(dialog).toContain('--dsh-fnos-create-brand-hover: #005eeb;')
    expect(dialog).toContain('--dsh-fnos-create-brand-active: #0043b8;')
  })

  it('确定按钮按显式类名落色，且带 !important 压过共享主题', () => {
    // 共享主题的按钮规则是 `body[data-dsh-semi-theme] ... .semi-button-primary...`
    // （特异性 0,6,1），常规选择器压不过；这里必须靠显式类名 + !important。
    expect(dialog).toContain('.semi-modal-footer .dsh-fnos-create-confirm {')
    expect(dialog).toContain('background: var(--dsh-fnos-create-brand) !important;')
    expect(dialog).toContain('background: var(--dsh-fnos-create-brand-hover) !important;')
    // 按钮类名由 Modal 的 okButtonProps 注入。
    expect(PANEL).toContain("okButtonProps={{ className: 'dsh-fnos-create-confirm' }}")
  })

  it('取消按钮是白底描边，与 fnOS 弹框一致', () => {
    expect(dialog).toContain('.semi-modal-footer .dsh-fnos-create-cancel {')
    expect(dialog).toContain('background: var(--dsw-alias-bg-layer-1) !important;')
    expect(dialog).toContain('border: 1px solid var(--dsw-alias-border-l2) !important;')
    expect(PANEL).toContain("cancelButtonProps={{ className: 'dsh-fnos-create-cancel' }}")
  })

  it('吃掉主题给 header/footer 的 24px 外边距，避免弹框被撑高', () => {
    // 实测（真机页面注入同结构 DOM）：主题给 .semi-modal-header/.semi-modal-footer
    // 各加 24px 上下 margin，弹框因此 326px 高；归零后收到 196px，接近 fnOS 版式。
    expect(dialog).toContain('padding: 0 !important;')
    expect(dialog.match(/margin: 0 !important;/gu)?.length ?? 0).toBeGreaterThanOrEqual(3)
    expect(dialog).toContain('padding: 20px 24px 0 !important;')
    expect(dialog).toContain('padding: 12px 24px 0 !important;')
    expect(dialog).toContain('padding: 16px 24px 20px !important;')
  })

  it('关闭按钮去掉灰色底块，与 fnOS 的无底色 × 一致', () => {
    expect(dialog).toContain('.semi-modal-header .semi-modal-close {')
    expect(dialog).toContain('background: transparent !important;')
  })

  it('不再有常驻说明行（规则并进名称不可用的错误文案）', () => {
    expect(PANEL).not.toContain('dsh-fnos-create-hint')
    expect(DIALOG_LOCALES).not.toContain('createDialogHint')
    expect(DIALOG_LOCALES).toContain('名称不能包含 : * ? " < > |，也不能带路径分隔符。')
  })

  it('共享包主题里没有混入 fnOS 品牌蓝', () => {
    // 色值只能出现在插件样式里；共享包一旦被改动，所有插件的主按钮都会变色。
    const sharedTheme = read('../../../../packages/dsh-semi-ui/src/theme.scss')
    const sharedRuntime = read('../../../../packages/dsh-semi-ui/src/theme.ts')
    for (const source of [sharedTheme, sharedRuntime]) {
      expect(source).not.toContain('#06f')
      expect(source).not.toContain('0066ff')
      expect(source).not.toContain('dsh-fnos-create-brand')
    }
  })
})

describe('FNOS-039 弹框与 fnOS 原生弹框的细节对齐', () => {
  // describe 作用域各自取一次：上一个 describe 里的 `dialog` 不在本作用域内。
  const dialog = ruleBody('.dsh-fnos-create-dialog')

  // 基准值是直接量 fnOS「文件管理」新建文件夹弹框得到的：
  // 弹框 454 宽、输入 36 高且内部上下各 1px、按钮 88×36 / radius 8 / 600、间距 12、
  // 取消为透明底 + 描边、placeholder 与标题一致。
  it('输入框 36 高，内层撑满保证文字上下对称', () => {
    expect(dialog).toContain('height: 36px !important;')
    // Semi 的 .semi-input 默认 30px 且贴顶，不撑满会出现「上 1、下 9」的偏心。
    expect(dialog).toContain('.semi-input {')
    expect(dialog).toContain('height: 100% !important;')
    expect(dialog).toContain('line-height: 34px !important;')
  })

  it('按钮尺寸与字重对齐 fnOS（88×36 / radius 8 / 600）', () => {
    expect(dialog).toContain('min-width: 88px;')
    expect(dialog).toContain('height: 36px;')
    expect(dialog).toContain('border-radius: 8px;')
    expect(dialog).toContain('font-weight: 600;')
    // 真机结构是 `.semi-modal-footer > div > button + button`：按钮在包裹层里，
    // gap 写在外层不会生效（外层只有一个孩子），必须写进包裹层。
    expect(dialog).toContain('display: flex !important;')
    expect(dialog).toContain('.semi-modal-footer > div {')
    expect(dialog).toContain('gap: 15px !important;')
    // Semi 自带相邻按钮 margin-left，必须归零，否则会叠加成 15 + 8。
    expect(dialog).toContain('.semi-button + .semi-button {')
    expect(dialog).toContain('margin-left: 0 !important;')
  })


  it('弹框去掉外描边，只靠阴影分层', () => {
    // 这圈边框来自 Semi 基础样式 `border: 1px solid var(--semi-color-border)`。
    expect(dialog).toContain('border: 0 !important;')
    // 阴影沿用主题，不自己再叠一层。
    expect(dialog).not.toContain('box-shadow: 0 12px');
  })

  it('取消按钮是透明底，不是填充色卡片', () => {
    expect(dialog).toContain('background: transparent !important;')
    expect(dialog).toContain('color: var(--dsw-alias-label-secondary) !important;')
  })

  it('弹框宽度对齐 fnOS 的 454', () => {
    expect(PANEL.match(/width=\{454\}/gu)?.length ?? 0).toBe(2)
  })

  it('两个弹框都有 placeholder：新建用标题、重命名用原名', () => {
    // 新建：占位与标题一致（fnOS 原生就是这样）。
    expect(PANEL).toMatch(/placeholder=\{createTarget\?\.kind === 'file' \? t\('createDialogFileTitle'\) : t\('createDialogTitle'\)\}/u)
    // 重命名：预填值清空后仍能看到原名。
    expect(PANEL).toContain("placeholder={displayName(renameTarget?.semanticPath ?? '')}")
  })
})

describe('选择面板：非 fnOS 环境不发起授权', () => {
  const PICKER = readFileSync(new URL('../../src/components/FnosAuthorizedPathPicker.tsx', import.meta.url), 'utf8')
  const LOCALES = readFileSync(new URL('../../src/client/locales.ts', import.meta.url), 'utf8')

  it('授权前先判断是不是 fnOS 托管，否则只给反馈', () => {
    /*
      授权只能由用户在 fnOS 主程序里逐级确认；本地 `dsh web` 这类环境里这条链路
      根本不存在——继续执行只会打开一个打不开的新标签页。

      判据用 `isFnosHosted()` 而不是「有没有宿主桥」：**独立浏览器页面同样属于
      fnOS 应用**，只是没有桥，那条路要走 `openAppAuth` 授权页，是正常流程。
    */
    const body = PICKER.slice(PICKER.indexOf('const authorizeDirectory = useCallback'))
    expect(body).toContain('isFnosHosted()')
    // 守卫必须在唤起选择器之前 return。
    const guardAt = body.indexOf('if (!isFnosHosted())')
    const pickAt = body.indexOf('pickAuthorizedDirectory(')
    expect(guardAt).toBeGreaterThan(-1)
    expect(pickAt).toBeGreaterThan(guardAt)
    // 给的是反馈而不是静默返回。
    expect(body.slice(guardAt, pickAt)).toContain('Toast.warning')
  })

  it('文案九种语言齐备', () => {
    expect(LOCALES).toContain("authorizeUnsupportedHere: '当前环境不是 fnOS，无法发起目录授权。'")
    expect(LOCALES).toContain("authorizeUnsupportedHere: 'Directory authorization is unavailable")
  })
})
