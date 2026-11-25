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
const ENTRY = read('../../src/components/FnosFooterEntry.tsx')
const SCSS = read('../../src/styles/index.scss')
const LOCALES = read('../../src/client/locales.ts')

describe('fnOS 配置弹框', () => {
  it('入口注册到 sidebar.footer.action，不注册面板行也不占「更多」菜单', () => {
    /*
      入口位置试过三次：

      1. `sidebar.panellist`（面板行）：走不通——该槽位的行点击会走
         `layout.selectPanel(id)`，必须同时注册 `main` 视图；真机上先闪一帧
         空白页、`main` 槽报错，关掉弹框后再点也不打开。
      2. `sidebar.panellist.actions`（「更多」菜单）：语义不对，飞牛 OS 不是面板，
         而且埋了两层菜单。
      3. `sidebar.footer.action`（侧栏底部，设置行正上方）：应用级、可叠加、
         与设置同级——这才是入口该在的位置。
    */
    const INDEX = read('../../src/client/index.ts')
    expect(INDEX).toContain("ctx.slots.inject('sidebar.footer.action'")
    expect(INDEX).toContain("id: 'dsh-fnos-footer-entry'")
    expect(INDEX).not.toContain("ctx.slots.inject('sidebar.panellist.actions'")
    expect(INDEX).not.toContain("ctx.slots.inject('main'")
    expect(INDEX).not.toContain('FNOS_CONFIG_PANEL_ID')
    /*
      两个文案键职责不同，别混：
      - `configMenuEntry`：**侧栏入口**的按钮文字，保持「飞牛 OS」——它说的是
        「这是飞牛 OS」，不是「这是一个设置按钮」；
      - `configDialogTitle`：下拉菜单首项与弹框标题，用「设置」。
    */
    expect(LOCALES).toContain("configMenuEntry: '飞牛 OS'")
    expect(LOCALES).toContain("configDialogTitle: '飞牛设置'")
  })

  it('入口行高按实测与侧栏其它行对齐（36px，不是抄官方源码的 42px）', () => {
    /*
      真机实测（192.168.0.17）：侧栏行「插件」「自动化任务」「更多」统一是 **36px**，
      设置行是 32px，而官方源码里写的是 42px。

      入口在视觉上属于「侧栏行」，跟着 36px 走才与上面那几行齐平；贴着的设置行矮
      4px 是官方那行自己的特征，跟着它反而会显得本行被压扁。

      另一个易漏点：`Menu` 会给 anchor 包一层 flex 容器，容器高度不显式给就会
      收缩到内容高度（实测 20px），把按钮一起压扁。所以 anchor 也必须写死高度。
    */
    const anchor = SCSS.slice(SCSS.indexOf('.dsh-fnos-footer-anchor {'))
    const anchorBlock = anchor.slice(0, anchor.indexOf('\n}'))
    expect(anchorBlock).toContain('height: 36px')
    expect(anchorBlock).toContain('flex: none')

    const trigger = SCSS.slice(SCSS.indexOf('.dsh-fnos-footer-trigger {'))
    const triggerBlock = trigger.slice(0, trigger.indexOf('\n}'))
    expect(triggerBlock).toContain('height: 36px')
    // 抄官方源码的 42px 不该再出现。
    expect(triggerBlock).not.toContain('height: 42px')
  })

  it('「设置」菜单项显示快捷键提示，且按平台给对应修饰键', () => {
    /*
      官方设置行右侧就有快捷键提示（`ShortcutKeys` + `shortcutKeys` prop）。
      入口在同一位置做同样的事，两者并排才像同一种控件。

      修饰键必须按平台给：macOS 是 `⌘ ,`，其余是 `Ctrl ,`。写死一个，
      另一半用户照着按没反应。
    */
    expect(ENTRY).toContain('detectShortcutPlatform')
    expect(ENTRY).toContain('fnosSettingsShortcutKeys')
    /*
      提示**挂在「设置」菜单项上**（官方 `MenuItemButton` 的 `shortcut` prop），
      不是入口行尾巴。官方账号菜单里「设置」右侧就带着键帽，形态一致。
    */
    expect(ENTRY).toContain('shortcut={{ keys: shortcutKeys, aria: shortcutAria }}')

    const SHORTCUT = read('../../src/client/shortcuts/fnos-settings-shortcut.ts')
    expect(SHORTCUT).toContain("'mac'")
    expect(SHORTCUT).toContain('userAgentData')
    expect(SHORTCUT).toContain("platform === 'mac' ? ['⌘', ','] : ['Ctrl', ',']")
  })


  it('折叠态与展开态都带无障碍名', () => {
    // 图标按钮没有可见文字，缺 aria-label 时读屏只会念「按钮」。
    expect(ENTRY).toContain('aria-label={t(\'configMenuEntry\')}')
    expect(ENTRY).toContain('aria-haspopup="menu"')
    expect(ENTRY).toContain('aria-expanded={open}')
  })

  it('三个菜单行：设置 / 刷新 / 重启', () => {
    expect(ENTRY).toContain('configDialogStore.set(true)')
    expect(ENTRY).toContain("t('configDialogTitle')")
    expect(ENTRY).toContain("t('refresh')")
    expect(ENTRY).toContain("t('webRestart')")
  })

  it('下拉宽度与字号对齐官方账号菜单', () => {
    /*
      实测官方账号菜单（设置 / 意见反馈 / 登录）：宽度 124px，行文字 14px / 22px。
      见 `ui-settings-account/src/client/AccountMenu.module.css`。

      DSH 有两套菜单字号：通用 `Menu` 原语的行文字是 13px（「更多」菜单就是），
      账号菜单自己覆盖成 14px。我们跟账号菜单对齐——同处侧栏底部、同为应用级操作。

      **14 是偶数**：插件样式禁止奇数 `font-size`（见 plugin-ui-standards）。
    */
    const scss = readFileSync(new URL('../../src/styles/index.scss', import.meta.url), 'utf8')
    const block = scss.match(/\.dsh-fnos-footer-menu \{[^}]*\}/u)?.[0] ?? ''
    expect(block).toContain('min-width: 124px')
    expect(block).toContain('max-width: min(280px')
    expect(block).toContain('font-size: 14px')

    // 行文字要单独压：官方 Menu 原语把它写死在 itemLabel 上。
    const label = scss.match(/\[class\*='itemLabel'\][^{]*\{[^}]*\}/u)?.[0] ?? ''
    expect(label).toContain('font-size: 14px')
    expect(label).toContain('line-height: 22px')
  })

  it('移动端横排导航：不清掉 width: 100% 就只放得下一项', () => {
    /*
      桌面形态是竖排，每项 `width: 100%` 占满整列。横排后这个 100% 仍然生效，
      每项都把整行撑满——真机实测一行只放得下一个，横向滚动条失去意义。

      `flex: 0 0 auto` 只解决「不伸展」，不解决「基础上就有 100% 宽」。

      375px 视口下的目标：三个完整 + 第四个露出图标（实测总宽 380，正好越界）。
    */
    const scss = readFileSync(new URL('../../src/styles/index.scss', import.meta.url), 'utf8')
    const mobileItem = scss.match(/@media \(max-width: 767px\)[\s\S]*?\.dsh-fnos-config-nav-item \{[^}]*\}/u)?.[0] ?? ''
    expect(mobileItem).toContain('width: auto')
    expect(mobileItem).toContain('flex: 0 0 auto')
    // 横排时内边距收窄，窄屏每像素都紧张。
    expect(mobileItem).toContain('padding: 9px 12px')
  })

  it('空状态一律用缺省组件，不用纯文案', () => {
    /*
      一行灰字在一堆有插画的空状态里显得像排版错误或「加载失败」，用户分不清
      「确实没有内容」和「页面坏了」。

      `Tree` 的 `emptyContent` 接受 ReactNode，直接传缺省组件即可。
    */
    const picker = readFileSync(new URL('../../src/components/FnosAuthorizedPathPicker.tsx', import.meta.url), 'utf8')
    expect(picker).toContain('FnosEmptyIllustration')
    expect(picker).toMatch(/emptyContent=\{\(\s*<DshEmpty/u)

    const sessionLog = readFileSync(new URL('../../src/components/FnosSessionLogHeaderAction.tsx', import.meta.url), 'utf8')
    expect(sessionLog).toMatch(/emptyContent=\{\(\s*<DshEmpty/u)

    const card = readFileSync(new URL('../../src/components/AuthorizedDirectoriesCard.tsx', import.meta.url), 'utf8')
    // 没有条目时也要缺省组件，不能是一行 <p>。
    expect(card).toMatch(/directories\.length === 0\s*\? \(\s*<DshEmpty/u)
  })

  it('插件样式里没有奇数字号', () => {
    // 偶数号在非整数 DPR 下更容易落在整像素上；档位收敛后每次调整都可感知。
    const scss = readFileSync(new URL('../../src/styles/index.scss', import.meta.url), 'utf8')
    const sizes = [...scss.matchAll(/font-size: (\d+)px/gu)].map(m => Number(m[1] ?? 0))
    const odd = [...new Set(sizes.filter(n => n % 2 === 1))]
    expect(odd, `奇数字号: ${odd.join(', ')}`).toEqual([])
  })

  it('触发器用飞牛标记', () => {
    // 飞牛标记代表「飞牛 OS」整体，通用齿轮会被误读成「应用设置」。
    expect(ENTRY).toContain('FnosMonoLogo')
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

  it('先关菜单再开弹框，避免 portaled 浮层抢焦点', () => {
    // 只看 openConfig 块。
    const open = ENTRY.slice(ENTRY.indexOf('const openConfig'), ENTRY.indexOf('return ('))
    expect(open).toContain('dismiss()')
    expect(open.indexOf('dismiss()')).toBeLessThan(open.indexOf('configDialogStore.set(true)'))
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

  it('左侧菜单 + 右侧主体，四个分组', () => {
    expect(DIALOG).toContain('dsh-fnos-config-nav')
    expect(DIALOG).toContain('dsh-fnos-config-panel')
    expect(DIALOG).toContain("id: 'directories'")
    /*
      「插件安装修复」不再是独立分组：它只服务于「装不上」这一件事，与反代、
      已装列表同属「插件」，摊在一级菜单里让左列显得更碎。现在收进
      「插件管理」的三个 tab（反代 / 安装异常 / 已安装）。
    */
    expect(DIALOG).toContain("id: 'plugins'")
    expect(DIALOG).not.toContain("id: 'repair'")
    expect(DIALOG).toContain("id: 'runtime'")
    expect(DIALOG).toContain("id: 'logs'")
  })

  it('运行页图表：时间用 dayjs 格式化，tooltip 不重复', () => {
    /*
      三件事：

      1. 时间走 dayjs 的 `HH:mm:ss`，不用 `toLocaleTimeString`——后者依赖运行时
         locale，分隔符/补零/12-24 小时制都可能不同，跨设备刻度宽度会变；
      2. tooltip 的 series 名与 y 轴 name 都带单位，axis trigger 会把两者都列出来，
         看起来像同一项重复——用自定义 formatter 只渲染 series；
      3. 窄屏一行一个。
    */
    const card = readFileSync(new URL('../../src/components/RuntimeStatusCard.tsx', import.meta.url), 'utf8')
    expect(card).toContain("from 'dayjs'")
    expect(card).toContain("format('HH:mm:ss')")
    // 剥掉注释再看：说明文字里会提到旧写法（解释为什么改），不算声明。
    const code = card.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '')
    expect(code).not.toContain('toLocaleTimeString')
    // 自定义 formatter 只渲染 series，不再列 y 轴 name。
    expect(card).toContain('formatter: (params: unknown)')
    expect(card).toContain('p0.seriesName')
    // 窄屏单列。
    expect(card).toContain("matchMedia('(max-width: 767px)')")
  })

  it('dayjs 要内联进产物，否则宿主加载插件整层失败', () => {
    // 不内联会在产物里留下 `require("dayjs")`，宿主运行时没有这个包——实测页面报
    // 「Failed to load plugins | @tnnevol/dsh-fnos」。
    const deps = readFileSync(new URL('../../../../packages/dsh-semi-ui/tsdown-client-deps.ts', import.meta.url), 'utf8')
    expect(deps).toContain('/^dayjs(?:\\/|$)/u')
  })

  it('运行页：移动端隐藏指标卡片，图表文字跟随主题', () => {
    /*
      指标卡片是「五个数字并排」的版式，窄屏下每格被压到只剩一个字宽，数值频繁
      换行（真机截图里「内 存」竖排、「488 MB」折成两行）。而它们与下方曲线重复
      ——曲线已经给出同样的数据，卡片只是「最新一个点」。手机上留曲线更值。

      图表文字必须显式给颜色：ECharts 默认轴标签是深灰，暗色主题下几乎看不见。
      取值走 DSH 语义变量，`getComputedStyle` 读出来就是当前主题解析后的颜色。
    */
    const scss = readFileSync(new URL('../../src/styles/index.scss', import.meta.url), 'utf8')
    const mobile = scss.match(/@media \(max-width: 767px\)[\s\S]{0,400}\.dsh-fnos-runtime-now \{[^}]*\}/u)?.[0] ?? ''
    expect(mobile).toContain('display: none')

    const card = readFileSync(new URL('../../src/components/RuntimeStatusCard.tsx', import.meta.url), 'utf8')
    expect(card).toContain("getPropertyValue('--dsw-alias-label-tertiary')")
    expect(card).toContain("getPropertyValue('--dsw-alias-label-secondary')")
    // 轴标签与纵轴名字都要上色，不能只给一处。
    expect(card).toContain('color: axisColor')
    expect(card).toContain('color: nameColor')
    // 分隔线同理：写死 rgba(0,0,0,.06) 在暗色下是黑上叠黑。
    expect(card).toContain('color: splitColor')
  })

  it('插件管理用三个 tab：工具箱 / 已安装插件 / 反代', () => {
    const PROXY = read('../../src/components/GatewayProxyCard.tsx')
    expect(PROXY).toContain('DshTabs')
    /*
      顺序是产品决定的：工具箱（排查类）→ 已安装插件（日常查看）→ 反代（配置项）。
      反代改动频率最低，排最后。

      按**行号**比较：`indexOf` 会先命中顶部的 import 语句。
    */
    const lineOf = (needle: string): number => PROXY.split('\n').findIndex(line => line.includes(needle))
    const toolboxAt = lineOf("tab={t('gatewayProxyTabToolbox')}")
    const installedAt = lineOf("tab={t('gatewayProxyTabInstalled')}")
    const proxyAt = lineOf("tab={t('gatewayProxyTabProxy')}")
    expect(toolboxAt).toBeGreaterThan(-1)
    expect(toolboxAt).toBeLessThan(installedAt)
    expect(installedAt).toBeLessThan(proxyAt)

    // 自定义插件索引并入工具箱，不再独占 tab；位置在修复之后。
    expect(PROXY).not.toContain("tab={t('gatewayProxyTabIndex')}")
    const npmAt = lineOf('<NpmMirrorCard')
    const repairAt = lineOf('<DependencyRepairCard')
    const indexAt = lineOf('<PluginIndexPanel')
    expect(npmAt).toBeGreaterThan(-1)
    expect(npmAt).toBeLessThan(repairAt)
    expect(repairAt).toBeLessThan(indexAt)
  })

  it('light 按钮的禁用态跟随主题，深色下不糊成灰块', () => {
    /*
      共享包主题层只覆盖了 `semi-button-solid` 的禁用态，`theme="light"` 走的是
      Semi 自己的 `--semi-color-primary-light-default` 一档——深色下那套值来自浅色
      主题（近白底 + 浅灰字），落在深色面板上几乎看不见。

      真机实测修前是一个灰糊糊的圆角块；修后底色 rgb(77,78,79)、文字
      rgb(173,178,184)，对比度 9.82（AA 要求 4.5）。
    */
    const scss = readFileSync(new URL('../../src/styles/index.scss', import.meta.url), 'utf8')
    expect(scss).toContain('.semi-button.semi-button-light.semi-button-disabled')
    // 用语义变量重算，不写死颜色。
    expect(scss).toMatch(/semi-button-light\.semi-button-disabled \{[^}]*var\(--dsw-alias-brand-primary\)/u)
    // opacity 必须归 1：半透明会再叠一层，文字更糊。
    expect(scss).toMatch(/semi-button-light\.semi-button-disabled \{[^}]*opacity: 1/u)
  })

  it('日志页：移动端只隐藏来源，不隐藏条数', () => {
    /*
      窄屏隐藏来源列：`authorization-service` 这类长标识符会把正文压到只剩几个
      字符，长句被逐词折成竖排。正文对排查更有价值，来源可以在桌面端看。

      **「条数」不隐藏**——它是用户能自己调的唯一一处容量开关，藏起来等于把
      控制权拿走。
      - 来源列（`authorization-service` 这类长标识符）会把正文压到只剩几个字符，
        于是长句被逐词折成竖排——隐藏来源，让正文独占剩余宽度。

      真机实测：隐藏来源后正文宽度从约 100px 提到 213px。
    */
    const scss = readFileSync(new URL('../../src/styles/index.scss', import.meta.url), 'utf8')
    const mobile = scss.match(/@media \(max-width: 767px\)[\s\S]*?\n\}/u)?.[0] ?? ''
    expect(mobile).toContain('.dsh-fnos-logs-name')
    /* 条数输入框在任何宽度下都保留。 */
    expect(mobile).not.toContain('.dsh-fnos-logs-limit')
    /*
      级别选择器不需要在窄屏单独收窄：它的默认宽度已经是 80px，比原先的窄屏值
      （96px）还小。留着那条覆盖只会让它变宽。
    */
    expect(mobile).not.toContain('.dsh-fnos-logs-level')
  })

  it('工具条不再显示条数计数', () => {
    /*
      那个 `0 / 43` 曾经只在「被截断时」显示，但它回答的是「缓冲里有多少条」——
      用户真正要知道的数量已经在「条数」输入框里（那是他自己填的上限）。两处
      数字并排，反而要停下来分辨哪个是哪个。

      整个计数与它的 `total` state 一并移除。
    */
    const panel = readFileSync(new URL('../../src/components/RuntimeLogPanel.tsx', import.meta.url), 'utf8')
    expect(panel).not.toContain('dsh-fnos-logs-count')
    expect(panel).not.toContain('entries.length < total')
    expect(panel).not.toContain('setTotal')
  })

  it('文件入口：失败走 Toast，错误不画在按钮上', () => {
    /*
      早前把失败记进 `lastErrorRef` 再把按钮切成 `data-state="error"`，于是按钮
      变成常驻的错误外观 + 一段长文案贴进 tooltip——截图里那个挂着的
      「无法打开 NAS 文件管理器。」就是它。错误是一次操作的瞬时结果，不该留在
      按钮这种「持续状态」的载体上，也不会自己消失。

      改用 Toast 后按钮只剩 idle / busy 两态。
    */
    const src = readFileSync(new URL('../../src/components/FnosOpenInHeaderAction.tsx', import.meta.url), 'utf8')
    expect(src).toContain('notifyFailure')
    // 剥掉注释再看：说明文字里会提到旧写法（解释为什么改），不算声明。
    const code = src.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '')
    // 不得再有 error 态与错误文案存放处。
    expect(code).not.toContain("'idle' | 'busy' | 'error'")
    expect(code).not.toContain('lastErrorRef')
    expect(code).not.toContain('data-state={phase}')
  })

  it('文件入口：独立 web 不渲染，App 与内嵌 web 都渲染', () => {
    /*
      | 环境 | 判据 | 显示 |
      | --- | --- | --- |
      | fnOS App | isWeb === false | 显示 |
      | NAS web 内嵌 | isWeb && !isStandaloneWeb | 显示 |
      | 独立 web | isWeb && isStandaloneWeb | 不显示 |

      独立 web 没有宿主桥，调用必然失败；给一个必然失败的入口比不给更差。
    */
    const src = readFileSync(new URL('../../src/components/FnosOpenInHeaderAction.tsx', import.meta.url), 'utf8')
    expect(src).toContain('HAS_FNOS_HOST_BRIDGE')
    expect(src).toContain('IS_FNOS_STANDALONE_WEB_ENV')
  })

  it('导出 Session log 弹框做移动端适配', () => {
    /*
      两个弹框：导出进度（480）与选择 NAS 目录（560）。桌面宽度写死在
      `width={...}` 上，Semi 会把它写成 `.semi-modal` 的内联样式——窄屏下必须由
      **最外层** 的 `max-width` 收住，内容层收不回来（与授权弹框同一个坑）。

      真机实测（393px 视口）：弹框实渲染 369px（= 393 − 24），不溢出。
    */
    const scss = readFileSync(new URL('../../src/styles/index.scss', import.meta.url), 'utf8')
    expect(scss).toContain('.semi-modal:has(> .semi-modal-content.dsh-fnos-nas-dialog)')
    expect(scss).toContain('.semi-modal:has(> .semi-modal-content.dsh-fnos-session-log-progress-dialog)')

    // 内容高度也要跟着屏高走：固定 340px 在手机竖屏下会把按钮顶到屏幕外。
    const mobile = scss.slice(scss.indexOf('@media (max-width: 767px)'))
    expect(mobile).toContain('.dsh-fnos-session-log-tree')
    expect(mobile).toContain('max-height: 56vh')
    expect(mobile).toContain('.dsh-fnos-session-log-dialog-body')
  })

  it('只保留 NAS 选目录弹框，导出进度框交给官方', () => {
    /*
      本插件曾额外弹一个「Session 导出已开始下载」进度框，而官方
      `session-log-export` 在导出时已经弹了自己的提示——两层弹框同时出现。
      现在导出反馈一律交给官方，本插件只剩 NAS 选目录这一个人工弹框。
    */
    const src = readFileSync(new URL('../../src/components/FnosSessionLogHeaderAction.tsx', import.meta.url), 'utf8')
    expect(src).toContain('className="dsh-fnos-nas-dialog"')
    expect(src).not.toContain('dsh-fnos-session-log-progress-dialog')
  })

  it('App 端隐藏两处「打开文件管理器」入口', () => {
    /*
      App 端（isWeb === false）没有文件管理器窗口的概念，跳出去会把用户带离
      当前会话。两处入口统一按 `SHOWS_FILE_MANAGER_ENTRY`（宿主桥可用 且 非 App）。
    */
    const card = readFileSync(new URL('../../src/components/AuthorizedDirectoriesCard.tsx', import.meta.url), 'utf8')
    expect(card).toContain('SHOWS_FILE_MANAGER_ENTRY')
    expect(card).not.toContain('{HAS_FNOS_HOST_BRIDGE && (')

    const picker = readFileSync(new URL('../../src/components/FnosAuthorizedPathPicker.tsx', import.meta.url), 'utf8')
    expect(picker).toContain('{SHOWS_FILE_MANAGER_ENTRY && (')
  })

  it('App 端长按唤出菜单，并新增复制完整路径', () => {
    /*
      - 长按 500ms 且未移动 → 同一个上下文菜单；只在 App 端挂监听
      - 复制的是真实绝对路径（`path`），不是语义化名称
      - 只复制不转换：用户要的是能贴进终端/脚本的那串
    */
    const picker = readFileSync(new URL('../../src/components/FnosAuthorizedPathPicker.tsx', import.meta.url), 'utf8')
    expect(picker).toContain('IS_FNOS_WEB_RUNTIME')
    expect(picker).toContain('touchstart')
    expect(picker).toContain('setTimeout')
    // 复制走真实路径
    expect(picker).toMatch(/clipboard\.writeText\(target\.path\)/u)
    expect(picker).toContain("t('copyFullPath')")
  })

  it('选择面板标题改为「文件与文件夹」', () => {
    const locales = readFileSync(new URL('../../src/client/locales.ts', import.meta.url), 'utf8')
    expect(locales).toContain("inputPickerTitle: '文件与文件夹'")
    expect(locales).toContain("inputPickerTitle: 'Files and folders'")
  })

  it('长按区域关掉文字选中与 callout', () => {
    // 不关的话长按会先选中一行文字并弹系统复制菜单，与我们的菜单抢屏幕。
    const scss = readFileSync(new URL('../../src/styles/index.scss', import.meta.url), 'utf8')
    // 同一个类名在文件里出现两次（早期只改内部列表宽度），取**最后一次**定义。
    const block = scss.slice(scss.lastIndexOf('.dsh-fnos-path-panel-tree {'))
    expect(block.slice(0, 900)).toContain('user-select: none')
    expect(block.slice(0, 900)).toContain('-webkit-touch-callout: none')
  })

  it('文件与文件夹面板：首次加载显示居中 loading，不闪缺省页', () => {
    /*
      `treeData` 在拉取完成前是空数组，`Tree` 会立刻渲染 `emptyContent`——于是
      打开面板的瞬间先看到「当前没有可选择的授权文件或目录」，几十毫秒后才变成
      列表。那不是空状态，是还没加载完。

      修法：`open` 变 true 时立刻置 loading（不能等 fetch 返回才置，否则仍会先
      渲染一帧缺省页），`Tree` 在 loading 期间整个换成居中 spinner。
    */
    const src = readFileSync(new URL('../../src/components/FnosAuthorizedPathPicker.tsx', import.meta.url), 'utf8')
    expect(src).toContain('loadingRoots')
    // open 时立刻置位
    expect(src).toMatch(/setLoadingRoots\(true\)\s*\n\s*void reloadRoots\(\)/u)
    // 失败也要落回 false，否则一直转圈
    expect(src).toMatch(/finally \{[\s\S]{0,80}setLoadingRoots\(false\)/u)
    // loading 时整块替换
    expect(src).toContain('dsh-fnos-path-panel-loading')
    expect(src).toContain('DshSpin')
    expect(src).toContain('aria-busy="true"')
  })

  it('loading 容器垂直水平居中且占满树区域', () => {
    const scss = readFileSync(new URL('../../src/styles/index.scss', import.meta.url), 'utf8')
    const block = scss.slice(scss.indexOf('.dsh-fnos-path-panel-loading {'))
    const rule = block.slice(0, block.indexOf('}'))
    expect(rule).toContain('align-items: center')
    expect(rule).toContain('justify-content: center')
    // 占满容器：加载中面板不会忽然缩一半
    expect(rule).toContain('flex: 1')
  })

  it('npm 镜像管理的安装按钮在右侧', () => {
    // 与「修复插件安装异常」那张卡一致：一列卡片里动作都在右边缘。
    const card = readFileSync(new URL('../../src/components/NpmMirrorCard.tsx', import.meta.url), 'utf8')
    const head = card.slice(card.indexOf('<header className="dsh-fnos-mirror-head">'))
    const headEnd = head.indexOf('</header>')
    // 按钮在 header 里，标题在左侧的包裹层里。
    expect(head.slice(0, headEnd)).toContain('dsh-fnos-mirror-head-text')
    expect(head.slice(0, headEnd)).toContain("t('mirrorInstall')")

    const scss = readFileSync(new URL('../../src/styles/index.scss', import.meta.url), 'utf8')
    const block = scss.slice(scss.indexOf('.dsh-fnos-mirror-head {'))
    expect(block.slice(0, block.indexOf('}'))).toContain('justify-content: space-between')
  })

  it('复制原始路径：所有环境可用，且排在删除之前', () => {
    /*
      原先是 App 端专属（理由是移动端更需要）。但桌面 web 同样常要这份路径——
      贴进终端、脚本、issue。能力本身不依赖宿主桥，没有理由按环境隐藏。

      位置也调整过：删除是破坏性操作，按惯例排最后。把它夹在「新建」与「复制」
      中间容易误点。
    */
    const src = readFileSync(new URL('../../src/components/FnosAuthorizedPathPicker.tsx', import.meta.url), 'utf8')
    // 不再有环境门控
    expect(src).not.toContain('IS_FNOS_WEB_RUNTIME ? null : (')
    // 复制项在删除之前
    const copyAt = src.indexOf("t('copyFullPath')")
    const deleteAt = src.indexOf("t('deleteDialogConfirm')")
    expect(copyAt).toBeGreaterThan(-1)
    expect(deleteAt).toBeGreaterThan(-1)
    expect(copyAt).toBeLessThan(deleteAt)
  })

  it('复制项文案是「原始路径」而不是「完整路径」', () => {
    const locales = readFileSync(new URL('../../src/client/locales.ts', import.meta.url), 'utf8')
    expect(locales).toContain("copyFullPath: '复制原始路径'")
    expect(locales).toContain("copyFullPath: 'Copy original path'")
  })

  it('日志级别下拉不显示勾选图标', () => {
    /*
      Semi 的 Option 默认 `showTick: true`，会在**每一项**前面留一个勾位
      （选中的实心、未选中的留白占位）。截图里五个级别前面全是勾，看起来像
      「全部选中」。

      这里靠背景高亮表达选中，不需要勾。
    */
    const panel = readFileSync(new URL('../../src/components/RuntimeLogPanel.tsx', import.meta.url), 'utf8')
    expect(panel).toContain('showTick: false')
  })

  it('样式注入只用 <style>，不在 head 里放非语义元素', () => {
    /*
      `<head>` 只允许 metadata content。早前把所有插件样式塞进一个
      `<div hidden>` 容器，那是非语义元素，无障碍检查与 HTML 校验都会标出来。

      改为直接操作 `<style>`：需要提高优先级时用 DOM 操作把它 append 到 head
      末尾（后出现的规则胜出），不需要容器这一层。
    */
    const build = readFileSync(new URL('../../tsdown.config.ts', import.meta.url), 'utf8')
    expect(build).toContain("document.createElement('style')")
    // 不许再创建容器 div。
    expect(build).not.toContain("document.createElement('div')")
    expect(build).not.toContain('dsh-plugin-styles')
    // 顺序靠 DOM 位置的 append 保证。
    expect(build).toContain('document.head.append(style)')
  })

  it('菜单选中态只用底色与字重', () => {
    // 左侧竖条已按产品要求去掉：它与底色是两套冗余指示，横排时还贴不齐圆角。
    const item = SCSS.slice(SCSS.indexOf('.dsh-fnos-config-nav-item {'))
    const block = item.slice(0, item.indexOf('\n}'))
    expect(block).toContain('&--active')
    expect(block).toContain('--dsw-alias-interactive-bg-active')
    expect(block).toContain('font-weight: 600')
    expect(block).not.toContain('&::before')
  })

  it('复用原组件，不复制实现', () => {
    expect(DIALOG).toContain('AuthorizedDirectoriesCard')
    // 「插件安装修复」已收进「插件管理」的 tab，由 GatewayProxyCard 内部引用。
    const PROXY = read('../../src/components/GatewayProxyCard.tsx')
    expect(PROXY).toContain('DependencyRepairCard')
    expect(PROXY).toContain('InstalledPluginsPanel')
    expect(PROXY).toContain('PluginIndexPanel')
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
    expect(block).toContain('overflow-y: auto')
    // 高度上限在弹框本体上（max-height 由 content 承担）。
    expect(SCSS).toContain('max-height: calc(100vh - 48px)')
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

  it('左右间距对齐官方：菜单 188 + 右列 24 内边距，不用竖线分隔', () => {
    const nav = SCSS.slice(SCSS.indexOf('.dsh-fnos-config-nav {'), SCSS.indexOf('.dsh-fnos-config-nav-item'))
    // 官方 nav 实测 `10px 12px 0`，12 让菜单项盒子从 12 起算。
    expect(nav).toContain('flex: 0 0 188px')
    expect(nav).toContain('padding: 10px 12px 0')
    // 官方相邻项间距 4。
    expect(nav).toContain('gap: 4px')
    expect(nav).not.toContain('border-right')
    const panel = SCSS.slice(SCSS.indexOf('.dsh-fnos-config-panel {'))
    const panelRule = panel.slice(0, panel.indexOf('}'))
    // 右列内容左沿 = 188 + 24 = 212，与官方 options 的 padding-left 一致；
    // 下 24 同官方；右 24 不把滚动条推到中间（滚动条画在本元素右边缘＝弹框右沿）。
    // 右侧 24 保留（与滚动区右沿分开）；底部归零——留白由弹框 padding-bottom 统一给。
    expect(panelRule).toContain('padding: 0 24px 0 4px')
  })

  it('左侧菜单项带图标，图标与文字横排居中', () => {
    expect(DIALOG).toContain('<IconifyIcon name={item.icon} />')
    expect(DIALOG).toContain("icon: 'lucide:folder'")
    expect(DIALOG).toContain("icon: 'lucide:blocks'")
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
    /*
      `flex: 1 1 0%` 而不是 `height: 100%` 或 `1 1 auto`：后两者按内容高度起算、
      会吸收掉父层的 padding-bottom，最后一个元素贴住弹框底沿。
      `1 1 0%` 基准为 0、按已扣掉 padding 的可用空间伸展，底部 15px 才是真空出来的。
    */
    expect(body).toContain('flex: 1 1 0%')
    expect(body).not.toMatch(/min-height:\s*\d+px/)
    // 内容多的分组由 tab 内容区自己滚动（tab 栏常驻）。
    expect(SCSS).toContain('.dsh-fnos-plugins-tabs .semi-tabs-content')
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
    // 切换分组时右缘不能因为有无滚动条而左右跳——这个约束现在落在
    // 真正的滚动容器（tab 内容区）上。
    const content = SCSS.slice(SCSS.indexOf('.dsh-fnos-plugins-tabs .semi-tabs-content {'))
    expect(content.slice(0, content.indexOf('}'))).toContain('scrollbar-gutter: stable')
  })

  it('插件管理外层不锁高度（锁了会滚不到底、保存按钮被截断）', () => {
    /*
      真机踩到：外层 `height: 100%` + 内层 `overflow: hidden`，整块被固定在可视
      高度内，内容超出既不自己滚、外层也拿不到真实高度——表现是「滚不到底、
      下面的保存按钮被截掉一截」。

      正确做法是内容自然撑开，滚动交给 `overflow-y: auto` 的 .dsh-fnos-config-panel。
    */
    const block = SCSS.slice(SCSS.indexOf('.dsh-fnos-plugins {'), SCSS.indexOf('.dsh-fnos-installed {'))
    expect(block.slice(0, block.indexOf('}'))).not.toContain('height: 100%')
    expect(block).not.toContain('overflow: hidden')
    // 顶部留白由面板统一给；本块再 padding 会在顶部形成一段无内容的空隙。
    expect(block.slice(0, block.indexOf('}'))).toContain('padding: 0')
  })

  it('左右两列间距 16px（nav 右 12 + panel 左 4）', () => {
    /*
      早前是 nav 右 12 + panel 左 24 = 36px，两列之间空出一条谁都不占的走廊。
      只收 panel 这一侧：菜单项的盒子宽度（188 − 12 − 12 = 164）因此不变。
    */
    const nav = SCSS.slice(SCSS.indexOf('.dsh-fnos-config-nav {'), SCSS.indexOf('.dsh-fnos-config-nav-item {'))
    expect(nav).toContain('padding: 10px 12px 0')
    const panel = SCSS.slice(SCSS.indexOf('.dsh-fnos-config-panel {'))
    const rule = panel.slice(0, panel.indexOf('}'))
    expect(rule).toContain('padding: 0 24px 0 4px')
  })

  it('垂直留白只在 semi-modal-body 上设置一次', () => {
    const shellBody = SCSS.slice(
      SCSS.indexOf('.semi-modal-content.dsh-fnos-config-dialog .semi-modal-body {'),
      SCSS.indexOf('.semi-modal-content.dsh-fnos-config-dialog .semi-modal-body {') + 400,
    )
    // Semi 默认给 body 24px 上下外边距，会让内容收缩；归零后 746 全部分给两列，
    // 左右缩进分别由 header（标题 24）与 nav（12+12）自己提供。
    expect(shellBody).toContain('padding: 0')
    expect(shellBody).toContain('margin: 0')
    expect(shellBody).toContain('flex: 1 1 auto')
    expect(shellBody).toContain('min-height: 0')
  })

  it('header 54 高，标题左沿 24 与官方一致', () => {
    const headerRule = SCSS.slice(
      SCSS.indexOf('.semi-modal-content.dsh-fnos-config-dialog .semi-modal-header {'),
    )
    const rule = headerRule.slice(0, headerRule.indexOf('}'))
    // 22 + 24（标题行高）+ 8 = 54，内容盒正好等于行高，无幻影空隙。
    expect(rule).toContain('padding: 22px 12px 8px 24px')
    expect(rule).toContain('height: 54px')
    // Semi 默认给 header 24px 外边距，归零才能让标题从顶部内边距开始。
    expect(rule).toContain('margin: 0')
    // 标题字号取官方 navTitle 实测值 16/24，此前用了 18。
    const title = SCSS.slice(SCSS.indexOf('.semi-modal-content.dsh-fnos-config-dialog .semi-modal-title {'))
    const titleRule = title.slice(0, title.indexOf('}'))
    expect(titleRule).toContain('font-size: 16px')
    expect(titleRule).toContain('line-height: 24px')
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
    /*
      `flex: 1 1 0%` 而不是 `height: 100%` 或 `1 1 auto`：后两者按内容高度起算、
      会吸收掉父层的 padding-bottom，最后一个元素贴住弹框底沿。
      `1 1 0%` 基准为 0、按已扣掉 padding 的可用空间伸展，底部 15px 才是真空出来的。
    */
    expect(body).toContain('flex: 1 1 0%')
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

  it('弹框去掉 1px 描边，阴影用主题层级变量', () => {
    // 按整条规则定位：同类选择器出现两次（窄屏兜底 + 表面样式），只取带边框的那条。
    const surface = SCSS.slice(SCSS.indexOf('body[data-dsh-semi-theme] .semi-modal-content.dsh-fnos-config-dialog {'))
    expect(surface.slice(0, 400)).toContain('border: none')
    /*
      阴影取自 `--dsw-shadow-lv3`（DSH 为「浮起的面板」准备的语义层级），不再自拼
      两段 rgba——自定义阴影在暗色主题下是「黑上叠黑」，看不出层级。
    */
    expect(surface.slice(0, 400)).toContain('box-shadow: var(--dsw-shadow-lv3)')
    expect(surface.slice(0, 400)).not.toMatch(/box-shadow:\s*\n?\s*0 \d+px/)
  })

  it('蒙层有背景模糊，三种主题变体都要有', () => {
    /*
      只压暗（半透明底色）在浅色页面上很容易看起来只是「整体淡了一点」，背后的
      文字仍清晰可辨，视觉上像并排两套界面。加一层模糊后背景退成光斑，
      焦点自然落到弹框上。

      三种变体（基础 / 亮色 / 暗色）都要带，否则某一主题下会突然没有模糊。
    */
    const maskBlocks = [
      SCSS.slice(SCSS.indexOf('.semi-modal-mask,'), SCSS.indexOf('.semi-modal-mask,') + 1200),
      SCSS.slice(SCSS.indexOf('body:not([data-ds-dark-theme]) .semi-modal-mask'), SCSS.indexOf('body:not([data-ds-dark-theme]) .semi-modal-mask') + 400),
      SCSS.slice(SCSS.indexOf('body[data-ds-dark-theme] .semi-modal-mask'), SCSS.indexOf('body[data-ds-dark-theme] .semi-modal-mask') + 400),
    ]
    for (const block of maskBlocks) {
      expect(block).toContain('backdrop-filter: blur(')
      // Safari 需要前缀版本。
      expect(block).toContain('-webkit-backdrop-filter')
    }
  })

  it('弹框与蒙层不写死颜色，全部走 DSH 主题变量', () => {
    /*
      写死颜色在亮色下够用，但**暗色主题会失效**：蒙层在深底上再压一层更黑、
      弹框阴影「黑上叠黑」，层级被抹平。遮罩与浮起面板都属于主题语义，
      底色应来自 `--dsw-alias-bg-base` / `--dsw-shadow-lv3`。
    */
    const mask = SCSS.slice(SCSS.indexOf('.semi-modal-mask,'), SCSS.indexOf('.semi-modal-mask,') + 900)
    expect(mask).toContain('--dsw-alias-bg-base')
    expect(mask).not.toMatch(/rgb\(0 0 0 \/ 45%\)/)
    const surface = SCSS.slice(SCSS.indexOf('body[data-dsh-semi-theme] .semi-modal-content.dsh-fnos-config-dialog {'))
    expect(surface.slice(0, 400)).toContain('--dsw-shadow-lv3')
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

  it('两种语言都有四个新文案键', () => {
    // 标题与入口统一叫「设置」：弹框标题就是入口点开后的落点，两处不一致会让人疑惑。
    expect(LOCALES).toContain("configDialogTitle: 'fnOS settings'")
    expect(LOCALES).toContain("configDialogTitle: '飞牛设置'")
    expect(LOCALES).toContain("configSectionDirectories: '授权目录'")
    // 导航分组名与卡片标题统一到「插件安装」语境，不再叫「依赖修复」——
    // 用户遇到的是「插件装不上」，不是「依赖坏了」。
    expect(LOCALES).toContain("configSectionRepair: '插件安装修复'")
    expect(LOCALES).toContain("dependencyRepairTitle: '修复插件安装异常'")
    expect(LOCALES).toContain("dependencyRepairRun: '修复'")
  })
})

describe('授权目录加载态：用骨架屏而不是文字提示', () => {
  const CARD_SRC = readFileSync(new URL('../../src/components/AuthorizedDirectoriesCard.tsx', import.meta.url), 'utf8')
  const SCSS_SRC = readFileSync(new URL('../../src/styles/index.scss', import.meta.url), 'utf8')

  it('加载中渲染骨架行，不再是一句「正在加载…」', () => {
    // 文字提示把「等待」变成一次阅读；骨架屏直接占住内容将要出现的位置。
    expect(CARD_SRC).toContain('DshSkeleton')
    expect(CARD_SRC).toContain('dsh-fnos-authorized-skeleton')
    // 旧的纯文字分支必须消失。
    expect(CARD_SRC).not.toContain("<p className=\"dsh-fnos-authorized-body\">{t('loading')}</p>")
  })

  it('骨架复用真实行的容器类，加载完成时行高不跳', () => {
    expect(CARD_SRC).toContain('dsh-fnos-authorized-path-row dsh-fnos-authorized-skeleton-row')
    expect(SCSS_SRC).toContain('.dsh-fnos-authorized-skeleton-row')
    // 真实行是 10px 内边距 + 20px 行高，骨架条要留出同样的高度。
    expect(SCSS_SRC).toMatch(/\.dsh-fnos-authorized-skeleton-row \{[\s\S]{0,120}min-height: 42px/u)
  })

  it('骨架对读屏可感知', () => {
    // 骨架屏没有可见文字，必须补一条可朗读的状态说明，否则读屏只会报「空」。
    expect(CARD_SRC).toContain('aria-busy="true"')
    expect(CARD_SRC).toContain('dsh-fnos-visually-hidden')
    expect(SCSS_SRC).toContain('.dsh-fnos-visually-hidden')
  })

  it('动画由组件承担，不自造 keyframes', () => {
    // Semi 的 Skeleton 自带 shimmer；自造动画容易与主题色、减少动效偏好脱节。
    expect(SCSS_SRC).not.toMatch(/@keyframes\s+dsh-fnos-skeleton/u)
  })

  it('骨架必须包在 `<Skeleton active>` 里，否则不动', () => {
    /*
      shimmer 的选择器是 `.semi-skeleton-active .semi-skeleton-title` 这类**后代**
      规则：`active` 只有根组件有，`Title` / `Button` 子组件没有。只写子组件时
      骨架条有底色但 `animationName` 是 `none`——看起来就是几块静止的灰条。
    */
    expect(CARD_SRC).toContain('<DshSkeleton active>')
  })
})

describe('插件卡片：没有自备图标时用官方默认图形', () => {
  const PANEL_SRC = readFileSync(new URL('../../src/components/InstalledPluginsPanel.tsx', import.meta.url), 'utf8')
  const SCSS_ALL = readFileSync(new URL('../../src/styles/index.scss', import.meta.url), 'utf8')

  it('复用官方的 PluginArtworkDefault，而不是自己复制一段 SVG', () => {
    /*
      DSH 自己的插件市场在图标缺失时用的就是它（`MarketIcon` 见
      `ui-plugin-market/DiscoverSection.tsx`）。直接复用组件，官方改图形我们跟着变。
    */
    expect(PANEL_SRC).toContain('PluginArtworkDefault')
    expect(PANEL_SRC).toContain("from '@deepseek-ai/dsh-client-ui-primitives'")
    // 不要内联 svg 兜底图形。
    expect(PANEL_SRC).not.toMatch(/plugin\.icon === undefined[\s\S]{0,80}<svg/u)
  })

  it('缺图标时仍然占位，不留空', () => {
    // 早前是 `plugin.icon === undefined ? null`：卡片少了身份标识，和旁边排一起参差。
    expect(PANEL_SRC).toContain('dsh-fnos-card-logo--default')
    expect(PANEL_SRC).not.toContain('{plugin.icon === undefined ? null : (')
  })

  it('默认图形的盒子与真实 logo 一致', () => {
    // 尺寸不同会让标题行基线在有无自备图标的插件之间跳动。
    expect(SCSS_ALL).toMatch(/\.dsh-fnos-card-logo--default \{[\s\S]{0,200}display: inline-flex/u)
  })

  it('只有授权目录按环境给缺省页，其余分组照常渲染', () => {
    /*
      四个分组的实际依赖不同：

      | 分组 | 数据来源 | 本地可用 |
      | --- | --- | --- |
      | 授权目录 | fnOS 宿主桥（选目录、ACL） | 否 |
      | 插件管理 | 插件自己的网关代理路由 | 是 |
      | 运行 | 插件自己的 runtime-status 路由 | 是 |
      | 日志 | 插件自己的 runtime-logs 路由 | 是 |

      所以不能按环境整体屏蔽——那样会把三个本来能用的面板一起换成缺省页。
    */
    const dialog = readFileSync(new URL('../../src/components/FnosConfigDialog.tsx', import.meta.url), 'utf8')
    // 只有 directories 分支带环境判据。
    expect(dialog).toMatch(/section === 'directories' && (!HAS_FNOS_HOST_BRIDGE|!fnosHostBridgeAvailable\(\))/u)
    expect(dialog).toMatch(/section === 'directories' && (HAS_FNOS_HOST_BRIDGE|fnosHostBridgeAvailable\(\))/u)
    for (const section of ['plugins', 'runtime', 'logs']) {
      expect(dialog).toContain(`section === '${section}' ? <`)
      // 这三个分组不得带任何环境判据。
      expect(dialog).not.toMatch(new RegExp(`section === '${section}'[^?]*fnosHostBridgeAvailable`, 'u'))
    }
    // 缺省页用自绘插画，不用组件库自带。
    expect(dialog).toContain('FnosEmptyIllustration')
    expect(dialog).not.toContain('DshSemiIllustrations')
  })

  it('渲染阻塞用缺省页，交互失败用 Toast', () => {
    /*
      两类问题的承载方式不同：

      - **渲染时被环境阻塞**：给缺省页（这里现在没有内容），不是一行红字；
      - **交互中调用失败**：给 Toast（操作结果），不能只在页面上留一句静态文案。
    */
    const card = readFileSync(new URL('../../src/components/AuthorizedDirectoriesCard.tsx', import.meta.url), 'utf8')
    // 加载失败 → 缺省页。
    expect(card).toContain('FnosEmptyIllustration')
    expect(card).toMatch(/state\.status === 'error' \? \(\s*<DshEmpty/u)
    // 交互失败（选目录、取消授权）→ Toast。
    expect(card).toContain('notifyFailure(message)')
  })
})

describe('日志落盘与「查看日志」入口', () => {
  it('用 rotating-file-stream 做大小轮转，不自写', async () => {
    /*
      按大小轮转 + 保留 N 份看着简单，边界却不少：写入并发、轮转瞬间的原子性、
      序号推进、多进程写同一目录。这些自己写必然出错，是成熟库的正好职责。
    */
    const FILE = readFileSync(new URL('../../src/host/runtime-log-file.ts', import.meta.url), 'utf8')
    expect(FILE).toContain("from 'rotating-file-stream'")
    expect(FILE).toContain('size: MAX_SIZE')
    expect(FILE).toContain('maxFiles: MAX_FILES')
    // 不自己算轮转。
    expect(FILE).not.toContain('renameSync')
    expect(FILE).not.toContain('unlinkSync')

    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
      dependencies: Record<string, string>
    }
    expect(pkg.dependencies['rotating-file-stream']).toBeDefined()
  })

  it('落盘与内存缓冲写同一行，卸载时收尾流', () => {
    const LOGS = readFileSync(new URL('../../src/host/runtime-logs.ts', import.meta.url), 'utf8')
    // 同一条记录：入缓冲后立刻落盘。
    expect(LOGS).toContain('buffer.push(entry)')
    expect(LOGS).toContain('appendRuntimeLogFile(')
    // 插件卸载时关流，否则最后几行留在用户态缓冲里。
    expect(LOGS).toContain('detachRuntimeLogFile()')
  })

  it('「查看日志」只在 NAS 的 iframe 里渲染', () => {
    /*
      用 `environment.ts` 的 `hasFnosHostBridge`（纯 DOM 判据，等价于
      `detectFnosEnvironment() === 'embedded'`），而不是 `host-bridge.ts` 里那个
      宽松的同名函数——后者把 mobile / 原生宿主也算作可用，手机端会冒出这个按钮，
      而那边定位一个绝对路径没有意义。

      独立浏览器页面同样没有宿主桥：给一个点了没反应的按钮比不给更差。
    */
    const PANEL = readFileSync(new URL('../../src/components/RuntimeLogPanel.tsx', import.meta.url), 'utf8')
    expect(PANEL).toContain("from '../client/services/environment.ts'")
    expect(PANEL).toContain('hasFnosHostBridge()')
    // 不用那个把 mobile 也算进来的宽松判据。
    expect(PANEL).not.toContain('fnosHostBridgeAvailable')
    expect(PANEL).toContain('openFnosFileManager(logDirectory')
    // 目录未知时也不渲染。
    expect(PANEL).toContain('logDirectory === undefined ? null :')
  })
})

describe('禁用态可读性', () => {
  it('抬高 Semi 禁用文字不透明度', () => {
    /*
      Semi 的 `--semi-color-disabled-text` 是 `rgba(grey-9, .35)`——只有 35%。
      在 `light` 主题的浅灰底上几乎看不见，用户读不出那是「禁用」而不是「没渲染
      出来」。

      改的是变量而不是逐个 `.semi-button-disabled`：这个变量被 Button、Input、
      Select、Switch 等一起消费，改一处即覆盖所有亮底/深底的禁用态。
    */
    const scss = readFileSync(new URL('../../src/styles/index.scss', import.meta.url), 'utf8')
    expect(scss).toContain('--semi-color-disabled-text: rgba(var(--semi-grey-9), .55)')
    // 引用 Semi 的调色板变量，不写死 rgb。
    expect(scss).not.toMatch(/--semi-color-disabled-text:\s*rgba\(\d/u)
  })
})

describe('日志列表：上限与虚拟化', () => {
  it('条数上限前后端共用一个契约常量', () => {
    /*
      两处各写一个数字迟早会漂——界面允许 5000、服务端只给 2000，用户会以为丢日志。
    */
    const CONTRACT = readFileSync(new URL('../../src/contracts/runtime-status-contract.ts', import.meta.url), 'utf8')
    expect(CONTRACT).toContain('export const RUNTIME_LOG_MAX_LIMIT = 2000')

    const HOST = readFileSync(new URL('../../src/host/runtime-logs.ts', import.meta.url), 'utf8')
    expect(HOST).toContain('MAX_LOG_LIMIT = RUNTIME_LOG_MAX_LIMIT')

    const PANEL = readFileSync(new URL('../../src/components/RuntimeLogPanel.tsx', import.meta.url), 'utf8')
    expect(PANEL).toContain('RUNTIME_LOG_MAX_LIMIT')
    // 不再有写死的 2000。
    expect(PANEL).not.toContain('max={2000}')
    expect(PANEL).not.toContain('Math.min(next, 2000)')
  })

  it('列表虚拟化用 Virtuoso，不改折行', () => {
    /*
      日志正文折行后行高不定；`react-window` 的 `VariableSizeList` 要靠外部测量 +
      `resetAfterIndex` 手工维护位置，测量滞后一次下一行就被压住——历史上反复出现的
      「文字叠在一起」都是这个来源。

      `Virtuoso` 内置 ResizeObserver 逐项测量，正是为动态高度设计的。
    */
    const PANEL = readFileSync(new URL('../../src/components/RuntimeLogPanel.tsx', import.meta.url), 'utf8')
    expect(PANEL).toContain("from 'react-virtuoso'")
    expect(PANEL).not.toMatch(/from 'react-window'/u)
    // 注释里解释「为什么不用那套」不算，检查的是调用。
    expect(PANEL).not.toMatch(/\.resetAfterIndex\(/u)

    /* 折行是产品决策：省略号会切掉路径与错误码。 */
    const SCSS = readFileSync(new URL('../../src/styles/index.scss', import.meta.url), 'utf8')
    const rule = SCSS.slice(SCSS.indexOf('.dsh-fnos-logs-text {'), SCSS.indexOf('}', SCSS.indexOf('.dsh-fnos-logs-text {')))
    expect(rule).toContain('overflow-wrap: anywhere')
    expect(rule).not.toContain('white-space: nowrap')
  })
})

describe('会话日志菜单：跨应用入口的显示条件', () => {
  it('「在应用中打开」与「导出到 NAS」只用 SHOWS_FILE_MANAGER_ENTRY', () => {
    /*
      `SHOWS_FILE_MANAGER_ENTRY` = `IS_FNOS_EMBEDDED_WEB_ENV`，即
      `isWeb && !isStandaloneWeb`（NAS 应用中心 iframe）。三种环境：

      - NAS 内嵌 web → 显示（文件管理器就在同一个桌面里）
      - 独立浏览器页面 → 不显示（没有宿主桥，openFileManager 必然失败）
      - App 端（isWeb === false）→ 不显示（没有文件管理器窗口的概念，
        跳出去会把用户带离当前会话）

      早前用的是 `HAS_FNOS_HOST_BRIDGE`——那个常量把 App 端也算作「桥可用」，
      于是手机上也会出现这一项。`SHOWS_FILE_MANAGER_ENTRY` 就是为这类跨应用跳转
      准备的常量，项目里已有，不必再现场组合 `isWeb` 判断。
    */
    const MENU = readFileSync(new URL('../../src/components/FnosSessionLogHeaderAction.tsx', import.meta.url), 'utf8')
    expect(MENU).toContain("import { SHOWS_FILE_MANAGER_ENTRY }")
    // 注释里解释「为什么不用旧的」不算，检查的是判定表达式。
    expect(MENU).not.toMatch(/\.\.\.\(HAS_FNOS_HOST_BRIDGE/u)
    // 至少两处：导出到 NAS 的二级项、在应用中打开整块。
    expect(MENU.match(/\.\.\.\(SHOWS_FILE_MANAGER_ENTRY/gu)?.length ?? 0).toBeGreaterThanOrEqual(2)

    /* 常量本身的定义不该漂。 */
    const ENV = readFileSync(new URL('../../src/client/services/runtime-env.ts', import.meta.url), 'utf8')
    expect(ENV).toContain('export const SHOWS_FILE_MANAGER_ENTRY: boolean = IS_FNOS_EMBEDDED_WEB_ENV')
    expect(ENV).toContain("export const IS_FNOS_EMBEDDED_WEB_ENV: boolean = DOM_ENV === 'embedded'")
  })
})

describe('备份文件不残留', () => {
  it('安装成功后删除本次备份', () => {
    /*
      备份只在失败时有用（`rename` 还原）。成功路径原本什么都不做，于是每装一次
      就在 profile 里留下两份 `*.dsh-install-backup-<pid>`——用户在文件管理器里
      看到一堆看不出用途、也不知道能不能删的文件。
    */
    const INSTALL = readFileSync(new URL('../../src/host/plugin-install.ts', import.meta.url), 'utf8')
    expect(INSTALL).toContain('async function discardProfileBackup')
    expect(INSTALL).toContain('await discardProfileBackup(saved)')
    // 成功分支在写 succeeded 之前就清掉。
    const successIdx = INSTALL.indexOf("status: 'succeeded'")
    const discardIdx = INSTALL.indexOf('await discardProfileBackup(saved)')
    expect(discardIdx).toBeGreaterThan(-1)
    expect(discardIdx).toBeLessThan(successIdx)
  })

})

describe('tooltip 的使用边界', () => {
  it('有文案的按钮不套 tooltip', () => {
    /*
      tooltip 的价值是「补上看不见的信息」。按钮本身已有文案时，tooltip 显示的
      仍是同一句话——出现时只是把已有的字遮住再重复一遍。
    */
    const PANEL = readFileSync(new URL('../../src/components/RuntimeLogPanel.tsx', import.meta.url), 'utf8')
    expect(PANEL).not.toContain('DshTooltip')
    /* 按钮本身带文案。 */
    expect(PANEL).toContain("{t('runtimeLogOpenDirectory')}")
  })
})

describe('授权目录：分成两个分组', () => {
  it('按能否取消授权拆组，不再逐行重复「应用共享目录」', () => {
    /*
      `removable === false` 的是应用共享目录（`@appshare` / `@apphome` 等），由应用
      自身创建、不可取消。它们与用户自己授权进来的目录性质不同。

      早前靠行尾一句「应用共享目录」区分，那一列在每行都重复一遍，读起来像状态标签
      而不是分组——用户真正要找「我授权了哪些目录」时，得逐行跳过这些只读项。
    */
    const CARD = readFileSync(new URL('../../src/components/AuthorizedDirectoriesCard.tsx', import.meta.url), 'utf8')
    expect(CARD).toContain('const userDirectories = state.directories.filter(directory => directory.removable)')
    expect(CARD).toContain('const sharedDirectories = state.directories.filter(directory => !directory.removable)')
    // 两组各有一个标题。
    expect(CARD).toContain("{t('authorizedDirectories')}")
    expect(CARD).toContain('dsh-fnos-authorized-group-title')
    expect(CARD).toContain("{t('sharedDirectory')}")
    // 行尾不再重复那句文案。
    expect(CARD).not.toContain('dsh-fnos-authorized-read-only')

    /* 样式也清理干净。 */
    const SCSS = readFileSync(new URL('../../src/styles/index.scss', import.meta.url), 'utf8')
    expect(SCSS).not.toContain('.dsh-fnos-authorized-read-only')
    expect(SCSS).toContain('.dsh-fnos-authorized-group-title')
  })
})

describe('日志：重叠修复与搜索范围', () => {
  it('行高交给 Virtuoso 测量，不再手工维护', () => {
    const PANEL = readFileSync(new URL('../../src/components/RuntimeLogPanel.tsx', import.meta.url), 'utf8')
    expect(PANEL).toContain('Virtuoso')
    expect(PANEL).toContain('increaseViewportBy')
    // 不再有行高常量或测量缓存。
    expect(PANEL).not.toContain('LOG_ROW_HEIGHT')
    expect(PANEL).not.toContain('rowHeights')
  })

  it('有搜索词时自动带磁盘历史，无开关', () => {
    /*
      用户输入关键词就是为了找「现在不在屏幕上的那条」——此时只查内存永远搜不到，
      再让他先选一个范围开关是多一步。

      没有搜索词时不读文件：全量读 5 份 ≤10 MiB 的日志没有意义，首屏也不该等它。
    */
    const PANEL = readFileSync(new URL('../../src/components/RuntimeLogPanel.tsx', import.meta.url), 'utf8')
    expect(PANEL).toContain("scope: hasQuery ? 'files' : 'memory'")
    // 范围下拉已移除。
    expect(PANEL).not.toContain('dsh-fnos-logs-scope')

    const HOST = readFileSync(new URL('../../src/host/runtime-logs.ts', import.meta.url), 'utf8')
    // 合并内存与文件并去重。
    expect(HOST).toContain('const seen = new Set<string>()')
    expect(HOST).toContain('identity(')
  })
})

describe('日志列表：padding 与虚拟化尺寸', () => {
  it('padding 在容器上，高度与宽度都扣掉内距', () => {
    /*
      早前把 padding 加在 `.dsh-fnos-logs-list > div` 上——那个 div 是 react-window
      的滚动层，而它的行是**绝对定位**（靠 translateY 排布）。绝对定位的行不受
      padding 约束，于是 padding 只把滚动条内缩了，行本身仍贴着边框。

      现在 padding 在容器上，组件侧把 clientHeight / clientWidth 扣掉内距再传给
      VariableSizeList——它要的是内容区像素值。
    */
    const SCSS = readFileSync(new URL('../../src/styles/index.scss', import.meta.url), 'utf8')
    const rule = SCSS.slice(SCSS.indexOf('.dsh-fnos-logs-list {'), SCSS.indexOf('}', SCSS.indexOf('.dsh-fnos-logs-list {')))
    expect(rule).toContain('padding: 8px 10px')
    expect(rule).toContain('box-sizing: border-box')
    // 不再有把 padding 挂在内层滚动层的规则。
    expect(SCSS).not.toContain('.dsh-fnos-logs-list > div')

    const PANEL = readFileSync(new URL('../../src/components/RuntimeLogPanel.tsx', import.meta.url), 'utf8')
    expect(PANEL).toContain('el.clientHeight - padY')
    // Virtuoso 的宽度由容器决定，不需要单独传像素值。
    expect(PANEL).not.toContain('listWidth')
  })
})

describe('日志：刷新间隔可选', () => {
  it('默认 5s，可选不刷新 / 5 / 10 / 30 / 60', () => {
    /*
      「不刷新」是明确的选择，不该留着空转的定时器。看历史日志时页面也不该自己
      跳——用户刚滚到的位置会被新内容顶走。
    */
    const PANEL = readFileSync(new URL('../../src/components/RuntimeLogPanel.tsx', import.meta.url), 'utf8')
    expect(PANEL).toContain('REFRESH_OPTIONS: readonly number[] = [0, 5, 10, 30, 60]')
    expect(PANEL).toContain('useState(5)')
    expect(PANEL).toContain('dsh-fnos-logs-refresh')
    /* 0 时不排定时器。 */
    expect(PANEL).toContain('if (refreshSeconds === 0) return undefined')
  })
})

describe('已安装插件列表：两个数组合并', () => {
  it('常驻项恒居顶部，安装状态取自官方 listBundles', () => {
    /*
      列表由两个数组拼成：

      1. 常驻数组：`PINNED_PLUGIN_NAMES` 里每一个都必须出现。官方 `listBundles()`
         里有它就用官方的 `installed` / `enabled` / `version`；没有就当成未安装，
         用兜底信息渲染成「安装」卡片。
      2. 其余数组：官方列表过滤掉常驻项后的部分。

      `[...pinned, ...rest]` 合并——常驻项因此恒居顶部。

      为什么不能只靠官方列表：它只列「当前可知的 bundle」，`dshmarket` 这类被强制
      卸载后就不在里面，卡片跟着消失，用户再也找不到装回来的入口。
    */
    const HOST = readFileSync(new URL('../../src/host/installed-plugins.ts', import.meta.url), 'utf8')
    // 两个数组分开算，最后合并。
    expect(HOST).toContain('const pinned = PINNED_PLUGIN_NAMES.map(name => pinnedCard(name))')
    expect(HOST).toContain('const rest = base.filter(')
    expect(HOST).toContain('const ordered = [...pinned, ...rest]')
    // 官方状态优先，取不到时退回本地判定。
    expect(HOST).toContain('manager.listBundles()')
    expect(HOST).toContain('officialByName.get(name)')
    // 官方的 installed/enabled 覆盖本地读到的值。
    expect(HOST).toContain('remote?.installed === true')
    expect(HOST).toContain('remote.enabled')
  })
})
