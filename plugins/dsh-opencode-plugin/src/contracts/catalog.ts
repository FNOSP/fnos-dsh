/**
 * 模型目录契约：宿主把上游目录归一化成这一层，浏览器与适配器都只读它。
 *
 * 归一化的目标不是复刻上游字段，而是把「DSH 需要什么」固定下来：协议族、
 * 端点、能力（思考等级、图片输入）、容量。上游字段名与取值形态（npm 包名、
 * reasoning_options、modalities）由 `host/catalog.ts` 负责解释。
 *
 * @module dsh-opencode/catalog-contract
 */

import type { OpenCodePlan } from './identity.ts'

/** 网关承载的协议族；决定端点尾段与 pi-ai 的 api 实现。 */
export type OpenCodeApiKind =
  | 'openai-completions'
  | 'openai-responses'
  | 'anthropic-messages'
  | 'google-generative-ai'

/** pi-ai 的思考等级全集，顺序即选择器展示顺序。 */
export const OPENCODE_REASONING_LEVELS = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const

export type OpenCodeReasoningLevel = typeof OPENCODE_REASONING_LEVELS[number]

/**
 * 思考等级 → 线上取值。
 *
 * 键是 DSH 选择器提供的等级，值是发给网关的拼写；`null` 表示该等级不受支持，
 * 缺省键表示按协议默认处理。语义与 pi-ai 的 `thinkingLevelMap` 一致，
 * 直接投影到模型对象上。
 */
export type OpenCodeThinkingLevelMap = Partial<Record<OpenCodeReasoningLevel, string | null>>

/** 每百万 token 的美元价格，仅用于展示与客户端估算。 */
export interface OpenCodeModelCost {
  readonly input: number
  readonly output: number
  readonly cacheRead?: number
  readonly cacheWrite?: number
}

/** 一个可在 DSH 中使用的 OpenCode 模型。 */
export interface OpenCodeModel {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly family?: string
  readonly api: OpenCodeApiKind
  /** 该协议族的完整请求端点前缀（不含 `/chat/completions` 等资源路径）。 */
  readonly baseURL: string
  readonly reasoning: boolean
  /** 思考等级映射；模型不支持思考时缺省。 */
  readonly thinkingLevelMap?: OpenCodeThinkingLevelMap
  readonly input: readonly ('text' | 'image')[]
  readonly contextWindow: number
  readonly maxTokens: number
  readonly cost?: OpenCodeModelCost
  /**
   * pi-ai 的 wire 兼容开关（thinkingFormat、maxTokensField、会话亲和等）。
   * 不透明的 JSON：DSH 侧只透传给 pi-ai，不解释字段。
   */
  readonly compat?: Readonly<Record<string, unknown>>
  /** 图片输入的预处理限制（来自 pi-ai 内置目录；不透明透传）。 */
  readonly inputLimits?: Readonly<Record<string, unknown>>
  /** 模型来源：`zen` 按量 或 `go` 套餐。 */
  readonly plan: OpenCodePlan
  /** 是否支持工具调用。 */
  readonly tools: boolean
  /** 是否支持结构化输出。 */
  readonly structuredOutput?: boolean
  /** 是否免费（输入/输出价格均为 0）。 */
  readonly free: boolean
  /**
   * 上架/发布时间（`YYYY-MM-DD`），来自公开目录的 `release_date`，缺失时退回
   * 活 roster 的 `created`。目录按它把较新的免费模型排在前面。
   */
  readonly releasedAt?: string
  /**
   * 上游只允许官方 OpenCode 客户端调用的免费模型（Zen 免费额度走客户端身份校验，
   * 第三方客户端调用会得到 `FreeTierError`）。这类模型在目录里保留展示，
   * 但不进入模型选择器；Go 套餐内含的免费模型不受此限制。
   */
  readonly clientOnly?: boolean
  /** 上游目录标为 deprecated；仍可用时保留，只做展示提示。 */
  readonly deprecated?: boolean
  /** Console 明确标记为未启用；仅当 Console 配置可读时出现。 */
  readonly disabled?: boolean
  /**
   * 套餐额度内的预计请求数（每月），来自官方 Go 文档的 Estimated requests 表。
   *
   * 只有 `plan` 为 `go` 且上游该档位有数据时出现；`null` 表示该模型在上游
   * 表里标为 Unlimited（不限量）。目录按它降序排序，让额度最大的模型排在最前。
   */
  readonly estimatedRequestsPerMonth?: number | null
}

