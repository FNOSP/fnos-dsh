import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { isAheadOfRegistry, isNewerVersion } from '../../src/host/plugin-updates.ts'
import { MARKET_ENTRY_ID, RECOMMENDED_INDEXES } from '../../src/host/plugin-index-sources.ts'

/**
 * 插件更新检测与索引源管理。
 *
 * 两条最容易错的规则：**预发布不算更新**（不能诱导稳定用户升 beta）、
 * **不兼容时不提示更新**（装上去起不来比「没更新」更糟）。
 */
const UPDATES = readFileSync(new URL('../../src/host/plugin-updates.ts', import.meta.url), 'utf8')
const INDEX = readFileSync(new URL('../../src/host/plugin-index-sources.ts', import.meta.url), 'utf8')
const PANEL = readFileSync(new URL('../../src/components/PluginIndexPanel.tsx', import.meta.url), 'utf8')
const LIST = readFileSync(new URL('../../src/components/InstalledPluginsPanel.tsx', import.meta.url), 'utf8')

describe('插件更新：版本比较', () => {
  it('严格更高才提示更新', () => {
    expect(isNewerVersion('8.1.0', '8.1.1')).toBe(true)
    expect(isNewerVersion('8.1.0', '8.0.9')).toBe(false)
    expect(isNewerVersion('8.1.0', '8.1.0')).toBe(false)
    expect(isNewerVersion('1.0.0', '2.0.0')).toBe(true)
  })

  it('预发布按 semver 规则比较，与 fork 的 newerVersions 同结论', () => {
    /*
      本项目只查 `dist-tags.latest`（稳定线），所以「稳定用户被诱导升 beta」这条
      风险由**取数**挡住，不需要在比较层再拦一道。比较层只管 semver 语义：

      - 同为正式版：严格更高才算更新；
      - 装的是 beta、latest 是正式版 → 是更新（该升上去）；
      - latest 是 beta、装的是正式版 → 不是更新（beta 低于同号正式版）。

      这里曾写成「带 `-` 一律不是更新」，会把 `1.73.20-beta` 装到
      `1.73.20` 正式版的场景判错；fork 的 `semver.gt` 也是按此规则。
    */
    // 主版本更高：即使 latest 是 beta，也高于当前正式版（semver 语义）。
    expect(isNewerVersion('8.1.0', '8.2.0-beta.1')).toBe(true)
    // 同号时 beta 低于正式版。
    expect(isNewerVersion('8.2.0', '8.2.0-beta.1')).toBe(false)
    expect(isNewerVersion('9.0.0-rc.1', '9.0.0')).toBe(true)      // beta → 正式版
    expect(isNewerVersion('8.1.0', '9.0.0')).toBe(true)
    expect(isNewerVersion('1.73.20-beta.1', '1.73.20')).toBe(true)
    expect(isNewerVersion('1.73.20', '1.73.20-beta.1')).toBe(false)
  })

  it('多位数字按数值比较，不按字符串', () => {
    // 真机场景：dshmarket 1.73.15 的 latest 是 1.73.20。
    expect(isNewerVersion('1.73.15', '1.73.20')).toBe(true)
    expect(isNewerVersion('1.73.9', '1.73.10')).toBe(true)
    expect(isNewerVersion('1.73.20', '1.73.15')).toBe(false)
  })

  it('三段位数不同也不出错（8.1.3 < 8.1.148）', () => {
    /*
      真机截图：OpenCode 装的是 8.1.3，registry 上是 8.1.148，界面却显示
      「已是最新」。手写解析碰到这种情况容易把段数不同、位数相差很大的版本比较
      判错。现在交给 `semver.gt`，与 npm 自己和宿主用同一套规则。
    */
    expect(isNewerVersion('8.1.3', '8.1.148')).toBe(true)
    expect(isNewerVersion('8.1.148', '8.1.3')).toBe(false)
    expect(isNewerVersion('8.1.3', '8.1.4')).toBe(true)
    // 构建元数据不参与排序。
    expect(isNewerVersion('8.1.3+build.9', '8.1.3+build.10')).toBe(false)
  })

  it('无法解析的版本不报错、不提示', () => {
    expect(isNewerVersion('bad', '8.1.1')).toBe(false)
    expect(isNewerVersion('8.1.0', 'also-bad')).toBe(false)
  })
})

