import { describe, expect, it } from 'vitest'

import { aggregateUsage, windowsForModel } from '../../src/client/services/usage-window-select.ts'
import type { ZCodeUsageWindow } from '../../src/contracts/usage.ts'

function window(overrides: Partial<ZCodeUsageWindow> & { label: string }): ZCodeUsageWindow {
  const totalUnits = overrides.totalUnits ?? 100
  const usedUnits = overrides.usedUnits ?? 0
  return {
    label: overrides.label,
    totalUnits,
    usedUnits,
    remainingUnits: overrides.remainingUnits ?? totalUnits - usedUnits,
    percent: overrides.percent ?? (totalUnits === 0 ? 0 : (usedUnits / totalUnits) * 100),
    exhausted: overrides.exhausted ?? false,
    ...(overrides.capability === undefined ? {} : { capability: overrides.capability }),
    ...(overrides.period === undefined ? {} : { period: overrides.period }),
    ...(overrides.resetsAt === undefined ? {} : { resetsAt: overrides.resetsAt }),
  }
}

/**
 * 环上显示的是**聚合**比例：上游对同一模型会给多份额度，只取一份会显示错。
 * 这组用例锁定「总剩余 / 总量」的口径。
 */
describe('aggregateUsage', () => {
  it('按总剩余除以总量计算，而不是取某一份额度', () => {
    // 截图遇到的情形：日额度已用尽(0/5M)，但活动额度还剩很多。
    const result = aggregateUsage([
      window({ label: 'GLM-5.3-Flash', period: 'daily', totalUnits: 5, usedUnits: 5 }),
      window({ label: 'GLM-5.3-Flash', period: 'one_time', totalUnits: 300, usedUnits: 10.2 }),
      window({ label: 'GLM-5.3-Flash', period: 'one_time', totalUnits: 200, usedUnits: 0 }),
      window({ label: 'GLM-5.3-Flash', period: 'daily', totalUnits: 3, usedUnits: 0 }),
    ])

    expect(result).toBeDefined()
    expect(result?.totalUnits).toBeCloseTo(508)
    expect(result?.remainingUnits).toBeCloseTo(492.8)
    // 单看日额度是 0%，聚合后才是真实可用比例。
    expect(result?.remainingPercent).toBeCloseTo((492.8 / 508) * 100, 6)
    expect(result?.windowCount).toBe(4)
  })

  it('多份全部满额时聚合仍是 100%', () => {
    const result = aggregateUsage([
      window({ label: 'A', totalUnits: 3, usedUnits: 0 }),
      window({ label: 'A', totalUnits: 200, usedUnits: 0 }),
    ])
    expect(result?.remainingPercent).toBe(100)
  })

  it('全部耗尽时是 0%', () => {
    const result = aggregateUsage([
      window({ label: 'A', totalUnits: 5, usedUnits: 5 }),
      window({ label: 'A', totalUnits: 10, usedUnits: 10 }),
    ])
    expect(result?.remainingPercent).toBe(0)
  })

  it('总量为 0 时按 100% 处理，不产生 NaN', () => {
    const result = aggregateUsage([window({ label: 'A', totalUnits: 0, usedUnits: 0 })])
    expect(result?.remainingPercent).toBe(100)
  })

  it('没有窗口时返回 undefined', () => {
    expect(aggregateUsage([])).toBeUndefined()
  })

  it('取最早的重置时间', () => {
    const result = aggregateUsage([
      window({ label: 'A', resetsAt: '2026-10-26T00:00:00.000Z' }),
      window({ label: 'A', resetsAt: '2026-10-25T12:00:00.000Z' }),
    ])
    expect(result?.resetsAt).toBe('2026-10-25T12:00:00.000Z')
  })
})

describe('windowsForModel', () => {
  const windows = [
    window({ label: 'GLM-5.3-Flash', capability: 'model:glm-5.3-flash', totalUnits: 5 }),
    window({ label: 'GLM-5.3', capability: 'model:glm-5.3', totalUnits: 3 }),
    window({ label: 'GLM-5.3-Flash', capability: 'model:glm-5.3-flash', totalUnits: 300 }),
  ]

  it('选出选中模型的全部窗口', () => {
    expect(windowsForModel(windows, 'GLM-5.3-Flash')).toHaveLength(2)
  })

  it('匹配不到时退回全部窗口', () => {
    expect(windowsForModel(windows, 'unknown-model')).toHaveLength(3)
  })

  it('未选模型时返回全部窗口', () => {
    expect(windowsForModel(windows, undefined)).toHaveLength(3)
  })
})
