/**
 * 插件偏好设置契约。
 *
 * 与参考插件不同，这里**没有**「推理端点策略」：ZCode 只有一个 Start Plan
 * 端点，没有按量与套餐之分。留着的两个字段都是纯展示/刷新策略，因此按插件
 * UI 规范第 2 档，用详情页自定义区块承载并持久化到插件自己的文件。
 *
 * @module dsh-zcode/preferences-contract
 */

import { DEFAULT_ZCODE_ENDPOINT_PLAN, type ZCodeEndpointPlan } from './identity.ts'

/** 对话输入区用量胶囊的显隐策略。 */
export type ZCodeUsageVisibility = 'auto' | 'always' | 'off'

export type { ZCodeEndpointPlan } from './identity.ts'

/** 持久化的插件偏好。 */
export interface ZCodePreferences {
  /** `auto`：仅选中 ZCode 模型时显示；`always`：常驻；`off`：隐藏并停止轮询。 */
  readonly usageVisibility: ZCodeUsageVisibility
  /** 目录与额度的自动刷新间隔（分钟）；0 表示关闭自动刷新。 */
  readonly refreshMinutes: number
  /** 在模型选择器里隐藏的模型 id。 */
  readonly hiddenModels: readonly string[]
  /**
   * 推理端点策略：`start-plan` 用账号 JWT 消耗套餐额度，`ultra` 用家族
   * MaaS 令牌消耗按量余额。二者对第三方客户端的可达性不同，故由用户选择。
   */
  readonly endpointPlan: ZCodeEndpointPlan
}

export const DEFAULT_ZCODE_PREFERENCES: ZCodePreferences = {
  usageVisibility: 'auto',
  refreshMinutes: 15,
  hiddenModels: [],
  endpointPlan: DEFAULT_ZCODE_ENDPOINT_PLAN,
}

/** 合法刷新间隔范围（分钟）；下限 1 避免把额度接口打成轮询。 */
export const ZCODE_REFRESH_MINUTES = { min: 0, max: 240 } as const

/** 规范化任意输入；非法字段回落到默认值，绝不抛给调用方。 */
export function normalizePreferences(value: unknown): ZCodePreferences {
  const source = value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  const visibility = source.usageVisibility
  const usageVisibility: ZCodeUsageVisibility =
    visibility === 'always' || visibility === 'off' || visibility === 'auto'
      ? visibility
      : DEFAULT_ZCODE_PREFERENCES.usageVisibility
  const rawMinutes = source.refreshMinutes
  const refreshMinutes = typeof rawMinutes === 'number' && Number.isFinite(rawMinutes)
    ? Math.max(
        ZCODE_REFRESH_MINUTES.min,
        Math.min(ZCODE_REFRESH_MINUTES.max, Math.round(rawMinutes)),
      )
    : DEFAULT_ZCODE_PREFERENCES.refreshMinutes
  const hiddenModels = Array.isArray(source.hiddenModels)
    ? [...new Set(
        source.hiddenModels.filter(
          (id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 200,
        ),
      )]
    : []
  const rawPlan = source.endpointPlan
  const endpointPlan: ZCodeEndpointPlan =
    rawPlan === 'ultra' || rawPlan === 'start-plan'
      ? rawPlan
      : DEFAULT_ZCODE_PREFERENCES.endpointPlan
  return { usageVisibility, refreshMinutes, hiddenModels, endpointPlan }
}
