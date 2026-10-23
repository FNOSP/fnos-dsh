/**
 * 模型目录的纯计算：搜索与分组过滤、容量展示、能力特性、思考等级与显隐写入。
 *
 * @module dsh-opencode/client/catalog-search
 */

import { OPENCODE_REASONING_LEVELS } from '../../contracts/catalog.ts'
import type { OpenCodeApiKind, OpenCodeModel, OpenCodeReasoningLevel } from '../../contracts/catalog.ts'
import type { OpenCodePlan } from '../../contracts/identity.ts'
import type { OpenCodeLocaleKey } from '../locales.ts'

/** 协议族 → 展示文案键；`Record` 保证新增协议族时编译期报错。 */
const API_KIND_LABEL_KEYS: Record<OpenCodeApiKind, OpenCodeLocaleKey> = {
  'openai-completions': 'catalogApiOpenaiCompletions',
  'openai-responses': 'catalogApiOpenaiResponses',
  'anthropic-messages': 'catalogApiAnthropicMessages',
  'google-generative-ai': 'catalogApiGoogleGenerativeAi',
}

/**
 * 协议族的展示文案键。
 * @param api - 契约里的协议族。
 * @returns 对应的 locale 键。
 */
export function apiKindLabelKey(api: OpenCodeApiKind): OpenCodeLocaleKey {
  return API_KIND_LABEL_KEYS[api]
}

/** 思考等级 → 展示文案键；`Record` 保证新增等级时编译期报错。 */
const REASONING_LEVEL_LABEL_KEYS: Record<OpenCodeReasoningLevel, OpenCodeLocaleKey> = {
  off: 'reasoningOff',
  minimal: 'reasoningMinimal',
  low: 'reasoningLow',
  medium: 'reasoningMedium',
  high: 'reasoningHigh',
  xhigh: 'reasoningXhigh',
  max: 'reasoningMax',
}

/**
 * 思考等级的展示文案键。
 * @param level - 契约里的思考等级。
 * @returns 对应的 locale 键。
 */
export function reasoningLevelLabelKey(level: OpenCodeReasoningLevel): OpenCodeLocaleKey {
  return REASONING_LEVEL_LABEL_KEYS[level]
}

/**
 * 把 token 数压缩成选择器习惯的短写法。
 * @param value - 原始 token 数。
 * @returns 例如 `200K`、`1M`、`8.2K`；非法或非正数时为 undefined。
 */
export function formatTokenCount(value: number | undefined): string | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return undefined
  const compact = (scaled: number): string => {
    const rounded = Math.round(scaled * 10) / 10
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
  }
  if (value >= 1_000_000) return `${compact(value / 1_000_000)}M`
  if (value >= 1_000) return `${compact(value / 1_000)}K`
  return String(Math.round(value))
}

/**
 * 搜索词拆成多个小写词；多个词按「全部命中」（AND）处理。
 * @param query - 用户输入。
 * @returns 小写词数组；空输入为空数组。
 */
export function searchTerms(query: string): readonly string[] {
  return query.trim().toLowerCase().split(/\s+/u).filter(term => term.length > 0)
}

/**
 * 一个模型是否命中全部搜索词。
 *
 * 搜索覆盖名称、id、家族、描述与协议族：用户往往记得「anthropic」或
 * 「claude」而记不住完整 id。
 * @param model - 目录条目。
 * @param terms - `searchTerms` 的结果。
 * @returns 全部词都命中时为 true。
 */
export function modelMatchesTerms(model: OpenCodeModel, terms: readonly string[]): boolean {
  if (terms.length === 0) return true
  const haystack = [
    model.name,
    model.id,
    model.family ?? '',
    model.description ?? '',
    model.api,
  ].join('\n').toLowerCase()
  return terms.every(term => haystack.includes(term))
}

/** 目录分组筛选：`all` 表示不分组，其余对应一个 plan。 */
export type OpenCodeCatalogPlanFilter = 'all' | OpenCodePlan

/**
 * 按搜索词与分组过滤目录；不改动顺序（上游顺序即选择器顺序）。
 *
 * 两个条件是 AND：用户先选分组再看搜索词，缩小的范围应当是两者的交集。
 * @param models - 目录条目。
 * @param query - 用户输入。
 * @param plan - 分组筛选；缺省为全部。
 * @returns 命中的条目。
 */
export function filterCatalogModels(
  models: readonly OpenCodeModel[],
  query: string,
  plan: OpenCodeCatalogPlanFilter = 'all',
): readonly OpenCodeModel[] {
  const terms = searchTerms(query)
  return models.filter(model => matchesPlanFilter(model, plan) && modelMatchesTerms(model, terms))
}

/**
 * 一个模型是否属于所选分组。
 * @param model - 目录条目。
 * @param filter - 分组筛选。
 * @returns 属于该分组时为 true；`all` 恒为 true。
 */
export function matchesPlanFilter(model: OpenCodeModel, filter: OpenCodeCatalogPlanFilter): boolean {
  return filter === 'all' || model.plan === filter
}