describe('插件更新：本地版本高于 registry', () => {
  it('本地比 registry 新时单独标记，不显示「已是最新」', () => {
    /*
      真机踩到：本地装 8.1.57，npm 上最新是 8.1.1，界面却显示「已是最新」。
      版本比较本身没错（8.1.1 不比 8.1.57 新），但文案误导——用户会以为
      自己装的就是发布版。开发/内测环境必须能看出这个差别。
    */
    expect(isAheadOfRegistry('8.1.57', '8.1.1')).toBe(true)
    expect(isAheadOfRegistry('8.1.1', '8.1.57')).toBe(false)
    expect(isAheadOfRegistry('8.1.1', '8.1.1')).toBe(false)
  })

  it('界面有独立的「本地版本」标记', () => {
    expect(LIST).toContain("t('installedAheadOfRegistry')")
    expect(LIST).toContain('plugin.aheadOfRegistry')
  })
})

describe('插件更新：兼容性门禁', () => {
  it('复用官方 evaluatePluginCompatibility，不自写 semver 规则', () => {
    expect(UPDATES).toContain('evaluatePluginCompatibility')
    expect(UPDATES).toContain('getDshRuntimeVersion')
    expect(UPDATES).toContain("from '@deepseek-ai/dsh-app-boot'")
  })

  it('不兼容时不提示更新', () => {
    // `!incompatible && latest !== undefined && isNewer`
    expect(UPDATES).toMatch(/updateAvailable: !incompatible/)
  })

  it('查询限并发，避免一次打十几个请求', () => {
    expect(UPDATES).toContain('CONCURRENCY')
  })
})

describe('插件索引：推荐源与状态', () => {
  it('两个推荐源固定', () => {
    expect([...RECOMMENDED_INDEXES]).toEqual([
      'https://fndsh-doc.tnnevol.cn/plugins/market/index.json',
      'https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json',
    ])
  })

  it('市场 entry id 取自官方 bundle，不是猜的', () => {
    expect(MARKET_ENTRY_ID).toBe('plugin-market')
    expect(INDEX).toContain('dsh-experimental-plugin-market-bundle')
  })

  it('开关状态来自 bundle 是否被选中，与官方 setBundleEnabled 同判据', () => {
    /*
      早前看 `ctx.get('pluginMarket')`（模块在不在内存里），于是 bundle 明明在
      `bundles` 数组里、界面却可以因为一个本地开关显示「未开启」。
      现在读写都走 `dsh.profile.bundles`，与「已安装的插件」页完全一致。
    */
    expect(INDEX).toContain('MARKET_BUNDLE_NAME')
    expect(INDEX).toContain('readSelectedBundles')
    expect(INDEX).toContain('selected.includes(MARKET_BUNDLE_NAME)')
    expect(INDEX).toContain('setMarketEnabled')
  })

  it('设置只追加、不覆盖用户已配的源', () => {
    expect(INDEX).toContain('只追加、不覆盖')
    expect(INDEX).toContain('const merged = [...status.configured]')
  })
})

