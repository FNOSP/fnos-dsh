import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { isNewerVersion } from '../../src/host/plugin-updates.ts'
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

  it('市场未装时报告不可用，而不是写一份没人读的配置', () => {
    // 用一个只有 settings 的空 context 模拟未装。
    const status = readIndexStatus({ settings: { describe: () => [] } } as never)
    expect(status.marketAvailable).toBe(false)
    expect(status.reason).toBe('plugin-market-not-installed')
  })

  it('一键设置只追加、不覆盖用户已配的源', () => {
    expect(INDEX).toContain('只追加、不覆盖')
    expect(INDEX).toContain('const merged = [...status.configured]')
  })
})

describe('插件索引：界面', () => {
  it('两个按键都有，且市场缺失时置灰', () => {
    expect(PANEL).toContain("t('indexApplyEnable')")
    expect(PANEL).toContain("t('indexApplyConfigure')")
    expect(PANEL).toContain('disabled={busy || marketMissing || allConfigured}')
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
