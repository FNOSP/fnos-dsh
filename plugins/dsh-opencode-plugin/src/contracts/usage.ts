/**
 * 套餐用量契约：OpenCode Go 的三个额度窗口。
 *
 * 上游以「已用百分比 + 重置时间」表达额度；这里只做归一化与校验，
 * 不把缺失字段补成 0——没读到就是没读到。
 *
 * @module dsh-opencode/usage-contract
 */

/** 一个额度窗口。 */
export interface OpenCodeUsageWindow {
  readonly status: 'ok' | 'rate-limited'
  /** 已用百分比，0..100。 */
  readonly percent: number
  /** 重置时间（ISO 8601）。 */
  readonly resetsAt: string
}

/** Go 套餐额度快照。 */
export interface OpenCodeUsage {
  /** 5 小时滚动窗口。 */
  readonly rolling: OpenCodeUsageWindow
  /** 每周窗口。 */
  readonly weekly: OpenCodeUsageWindow
  /** 每月窗口。 */
  readonly monthly: OpenCodeUsageWindow
  /** 读取时间（epoch ms）。 */
  readonly fetchedAt: number
  /** Console 报告的套餐名（若上游返回）。 */
  readonly plan?: string
}

/** 剩余百分比，用于展示；已用值越界时夹到合法区间。 */
export function remainingPercent(window: OpenCodeUsageWindow): number {
  return Math.max(0, Math.min(100, 100 - window.percent))
}

/** 距离重置的毫秒数；无效时间返回 undefined。 */
export function resetAfterMs(window: OpenCodeUsageWindow, now = Date.now()): number | undefined {
  const at = Date.parse(window.resetsAt)
  if (!Number.isFinite(at)) return undefined
  return Math.max(0, at - now)
}
