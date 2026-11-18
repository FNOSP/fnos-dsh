import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/** 本插件测试统一用相对本文件的 URL 定位源码（该包没有共享的 paths 助手）。 */
const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8')

/**
 * fnOS 详情页配置区的呈现约束。
 *
 * 这一轮的界面调整来自实机截图：配置被一层折叠面板包住，用户要先点一下才能
 * 看到内容；而这一页里**只有这一块内容**，折叠不承担任何信息架构作用，只增加
 * 一次点击。因此折叠被整体移除，内容常驻。
 *
 * 另外三处是可用性问题：
 *
 *  - 授权目录多起来没有上限，会把整页撑得很长，需要固定视口高度；
 *  - 反代的说明文字是长句，平铺在标题下会挤压表单，收进 tip 图标；
 *  - 文本框既不知道快捷键、也不知道「一行一个」，且行数无上限。
 */
const CARD = read('../../src/components/AuthorizedDirectoriesCard.tsx')
/** 「三方插件代理」已从授权目录卡片拆出为独立分组（FNOS-052）。 */
const PROXY = read('../../src/components/GatewayProxyCard.tsx')
const SCSS = read('../../src/styles/index.scss')
const LOCALES = read('../../src/client/locales.ts')

/**
 * 从**中文**块里取一条文案。
 *
 * `locales.ts` 里 `en` 与 `zh` 定义了同名 key，全局正则只会命中先出现的 `en`。
 * 断言中文文案必须先把中文块切出来。
 */
function zhCopy(key: string): string {
  const start = LOCALES.indexOf('export const zh')
  if (start < 0) throw new Error('locales.ts 里找不到中文块')
  const match = new RegExp(`${key}: '((?:[^'\\\\]|\\\\.)*)'`).exec(LOCALES.slice(start))
  if (match === null) throw new Error(`中文块里找不到 ${key}`)
  return match[1] ?? ''
}

