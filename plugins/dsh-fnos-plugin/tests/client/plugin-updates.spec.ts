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

  it('预发布版本不提示更新', () => {
    // 稳定用户不该被诱导升 beta。
    expect(isNewerVersion('8.1.0', '8.2.0-beta.1')).toBe(false)
    expect(isNewerVersion('8.1.0', '9.0.0-rc.1')).toBe(false)
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

  it('一键设置只追加、不覆盖用户已配的源', () => {
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

  it('一键设置按钮在市场缺失或已配齐时置灰', () => {
    expect(PANEL).toContain("t('indexApplyConfigure')")
    expect(PANEL).toContain('disabled={busy || marketMissing || allConfigured}')
  })

  it('引导图引用官方插件自带图，读不到时不显示破图', () => {
    // 用官方图：官方改版时那张图会一起更新。
    expect(PANEL).toContain('detail-file?bundle=')
    expect(PANEL).toContain('preview.zh.svg')
    expect(PANEL).toContain('onError')
  })

  it('「一键设置」只在开启后显示', () => {
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
    const idx = SCSS.indexOf('.dsh-fnos-repair-tab > * {')
    expect(idx).toBeGreaterThan(-1)
    const rule = SCSS.slice(idx, SCSS.indexOf('\n}', idx))
    expect(rule).toContain('border-bottom: 1px solid')

    // 第一个模块的线贴近内容（5px），后续模块线与下一块之间留 15px。
    expect(rule).toContain('padding-bottom: 5px')
    const gap = SCSS.slice(SCSS.indexOf('.dsh-fnos-repair-tab > * + * {'))
    expect(gap.slice(0, gap.indexOf('\n}'))).toContain('margin-top: 15px')

    const last = SCSS.slice(SCSS.indexOf('.dsh-fnos-repair-tab > *:last-child {'))
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
