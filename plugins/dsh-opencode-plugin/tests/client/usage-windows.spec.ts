import { describe, expect, it } from 'vitest'
import type { OpenCodeUsage } from '../../src/contracts/usage.ts'
import {
  countdownParts,
  countdownUnitKey,
  formatCountdownParts,
  peakUsageWindow,
  remainingPercentValue,
  resetCountdown,
  usageWindowLabelKey,
  usageWindowOf,
  usedPercentText,
  usedPercentValue,
} from '../../src/client/services/usage-windows.ts'

const NOW = Date.parse('2026-10-23T09:00:00.000Z')

/** 构造一份三窗口齐全的用量快照。 */
function usage(rollingUsed: number, weeklyUsed: number, monthlyUsed: number): OpenCodeUsage {
  return {
    rolling: { status: 'ok', percent: rollingUsed, resetsAt: '2026-10-23T14:00:00.000Z' },
    weekly: { status: 'ok', percent: weeklyUsed, resetsAt: '2026-10-27T09:00:00.000Z' },
    monthly: { status: 'rate-limited', percent: monthlyUsed, resetsAt: '2026-11-22T09:00:00.000Z' },
    fetchedAt: NOW,
  }
}

describe('已用百分比展示', () => {
  it('四舍五入并夹到 0..100', () => {
    expect(usedPercentText({ status: 'ok', percent: 42.4, resetsAt: '' })).toBe('42%')
    expect(usedPercentText({ status: 'ok', percent: 42.6, resetsAt: '' })).toBe('43%')
    expect(usedPercentText({ status: 'ok', percent: 100, resetsAt: '' })).toBe('100%')
    expect(usedPercentText({ status: 'ok', percent: 150, resetsAt: '' })).toBe('100%')
    expect(usedPercentText({ status: 'ok', percent: -5, resetsAt: '' })).toBe('0%')
  })

  it('缺失或非数字时不猜 0%', () => {
    expect(usedPercentText(undefined)).toBeUndefined()
    expect(usedPercentText({ status: 'ok', percent: Number.NaN, resetsAt: '' })).toBeUndefined()
  })

  it('进度条与圆环的数值口径', () => {
    expect(usedPercentValue({ status: 'ok', percent: 42, resetsAt: '' })).toBe(42)
    expect(usedPercentValue(undefined)).toBe(0)
    expect(remainingPercentValue({ status: 'ok', percent: 42, resetsAt: '' })).toBe(58)
    expect(remainingPercentValue(undefined)).toBe(100)
  })
})

describe('窗口取出与「最紧张的窗口」', () => {
  it('按类别取出窗口', () => {
    const snapshot = usage(10, 20, 30)
    expect(usageWindowOf(snapshot, 'rolling')).toBe(snapshot.rolling)
    expect(usageWindowOf(snapshot, 'monthly')).toBe(snapshot.monthly)
    expect(usageWindowOf(undefined, 'weekly')).toBeUndefined()
  })

  it('胶囊圆环读取已用比例最高的窗口', () => {
    expect(peakUsageWindow(usage(10, 90, 50))?.kind).toBe('weekly')
    expect(peakUsageWindow(usage(70, 20, 30))?.kind).toBe('rolling')
    expect(peakUsageWindow(usage(10, 20, 95))?.kind).toBe('monthly')
  })

  it('平局时按展示顺序取靠前的窗口', () => {
    expect(peakUsageWindow(usage(50, 50, 50))?.kind).toBe('rolling')
  })

  it('空快照返回 undefined', () => {
    expect(peakUsageWindow(undefined)).toBeUndefined()
  })

  it('窗口类别有稳定的文案键', () => {
    expect(usageWindowLabelKey('rolling')).toBe('usageRolling')
    expect(usageWindowLabelKey('weekly')).toBe('usageWeekly')
    expect(usageWindowLabelKey('monthly')).toBe('usageMonthly')
  })
})

describe('重置倒计时', () => {
  it('天 + 小时，丢弃分钟', () => {
    expect(countdownParts(3 * 86_400_000 + 2 * 3_600_000 + 30 * 60_000)).toEqual([
      { value: 3, unit: 'day' },
      { value: 2, unit: 'hour' },
    ])
  })

  it('小时 + 分钟', () => {
    expect(countdownParts(2 * 3_600_000 + 30 * 60_000)).toEqual([
      { value: 2, unit: 'hour' },
      { value: 30, unit: 'minute' },
    ])
  })

  it('整小时不带 0 分', () => {
    expect(countdownParts(2 * 3_600_000)).toEqual([{ value: 2, unit: 'hour' }])
  })

  it('不足一分钟向上取整，而不是显示 0 分', () => {
    expect(countdownParts(30_000)).toEqual([{ value: 1, unit: 'minute' }])
  })

  it('未知与已到期返回空数组', () => {
    expect(countdownParts(undefined)).toEqual([])
    expect(countdownParts(0)).toEqual([])
    expect(countdownParts(-1_000)).toEqual([])
    expect(countdownParts(Number.NaN)).toEqual([])
  })

  it('单位文案键与拼装', () => {
    expect(countdownUnitKey('day')).toBe('unitDay')
    expect(countdownUnitKey('hour')).toBe('unitHour')
    expect(countdownUnitKey('minute')).toBe('unitMinute')
    const parts = countdownParts(3 * 86_400_000 + 2 * 3_600_000)
    const label = (unit: 'day' | 'hour' | 'minute'): string => (unit === 'day' ? '天' : unit === 'hour' ? '小时' : '分')
    expect(formatCountdownParts(parts, label)).toBe('3天 2小时')
  })

  it('按 resetsAt 计算：未来 / 已过期 / 无法解析', () => {
    const future = resetCountdown({ status: 'ok', percent: 10, resetsAt: new Date(NOW + 2 * 3_600_000).toISOString() }, NOW)
    expect(future.kind).toBe('in')
    if (future.kind === 'in') expect(future.parts).toEqual([{ value: 2, unit: 'hour' }])

    expect(resetCountdown({ status: 'ok', percent: 10, resetsAt: new Date(NOW - 1).toISOString() }, NOW)).toEqual({ kind: 'soon' })
    expect(resetCountdown({ status: 'ok', percent: 10, resetsAt: 'not-a-date' }, NOW)).toEqual({ kind: 'unknown' })
    expect(resetCountdown(undefined, NOW)).toEqual({ kind: 'unknown' })
  })
})
