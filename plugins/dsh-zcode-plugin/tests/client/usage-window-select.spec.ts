import { describe, expect, it } from 'vitest'
import { primaryWindow, remainingOf } from '../../src/client/services/usage-window-select.ts'
import type { ZCodeUsageWindow } from '../../src/contracts/usage.ts'

function window(overrides: Partial<ZCodeUsageWindow> & Pick<ZCodeUsageWindow, 'label'>): ZCodeUsageWindow {
  return {
    totalUnits: 100,
    usedUnits: 0,
    remainingUnits: 100,
    percent: 0,
    exhausted: false,
    ...overrides,
  }
}

const daily = window({ label: 'GLM-5.3', capability: 'model:glm-5.3', period: 'daily', percent: 25 })
const campaign = window({ label: 'GLM-5.3', capability: 'model:glm-5.3', period: 'custom', percent: 0 })
const flashDaily = window({ label: 'GLM-5.3-Flash', capability: 'model:glm-5.3-flash', period: 'daily', percent: 50 })

describe('剩余比例', () => {
  it('由已用比例反推并夹到 0..100', () => {
    expect(remainingOf(window({ label: 'x', percent: 25 }))).toBe(75)
    expect(remainingOf(window({ label: 'x', percent: 0 }))).toBe(100)
    expect(remainingOf(window({ label: 'x', percent: 100 }))).toBe(0)
    expect(remainingOf(window({ label: 'x', percent: 140 }))).toBe(0)
    expect(remainingOf(window({ label: 'x', percent: -20 }))).toBe(100)
  })

  it('非有限值按满额处理，不显示 NaN', () => {
    expect(remainingOf(window({ label: 'x', percent: Number.NaN }))).toBe(100)
  })
})

describe('环上显示哪一份额度', () => {
  it('优先当前选中模型的日额度', () => {
    const picked = primaryWindow([campaign, daily, flashDaily], 'GLM-5.3')
    expect(picked).toBe(daily)
  })

  it('选中模型只有单一额度时取它', () => {
    const picked = primaryWindow([daily, flashDaily], 'GLM-5.3-Flash')
    expect(picked).toBe(flashDaily)
  })

  it('capability 按后缀匹配，大小写不敏感', () => {
    // 会话里的模型 id 是官方大小写，capability 是小写，不能全等比较。
    expect(primaryWindow([flashDaily], 'GLM-5.3-Flash')).toBe(flashDaily)
    expect(primaryWindow([flashDaily], 'glm-5.3-flash')).toBe(flashDaily)
  })

  it('选中模型无匹配时退回任一模型的日额度', () => {
    expect(primaryWindow([campaign, flashDaily], 'unknown-model')).toBe(flashDaily)
  })

  it('没有任何日额度时退回第一份', () => {
    expect(primaryWindow([campaign], 'unknown-model')).toBe(campaign)
  })

  it('没有额度时返回 undefined', () => {
    expect(primaryWindow([], 'GLM-5.3')).toBeUndefined()
  })

  it('选中模型为空字符串时按未选中处理，不误匹配', () => {
    expect(primaryWindow([campaign, daily], '')).toBe(daily)
  })
})
