/**
 * 上游对单次请求 `tools` 数量的硬上限。
 *
 * 部分免费模型的网关会限制一次请求里能带的工具个数，超过就直接 400
 * （`Invalid value for 'tools': maximum number of items is 128`）。插件**不做
 * 工具裁剪**——裁剪会让模型在不知情的情况下少看见能力，排错更难；因此这里只
 * 记录上限，供设置页给出可解释的提示。
 *
 * 键是网关接受的模型 id（不带 `zen:` / `go:` 前缀）；同一模型在两组来源共用一条
 * 记录。
 *
 * @module dsh-opencode/client/model-limits
 */

import { planOfModelKey } from '../../contracts/identity.ts'

/** 已知的工具数量上限；未列出的模型不限制（或上限未知）。 */
export const OPENCODE_TOOL_LIMITS: Readonly<Record<string, number>> = {
  'beam-free': 128,
}

/**
 * 去掉 plan 前缀后的模型 id。
 * @param model - 目录里的模型键，可能带 `zen:` / `go:` 前缀。
 * @returns 网关接受的原始 id。
 */
function wireIdOf(model: string): string {
  const plan = planOfModelKey(model)
  return plan === undefined ? model : model.slice(plan.length + 1)
}

/**
 * 查询某个模型的工具数量上限。
 * @param model - 模型 id 或模型键（可带 plan 前缀）。
 * @returns 上限值；没有已知上限时返回 undefined。
 */
export function toolLimitOf(model: string): number | undefined {
  const wireId = wireIdOf(model)
  return OPENCODE_TOOL_LIMITS[wireId]
}

/**
 * 从目录里挑出有工具数量上限、且当前可用的模型。
 * @param models - 目录模型列表（`plan` + `id`）。
 * @returns 命中的模型，附带各自上限；顺序与入参一致。
 */
export function modelsWithToolLimit(
  models: readonly { readonly plan: string; readonly id: string; readonly disabled?: boolean; readonly clientOnly?: boolean }[],
): readonly { readonly id: string; readonly plan: string; readonly limit: number }[] {
  const hits: { id: string; plan: string; limit: number }[] = []
  for (const model of models) {
    if (model.disabled === true || model.clientOnly === true) continue
    const limit = toolLimitOf(model.id)
    if (limit === undefined) continue
    hits.push({ id: model.id, plan: model.plan, limit })
  }
  return hits
}
