/**
 * 用量契约：Start Plan 的额度窗口。
 *
 * ZCode 的额度按「每个模型 × 周期」表达（日 / 周 / 月 / 一次性），与参考插件的
 * 固定三窗口不同，因此这里保留上游的粒度：一个模型可能同时有日额度和一次性
 * 活动额度，两块都要能显示，不能合并成一个百分比。
 *
 * @module dsh-zcode/usage-contract
 */

/** 一个模型的额度窗口。 */
export interface ZCodeUsageWindow {
  /** 展示名（如 `GLM-5.3`）。 */
  readonly label: string
  /** capability 原文（如 `model:glm-5.3`），用于与目录对齐。 */
  readonly capability?: string
  readonly totalUnits: number
  readonly usedUnits: number
  readonly remainingUnits: number
  /** 已用百分比，0..100；总量为 0 时给 0。 */
  readonly percent: number
  /** 周期：`daily` / `weekly` / `monthly` / `one_time` 等，上游原样。 */
  readonly period?: string
  /** 重置或到期时间（ISO 8601）。 */
  readonly resetsAt?: string
  /** 该窗口是否已耗尽。 */
  readonly exhausted: boolean
}

/** Start Plan 用量快照。 */
export interface ZCodeUsage {
  /** 当前生效的套餐。 */
  readonly plans: readonly { readonly planId: string; readonly name?: string; readonly endsAt?: string }[]
  readonly windows: readonly ZCodeUsageWindow[]
  /** 读取时间（epoch ms）。 */
  readonly fetchedAt: number
  /** 账号家族。 */
  readonly family?: string
}

/** 剩余百分比。 */
export function remainingPercent(window: ZCodeUsageWindow): number {
  return Math.max(0, Math.min(100, 100 - window.percent))
}

/** 距离重置的毫秒数；无效或缺失时间返回 undefined。 */
export function resetAfterMs(window: ZCodeUsageWindow, now = Date.now()): number | undefined {
  if (window.resetsAt === undefined) return undefined
  const at = Date.parse(window.resetsAt)
  if (!Number.isFinite(at)) return undefined
  return Math.max(0, at - now)
}

/**
 * 把上游额度换算成百分比。
 *
 * 上游给的是整数 token 单位，可能为 0（活动额度未发放）；此时按 0% 处理而不是
 * 制造 NaN 或 Infinity——界面上「0 / 0」比「NaN%」可读得多。
 */
export function usagePercent(used: number, total: number): number {
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return 0
  return Math.max(0, Math.min(100, (used / total) * 100))
}
