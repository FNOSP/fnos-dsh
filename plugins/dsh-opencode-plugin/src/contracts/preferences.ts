/**
 * 插件偏好设置契约。
 *
 * 这些字段是**插件自己的**展示与刷新策略，不进入 DSH 的模型配置：
 * 官方 `Config` schema 表达不了「按模型隐藏」「用量胶囊显隐」这类交互，
 * 因此按插件 UI 规范第 2 档，用详情页自定义区块承载，并持久化到插件自己的
 * 文件（`.dsh-opencode-preferences.json`）。
 *
 * @module dsh-opencode/preferences-contract
 */

/** 对话输入区用量胶囊的显隐策略。 */
export type OpenCodeUsageVisibility = 'auto' | 'always' | 'off'

/** 持久化的插件偏好。 */
export interface OpenCodePreferences {
  /** `auto`：仅选中 OpenCode 模型时显示；`always`：常驻；`off`：隐藏并停止轮询。 */
  readonly usageVisibility: OpenCodeUsageVisibility
  /** 目录与用量的自动刷新间隔（分钟）；0 表示关闭自动刷新。 */
  readonly refreshMinutes: number
  /** 在模型选择器里隐藏的模型 id。 */
  readonly hiddenModels: readonly string[]
}

export const DEFAULT_OPENCODE_PREFERENCES: OpenCodePreferences = {
  usageVisibility: 'auto',
  refreshMinutes: 15,
  hiddenModels: [],
}

/** 合法刷新间隔范围（分钟）。 */
export const OPENCODE_REFRESH_MINUTES = { min: 0, max: 240 } as const

/** 规范化任意输入；非法字段回落到默认值，绝不抛给调用方。 */
export function normalizePreferences(value: unknown): OpenCodePreferences {
  const source = value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  const visibility = source.usageVisibility
  const usageVisibility: OpenCodeUsageVisibility = visibility === 'always' || visibility === 'off' || visibility === 'auto'
    ? visibility
    : DEFAULT_OPENCODE_PREFERENCES.usageVisibility
  const rawMinutes = source.refreshMinutes
  const refreshMinutes = typeof rawMinutes === 'number' && Number.isFinite(rawMinutes)
    ? Math.max(OPENCODE_REFRESH_MINUTES.min, Math.min(OPENCODE_REFRESH_MINUTES.max, Math.round(rawMinutes)))
    : DEFAULT_OPENCODE_PREFERENCES.refreshMinutes
  const hiddenModels = Array.isArray(source.hiddenModels)
    ? [...new Set(source.hiddenModels.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 200))]
    : []
  return { usageVisibility, refreshMinutes, hiddenModels }
}
