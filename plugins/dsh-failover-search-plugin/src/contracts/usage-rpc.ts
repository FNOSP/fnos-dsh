/**
 * 详情页配置区与用量区块的 host ↔ client 契约。
 *
 * 频道与端点字符串是**两端协商的取值**，因此定义在 contracts 而不是 host：两端各
 * 写一份常量曾在本仓库其它插件上导致过真实的静默失联。
 */
import type { AccountUsage } from './types.ts'

/** 客户端查询用量快照所用的 RPC 频道。 */
export const FAILOVER_USAGE_CHANNEL = '/dsh-failover-search'

/** 用量区块调用的端点：读取当前快照（只读，不触发刷新）。 */
export const FAILOVER_USAGE_ENDPOINT = 'usage'

/** 配置区调用的端点：读取账号的 key 掩码（secret 明文永不出现在返回里）。 */
export const FAILOVER_ACCOUNTS_ENDPOINT = 'accounts'

/** 一个账号在配置区的展示信息。 */
export interface AccountSummary {
  /** 平台 id：`tinyfish` / `tavily`。 */
  readonly platform: string
  /** 账号代号（备注名或 `平台-序号`）。 */
  readonly label: string
  /**
   * key 的不可还原掩码（形如 `sk-tin…KFFtn`）。
   *
   * 明文 key 是 secret 角色、不随配置读取面跨线，客户端只能通过这个掩码让用户
   * 辨认「这一行配的是哪个 key」。
   */
  readonly maskedKey: string
}

/** 账号端点的返回面。 */
export interface AccountsSnapshot {
  /** 两个平台的账号信息，按平台分组前的平铺列表。 */
  readonly accounts: readonly AccountSummary[]
}

/** 用量端点的返回面。 */
export interface UsageSnapshot {
  /** 各账号的用量快照。 */
  readonly accounts: readonly AccountUsage[]
  /** 快照获取时间（ISO-8601）；从未刷新时为 undefined。 */
  readonly fetchedAt?: string
  /** 快照是否仍在新鲜期内。 */
  readonly fresh: boolean
}
