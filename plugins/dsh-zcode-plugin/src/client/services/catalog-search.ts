/**
 * 模型目录的搜索与分组。
 *
 * 纯函数，便于直接断言：目录卡的搜索框与计数都走这里，组件本身不写过滤逻辑。
 *
 * @module dsh-zcode/client/catalog-search
 */

import type { ZCodeModel } from '../../contracts/catalog.ts'

/**
 * 按关键字过滤模型。
 *
 * 匹配 id 与显示名，大小写不敏感；空查询返回原列表。`-` 与为空格的等价处理
 * 让「glm 5.3」也能命中 `GLM-5.3`。
 */
export function filterModels(models: readonly ZCodeModel[], query: string): readonly ZCodeModel[] {
  const normalized = query.trim().toLowerCase().replace(/\s+/gu, '-')
  if (normalized.length === 0) return models
  return models.filter(model =>
    model.id.toLowerCase().includes(normalized)
    || model.name.toLowerCase().includes(normalized))
}

/** 把模型分成「可见」与「已隐藏」两组，保持原顺序。 */
export function splitHidden(
  models: readonly ZCodeModel[],
  hidden: ReadonlySet<string>,
): { readonly visible: readonly ZCodeModel[], readonly hidden: readonly ZCodeModel[] } {
  const visible: ZCodeModel[] = []
  const hiddenModels: ZCodeModel[] = []
  for (const model of models) {
    if (hidden.has(model.id)) hiddenModels.push(model)
    else visible.push(model)
  }
  return { visible, hidden: hiddenModels }
}

/** 模型的搜索关键字串（供调试与 aria-label）。 */
export function modelSearchHaystack(model: ZCodeModel): string {
  return `${model.id} ${model.name}`.toLowerCase()
}
