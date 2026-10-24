/**
 * 模型目录契约：宿主把 ZCode 的权益归一化成这一层，浏览器与适配器都只读它。
 *
 * 目录有两个来源，按可信度排序：
 *
 * 1. `balance` —— `GET /api/v1/zcode-plan/billing/balance` 返回的额度条目，
 *    每条的 `capabilities` 形如 `["model:glm-5.3"]`，这是**账号此刻真正拥有的
 *    模型**，也是唯一能反映动态下发结果（套餐变体、活动赠送、到期）的来源；
 * 2. `builtin` —— 内置 provider 规则里的 `builtinModelIds`，只在额度接口不可读
 *    时兜底，保证未登录/接口异常时选择器不是空的。
 *
 * 因此 `source` 不是「数据来自哪个接口」的记账，而是告诉界面当前清单有多可信。
 *
 * @module dsh-zcode/catalog-contract
 */

import type { ZCodeFamily } from './identity.ts'

/** 网关承载的协议族；当前只有 Anthropic Messages。 */
export type ZCodeApiKind = 'anthropic-messages'

/** pi-ai 的思考等级全集，顺序即选择器展示顺序。 */
export const ZCODE_REASONING_LEVELS = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const

export type ZCodeReasoningLevel = typeof ZCODE_REASONING_LEVELS[number]

/** 思考等级 → 线上取值；`null` 表示该等级不受支持。 */
export type ZCodeThinkingLevelMap = Partial<Record<ZCodeReasoningLevel, string | null>>

/** 一个可在 DSH 中使用的 ZCode 模型。 */
export interface ZCodeModel {
  /** 网关模型 id（如 `GLM-5.3`），发请求时原样使用。 */
  readonly id: string
  /** 选择器显示名。 */
  readonly name: string
  readonly description?: string
  readonly family?: string
  readonly api: ZCodeApiKind
  /** 该协议族的完整请求端点前缀（不含 `/messages`）。 */
  readonly baseURL: string
  readonly reasoning: boolean
  readonly thinkingLevelMap?: ZCodeThinkingLevelMap
  readonly input: readonly ('text' | 'image')[]
  readonly contextWindow: number
  readonly maxTokens: number
  /** 是否支持工具调用。 */
  readonly tools: boolean
  /** 是否支持结构化输出。 */
  readonly structuredOutput?: boolean
  /** 模型归属的账号家族；换家族后同一模型可能不可用。 */
  readonly accountFamily: ZCodeFamily
  /** 该模型在额度接口里的 capability 原文（如 `model:glm-5.3`）。 */
  readonly capability?: string
}

/** 额度条目：某个模型在某个周期内的用量。 */
export interface ZCodeBalanceEntry {
  /** 上游额度 id。 */
  readonly entitlementId: string
  /** 展示名（如 `GLM-5.3`）。 */
  readonly showName: string
  /** 对应的 capability（如 `model:glm-5.3`）。 */
  readonly capability?: string
  readonly totalUnits: number
  readonly usedUnits: number
  readonly remainingUnits: number
  /** 周期：`daily` / `weekly` / `monthly` / `one_time` 等，上游原样。 */
  readonly period?: string
  readonly periodStart?: string
  readonly periodEnd?: string
  readonly expiresAt?: string
}

/** 套餐记录。 */
export interface ZCodePlanEntry {
  readonly planId: string
  readonly name?: string
  readonly status?: string
  readonly endsAt?: string
}

/** 目录快照。 */
export interface ZCodeCatalog {
  /** 快照生成时间（epoch ms）。 */
  readonly fetchedAt: number
  /**
   * `balance`：清单与额度来自账号权益，可信；
   * `builtin`：额度接口不可读，只用了内置兜底清单。
   */
  readonly source: 'balance' | 'builtin'
  readonly models: readonly ZCodeModel[]
  /** 账号当前生效的套餐。 */
  readonly plans: readonly ZCodePlanEntry[]
  /** 额度条目（可能包含目录里没出现的模型）。 */
  readonly balances: readonly ZCodeBalanceEntry[]
  /** 解析期间的降级说明，用于界面提示。 */
  readonly warnings: readonly string[]
}

/**
 * 把 `capability` 还原成模型 id。
 *
 * 上游写法是 `model:<小写 id>`（如 `model:glm-5.3`），而网关接受的模型 id
 * 是官方大小写形态（`GLM-5.3`）。这里只剥前缀并保留原始大小写，大小写归一
 * 交给 {@link normalizeModelId}。
 */
export function modelIdOfCapability(capability: string): string | undefined {
  const trimmed = capability.trim()
  if (!trimmed.toLowerCase().startsWith('model:')) return undefined
  const id = trimmed.slice('model:'.length).trim()
  return id.length === 0 ? undefined : id
}

/**
 * 官方模型 id 的大小写映射表。
 *
 * 额度接口给的是小写 id，网关要的是官方拼写；这份表与 ZCode 客户端内置的
 * 归一化表一致，用于把 `glm-5.3` 还原成 `GLM-5.3`，未命中的保持原样。
 */
const OFFICIAL_MODEL_IDS: ReadonlyMap<string, string> = new Map(
  [
    'GLM-5.3',
    'GLM-5.3-Flash',
    'GLM-5V-Turbo',
    'GLM-5.2',
    'GLM-5.1',
    'GLM-5.1-Highspeed',
    'GLM-5',
    'GLM-5-Turbo',
    'GLM-4.7',
    'GLM-4.7-FlashX',
    'GLM-4.7-Flash',
    'GLM-4.6',
    'GLM-4.5-Air',
    'GLM-4.5',
    'GLM-4.6V',
    'GLM-4.6V-Flash',
    'GLM-4.6V-FlashX',
    'GLM-4.1V-Thinking-FlashX',
    'GLM-4.1V-Thinking-Flash',
    'GLM-4-FlashX-250414',
    'GLM-4-Flash-250414',
    'GLM-4V-Flash',
  ].map(id => [id.toLowerCase(), id]),
)

/** 把模型 id 归一成官方大小写；未命中时原样返回。 */
export function normalizeModelId(id: string): string {
  const trimmed = id.trim()
  if (trimmed.length === 0) return trimmed
  return OFFICIAL_MODEL_IDS.get(trimmed.toLowerCase()) ?? trimmed
}

/** 目录中真正可用的模型（当前全部可对话，保留过滤钩子便于将来扩展）。 */
export function selectableModels(catalog: ZCodeCatalog): readonly ZCodeModel[] {
  return catalog.models
}

/** 按 id 找模型。 */
export function findModel(catalog: ZCodeCatalog, id: string): ZCodeModel | undefined {
  return catalog.models.find(model => model.id === id)
}
