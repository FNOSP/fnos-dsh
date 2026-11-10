import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { isAheadOfRegistry, isNewerVersion } from '../../src/host/plugin-updates.ts'
import { MARKET_ENTRY_ID, RECOMMENDED_INDEXES, readIndexStatus } from '../../src/host/plugin-index-sources.ts'

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

  it('市场未装时报告不可用，而不是写一份没人读的配置', async () => {
    // 服务未挂载（ctx.get 返回 undefined）即为未装。
    const status = await readIndexStatus({ get: () => undefined, settings: { describe: () => [] } } as never)
    expect(status.marketAvailable).toBe(false)
    expect(status.reason).toBe('plugin-market-not-installed')
  })

  it('一键设置只追加、不覆盖用户已配的源', () => {
    expect(INDEX).toContain('只追加、不覆盖')
    expect(INDEX).toContain('const merged = [...status.configured]')
  })
})

describe('插件索引：界面', () => {
  it('开启用 Switch 而不是按钮', () => {
    // 开关表达「持续状态」，按钮表达「执行动作」；这里改的是状态。
    expect(PANEL).toContain('DshSwitch')
    expect(PANEL).toContain('checked={enabled}')
    expect(PANEL).toContain('disabled={busy || marketMissing}')
    expect(PANEL).not.toContain("t('indexApplyEnable')")
  })

  it('开关反映真实状态（市场启用 + 未显式关掉），不是本地偏好', () => {
    /*
      真机踩到：市场明明是启用状态，开关却显示「未开启」——因为原来只看
      localStorage 里的偏好，本地没存过值就当 false。开关必须反映事实。
    */
    expect(PANEL).toContain('getIndexDisabled')
    expect(PANEL).toMatch(/const enabled = status !== undefined && status\.marketAvailable/)
    // 偏好只记录「关掉」，默认跟随真实状态。
    const CLIENT = readFileSync(new URL('../../src/client/services/plugin-index-client.ts', import.meta.url), 'utf8')
    expect(CLIENT).toContain('DISABLED_KEY')
    expect(CLIENT).toContain('removeItem')
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

describe('已安装列表：更新三态', () => {
  it('不兼容优先于更新提示', () => {
    const inorder = LIST.indexOf('installedIncompatible')
    const update = LIST.indexOf('installedUpdateAvailable')
    expect(inorder).toBeGreaterThan(-1)
    expect(update).toBeGreaterThan(-1)
    expect(inorder).toBeLessThan(update)
  })
})
