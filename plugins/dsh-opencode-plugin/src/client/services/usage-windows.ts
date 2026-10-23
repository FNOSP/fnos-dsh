/**
 * 套餐用量窗口的展示计算：已用百分比、重置倒计时与「最紧张的窗口」。
 *
 * 全部是纯函数，便于直接断言；组件只负责把结果映射到 locale 文案。
 * 契约里 `percent` 是**已用**百分比（0..100），`resetsAt` 是 ISO 时间。
 *
 * @module dsh-opencode/client/usage-windows
 */

import { resetAfterMs } from '../../contracts/usage.ts'
import type { OpenCodeUsage, OpenCodeUsageWindow } from '../../contracts/usage.ts'

/** 三个额度窗口的语义类别；顺序即界面展示顺序。 */
export type OpenCodeUsageWindowKind = 'rolling' | 'weekly' | 'monthly'

/** 展示顺序：5 小时 → 每周 → 每月。 */
export const OPENCODE_USAGE_WINDOW_KINDS: readonly OpenCodeUsageWindowKind[] = ['rolling', 'weekly', 'monthly']

/**
 * 取出指定窗口。
 *
 * 契约里三个窗口都是必填，但响应毕竟是跨进程数据；缺失时返回 undefined，
 * 由界面决定显示「未提供」而不是渲染 0%。
 * @param usage - 用量快照。
 * @param kind - 窗口类别。
 * @returns 该窗口；快照缺失或结构异常时为 undefined。
 */
export function usageWindowOf(usage: OpenCodeUsage | undefined, kind: OpenCodeUsageWindowKind): OpenCodeUsageWindow | undefined {
  if (usage === undefined) return undefined
  const value = (usage as unknown as Record<string, unknown>)[kind]
  if (value === null || typeof value !== 'object') return undefined
  return value as OpenCodeUsageWindow
}

/** 把任意数值夹到 0..100；非数字返回 undefined。 */
export function clampPercent(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.max(0, Math.min(100, value))
}

/**
 * 已用百分比的展示文本。
 * @param window - 一个额度窗口。
 * @returns 例如 `42%`；缺失或非法时为 undefined。
 */
export function usedPercentText(window: OpenCodeUsageWindow | undefined): string | undefined {
  const percent = clampPercent(window?.percent)
  return percent === undefined ? undefined : `${String(Math.round(percent))}%`
}

/**
 * 进度条使用的已用百分比。
 * @param window - 一个额度窗口。
 * @returns 0..100；缺失时为 0。
 */
export function usedPercentValue(window: OpenCodeUsageWindow | undefined): number {
  return clampPercent(window?.percent) ?? 0
}

/**
 * 圆环使用的剩余百分比（「剩多少填多少」）。
 * @param window - 一个额度窗口。
 * @returns 0..100；缺失时为 0。
 */
export function remainingPercentValue(window: OpenCodeUsageWindow | undefined): number {
  return 100 - usedPercentValue(window)
}

/**
 * 窗口类别 → 文案键。
 * @param kind - 窗口类别。
 * @returns `usageRolling` / `usageWeekly` / `usageMonthly`。
 */
export function usageWindowLabelKey(kind: OpenCodeUsageWindowKind): 'usageRolling' | 'usageWeekly' | 'usageMonthly' {
  if (kind === 'rolling') return 'usageRolling'
  if (kind === 'weekly') return 'usageWeekly'
  return 'usageMonthly'
}

/**
 * 已用比例最高的窗口，用于输入区胶囊的圆环。
 *
 * 三个窗口里越接近耗尽的那个越值得被看见；平局按展示顺序取靠前的窗口。
 * @param usage - 用量快照。
 * @returns 最紧张的窗口；没有可用窗口时为 undefined。
 */
export function peakUsageWindow(usage: OpenCodeUsage | undefined): { readonly kind: OpenCodeUsageWindowKind; readonly window: OpenCodeUsageWindow } | undefined {
  let best: { kind: OpenCodeUsageWindowKind; window: OpenCodeUsageWindow } | undefined
  let bestPercent = -1
  for (const kind of OPENCODE_USAGE_WINDOW_KINDS) {
    const window = usageWindowOf(usage, kind)
    if (window === undefined) continue
    const percent = usedPercentValue(window)
    if (percent > bestPercent) {
      best = { kind, window }
      bestPercent = percent
    }
  }
  return best
}

/** 倒计时单位；界面按 locale 映射成「天/小时/分」。 */
export type CountdownUnit = 'day' | 'hour' | 'minute'

/** 倒计时的一个片段。 */
export interface CountdownPart {
  readonly value: number
  readonly unit: CountdownUnit
}

/**
 * 把剩余毫秒拆成最多两个倒计时片段。
 *
 * 精度到分钟：额度的重置时间通常以小时/天计，秒级跳动既无意义也会让界面抖动。
 * 不足一分钟向上取整为 `1 分`（而不是显示 0 分）；已经到期返回空数组，由调用方
 * 显示「即将重置」。
 *
 * @param remainingMs - 距离重置的毫秒数。
 * @returns 倒计时片段；未知或已到期时为空数组。
 */
export function countdownParts(remainingMs: number | undefined): readonly CountdownPart[] {
  if (remainingMs === undefined || !Number.isFinite(remainingMs) || remainingMs <= 0) return []
  const totalMinutes = Math.ceil(remainingMs / 60_000)
  const days = Math.floor(totalMinutes / (24 * 60))
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) return hours > 0 ? [{ value: days, unit: 'day' }, { value: hours, unit: 'hour' }] : [{ value: days, unit: 'day' }]
  if (hours > 0) return minutes > 0 ? [{ value: hours, unit: 'hour' }, { value: minutes, unit: 'minute' }] : [{ value: hours, unit: 'hour' }]
  return [{ value: minutes, unit: 'minute' }]
}

/**
 * 倒计时单位的文案键。
 * @param unit - 倒计时单位。
 * @returns `unitDay` / `unitHour` / `unitMinute`。
 */
export function countdownUnitKey(unit: CountdownUnit): 'unitDay' | 'unitHour' | 'unitMinute' {
  if (unit === 'day') return 'unitDay'
  if (unit === 'hour') return 'unitHour'
  return 'unitMinute'
}

/**
 * 用调用方给的文案函数拼装倒计时。
 * @param parts - `countdownParts` 的结果。
 * @param label - 单位 → 本地化单位名。
 * @returns 例如 `3天 2小时` / `3d 2h`。
 */
export function formatCountdownParts(parts: readonly CountdownPart[], label: (unit: CountdownUnit) => string): string {
  return parts.map(part => `${String(part.value)}${label(part.unit)}`).join(' ')
}

/** 一个窗口的重置倒计时状态。 */
export type ResetCountdown =
  | { readonly kind: 'in'; readonly parts: readonly CountdownPart[] }
  | { readonly kind: 'soon' }
  | { readonly kind: 'unknown' }

/**
 * 计算某个窗口的重置倒计时。
 * @param window - 一个额度窗口。
 * @param now - 当前 epoch 毫秒。
 * @returns 倒计时状态：有时长、已到期、或时间无法解析。
 */
export function resetCountdown(window: OpenCodeUsageWindow | undefined, now: number = Date.now()): ResetCountdown {
  const remaining = window === undefined ? undefined : resetAfterMs(window, now)
  if (remaining === undefined) return { kind: 'unknown' }
  if (remaining <= 0) return { kind: 'soon' }
  return { kind: 'in', parts: countdownParts(remaining) }
}