describe('配置区不再折叠，内容常驻', () => {
  it('不再有折叠开关（没有 aria-expanded / 可点击头部）', () => {
    // 折叠头是一个带 aria-expanded 的 <button>。移除折叠后不应再有该**属性**。
    // 只剔掉注释再断言：正文注释里保留「曾经是 <button aria-expanded>」的说明是
    // 有价值的（它记录了为什么不再折叠），不该因此判失败。
    const code = CARD.replace(/\{\/\*[\s\S]*?\*\/\}/gu, '').replace(/\/\*[\s\S]*?\*\//gu, '')
    expect(code).not.toContain('aria-expanded')
    expect(code).not.toContain('dsh-fnos-authorized-chevron')
  })

  it('不再持有开合状态，也不再条件渲染主体', () => {
    expect(CARD).not.toMatch(/const \[open, setOpen\]/)
    // 旧的写法是 `{open ? (<div ...card-body>...) : null}`：条件渲染会把内容
    // 从 DOM 里拿掉，而常驻意味着它始终在。
    expect(CARD).not.toMatch(/\{open \?/)
  })

  it('主体常驻渲染，且保留锚点 id（外部仍可深链）', () => {
    expect(CARD).toContain('id="dsh-fnos-authorized-directories-body"')
    expect(CARD).toContain('dsh-fnos-authorized-card-body')
  })

  it('数据加载不再依赖「被展开」，挂载即拉取', () => {
    // 旧实现是 `useEffect(() => { if (open) {...} }, [open])`：不点开就不发请求。
    expect(CARD).not.toMatch(/if \(open\)/)
    expect(CARD).toMatch(/useEffect\(\(\) => \{[\s\S]{0,120}refresh\(\)/)
  })
})

describe('图标按钮尺寸', () => {
  it('图标 20px、容器 32px（保持留白比例与点击热区）', () => {
    // 16px 在大屏上偏小，与 28px 高的按钮不成比例。
    const SCSS = readFileSync(new URL('../../src/styles/index.scss', import.meta.url), 'utf8')
    const idx = SCSS.indexOf('.dsh-fnos-icon-button {')
    const rule = SCSS.slice(idx, SCSS.indexOf('\n}', idx))
    expect(rule).toContain('width: 32px')
    expect(rule).toContain('width: 20px')
  })
})

describe('授权目录：不出现多余的顶部分隔线', () => {
  it('卡片主体没有 border-top', () => {
    /*
      这一块就是卡片的全部内容（按钮行 + 目录列表），上面没有需要分隔的兄弟区段。
      留着会在弹框顶部横一道线，看起来像半个分隔符。
    */
    const idx = SCSS.indexOf('.dsh-fnos-authorized-card-body {')
    expect(idx).toBeGreaterThan(-1)
    // 去掉注释再看：说明文字里提到 `border-top` 是解释原因，不算声明。
    const rule = SCSS.slice(idx, SCSS.indexOf('\n}', idx)).replace(/\/\*[\s\S]*?\*\//gu, '')
    expect(rule).not.toMatch(/^\s*border-top\s*:/mu)
    // 顶部也不该留白：这一块紧接面板顶端，12px 的 padding-top 只是一段空当。
    expect(rule).toMatch(/padding:\s*0 0 8px/u)
  })
})

describe('授权目录：添加/刷新改成纯图标按钮', () => {
  it('无边框无底色，文案移进 tooltip，保留 aria-label', () => {
    /*
      它们原先是有文字与边框的按钮，在列表上方各占一大块宽度，视觉重心比下面的
      目录行还重。图标 + 悬浮提示既保住可读性，又把重心还给目录列表。

      `aria-label` 必须留：图标按钮没有可见文本，缺了它读屏软件只会念「按钮」。
    */
    const CARD = read('../../src/components/AuthorizedDirectoriesCard.tsx')
    expect(CARD).toContain('dsh-fnos-icon-button')
    expect(CARD).toContain("content={t('add')}")
    expect(CARD).toContain("content={t('refresh')}")
    expect(CARD).toContain("aria-label={t('add')}")
    expect(CARD).toContain("aria-label={t('refresh')}")
    // 不再用带边框的按钮类承载这两个动作。
    expect(CARD).not.toContain('authorized-button--primary')
  })

  it('按钮本身透明，悬停才出背景', () => {
    const rule = SCSS.slice(SCSS.indexOf('.dsh-fnos-icon-button {'))
    const body = rule.slice(0, rule.indexOf('}'))
    expect(body).toContain('background: transparent')
    expect(body).toContain('border: none')
    expect(rule).toContain('&:hover:not(:disabled)')
  })
})

describe('授权目录：打开按钮与路径省略', () => {
  it('每个目录都有「打开」按钮（只读目录也能浏览）', () => {
    /*
      「打开」对每个目录都有意义——包括只读的应用共享目录：用户想确认目录里
      有什么，不该被「不能取消授权」顺带禁掉浏览。
    */
    const CARD = read('../../src/components/AuthorizedDirectoriesCard.tsx')
    expect(CARD).toContain("t('open')")
    expect(CARD).toContain('openDirectory')
    expect(CARD).toContain('openFnosFileManager')
    // 用 openFileManager 而不是 openFile：后者按文件类型交给默认应用，对目录无意义。
    expect(CARD).not.toContain('sdk.openFile(')
  })

  it('路径用 Semi Typography 省略 + tooltip，且有最大宽度', () => {
    // 自写省略号只有原生 title：延迟约 1 秒、样式不受控、没截断时也会弹。
    const CARD = read('../../src/components/AuthorizedDirectoriesCard.tsx')
    expect(CARD).toContain('ellipsis={{ showTooltip: true }}')
    expect(CARD).not.toContain('title={directory.semanticPath}')

    /*
      必须用**三个类名**（0,3,0）：Semi 的省略规则是双类 0,2,0，只重复一次仍打平，
      而同权重下更靠后的 Semi 胜出——实测 `maxWidth` 仍是 `100%`。
    */
    expect(SCSS).toContain('.dsh-fnos-authorized-path.dsh-fnos-authorized-path.dsh-fnos-authorized-path {')
    const idx = SCSS.indexOf('.dsh-fnos-authorized-path.dsh-fnos-authorized-path.dsh-fnos-authorized-path {')
    const body = SCSS.slice(idx, SCSS.indexOf('\n}', idx))
    expect(body).toContain('max-width')
    expect(body).toContain('min-width: 0')
  })
})

describe('授权目录卡片：不渲染重复标题', () => {
  it('卡片里没有标题行（分组名已在左侧菜单）', () => {
    /*
      分组名「授权目录」已经写在左侧菜单里，卡内再写一遍「fnos」是同一信息的
      重复，还占掉一行高度、把首屏的目录列表往下推。
    */
    const CARD = read('../../src/components/AuthorizedDirectoriesCard.tsx')
    expect(CARD).not.toContain('dsh-fnos-authorized-card-header')
    expect(CARD).not.toContain("t('title')")
    // 列表主体仍在，它自带的 border-top 就是面板顶部分隔线。
    expect(CARD).toContain('dsh-fnos-authorized-card-body')
  })
})

describe('授权目录列表：不单独限高，滚动交给面板', () => {
  it('列表容器没有自身高度上限与滚动条', () => {
    /*
      早前钉了 `max-height: 300px` + `overflow-y: auto`，理由是「目录没有数量
      上限，会把保存按钮顶出屏幕」。但外层面板本身就是滚动容器，列表再限高只是
      造出**嵌套滚动区**：滚轮落在列表与落在面板上行为不同，同一屏两套滚动。
    */
    const block = SCSS.slice(SCSS.indexOf('.dsh-fnos-authorized-path-list {'))
    const rule = block.slice(0, block.indexOf('}'))
    // 只匹配声明行：注释里留着「早前钉过 max-height」的说明，不能被误命中。
    expect(rule).not.toMatch(/^\s*max-height\s*:/m)
    expect(rule).not.toMatch(/^\s*overflow-y\s*:/m)
  })

  it('右列默认自己滚，仅「插件管理」交给 tab 内容区', () => {
    /*
      右列是授权目录 / 运行 / 日志三个视图的滚动容器——真机踩到过：把它的
      overflow 一律改成 visible 后，「授权目录」滚不到底（滚动条消失，底部内容
      被裁）。

      只有「插件管理」例外：那个视图内部有 tab 栏，若由右列滚动，tab 栏会跟着
      滚走。用 `:has()` 反向选择把它排除。
    */
    const panel = SCSS.slice(SCSS.indexOf('.dsh-fnos-config-panel {'))
    expect(panel.slice(0, panel.indexOf('}'))).toContain('overflow-y: auto')
    expect(SCSS).toContain('.dsh-fnos-config-panel:has(.dsh-fnos-plugins-tabs)')
    const contentRule = SCSS.slice(SCSS.indexOf('.dsh-fnos-plugins-tabs .semi-tabs-content {'))
    expect(contentRule.slice(0, contentRule.indexOf('}'))).toContain('overflow-y: auto')
  })
})

describe('反代配置：文案、tip、placeholder、行数上限', () => {
  it('标题文案改为「三方插件 proxy」', () => {
    expect(zhCopy('gatewayProxyTitle')).toBe('三方插件 proxy')
    expect(LOCALES).not.toContain('三方插件 API URL 反代配置')
  })

  it('组内不再重复标题（标题由左侧菜单承担）', () => {
    /*
      原先这里有一行「三方插件 proxy」+ info tip。它与左侧菜单的「插件管理」说的是
      同一件事，形成两级标题；tab 行紧接着又是第三种层级。标题移除后，tab 直接作为
      这一页的主结构。
    */
    expect(PROXY).not.toContain('gatewayProxyTitle')
    expect(PROXY).not.toContain('dsh-fnos-authorized-gateway-tip')
    expect(PROXY).toContain('DshTabs')
  })

  it('描述固定三行：是什么 / 怎么写 / 举例子', () => {
    // `zhCopy` 取的是**源码字面量**，其中的 `\n` 在文件里是两个字符（反斜杠 + n），
    // 而运行时会被 JS 解析成真换行。要断言行结构，先按 JS 的规则解回来。
    const tip = zhCopy('gatewayProxyDescription').replace(/\\n/g, '\n')
    const lines = tip.split('\n')

    expect(lines).toHaveLength(3)
    // 第一行：是什么——统一接入网关，而不是「转发给本机其它服务」。
    expect(lines[0]).toContain('是什么')
    expect(lines[0]).toMatch(/网关/)
    expect(lines[0]).toMatch(/三方插件/)
    // 第二行：怎么写——绝对路径前缀 + 一行一个。
    expect(lines[1]).toContain('怎么写')
    expect(lines[1]).toMatch(/每行|一行/)
    expect(lines[1]).toMatch(/绝对路径前缀/)
    // 第三行：举例子——必须给出**真实形态**的插件 API 路径及其前缀。
    expect(lines[2]).toContain('举例子')
    expect(lines[2]).toContain('/plugin-api/get/me')
    expect(lines[2]).toContain('/plugin-api')
  })

  it('源码里的换行是转义序列，运行时才成为真换行', () => {
    // 上一条断言依赖这个前提：如果谁把 `\n` 改成真的换行写进字符串字面量，
    // 源码会变成多行、而渲染结果不变，上一条仍会通过但可读性变差。
    expect(zhCopy('gatewayProxyDescription')).toContain('\\n')
  })

  it('说明点明 proxy 的作用是接入统一网关', () => {
    // 这条是本次的语义修正：功能不是「转发给本机其它服务」，而是把三方插件的
    // 绝对路径 API 统一接入应用网关。
    expect(zhCopy('gatewayProxyDescription')).toMatch(/统一接入|接入.*网关|网关.*接入/)
  })

  it('多行样式只作用于本 tip，不改动共用提示外观', () => {
    // 直接给 `.semi-tooltip-wrapper` 加 pre-line 会波及所有提示。
    const rule = (() => {
      const i = SCSS.indexOf('.semi-tooltip-wrapper.dsh-fnos-gateway-tip-content')
      return SCSS.slice(i, i + SCSS.slice(i).indexOf('}'))
    })()
    expect(rule).toContain('dsh-fnos-gateway-tip-content')
    // 不应存在一条裸 `.semi-tooltip-wrapper { white-space: ... }` 规则。
    expect(SCSS).not.toMatch(/\.semi-tooltip-wrapper\s*\{[^}]*white-space/)
  })

  it('placeholder 提示保存快捷键与「一行一个」', () => {
    const ph = zhCopy('gatewayProxyPlaceholder')
    expect(ph).toMatch(/Ctrl|⌘|Cmd/)
    expect(ph).toMatch(/每行|一行/)
  })

  it('文本框最多 8 行，超出滚动', () => {
    const rule = (() => {
      const i = SCSS.indexOf('.dsh-fnos-authorized-textarea')
      const b = SCSS.slice(i)
      return b.slice(0, b.indexOf('}'))
    })()
    // 行高 20px（见 font 简写）→ 8 行 = 160px
    expect(rule).toContain('max-height')
    expect(rule).toMatch(/overflow-y: auto|overflow: auto/)
    expect(rule).toMatch(/max-height:\s*calc\(8 \* 20px\)|max-height:\s*160px/)
  })

  it('不再允许用户把文本框拖出 8 行上限', () => {
    const rule = (() => {
      const i = SCSS.indexOf('.dsh-fnos-authorized-textarea')
      const b = SCSS.slice(i)
      return b.slice(0, b.indexOf('}'))
    })()
    // resize: vertical 会让用户绕过 max-height 的视觉预期（拖高后内容仍被裁）。
    expect(rule).toMatch(/resize:\s*none/)
  })
})

/**
 * 外层「面板」框：详情页里不再需要它。
 *
 * 宿主给 `plugins.detail.section` 的容器（`.detailSections` / `.detailSection`）只有
 * `flex-column` 与间距，**不画边框也不画底色**。此前插件自己又套了一层带边框和背景
 * 的卡片（`.dsh-fnos-authorized-card`），于是在详情页上出现「框里的框」：外层是插件
 * 画的圆角边框，内层（列表项、文本框）各自还有边框，视觉上多出一层无意义的容器。
 *
 * 详情页本身已经是承载这一块内容的容器，插件不该再画一个。
 */
describe('详情页区块不再自带外层面板', () => {
  const cardRule = (): string => {
    const i = SCSS.indexOf('.dsh-fnos-authorized-card {')
    return SCSS.slice(i, SCSS.indexOf('}', i))
  }

  it('外层容器没有边框与背景', () => {
    const rule = cardRule()
    expect(rule).not.toMatch(/border:\s*1px/)
    expect(rule).not.toMatch(/background:/)
    expect(rule).not.toMatch(/border-radius/)
  })

  it('外层容器保留布局职责（不整块删掉，避免破坏间距与语义）', () => {
    expect(CARD).toContain('dsh-fnos-authorized-card')
    const rule = cardRule()
    // 仍然要能排布内部区块。
    expect(rule).toMatch(/display:\s*flex|flex-direction/)
  })

  it('标题区与主体不再靠边框分隔（分隔线由主体自身提供）', () => {
    // 去掉外层框后，标题下沿若还留着「贴边框」的视觉会显得悬空；
    // 主体自己带的 border-top 才是分隔线。
    const body = (() => {
      const i = SCSS.indexOf('.dsh-fnos-authorized-card-body {')
      return SCSS.slice(i, SCSS.indexOf('}', i))
    })()
    expect(body).toContain('border-top')
  })
})

/**
 * 「依赖修复」卡片的交互与对齐约束。
 *
 * 两条来自实机截图反馈：一是**检查按钮多余**——检查结果对用户没有第二种用法
 * （看到失效条目也还是要点修复），却让排障多一次点击，因此只留「修复依赖」，
 * 点它直接修复；二是标题与 tip 图标**没有垂直居中**，内联图标的基线对齐在字号
 * 变化时会偏，改用 flex 居中并固定 10px 间距。
 */
describe('依赖修复卡片：单一动作按钮 + 标题对齐', () => {
  const REPAIR_CARD = read('../../src/components/DependencyRepairCard.tsx')

  it('只有一个动作按钮，不再有「检查」', () => {
    expect(REPAIR_CARD).not.toContain('dependencyRepairCheck')
    expect(REPAIR_CARD).toContain('dependencyRepairRun')
    // 「检查」按钮曾用 borderless 样式；它没了，剩下的动作按钮应是主按钮。
    expect(REPAIR_CARD).toContain('theme="solid"')
  })

  it('不再在挂载时自动诊断（诊断改为修复的前置步骤）', () => {
    // 旧实现用 useEffect 在进入页面时就发一次诊断请求。诊断后来改为「修复的
    // 前置步骤」，再后来整个检测都去掉了（见下一条用例）。
    expect(REPAIR_CARD).not.toContain('useEffect')
    expect(REPAIR_CARD).toMatch(/const repair = useCallback\(/)
  })

  it('强制修复：卡片不检测、不列匹配项', () => {
    // 这是强制动作，不是需要用户判断的业务流程。列出 `name@range` 这类内部标识
    // 对「我要不要修」没有任何帮助，只会把实现细节摊给用户。
    expect(REPAIR_CARD).not.toContain('diagnoseDependencyRepair')
    expect(REPAIR_CARD).not.toContain('entries')
    expect(REPAIR_CARD).not.toContain('dependencyRepairStaleCount')
    expect(REPAIR_CARD).not.toContain('dependencyRepairReason')
    // 唯一的数据来源是执行修复。
    expect(REPAIR_CARD).toContain('runDependencyRepair')
  })

  it('健康的结果要留在屏幕上，不能一闪而过', () => {
    /*
      真机反馈：「这个功能执行的很快吗，为什么闪一下就消失了」。

      根因是结果块的渲染条件写成了 `phase.result.steps.length > 0`。健康的
      profile 走「无失效条目，跳过重建」分支返回 `steps: []`，于是连结论块都不
      渲染——用户点完修复只看到进度行闪一下，屏幕上什么都没留下。

      现在按 `outcome` 分叉，并且 `healthy` 必须有文案。这是需求 FNOS-050-02
      明确要求的「两者都无时明确显示『依赖状态正常』」。
    */
    expect(REPAIR_CARD).not.toContain('phase.result.steps.length > 0')
    expect(REPAIR_CARD).toContain('dependencyRepairHealthy')
    expect(REPAIR_CARD).toContain('dependencyRepairUnavailable')
    expect(REPAIR_CARD).toContain("phase.result.outcome === 'healthy'")
    // 结果块自身也带 live region，避免只有进度行可播报。
    expect(REPAIR_CARD).toMatch(/className="dsh-fnos-repair-result"[^>]*aria-live="polite"/u)
  })

  it('结果块用到的样式类都有定义', () => {
    /*
      结果块引用了 `dsh-fnos-repair-result/list/entry/code/muted/ok/error` 七个类，
      但样式表里一个都没写——渲染出来是浏览器默认的 `ul` 圆点 + 缩进，与卡片
      其余部分完全不是一个外观。这条用例防的是「类名写了、样式忘了」。
    */
    for (const name of ['repair-actions', 'repair-result', 'repair-ok', 'repair-error', 'repair-list', 'repair-entry', 'repair-code', 'repair-muted']) {
      expect(SCSS).toContain(`.dsh-fnos-${name} {`)
    }
  })

  it('点按钮直接执行修复，不再二次确认', () => {
    /*
      确认弹框里的三行说明已移到卡片自身的 tip 与描述里——用户点按钮前就能读到
      「会重建什么、不会动什么」。信息在场上，再弹一次只是多一次点击；而这一步
      可重入、不含不可撤销的数据删除（只清可重建产物）。

      按钮在 running 时显示 loading，视觉上就是「已经在做了」。
    */
    expect(REPAIR_CARD).not.toContain('setConfirmOpen')
    expect(REPAIR_CARD).not.toContain('confirmOpen')
    // 按钮直接调 repair。
    const onClick = /onClick=\{\(\) => \{ void repair\(\) \}\}/.exec(REPAIR_CARD)
    expect(onClick).not.toBeNull()
    // loading 由 busy 驱动；**文案始终是「修复」**，执行中不换字。
    expect(REPAIR_CARD).toContain('loading={busy}')
    expect(REPAIR_CARD).toContain("t('dependencyRepairRun')")
    expect(REPAIR_CARD).not.toContain('dependencyRepairRunning')
  })
  it('执行中只给 loading，不给 disabled', () => {
    /*
      真机反馈：「点了没反应、也没有日志」。根因是按钮同时写了
      `disabled={busy}` 和 `loading={busy}`——`disabled` 先把按钮压成灰底
      不可点态，`loading` 的转圈随之被压掉，用户看到的是「按钮坏了」。

      `loading` 本身就拦住重复点击，不需要 `disabled` 再兜一层。
    */
    expect(REPAIR_CARD).toContain('loading={busy}')
    expect(REPAIR_CARD).not.toContain('disabled={busy}')

    /*
      长耗时动作要有实时进度：**静态说明换成日志框**。

      原先只有一行「正在重建依赖…」，看不出在装依赖还是卡死了；现在显示宿主
      逐行推来的日志，边跑边出，而不是结束后突然冒出一堆。
    */
    expect(REPAIR_CARD).not.toContain('dependencyRepairProgress')
    expect(REPAIR_CARD).toContain('runDependencyRepairStreaming')
    // 复用「npm 镜像管理」的日志框三段结构：同一个面板里两个跑命令的地方长得一样。
    expect(REPAIR_CARD).toContain('dsh-fnos-mirror-logbox')
    expect(REPAIR_CARD).toContain('dsh-fnos-mirror-logbar')
    expect(REPAIR_CARD).toContain('dsh-fnos-mirror-log')
    expect(REPAIR_CARD).toMatch(/role="log"[^>]*aria-live="polite"/u)
    // 复制按钮不能省：报错要能拿去搜或贴进 issue。
    expect(REPAIR_CARD).toContain('copyLog')
  })

  it('中文文案里「检查」两键已随按钮一起移除', () => {
    const start = LOCALES.indexOf('export const zh')
    const zhBlock = LOCALES.slice(start)
    expect(zhBlock).not.toContain('dependencyRepairCheck:')
    expect(REPAIR_CARD).not.toContain('Checking')
  })

  it('标题是 flex 容器，图标与文本按中线对齐', () => {
    const i = SCSS.indexOf('.dsh-fnos-authorized-card-name {')
    const rule = SCSS.slice(i, SCSS.indexOf('}', i))
    expect(rule).toContain('display: flex')
    expect(rule).toContain('align-items: center')
  })

  it('图标与文本间距 10px', () => {
    const i = SCSS.indexOf('.dsh-fnos-authorized-card-name {')
    const rule = SCSS.slice(i, SCSS.indexOf('}', i))
    expect(rule).toContain('gap: 10px')
  })

  it('标题内的图标清掉行内基线的负边距，否则会顶高 1px', () => {
    const i = SCSS.indexOf('.dsh-fnos-authorized-card-name .dsh-fnos-authorized-gateway-tip')
    expect(i).toBeGreaterThan(-1)
    const rule = SCSS.slice(i, SCSS.indexOf('}', i))
    expect(rule).toContain('margin: 0')
  })
})

/**
 * 「有新版本」标记要活过列表重载。
 *
 * 实机反馈：点刷新拿到「有新版本」，接着装一个或禁用一个插件，绿标就没了——
 * 因为任何增删改都会重读一次清单，而重读不联网，`updateAvailable` 变回 undefined。
 */
describe('插件更新标记的持久化', () => {
  const PANEL = read('../../src/components/InstalledPluginsPanel.tsx')

  it('联网检测的结果写进 localStorage', () => {
    expect(PANEL).toContain('rememberUpdates')
    expect(PANEL).toContain('localStorage')
    // 只记「有更新」或「本地更高」，两者都不成立的不必占位。
    expect(PANEL).toContain('updateAvailable !== true && plugin.aheadOfRegistry !== true')
  })

  it('不联网的重载把缓存合回去', () => {
    // 首屏与增删改后的重读都走并集路径，否则刚刷新出来的标记会被冲掉。
    expect(PANEL).toContain('mergeRememberedUpdates')
    expect(PANEL).toContain('checkUpdates ? next : mergeRememberedUpdates(next)')
  })

  it('版本变了就不沿用旧结论', () => {
    // 装了新版本之后「有新版本」必须失效，不能把旧结论套到新版本上。
    expect(PANEL).toContain('hit.version !== plugin.version')
  })
})
