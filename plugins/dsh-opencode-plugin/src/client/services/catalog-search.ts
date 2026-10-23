/**
 * 模型目录的纯计算：搜索过滤、容量展示、思考等级与显隐写入。
 *
 * @module dsh-opencode/client/catalog-search
 */

import { OPENCODE_REASONING_LEVELS } from '../../contracts/catalog.ts'
import type { OpenCodeApiKind, OpenCodeModel, OpenCodeReasoningLevel } from '../../contracts/catalog.ts'
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

/**
 * 按搜索词过滤目录；不改动顺序（上游顺序即选择器顺序）。
 * @param models - 目录条目。
 * @param query - 用户输入。
 * @returns 命中的条目。
 */
export function filterCatalogModels(models: readonly OpenCodeModel[], query: string): readonly OpenCodeModel[] {
  const terms = searchTerms(query)
  if (terms.length === 0) return models
  return models.filter(model => modelMatchesTerms(model, terms))
}

/**
 * 模型实际开放的思考等级（顺序即契约顺序）。
 *
 * `thinkingLevelMap` 里值为 `null` 表示该等级不受支持；模型本身不支持思考或
 * 没有映射时返回空数组，由界面退化成「支持思考」标签。
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
