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
