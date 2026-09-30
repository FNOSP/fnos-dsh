/** Shared Codex usage-window selection for settings and composer status. */

export const FIVE_HOUR_WINDOW_SECONDS = 5 * 60 * 60
export const WEEKLY_WINDOW_SECONDS = 7 * 24 * 60 * 60
export const MONTHLY_WINDOW_SECONDS = 30 * 24 * 60 * 60

export interface CodexUsageWindow {
  remainingPercent?: number
  limitWindowSeconds?: number
  resetAfterSeconds?: number
  resetAt?: number
}

export interface CodexUsageWindows {
  primaryWindow?: CodexUsageWindow
  secondaryWindow?: CodexUsageWindow
}

/** 用量窗口的语义类别，决定界面用哪条文案。 */
export type CodexUsageWindowKind = 'five-hour' | 'weekly' | 'monthly'

/** 服务端未给时长时的标签兜底：旧实现把「不是 5 小时」的一律叫每周。 */
export const DEFAULT_USAGE_WINDOW_KIND: CodexUsageWindowKind = 'weekly'

/**
 * 分类阈值：按 `limit_window_seconds` **区间**判定，而不是精确相等。
 *
 * 服务端给的是真实时长，实测既出现过 `2592000`（正好 30 天）也出现过 `2588400`
 * （29 天 23 小时，即界面上的「29 天 23 小时后重置」）。若按精确值匹配，任何一种
 * 时长微调都会让窗口**凭空消失**，所以这里用区间：
 *
 *  - `≤ 2 天` → 五小时档（实测 18000，曾漂移数分钟）；
 *  - `2 ~ 14 天` → 每周档（实测 604800）；
 *  - `> 14 天` → 每月档（实测 2592000，未订阅账号只有这一个窗口）。
 *
 * 阈值取在档位之间而非贴着实测值，是为了让已知档位附近的小幅漂移仍落在各自档位，
 * 同时不把 30 天误判成每周。
 */
const DAILY_UPPER_BOUND_SECONDS = 2 * 24 * 60 * 60
const WEEKLY_UPPER_BOUND_SECONDS = 14 * 24 * 60 * 60

/**
 * 按窗口时长判定语义类别。
 *
 * 服务端**没有**给时长时返回 `'weekly'`：那是旧实现唯一的兜底标签（它把「不是
 * 5 小时」的一律当每周），保留它可避免无时长的窗口突然没有标签。
 *
 * 注意这**不影响选择**：`windowOfKind` 会用时长是否已知先过滤，所以「无时长」
 * 的窗口仍不会被任何具名选择器认领（`does not guess a window when the API omits
 * its duration` 这条既有约定保持不变）——分类只决定它在被选中后挂哪个标签。
 * @param value - 一个用量窗口。
 * @returns 窗口类别。
 */
export function usageWindowKind(value: CodexUsageWindow | undefined): CodexUsageWindowKind {
  const seconds = value?.limitWindowSeconds
  if (seconds === undefined || !Number.isFinite(seconds)) return DEFAULT_USAGE_WINDOW_KIND
  if (seconds > WEEKLY_UPPER_BOUND_SECONDS) return 'monthly'
  if (seconds <= DAILY_UPPER_BOUND_SECONDS) return 'five-hour'
  // 5 小时与 7 天之间没有已知档位；归入每周档而不是留空，避免界面失去标签。
  return 'weekly'
}

/**
 * 该窗口是否带**已知时长**。
 *
 * 分类允许对未知时长兜底出标签，但选择器不能靠兜底猜——服务端没给时长时，
 * 我们无法判断它是哪个档位，只能不认领。
 */
function hasKnownDuration(value: CodexUsageWindow): boolean {
  return value.limitWindowSeconds !== undefined && Number.isFinite(value.limitWindowSeconds)
}

function windowOfKind(usage: CodexUsageWindows, kind: CodexUsageWindowKind): CodexUsageWindow | undefined {
  return [usage.primaryWindow, usage.secondaryWindow]
    .find(window => window !== undefined && hasKnownDuration(window) && usageWindowKind(window) === kind)
}

/** Return the five-hour window when the API declares one. */
export function fiveHourWindow(usage: CodexUsageWindows): CodexUsageWindow | undefined {
  return windowOfKind(usage, 'five-hour')
}

/** Return the weekly window when the API declares one. */
export function weeklyWindow(usage: CodexUsageWindows): CodexUsageWindow | undefined {
  return windowOfKind(usage, 'weekly')
}

/** Return the monthly window when the API declares one（未订阅账号的常态）。 */
export function monthlyWindow(usage: CodexUsageWindows): CodexUsageWindow | undefined {
  return windowOfKind(usage, 'monthly')
}

/**
 * 紧凑状态栏选用的窗口：优先最近到期的档位。
 *
 * 顺序是五小时 → 每周 → 每月。未订阅账号只有一个 30 天窗口，因此落到最后一项；
 * 修复前这一项不存在，函数返回 `undefined`，状态栏**什么都不显示**。
 */
export function compactUsageWindow(usage: CodexUsageWindows): CodexUsageWindow | undefined {
  return fiveHourWindow(usage) ?? weeklyWindow(usage) ?? monthlyWindow(usage)
}
