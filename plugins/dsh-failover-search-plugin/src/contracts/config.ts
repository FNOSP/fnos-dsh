/**
 * FNOS-010 插件的 Config schema。
 *
 * 每个顶层字段都是 `.volatile()`：DSH 通过 `entry.fiber.runtime.Config` 解析配置
 * 命名空间，volatile 字段让 `apply` 拿到稳定引用而不是快照，保存后的新值直接
 * 到达运行中的插件、无需重挂载（需求 FNOS-010-04-AC-01/02「保存后下一次搜索
 * 立即生效」）。读取一律经 `.get()`。
 *
 * key 列表项用 `role('secret')` 声明 key：宿主据此在读取面脱敏（`dsh-settings`
 * 的结构化脱敏只认这一角色），配置回显与会话记录都不会出现明文。
 */
import type { Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  DEFAULT_FAILOVER_ORDER,
  DEFAULT_HOST_TIMEOUT_MS,
  DEFAULT_PROBE_ENABLED,
  DEFAULT_SAME_PLATFORM_RETRY,
  DEFAULT_USAGE_REFRESH_MINUTES,
  OFFICIAL_SOURCE_ID,
  TAVILY_PLATFORM_ID,
  TINYFISH_PLATFORM_ID,
  USAGE_REFRESH_MAX_MINUTES,
  USAGE_REFRESH_MIN_MINUTES,
} from './constants.ts'

/** 一个平台账号：key 与可选的备注名。 */
export interface AccountConfig {
  /** 平台 API key；以 secret 角色存储，配置读取面不返回明文。 */
  key: string
  /** 备注名（如 `tinyfish-1`），用于展示与日志区分；省略时按序号展示。 */
  label?: string
}

/** 三个可选来源的 id 取值。 */
export type SourceId = typeof TINYFISH_PLATFORM_ID | typeof TAVILY_PLATFORM_ID | typeof OFFICIAL_SOURCE_ID

/** 一次搜索开始时快照出的配置取值。 */
export interface FailoverSearchSettings {
  /** TinyFish 平台账号列表；为空表示该平台禁用。 */
  readonly tinyfishAccounts: readonly AccountConfig[]
  /** Tavily 平台账号列表；为空表示该平台禁用。 */
  readonly tavilyAccounts: readonly AccountConfig[]
  /** 来源尝试顺序；官方搜索固定参与，作为兜底可调整位置但不可移除。 */
  readonly sourceOrder: readonly string[]
  /** 单个账号一次搜索请求的超时（毫秒）。 */
  readonly timeoutMs: number
  /** 某账号请求失败后是否继续尝试同平台其它账号。 */
  readonly samePlatformRetry: boolean
  /** 用量快照的后台刷新周期（分钟）。 */
  readonly usageRefreshMinutes: number
  /** 是否启用基于用量快照的请求前账号排除。 */
  readonly requestProbe: boolean
}

/** 插件 `apply` 收到的配置面：每个字段一个稳定引用。 */
export interface FailoverSearchConfig {
  readonly tinyfishAccounts: Volatile<readonly AccountConfig[]>
  readonly tavilyAccounts: Volatile<readonly AccountConfig[]>
  readonly sourceOrder: Volatile<readonly string[]>
  readonly timeoutMs: Volatile<number>
  readonly samePlatformRetry: Volatile<boolean>
  readonly usageRefreshMinutes: Volatile<number>
  readonly requestProbe: Volatile<boolean>
}

/**
 * 插件 Config schema。
 *
 * 字段顺序即官方自动生成表单的呈现顺序：来源与账号 → 均摊与转移 → 用量展示与探测。
 *
 * 显式标注 `z<Schemastery.ObjectS<…>, Schemastery.ObjectT<…>, 'plain'>`：只写
 * `z.object(...)` 时推导出的类型会引用 schemastery 内部的 cosmokit 类型，声明文件
 * 生成随即报 “inferred type cannot be named without a reference to …”，发布产物里
 * 的 `d.ts` 也就跟着缺失。标注后导出的是本插件自己的契约面。
 *
 * `Schemastery` 是 schemastery 声明的**全局命名空间**（不是模块导出），因此无需
 * 也不能 import 它。
 */