/**
 * 账号套餐档位。
 *
 * - `payg`：只有按量（Console 余额），没有 Go 订阅；
 * - `go` / `go-plus` / `go-teams`：三档 Go 订阅，额度与 Estimated requests 各不相同；
 * - `unknown`：未登录或套餐接口不可读，调用方应保守处理（不做整侧过滤）。
 */
export type OpenCodeAccountPlan = 'payg' | 'go' | 'go-plus' | 'go-teams' | 'unknown'

/** 账号套餐快照。 */
export interface OpenCodeAccountEntitlement {
  readonly plan: OpenCodeAccountPlan
  /** 判定依据：`console` 读到了 Console 套餐接口；`usage` 只用用量接口兜底推断。 */
  readonly source: 'console' | 'usage' | 'none'
  /** 读取时间（epoch ms）。 */
  readonly fetchedAt: number
  /** 读取失败时的说明；成功时为 undefined。 */
  readonly error?: string
}

/** 目录快照。 */
export interface OpenCodeCatalog {
  /** 快照生成时间（epoch ms）。 */
  readonly fetchedAt: number
  /**
   * `console`：本次快照读到了账号的 Console 配置；`public`：未登录或配置
   * 不可读，只用了公开目录。
   *
   * 注意它不表示「模型全集来自账号配置」：Go 工作空间的模型清单以活 roster
   * 为准，Console 配置只做增补、禁用标记与工作空间路由头。
   */
  readonly source: 'console' | 'public'
  readonly models: readonly OpenCodeModel[]
  /** 解析期间的降级说明（未知协议、跳过图片模型等），用于界面提示。 */
  readonly warnings: readonly string[]
}

/** 估算表的来源标注，供界面说明数据口径。 */
export interface OpenCodeEstimateProvenance {
  /** 抓取日期（`YYYY-MM-DD`）。 */
  readonly fetchedAt: string
  /** 官方文档地址。 */
  readonly sourceUrl: string
}

/**
 * `/catalog` 与 `/catalog/refresh` 响应里的套餐字段。
 *
 * 它描述的是**本次目录视图**的口径：`catalog.models` 已经按 `plan` 整侧过滤、
 * 按该档位的预计请求数排好序。界面据此显示套餐名、判定依据与过滤说明，
 * 不要自己再过滤一遍。
 */
export interface OpenCodeCatalogEntitlement extends OpenCodeAccountEntitlement {
  /** 本次视图实际生效的端点策略；`auto` 表示未改写各模型的原生端点。 */
  readonly endpointPlan: OpenCodePlan | 'auto'
  /**
   * 本次视图被整侧过滤掉的模型条数。
   *
   * 目录视图始终按套餐整侧过滤（未知套餐按 Go 口径），因此该字段始终出现。
   * 界面只在它大于 0 时显示「已隐藏 N 个」——0 表示另一侧本来就没有条目。
   */
  readonly filteredModelCount: number
  /** 排序所用估算表的来源；按量（`payg`）没有额度口径，故缺省。 */
  readonly estimates?: OpenCodeEstimateProvenance
}

/** 目录中可用于生成对话的模型；过滤掉图片生成、显式关闭与仅官方客户端可用的条目。 */
export function selectableModels(catalog: OpenCodeCatalog): readonly OpenCodeModel[] {
  return catalog.models.filter(model => model.disabled !== true && model.clientOnly !== true)
}