/**
 * 各分组的条目数量，用于筛选按钮上的计数。
 * @param models - 目录条目。
 * @returns `all` / `go` / `zen` 三个计数；输入为空时全为 0。
 */
export function countCatalogModels(
  models: readonly OpenCodeModel[],
): Readonly<Record<OpenCodeCatalogPlanFilter, number>> {
  const counts: Record<OpenCodeCatalogPlanFilter, number> = { all: models.length, go: 0, zen: 0 }
  for (const model of models) counts[model.plan] += 1
  return counts
}

/**
 * 分组标签的文案键：Go 显示「Go」，Zen 显示「按量」。
 * @param plan - 契约里的分组。
 * @returns 对应的 locale 键。
 */
export function planLabelKey(plan: OpenCodePlan): OpenCodeLocaleKey {
  return plan === 'go' ? 'catalogPlanGo' : 'catalogPlanZen'
}

/** 模型能力：条目上用图标表达、气泡里逐项列出的五个特性。 */
export type OpenCodeFeatureId = 'reasoning' | 'tools' | 'image' | 'text' | 'free'

/** 一组能力描述。 */
export interface OpenCodeFeature {
  readonly id: OpenCodeFeatureId
  readonly supported: boolean
  /** 思考等级明细：仅 reasoning 受支持且模型声明了映射时存在。 */
  readonly levels?: readonly OpenCodeReasoningLevel[]
}

/** 能力 → 展示文案键；`Record` 保证新增能力时编译期报错。 */
const FEATURE_LABEL_KEYS: Record<OpenCodeFeatureId, OpenCodeLocaleKey> = {
  reasoning: 'catalogFeatureReasoning',
  tools: 'catalogFeatureTools',
  image: 'catalogFeatureImage',
  text: 'catalogFeatureText',
  free: 'catalogFeatureFree',
}

/**
 * 能力标签的文案键。
 * @param id - 能力标识。
 * @returns 对应的 locale 键。
 */
export function featureLabelKey(id: OpenCodeFeatureId): OpenCodeLocaleKey {
  return FEATURE_LABEL_KEYS[id]
}

/**
 * 模型能力的固定顺序清单。
 *
 * 顺序与契约字段顺序一致，条目上的图标和气泡里的行都按它排列，保证同一模型
 * 在两处表达一致。
 * @param model - 目录条目。
 * @returns 五个能力及其是否受支持；reasoning 附带受支持的思考等级。
 */
export function modelFeatures(model: OpenCodeModel): readonly OpenCodeFeature[] {
  const levels = reasoningLevels(model)
  const features: OpenCodeFeature[] = [
    model.reasoning === true && levels.length > 0
      ? { id: 'reasoning', supported: true, levels }
      : { id: 'reasoning', supported: model.reasoning === true },
    { id: 'tools', supported: model.tools === true },
    { id: 'image', supported: supportsImageInput(model) },
    { id: 'text', supported: model.input.includes('text') },
    { id: 'free', supported: model.free === true },
  ]
  return features
}

/**
 * 条目上要画成图标的能力（只看受支持的，按固定顺序）。
 * @param model - 目录条目。
 * @returns 受支持能力的标识列表；模型没有任何能力时为空数组。
 */
export function supportedFeatureIds(model: OpenCodeModel): readonly OpenCodeFeatureId[] {
  return modelFeatures(model)
    .filter(feature => feature.supported)
    .map(feature => feature.id)
}

/**
 * 模型实际开放的思考等级（顺序即契约顺序）。
 *
 * `thinkingLevelMap` 里值为 `null` 表示该等级不受支持；模型本身不支持思考或
 * 没有映射时返回空数组，界面只在气泡里标出支持与否，不列等级明细。
 * @param model - 目录条目。
 * @returns 受支持的思考等级。
 */
export function reasoningLevels(model: OpenCodeModel): readonly OpenCodeReasoningLevel[] {
  if (model.reasoning !== true) return []
  const map = model.thinkingLevelMap
  if (map === undefined) return []
  return OPENCODE_REASONING_LEVELS.filter(level => map[level] !== null && map[level] !== undefined)
}

/**
 * 模型是否接受图片输入。
 * @param model - 目录条目。
 * @returns `input` 含 `image` 时为 true。
 */
export function supportsImageInput(model: OpenCodeModel): boolean {
  return model.input.includes('image')
}

/**
 * 计算切换显隐后的隐藏列表。
 *
 * 写入的是整份数组：宿主按补丁合并，缺省表示「保留原值」，因此不能只传
 * 被点的那一项。
 * @param hiddenModels - 当前隐藏列表。
 * @param id - 被切换的模型 id。
 * @param visible - 切换后是否应在选择器中显示。
 * @returns 新的隐藏列表（保持原有顺序，去重由契约归一化兜底）。
 */
export function withModelVisibility(hiddenModels: readonly string[], id: string, visible: boolean): readonly string[] {
  if (visible) return hiddenModels.filter(item => item !== id)
  return hiddenModels.includes(id) ? [...hiddenModels] : [...hiddenModels, id]
}
