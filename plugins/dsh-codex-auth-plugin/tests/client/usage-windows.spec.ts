import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  compactUsageWindow,
  FIVE_HOUR_WINDOW_SECONDS,
  fiveHourWindow,
  monthlyWindow,
  MONTHLY_WINDOW_SECONDS,
  usageWindowKind,
  WEEKLY_WINDOW_SECONDS,
  weeklyWindow,
} from '../../src/client/services/usage-windows.ts'

/**
 * `limit_window_seconds` 是服务端给的**真实**窗口时长，不同套餐差别很大。
 *
 * 实测（free 账号，真实 WHAM 响应）：
 *
 * ```json
 * { "plan_type": "free",
 *   "rate_limit": { "primary_window": { "limit_window_seconds": 2592000 },
 *                   "secondary_window": null } }
 * ```
 *
 * `2592000 = 30 天`。原实现按**精确相等**匹配 `18000`（5 小时）与 `604800`（7 天），
 * 于是 30 天窗口两个都不命中：三个选择器全部返回 `undefined`，用量界面**什么都
 * 不显示**——用户看到的就是「无法获取套餐信息」，而数据其实已经拿到了。
 */
describe('Codex usage window selection', () => {
  const fiveHour = { limitWindowSeconds: FIVE_HOUR_WINDOW_SECONDS, remainingPercent: 62 }
  const weekly = { limitWindowSeconds: WEEKLY_WINDOW_SECONDS, remainingPercent: 84 }
  const monthly = { limitWindowSeconds: MONTHLY_WINDOW_SECONDS, remainingPercent: 97 }

  it('finds windows by duration instead of primary or secondary position', () => {
    const usage = { primaryWindow: weekly, secondaryWindow: fiveHour }
    expect(fiveHourWindow(usage)).toBe(fiveHour)
    expect(weeklyWindow(usage)).toBe(weekly)
  })

  it('does not guess a window when the API omits its duration', () => {
    const usage = { primaryWindow: { remainingPercent: 50 }, secondaryWindow: { remainingPercent: 75 } }
    expect(fiveHourWindow(usage)).toBeUndefined()
    expect(weeklyWindow(usage)).toBeUndefined()
  })

  it('prefers the five-hour window for the compact composer status', () => {
    expect(compactUsageWindow({ primaryWindow: weekly, secondaryWindow: fiveHour })).toBe(fiveHour)
    expect(compactUsageWindow({ primaryWindow: weekly })).toBe(weekly)
  })

  describe('月度窗口（未订阅账号）', () => {
    it('认出 30 天窗口是月度', () => {
      expect(monthlyWindow({ primaryWindow: monthly })).toBe(monthly)
    })

    it('月度窗口不会再被当成每周，也不会两个都落空', () => {
      const usage = { primaryWindow: monthly }
      expect(weeklyWindow(usage)).toBeUndefined()
      expect(fiveHourWindow(usage)).toBeUndefined()
      // 关键：修复前这里是 undefined，界面因此完全不显示用量。
      expect(compactUsageWindow(usage)).toBe(monthly)
    })

    it('在只有月度窗口时仍能给出用途标签', () => {
      expect(usageWindowKind(monthly)).toBe('monthly')
      expect(usageWindowKind(fiveHour)).toBe('five-hour')
      expect(usageWindowKind(weekly)).toBe('weekly')
      // 服务端没给时长时只能回到「每周」这个旧的兜底语义。
      expect(usageWindowKind({ remainingPercent: 50 })).toBe('weekly')
    })

    it('分类按区间而不是精确值：服务端微调时长不会让界面失灵', () => {
      // 实测漂移过的形态：29 天 23 小时。
      expect(usageWindowKind({ limitWindowSeconds: 29 * 24 * 3600 + 23 * 3600 })).toBe('monthly')
      // 5 小时窗口曾出现 ±几分钟的偏差。
      expect(usageWindowKind({ limitWindowSeconds: 5 * 3600 - 300 })).toBe('five-hour')
      expect(usageWindowKind({ limitWindowSeconds: 7 * 24 * 3600 - 60 })).toBe('weekly')
    })

    it('空窗口不参与分类', () => {
      expect(monthlyWindow({})).toBeUndefined()
    })
  })
})

/**
 * 套餐类型（`plan_type`）的展示。
 *
 * 服务端返回的是内部标识符，未订阅账号实测为 `free`。界面此前完全不显示套餐，
 * 原因不是拿不到——host 的 `normalizeCodexUsagePayload` 早就解析了 `planType`，
 * 而是**客户端的 `CodexUsage` 接口没有声明该字段**，数据在类型层就被丢了。
 */
describe('套餐类型的展示', () => {
  it('免费版的内部标识是 free，展示为「免费版」而不是「免费套餐」', async () => {
    const { zh } = await import('../../src/client/locales.ts')
    console.log('  usagePlanFree =', JSON.stringify(zh.usagePlanFree))
    expect(zh.usagePlanFree).toBe('免费版')
    expect(zh.usagePlanFree).not.toContain('套餐')
  })

  it('三种已知套餐都有中文展示名', async () => {
    const { zh } = await import('../../src/client/locales.ts')
    expect(zh.usagePlanPlus).toBe('Plus 版')
    expect(zh.usagePlanPro).toBe('Pro 版')
  })

  it('月度限额有中英文案', async () => {
    const { zh, en } = await import('../../src/client/locales.ts')
    expect(zh.usageMonthly).toBe('每月使用限额')
    expect(en.usageMonthly).toBe('Monthly usage limit')
  })

  it('Host 解析出的 planType 能穿过客户端类型（此前该字段被漏声明）', () => {
    const source = readFileSync(new URL('../../src/client/services/usage-status-data.ts', import.meta.url), 'utf8')
    expect(source).toContain('planType')
  })
})
