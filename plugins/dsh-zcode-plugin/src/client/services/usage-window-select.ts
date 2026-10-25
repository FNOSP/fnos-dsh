/**
 * 额度窗口的选取与换算：纯函数，便于直接断言。
 *
 * 单独成模块是因为 `ZCodeUsageStatus.tsx` 一旦被 import 就会拉起 Semi 组件，
 * 在 node 环境下无法加载；而"环上显示哪一份额度"是有明确规则、值得测的逻辑。
 *
 * @module dsh-zcode/client/usage-window-select
 */

import type { ZCodeUsageWindow } from '../../contracts/usage.ts'

/** 剩余比例，夹到 0..100；非有限值按 100 处理（宁可不吓人也不显示 NaN）。 */
export function remainingOf(window: ZCodeUsageWindow): number {
  if (!Number.isFinite(window.percent)) return 100
  return Math.max(0, Math.min(100, 100 - window.percent))
}

/** 一组额度窗口的聚合用量。 */
export interface UsageAggregate {
  /** 聚合后的剩余百分比，0..100。 */
  readonly remainingPercent: number
  /** 聚合后的剩余量与总量（单位与窗口一致）。 */
  readonly remainingUnits: number
  readonly totalUnits: number
  /** 参与聚合的窗口数量。 */
  readonly windowCount: number
  /** 最早的一个重置时间；都没有时为空。 */
  readonly resetsAt?: string
}

/**
 * 把多份额度按「总剩余 / 总量」聚合成一个进度值。
 *
 * 上游对同一模型会同时给出多份额度（日额度、活动额度、不同套餐各一份），
 * 只取其中一份会把「日额度已用尽但活动额度还有」显示成 0%，也会把「日额度
 * 满但活动额度快用完」显示成 100%——两者都与账号实际可用量不符。
 *
 * 用总量与总剩余聚合才反映真实可用比例；各份的明细仍在浮层里逐条列出，
 * 所以这里不损失信息。
 *
 * @param windows - 参与聚合的窗口；空数组返回 undefined。
 * @returns 聚合结果；没有任何总量时按 100% 处理。
 */
export function aggregateUsage(windows: readonly ZCodeUsageWindow[]): UsageAggregate | undefined {
  if (windows.length === 0) return undefined
  let totalUnits = 0
  let remainingUnits = 0
  let resetsAt: number | undefined
  for (const window of windows) {
    if (Number.isFinite(window.totalUnits)) totalUnits += Math.max(0, window.totalUnits)
    // 剩余量以窗口自报为准；缺失时用「总量 - 已用」兜底，避免把未知当 0。
    const remaining = Number.isFinite(window.remainingUnits)
      ? window.remainingUnits
      : (Number.isFinite(window.totalUnits) && Number.isFinite(window.usedUnits)
        ? window.totalUnits - window.usedUnits
        : 0)
    if (Number.isFinite(remaining)) remainingUnits += Math.max(0, remaining)
    if (window.resetsAt !== undefined) {
      const at = Date.parse(window.resetsAt)
      if (Number.isFinite(at) && (resetsAt === undefined || at < resetsAt)) resetsAt = at
    }
  }
  const remainingPercent = totalUnits > 0
    ? Math.max(0, Math.min(100, (remainingUnits / totalUnits) * 100))
    : 100
  return {
    remainingPercent,
    remainingUnits,
    totalUnits,
    windowCount: windows.length,
    ...(resetsAt === undefined ? {} : { resetsAt: new Date(resetsAt).toISOString() }),
  }
}

/**
 * 选出当前模型名下、应参与聚合的全部窗口。
 *
 * 与 {@link primaryWindow} 的区别：那个用来挑"代表窗口"做文案，这个用来算
 * 进度值。选中模型匹配不到时退回全部窗口，保证环仍有意义。
 */
export function windowsForModel(
  windows: readonly ZCodeUsageWindow[],
  selectedModel: string | undefined,
): readonly ZCodeUsageWindow[] {
  if (windows.length === 0) return []
  if (selectedModel === undefined || selectedModel.length === 0) return windows
  const wanted = selectedModel.toLowerCase()
  const matched = windows.filter(window =>
    (window.capability?.toLowerCase().endsWith(`:${wanted}`) ?? false)
    || window.label.toLowerCase() === wanted)
  return matched.length > 0 ? matched : windows
}

/**
 * 选出环上要显示的那一份额度。
 *
 * 优先当前选中模型——同一模型可能同时有日额度与活动额度，日额度最能代表
 * "现在还能用多少"。选中模型无法匹配时退回任一模型的日额度，再退回第一份，
 * 让图标始终有可读含义，而不是永远空环。
 *
 * @param windows - 全部额度窗口。
 * @param selectedModel - 会话当前选中的模型 id。
 * @returns 选中的窗口；没有额度时返回 undefined。
 */
export function primaryWindow(
  windows: readonly ZCodeUsageWindow[],
  selectedModel: string | undefined,
): ZCodeUsageWindow | undefined {
  if (windows.length === 0) return undefined
  if (selectedModel !== undefined && selectedModel.length > 0) {
    const wanted = selectedModel.toLowerCase()
    const matched = windows.filter(window =>
      // capability 形如 `model:glm-5.3-flash`，比较后缀而不是全等。
      (window.capability?.toLowerCase().endsWith(`:${wanted}`) ?? false)
      || window.label.toLowerCase() === wanted)
    const daily = matched.find(window => window.period === 'daily')
    if (daily !== undefined) return daily
    if (matched.length > 0) return matched[0]
  }
  return windows.find(window => window.period === 'daily') ?? windows[0]
}