export const FailoverSearchConfigSchema: z<
  Schemastery.ObjectS<NoInfer<{
    tinyfishAccounts: z<NoInfer<AccountConfig[]>, NoInfer<AccountConfig[]>, 'volatile-defined'>
    tavilyAccounts: z<NoInfer<AccountConfig[]>, NoInfer<AccountConfig[]>, 'volatile-defined'>
    sourceOrder: z<NoInfer<string[]>, NoInfer<string[]>, 'volatile-defined'>
    timeoutMs: z<NoInfer<number>, NoInfer<number>, 'volatile-defined'>
    samePlatformRetry: z<NoInfer<boolean>, NoInfer<boolean>, 'volatile-defined'>
    usageRefreshMinutes: z<NoInfer<number>, NoInfer<number>, 'volatile-defined'>
    requestProbe: z<NoInfer<boolean>, NoInfer<boolean>, 'volatile-defined'>
  }>>,
  Schemastery.ObjectT<NoInfer<{
    tinyfishAccounts: z<NoInfer<AccountConfig[]>, NoInfer<AccountConfig[]>, 'volatile-defined'>
    tavilyAccounts: z<NoInfer<AccountConfig[]>, NoInfer<AccountConfig[]>, 'volatile-defined'>
    sourceOrder: z<NoInfer<string[]>, NoInfer<string[]>, 'volatile-defined'>
    timeoutMs: z<NoInfer<number>, NoInfer<number>, 'volatile-defined'>
    samePlatformRetry: z<NoInfer<boolean>, NoInfer<boolean>, 'volatile-defined'>
    usageRefreshMinutes: z<NoInfer<number>, NoInfer<number>, 'volatile-defined'>
    requestProbe: z<NoInfer<boolean>, NoInfer<boolean>, 'volatile-defined'>
  }>>,
  'plain'
> = z.object({
  tinyfishAccounts: z.array(z.object({
    key: z.string().required().role('secret').description('API key（以 secret 角色存储，不随配置回显）'),
    label: z.string().description('备注名，例如 tinyfish-1'),
  })).default([]).volatile().description('TinyFish 账号：可配置多个 key，在同一平台的多个账号间均摊请求'),
  tavilyAccounts: z.array(z.object({
    key: z.string().required().role('secret').description('API key（以 secret 角色存储，不随配置回显）'),
    label: z.string().description('备注名，例如 tinyfish-1'),
  })).default([]).volatile().description('Tavily 账号：可配置多个 key；套餐配额按账户计，多个 key 提供失效冗余'),
  sourceOrder: z.array(z.union([TINYFISH_PLATFORM_ID, TAVILY_PLATFORM_ID, OFFICIAL_SOURCE_ID]))
    .default([...DEFAULT_FAILOVER_ORDER])
    .volatile()
    .description('来源尝试顺序（默认 TinyFish → Tavily → 官方搜索）'),
  timeoutMs: z.number()
    .default(DEFAULT_HOST_TIMEOUT_MS)
    .min(1)
    .volatile()
    .description('单个账号一次搜索请求的超时（毫秒）；须小于工具层总预算'),
  samePlatformRetry: z.boolean()
    .default(DEFAULT_SAME_PLATFORM_RETRY)
    .volatile()
    .description('某账号请求失败后，是否继续尝试同平台其它账号'),
  usageRefreshMinutes: z.number()
    .default(DEFAULT_USAGE_REFRESH_MINUTES)
    .min(USAGE_REFRESH_MIN_MINUTES)
    .max(USAGE_REFRESH_MAX_MINUTES)
    .volatile()
    .description('平台用量快照的后台刷新周期（分钟）'),
  requestProbe: z.boolean()
    .default(DEFAULT_PROBE_ENABLED)
    .volatile()
    .description('是否启用基于用量快照的请求前账号排除'),
})

/**
 * 插件 Config schema（`apply` 第二个参数的实际取值面）。
 */
export const Config: FailoverSearchConfig & typeof FailoverSearchConfigSchema
  = FailoverSearchConfigSchema as FailoverSearchConfig & typeof FailoverSearchConfigSchema

/**
 * `apply` 收到的第二个参数类型。
 *
 * 声明为 `FailoverSearchConfig & typeof Config`：前者给出字段的可读取面，
 * 后者让提交给 Cordis 的插件对象同时带上 schema 值（DSH 通过
 * `entry.fiber.runtime.Config` 解析命名空间，缺了它 `settings.update` 会报
 * `No configurable plugin entry`）。
 */
export type ResolvedConfig = FailoverSearchConfig & typeof Config
/** 在一个操作入口把全部字段收敛成一次取值快照。 */
export function readSettings(config: FailoverSearchConfig | undefined): FailoverSearchSettings {
  return {
    tinyfishAccounts: config?.tinyfishAccounts?.get() ?? [],
    tavilyAccounts: config?.tavilyAccounts?.get() ?? [],
    sourceOrder: config?.sourceOrder?.get() ?? [...DEFAULT_FAILOVER_ORDER],
    timeoutMs: config?.timeoutMs?.get() ?? DEFAULT_HOST_TIMEOUT_MS,
    samePlatformRetry: config?.samePlatformRetry?.get() ?? DEFAULT_SAME_PLATFORM_RETRY,
    usageRefreshMinutes: config?.usageRefreshMinutes?.get() ?? DEFAULT_USAGE_REFRESH_MINUTES,
    requestProbe: config?.requestProbe?.get() ?? DEFAULT_PROBE_ENABLED,
  }
}