describe('插件索引：界面', () => {
  it('开启用 Switch 而不是按钮，且调用真实切换接口', () => {
    // 开关表达「持续状态」，按钮表达「执行动作」；这里改的是状态。
    expect(PANEL).toContain('SwitchWithLoading')
    expect(PANEL).toContain('checked={enabled}')
    expect(PANEL).toContain('setIndexEnabledRemote')
    expect(PANEL).not.toContain("t('indexApplyEnable')")
  })

  it('开关反映真实状态（市场启用 + 未显式关掉），不是本地偏好', () => {
    /*
      真机踩到：市场明明是启用状态，开关却显示「未开启」——因为原来只看
      localStorage 里的偏好，本地没存过值就当 false。开关必须反映事实。
    */
    // 现在直接读 bundle 选择状态，本地偏好已彻底移除。
    expect(PANEL).toMatch(/const enabled = status\?\.marketEnabled === true/u)
    const CLIENT = readFileSync(new URL('../../src/client/services/plugin-index-client.ts', import.meta.url), 'utf8')
    expect(CLIENT).not.toContain('DISABLED_KEY')
    expect(CLIENT).toContain('setIndexEnabledRemote')
  })

  it('引导图用 Semi 的 Image 组件，且不带 border', () => {
    // 裸 <img> 拿不到 Semi 的加载态与主题样式。
    expect(PANEL).toContain('DshImage')
    // 只检查实际 JSX 标签：注释里提到「裸 <img>」属于说明文字，不算违规。
    expect(PANEL).not.toMatch(/<img\s/u)
    const SCSS = readFileSync(new URL('../../src/styles/index.scss', import.meta.url), 'utf8')
    const rule = SCSS.slice(SCSS.indexOf('.dsh-fnos-idx-guide-image {'))
    expect(rule.slice(0, rule.indexOf('}'))).not.toContain('border')
  })

  it('设置按钮在市场缺失或已配齐时置灰', () => {
    expect(PANEL).toContain("t('indexApplyConfigure')")
    expect(PANEL).toContain('disabled={applying || busyUrls.size > 0 || marketMissing || allConfigured}')
  })

  it('移除/添加各自独立转圈，可以同时有多个在跑', () => {
    /*
      用全局布尔会让点一条时**所有行**一起转圈，看起来像整批都在变。

      但只用单个 `string` 也不够：用户可以连续点几条，点第二条时把第一条的状态
      覆盖掉，上一行的转圈凭空消失——它其实还在跑（2026-11-26 提出人指出）。

      所以记的是**集合**：每行只看 `has(自己)`。
    */
    expect(PANEL).toContain('const [busyUrls, setBusyUrls] = useState<ReadonlySet<string>>')
    expect(PANEL).toContain('loading={busyUrls.has(source.url)}')
    // 只清自己那一格，别把还在跑的其它行一起清掉。
    expect(PANEL).toContain('next.delete(url)')
    /* 「设置」是整批操作，没有具体行，用独立的 applying。 */
    expect(PANEL).toContain('const [applying, setApplying]')
  })

  it('增删请求串行执行，界面允许连点', () => {
    /*
      后端是读-改-写：先读当前 `indexes` 再整体写回。两条并发请求会各自读到同一份
      旧值，后写的覆盖先写的——「加了 B 也加了 C」最后只剩一条。

      所以 UI 允许连续点、各自转圈，请求由队列排队执行。
    */
    expect(PANEL).toContain('const queueRef = useRef<Promise<void>>(Promise.resolve())')
    expect(PANEL).toContain('queueRef.current = queueRef.current.then(')
    // 同一 URL 已经在跑时不重复入队。
    expect(PANEL).toContain('if (busyUrls.has(url)) return')
  })

  it('引导图引用官方插件自带图，读不到时不显示破图', () => {
    // 用官方图：官方改版时那张图会一起更新。
    expect(PANEL).toContain('detail-file?bundle=')
    expect(PANEL).toContain('preview.zh.svg')
    expect(PANEL).toContain('onError')
  })

  it('「设置」只在开启后显示', () => {
    /*
      未开启时这一行是死信息：源都配齐、按钮永远灰着，占一整块却没有可做的事。
      开关已表达「开/关」，清单也照常展示配了哪些源，因此未开启时直接隐藏。
    */
    expect(PANEL).toMatch(/\{enabled \? \(\s*<div className="dsh-fnos-idx-row"/u)
    expect(PANEL).toContain("t('indexApplyConfigure')")
  })

  it('关闭时整块隐藏（源清单 / 引导文字 / 引导图）', () => {
    /*
      关闭状态下这些全是死信息：源配了也说明不了什么、引导也没有可执行的动作，
      却占掉大半屏。开关本身已清楚表达「未启用」。
    */
    const PANEL = readFileSync(new URL('../../src/components/PluginIndexPanel.tsx', import.meta.url), 'utf8')
    const idx = PANEL.lastIndexOf('{enabled ? (')
    const block = PANEL.slice(idx)
    expect(block).toContain('dsh-fnos-idx-list')
    expect(block).toContain("t('indexGuideText')")
    expect(block).toContain('dsh-fnos-idx-guide-image')
    expect(block).toContain(') : null}')
  })

  it('索引标题从索引文件读，不硬编码', () => {
    // 索引改名（dsh 插件目录 → Awesome DSH Plugin 插件精选）时代码不用改。
    expect(INDEX).toContain('fetchIndexTitle')
    expect(INDEX).toContain('title')
    expect(PANEL).toContain('source.label')
  })

  it('引导文案告诉用户在官方界面的哪一步填（不用会过期的截图）', () => {
    expect(PANEL).toContain("t('indexGuideText')")
  })
})

describe('插件安装与异常：两段顺序与分割线', () => {
  it('镜像管理在前、修复在后', () => {
    /*
      「装不上」最常见的原因是网络（国内直连 registry 慢或被限流），先排查镜像
      再谈修复，顺序与真实排查路径一致。
    */
    const CARD = readFileSync(new URL('../../src/components/GatewayProxyCard.tsx', import.meta.url), 'utf8')
    const block = CARD.slice(CARD.indexOf('dsh-fnos-repair-tab'))
    expect(block.indexOf('NpmMirrorCard')).toBeLessThan(block.indexOf('DependencyRepairCard'))
  })

  it('分割线挂在每个模块底部，最后一个去掉', () => {
    /*
      早前把线画在镜像模块的 `border-top` 上，位置偏了：那条线跑到 tab 内容区最
      上面、紧贴 tab 栏，看起来像 tab 栏的下边框，而不是「两个功能之间」的线。

      改为每个模块各自 `border-bottom`，`:last-child` 去掉。
    */
    const SCSS = readFileSync(new URL('../../src/styles/index.scss', import.meta.url), 'utf8')
    /* 选择器空格是格式差异，用正则定位。 */
    const idx = SCSS.search(/\.dsh-fnos-repair-tab\s*>\s*\*\s*\{/u)
    expect(idx).toBeGreaterThan(-1)
    const rule = SCSS.slice(idx, SCSS.indexOf('\n}', idx))
    expect(rule).toContain('border-bottom: 1px solid')

    // 第一个模块的线贴近内容（5px），后续模块线与下一块之间留 15px。
    expect(rule).toContain('padding-bottom: 5px')
    const gap = SCSS.slice(SCSS.search(/\.dsh-fnos-repair-tab\s*>\s*\*\s*\+\s*\*\s*\{/u))
    expect(gap.slice(0, gap.indexOf('\n}'))).toContain('margin-top: 15px')

    const last = SCSS.slice(SCSS.search(/\.dsh-fnos-repair-tab\s*>\s*\*:last-child\s*\{/u))
    expect(last.slice(0, last.indexOf('\n}'))).toContain('border-bottom: none')

    // 镜像模块自己不再带 border-top（否则第一块顶部多一道线）。
    const mirror = SCSS.slice(SCSS.indexOf('.dsh-fnos-mirror {'), SCSS.indexOf('.dsh-fnos-mirror-head {'))
      .replace(/\/\*[\s\S]*?\*\//gu, '')
    expect(mirror).not.toMatch(/^\s*border-top\s*:/mu)
  })
})

describe('状态获取要快：默认不联网查更新', () => {
  it('路由只在 updates=1 时查 registry', () => {
    /*
      查更新是「每个插件发一次 registry 请求」，装十几个插件就要十几个网络往返，
      首屏因此很慢。官方 `listPlugins` 也只读本地清单，版本更新是另一条单独调用。
    */
    const ROUTES = readFileSync(new URL('../../src/host/gateway-proxy-routes.ts', import.meta.url), 'utf8')
    expect(ROUTES).toContain("url.searchParams.get('updates') === '1'")
    const CLIENT = readFileSync(new URL('../../src/client/services/gateway-proxy-client.ts', import.meta.url), 'utf8')
    // 客户端默认 false。
    expect(CLIENT).toContain('fetchInstalledPlugins(checkUpdates = false)')
  })

  it('索引页有手动刷新按钮', () => {
    // 状态来自磁盘上的 bundles 数组，外部改动不会自动反映过来。
    const PANEL = readFileSync(new URL('../../src/components/PluginIndexPanel.tsx', import.meta.url), 'utf8')
    expect(PANEL).toContain("aria-label={t('refresh')}")
  })
})

describe('禁用索引不需要重启', () => {
  it('只有启用的 needRestart 为真', () => {
    /*
      启用要往组合里加一层 bundle，而组合在进程启动时装配——不重启那层代码不在内存里。
      禁用是把它摘掉：模块还在内存，但索引这条路不再被调用，用户看到的就是「立刻关掉了」。
      为此提示重启属于过度要求，反而让用户以为没关成功。
    */
    const SRC = readFileSync(new URL('../../src/host/plugin-index-sources.ts', import.meta.url), 'utf8')
    expect(SRC).toContain('needRestart: enabled')
    expect(SRC).not.toContain('needRestart: true }')
  })

  it('文案分两种，禁用不提重启，且走 Toast', () => {
    const PANEL = readFileSync(new URL('../../src/components/PluginIndexPanel.tsx', import.meta.url), 'utf8')
    expect(PANEL).toContain("t('indexToggleDisabled')")
    expect(PANEL).toContain('notifySuccess')
    // 不再就地渲染提示。
    expect(PANEL).not.toContain('restartNotice')
  })
})

describe('操作结果用 Toast 通知', () => {
  it('不再就地插一行提示文案', () => {
    /*
      就地插文案会撑动布局、容易被忽略、失败后一直挂着。Toast 悬浮在角落、自动
      消失、样式统一。

      需要**持续看到**的信息（如「需重启 Web 才生效」）仍留在页面上——那种提示
      消失得太快反而有害，因此 `pluginRemoveNeedRestart` 走 Toast，
      而安装卡片内的进度仍内联。
    */
    const NOTIFY = readFileSync(new URL('../../src/client/notify.ts', import.meta.url), 'utf8')
    expect(NOTIFY).toContain('DshToast.success')
    expect(NOTIFY).toContain('DshToast.error')

    // 已安装面板不再有就地 notice 状态。
    const PANEL = readFileSync(new URL('../../src/components/InstalledPluginsPanel.tsx', import.meta.url), 'utf8')
    expect(PANEL).toContain('notifyFailure')
    expect(PANEL).not.toContain('setNotice(')
  })
})

describe('样式注入必须去重', () => {
  it('用固定 id 复用 style 标签，不无条件 append', () => {
    /*
      真机问题：插件每次加载（热更新、禁用再启用、多插件并存）都无条件
      `document.head.append(style)`，页面里能堆出好几份完全相同的 Semi 样式
      （整包 CSS 约 250KB，Semi 占 89%）。

      实测本仓库 6 个插件都内联了 Semi，装多个插件时重复更明显。
    */
    const BUILD = readFileSync(new URL('../../tsdown.config.ts', import.meta.url), 'utf8')
    expect(BUILD).toContain('getElementById(ID)')
    expect(BUILD).toContain('dsh-plugin-style-')
    expect(BUILD).toContain('__disposeStyle')
    // 不能还是「直接 append」的旧写法。
    expect(BUILD).not.toContain("document.head.append(style); })();")
  })
})

describe('已安装列表：更新三态', () => {
  it('不兼容优先于更新提示', () => {
    const inorder = LIST.indexOf('installedIncompatible')
    const update = LIST.indexOf('installedUpdateAvailable')
    expect(inorder).toBeGreaterThan(-1)
    expect(update).toBeGreaterThan(-1)
    expect(inorder).toBeLessThan(update)
  })
})

describe('索引源页签：刷新按钮与「已安装的插件」同位置', () => {
  const INDEX_SRC = readFileSync(new URL('../../src/components/PluginIndexPanel.tsx', import.meta.url), 'utf8')
  const INSTALLED_SRC = readFileSync(new URL('../../src/components/InstalledPluginsPanel.tsx', import.meta.url), 'utf8')

  it('刷新按钮在卡片之外的独立工具条里', () => {
    /*
      原先它塞在索引源卡片内、紧挨着开关：语义上属于「工具条动作」却混进了
      「这一项的状态与开关」之间。两个页签之间切换时同一个按钮换个地方，很跳。
    */
    expect(INDEX_SRC).toContain('dsh-fnos-installed-toolbar')
    expect(INSTALLED_SRC).toContain('dsh-fnos-installed-toolbar')

    // 工具条必须在索引源卡片（`.dsh-fnos-idx-row`）**之后**闭合，而不是里面。
    const rowEnd = INDEX_SRC.indexOf('dsh-fnos-installed-toolbar')
    const cardStart = INDEX_SRC.indexOf('dsh-fnos-idx-row')
    expect(cardStart).toBeGreaterThan(-1)
    expect(rowEnd).toBeGreaterThan(cardStart)
    // 刷新按钮不应出现在 card 的开关之后、工具条之前。
    const between = INDEX_SRC.slice(cardStart, rowEnd)
    expect(between).not.toContain('lucide:refresh-cw')
  })

  it('两个页签用同一个类，右对齐由样式统一决定', () => {
    // 用同一个类而不是各写一套对齐，避免以后又漂走。
    expect(INDEX_SRC).not.toContain('dsh-fnos-idx-toolbar')
  })
})

describe('索引源面板：首次加载用骨架屏占位', () => {
  const PANEL_SRC = readFileSync(new URL('../../src/components/PluginIndexPanel.tsx', import.meta.url), 'utf8')
  const SCSS_SRC = readFileSync(new URL('../../src/styles/index.scss', import.meta.url), 'utf8')

  it('status 未就绪时渲染骨架，不按「未开启」渲染', () => {
    /*
      `status` 还是 `undefined` 时什么都不知道，早前却直接按「未开启」渲染：加载慢的
      时候用户先看到一个**错的**「未开启」，随后跳成「已开启」，中间还空着一大块。
    */
    expect(PANEL_SRC).toContain('const loading = status === undefined && error === undefined')
    expect(PANEL_SRC).toContain('dsh-fnos-idx-skeleton')
    // 正常视图必须被 status 门住，否则加载中仍会显示「未开启」。
    expect(PANEL_SRC).toMatch(/\{status === undefined \? null : \(/u)
  })

  it('占位内容走 placeholder 属性，不能当 children 传', () => {
    /*
      Semi 的 `Skeleton` 是容器：`children` 是**加载完成后**要显示的内容，占位图由
      `placeholder` 单独给。

      早前把 `<DshSkeleton.Title>` 直接写在里面，它被当成 children——而 `loading`
      默认为 `true` 时 children 不渲染，产出的 DOM 是空的
      `<div class="semi-skeleton">`，高度 0。视觉上就是**一片空白**
      （真机实测 `rootH: 0`），正是截图里的样子。

      修后实测：骨架高 142px、骨架条 24px、`animationName` 为 `skeleton-loading`。
    */
    expect(PANEL_SRC).toContain('placeholder={(')
    expect(PANEL_SRC).toContain('active')
    // 不能再出现「DshSkeleton 直接包住 Title」的写法。
    expect(PANEL_SRC).not.toMatch(/<DshSkeleton active>\s*\{?\/?\*?[\s\S]{0,80}<DshSkeleton\.Title/u)
    expect(PANEL_SRC).toContain('aria-busy="true"')
    expect(PANEL_SRC).toContain('dsh-fnos-visually-hidden')
  })

  it('骨架样式与真实行同盒模型，加载完成不跳动', () => {
    expect(SCSS_SRC).toContain('.dsh-fnos-idx-skeleton-row')
    expect(SCSS_SRC).toMatch(/\.dsh-fnos-idx-skeleton-row \{[^}]*min-height: 40px/u)
  })

  it('加载失败不算 loading，交给错误提示', () => {
    // 否则失败后会一直转骨架。
    expect(PANEL_SRC).toContain('error === undefined')
  })
})

describe('移动端面板：左右内边距对称', () => {
  const SCSS_SRC = readFileSync(new URL('../../src/styles/index.scss', import.meta.url), 'utf8')

  it('移动端覆盖掉桌面的 `0 24px 0 4px`', () => {
    /*
      桌面形态左 4 是刻意的：它要和左侧导航列自己的右内边距 12 相加成 16。
      移动端导航变成顶部横条、左列不存在，那 4px 就裸露成「左边几乎没有留白」，
      右边仍是 24px，同一块内容左右差 20px。
    */
    // 桌面那条 `0 24px 0 4px` 要保留（左 4 是与导航列配合的刻意取值），
    // 移动端必须另给一条对称覆盖。
    expect(SCSS_SRC).toContain('padding: 0 24px 0 4px')
    expect(SCSS_SRC).toContain('padding: 0 16px calc(16px + env(safe-area-inset-bottom, 0px))')
  })

  it('卡片正文不再叠第二级缩进', () => {
    // `margin: 0 16px` 叠在面板 16 上会变成 32，与顶部图标行的边线对不齐。
    expect(SCSS_SRC).toMatch(/\.dsh-fnos-authorized-card-body \{\s*margin-inline: 0;/u)
  })
})

describe('反代面板：能力不可用走缺省页', () => {
  const CARD = readFileSync(new URL('../../src/components/GatewayProxyCard.tsx', import.meta.url), 'utf8')
  const SCSS = readFileSync(new URL('../../src/styles/index.scss', import.meta.url), 'utf8')
  const LOCALES = readFileSync(new URL('../../src/client/locales.ts', import.meta.url), 'utf8')

  it('读取失败与保存失败分开', () => {
    /*
      反代前缀依赖 fnOS 侧注入的脚本；没有注入时读接口整体失败。早前把它和保存失败
      塞进同一个 message，于是读取失败仍然渲染完整编辑器——填不进内容的文本框、
      两个永远是灰的按钮、底下一行红字，看着像功能坏了。
    */
    expect(CARD).toContain('const [loadFailed, setLoadFailed] = useState(false)')
    expect(CARD).toContain('setLoadFailed(true)')
    // 读取失败的 catch 里不应再写 message。
    const loadCatch = CARD.slice(CARD.indexOf('const load = useCallback'), CARD.indexOf('useEffect(() => { void load() }'))
    expect(loadCatch).not.toContain("setMessage(t('gatewayProxyFailed'))")
  })

  it('不可用时渲染缺省组件，不渲染编辑器', () => {
    expect(CARD).toContain('const proxyPanel = loadFailed ? (')
    expect(CARD).toContain('<DshEmpty')
    expect(CARD).toContain('dsh-fnos-proxy-empty')
    expect(CARD).toContain('FnosEmptyIllustration')
    // 缺省页要带重试，能力恢复后不必重开面板。
    expect(CARD).toContain("t('retry')")
  })

  it('九种语言都有新增的三条文案', () => {
    for (const key of ['gatewayProxyUnavailableTitle', 'gatewayProxyUnavailableHint', 'retry']) {
      expect(LOCALES).toContain(`${key}:`)
    }
    expect(LOCALES).toContain("gatewayProxyUnavailableTitle: '当前环境不支持反代配置'")
    expect(LOCALES).toContain("retry: '重试'")
  })

  it('缺省页样式与其它空状态同一套', () => {
    expect(SCSS).toMatch(/\.dsh-fnos-picker-empty,\s*\.dsh-fnos-proxy-empty \{/u)
    expect(SCSS).toContain('.dsh-fnos-proxy-empty-desc')
  })
})

/**
 * 「有更新」的判据：**registry 上适配当前 DSH 的最高版本**，不看 dist-tag。
 *
 * 真机复现：`@tnnevol/dsh-opencode` 装 8.1.3，该包 `latest=8.1.3` 而
 * `next=8.1.148`。只看 latest 会判定「已是最新」，把真正能装的新版本藏起来。
 * 本仓库的发布策略就是只发 next，latest 长期滞后——所以判据必须与 tag 解耦。
 */
describe('更新判据：取适配当前 DSH 的最高版本', () => {
  const HOST = readFileSync(new URL('../../src/host/plugin-updates.ts', import.meta.url), 'utf8')

  it('拉完整版本清单而不是 dist-tags.latest', () => {
    expect(HOST).toContain('fetchHighestCompatible')
    // 请求包根路径的完整文档，而不是 /latest 这个 tag 端点。
    expect(HOST).not.toMatch(/registry\.npmjs\.org\/\$\{name[^}]*\}\/latest/u)
  })

  it('用精简元数据，避免拉回 README 等大字段', () => {
    expect(HOST).toContain('application/vnd.npm.install-v1+json')
  })

  it('跳过预发布版本', () => {
    // 稳定用户不该被悄悄推到预发布线；按 semver 的 prerelease 判断，不靠字符串匹配。
    expect(HOST).toContain("normalized.includes('-')")
  })

  it('按当前 DSH 基线筛，且用与宿主相同的判定', () => {
    expect(HOST).toContain('evaluatePluginCompatibility')
    expect(HOST).toContain('getDshRuntimeVersion()')
  })

  it('候选里取最高的，不依赖 registry 返回顺序', () => {
    expect(HOST).toContain('gt(normalized, best)')
  })
})
