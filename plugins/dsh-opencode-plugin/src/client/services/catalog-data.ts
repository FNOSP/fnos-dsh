/**
 * 模型目录的同源路由调用，以及套餐归属的展示映射。
 *
 * 套餐判定的数据面在宿主侧（`/catalog` 响应的 `entitlement`）；这里只负责把
 * 契约取值翻成文案键、把额度数字排成可读文本，不做任何请求或过滤决策。
 */

import { OPENCODE_ROUTES } from '../../contracts/routes.ts'
import type {
  OpenCodeAccountPlan,
  OpenCodeCatalog,
  OpenCodeCatalogEntitlement,
  OpenCodeModel,
} from '../../contracts/catalog.ts'
import type { OpenCodeLocaleKey } from '../locales.ts'
import { requestJson } from './http.ts'

/** 一组供应商路由的注册状态；由宿主在目录响应里一并下发。 */
export interface OpenCodeCatalogRouteStatus {
  readonly id: string
  readonly name: string
  readonly registered: boolean
  readonly error?: string
  /** 当前可用的模型数（已排除停用条目）。 */
  readonly modelCount: number
}

/**
 * 目录端点响应。
 *
 * `catalog` 为 `null` 表示宿主连上一次快照都没有；`error` 可能是「本次刷新
 * 失败但仍有旧快照」，因此有 `catalog` 时仍然要把 `error` 作为提示展示。
 * `routes` 里 `registered === false` 的组不会出现在模型选择器，需要在目录卡
 * 顶部给出可读警告。`entitlement` 描述本次视图的套餐口径：`catalog.models`
 * 已按它整侧过滤并排好序，界面不再自行过滤。
 */
export interface OpenCodeCatalogResponse {
  readonly catalog: OpenCodeCatalog | null
  readonly consoleError?: string
  readonly error?: string
  readonly routes?: readonly OpenCodeCatalogRouteStatus[]
  readonly entitlement?: OpenCodeCatalogEntitlement
}

/** 读取当前目录快照（宿主按需判断是否过期）。 */
export function readCatalog(): Promise<OpenCodeCatalogResponse> {
  return requestJson<OpenCodeCatalogResponse>(OPENCODE_ROUTES.catalog)
}

/** 强制刷新目录（会真实打到 OpenCode 上游）。 */
export function refreshCatalog(): Promise<OpenCodeCatalogResponse> {
  return requestJson<OpenCodeCatalogResponse>(OPENCODE_ROUTES.catalogRefresh, 'POST')
}

/**
 * 套餐档位 → 展示文案键。
 *
 * Go 三档是上游产品名，各语言照写；按量口径按官方 v2 文档叫 Console
 * （pay-as-you-go），`zen` 只保留在内部契约与模型键后缀里。
 */
const ACCOUNT_PLAN_LABEL_KEYS: Record<OpenCodeAccountPlan, OpenCodeLocaleKey> = {
  go: 'accountPlanGo',
  'go-plus': 'accountPlanGoPlus',
  'go-teams': 'accountPlanGoTeams',
  payg: 'accountPlanPayg',
  unknown: 'accountPlanUnknown',
}

/**
 * 套餐档位的展示文案键。
 * @param plan - 契约里的套餐档位。
 * @returns 对应的 locale 键。
 */
export function accountPlanLabelKey(plan: OpenCodeAccountPlan): OpenCodeLocaleKey {
  return ACCOUNT_PLAN_LABEL_KEYS[plan]
}

/** 判定依据 → 展示文案键；`Record` 保证新增来源时编译期报错。 */
const ACCOUNT_PLAN_SOURCE_KEYS: Record<OpenCodeCatalogEntitlement['source'], OpenCodeLocaleKey> = {
  console: 'accountPlanSourceConsole',
  usage: 'accountPlanSourceUsage',
  none: 'accountPlanSourceNone',
}

/**
 * 套餐判定依据的展示文案键。
 * @param source - 契约里的判定依据。
 * @returns 对应的 locale 键。
 */
export function accountPlanSourceKey(source: OpenCodeCatalogEntitlement['source']): OpenCodeLocaleKey {
  return ACCOUNT_PLAN_SOURCE_KEYS[source]
}

/**
 * 每月预计请求数的千分位文本。
 *
 * 用 `Intl.NumberFormat` 而不是手写分组：界面上百位以上是常读数字，各语言的
 * 分组符与小分隔符并不一致（`226,600` / `226.600` / `226 600`）。
 * @param value - 每月预计请求数。
 * @param locale - 可选的 BCP 47 标签；缺省跟随运行环境。
 * @returns 千分位文本；非法或负数时为 undefined。
 */
export function formatRequestCount(value: number, locale?: string): string | undefined {
  if (!Number.isFinite(value) || value < 0) return undefined
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value)
}

/**
 * 每月预计请求数的展示文本。
 *
 * 三态由契约决定，缺一不可：数字是官方额度表里的值；`null` 表示该模型在表里
 * 标为 Unlimited；`undefined` 表示不属于 Go 侧或表里没有它——此时整段不渲染，
 * 不占位、也不显示 0。
 * @param model - 目录条目。
 * @param unlimitedLabel - 「不限量」的文案（调用方从 locale 取，这个模块不碰翻译）。
 * @param locale - 可选 BCP 47 标签，用于千分位分组符。
 * @returns 可展示文本；该条目没有额度口径时为 undefined。
 */
export function estimatedRequestsText(
  model: OpenCodeModel,
  unlimitedLabel: string,
  locale?: string,
): string | undefined {
  const estimate = model.estimatedRequestsPerMonth
  if (estimate === undefined) return undefined
  if (estimate === null) return unlimitedLabel
  return formatRequestCount(estimate, locale)
}
