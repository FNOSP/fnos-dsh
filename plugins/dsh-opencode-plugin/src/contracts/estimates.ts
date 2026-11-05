/**
 * OpenCode Go 的「预计请求数」内置快照。
 *
 * 上游只在文档页给这张表，没有对应 API（2026-11-05 实测 `/inference/go/v1/*`
 * 与 `/console/api/*` 均无该数据）。因此这里把三档套餐的每月预计请求数内置成
 * 只读数据，目录排序与展示都读它：无网络依赖、行为可测，上游改额度时随插件
 * 版本更新。
 *
 * 数据来源：<https://opencode.ai/v2/docs/console/go/> 的 Estimated requests 表，
 * 抓取时间为 {@link OPENCODE_ESTIMATES_FETCHED_AT}。模型键是网关真实模型 id
 * （不带 `zen:` / `go:` 前缀），与文档表的 Model ID 列一一对应。
 *
 * `null` 表示文档在该档位把模型标为 `Unlimited`（当前是 Beam Free 与
 * Iceman Contributor Free 两个限时免费模型），排序时按最高档处理。
 *
 * @module dsh-opencode/estimates-contract
 */

import type { OpenCodeAccountPlan } from './catalog.ts'

/** 快照抓取日期（`YYYY-MM-DD`），用于界面标注数据口径。 */
export const OPENCODE_ESTIMATES_FETCHED_AT = '2026-11-05'

/** 快照来源地址。 */
export const OPENCODE_ESTIMATES_SOURCE_URL = 'https://opencode.ai/v2/docs/console/go/'

/** 一档套餐的「模型 id → 每月预计请求数」表。 */
export type OpenCodeEstimateTable = Readonly<Record<string, number | null>>

/**
 * Go 档（$10/月）的每月预计请求数。
 *
 * 顺序即文档顺序，按数值从大到小排列，方便人工核对。
 */
export const OPENCODE_GO_ESTIMATES: OpenCodeEstimateTable = {
  'beam-free': null,
  'iceman-contributor-free': null,
  'muse-spark-1.2-contributor': 226_600,
  'muse-spark-1.3-contributor': 226_600,
  'deepseek-v4.1-flash': 216_670,
  'mimo-v2.5': 150_400,
  'mimo-v2.6-flash': 150_400,
  'longcat-2.0': 57_200,
  'glm-5.3-flash': 31_580,
  'qwen3.8-flash': 27_000,
  'qwen3.7-plus': 21_600,
  hy3: 21_500,
  'gpt-6-luna': 21_130,
  'minimax-m3.1-flash': 19_380,
  'claude-haiku-5-5': 19_230,
  'mimo-v2.5-pro': 16_300,
  'mimo-v2.6-pro': 16_300,
  'minimax-m3': 16_000,
  hy4: 13_500,
  'gpt-5.6-luna': 10_250,
  'hy4-preview': 6_770,
  'kimi-k2.7-code': 6_750,
  'deepseek-v4-pro': 5_200,
  'glm-5.2': 4_300,
  'step-5-preview': 2_130,
  'gemini-4-argon': 2_120,
  'glm-5.3': 1_080,
  'grok-4.7': 845,
  'qwen3.8-max': 810,
  'kimi-k3.1-pro': 735,
  'kimi-k3': 490,
}

/** Go Plus 档（$40/月）的每月预计请求数。 */
export const OPENCODE_GO_PLUS_ESTIMATES: OpenCodeEstimateTable = {
  'beam-free': null,
  'iceman-contributor-free': null,
  'muse-spark-1.2-contributor': 453_200,
  'muse-spark-1.3-contributor': 453_200,
  'deepseek-v4.1-flash': 433_330,
  'mimo-v2.5': 300_800,
  'mimo-v2.6-flash': 300_800,
  'longcat-2.0': 228_800,
  'glm-5.3-flash': 94_740,
  hy3: 86_000,
  'gpt-6-luna': 84_520,
  'qwen3.8-flash': 81_000,
  'minimax-m3.1-flash': 77_520,
  'claude-haiku-5-5': 76_920,
  'mimo-v2.5-pro': 65_200,
  'mimo-v2.6-pro': 65_200,
  'qwen3.7-plus': 64_800,
  hy4: 54_000,
  'minimax-m3': 48_000,
  'gpt-5.6-luna': 41_000,
  'hy4-preview': 27_080,
  'deepseek-v4-pro': 20_800,
  'kimi-k2.7-code': 20_250,
  'glm-5.2': 12_900,
  'glm-5.3': 8_640,
  'step-5-preview': 8_520,
  'gemini-4-argon': 8_480,
  'grok-4.7': 3_380,
  'qwen3.8-max': 3_240,
  'kimi-k3.1-pro': 2_941,
  'kimi-k3': 1_960,
}

/** Go Teams 档（$20/成员/月）的每月预计请求数。 */
export const OPENCODE_GO_TEAMS_ESTIMATES: OpenCodeEstimateTable = {
  'beam-free': null,
  'iceman-contributor-free': null,
  'muse-spark-1.2-contributor': 245_480,
  'muse-spark-1.3-contributor': 245_480,
  'deepseek-v4.1-flash': 227_500,
  'mimo-v2.5': 162_930,
  'mimo-v2.6-flash': 162_930,
  'longcat-2.0': 61_970,
  'glm-5.3-flash': 34_210,
  'qwen3.8-flash': 31_500,
  'gpt-6-luna': 28_170,
  'claude-haiku-5-5': 25_640,
  'minimax-m3.1-flash': 24_230,
  'qwen3.7-plus': 23_400,
  hy3: 23_290,
  'mimo-v2.5-pro': 21_730,
  'mimo-v2.6-pro': 21_730,
  'minimax-m3': 17_330,
  hy4: 14_630,
  'gpt-5.6-luna': 13_670,
  'hy4-preview': 7_900,
  'kimi-k2.7-code': 7_310,
  'deepseek-v4-pro': 6_930,
  'glm-5.2': 4_660,
  'step-5-preview': 2_840,
  'gemini-4-argon': 2_470,
  'glm-5.3': 1_440,
  'grok-4.7': 1_130,
  'qwen3.8-max': 1_080,
  'kimi-k3.1-pro': 980,
  'kimi-k3': 653,
}

/**
 * 按套餐档位取预计请求数表。
 *
 * `payg` 与 `unknown` 没有对应的 Go 额度表：按量模型按 token 计费，不存在
 * 「每月预计请求数」这一口径，返回 undefined 让调用方回落到不按额度排序。
 *
 * @param plan - 账号套餐档位。
 * @returns 该档位的估算表；按量或未知时为 undefined。
 */
export function estimatesForPlan(plan: OpenCodeAccountPlan): OpenCodeEstimateTable | undefined {
  switch (plan) {
    case 'go':
      return OPENCODE_GO_ESTIMATES
    case 'go-plus':
      return OPENCODE_GO_PLUS_ESTIMATES
    case 'go-teams':
      return OPENCODE_GO_TEAMS_ESTIMATES
    default:
      return undefined
  }
}

/**
 * 查一个模型的每月预计请求数。
 *
 * @param table - 套餐档位估算表。
 * @param modelId - 网关真实模型 id（不带 plan 前缀）。
 * @returns 数值；`null` 表示上游标为不限量；表中没有该模型时 undefined。
 */
export function estimateOf(table: OpenCodeEstimateTable | undefined, modelId: string): number | null | undefined {
  if (table === undefined) return undefined
  return Object.hasOwn(table, modelId) ? table[modelId] : undefined
}
