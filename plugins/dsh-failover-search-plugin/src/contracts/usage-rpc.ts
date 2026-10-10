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

/**
 * 用量区块手动刷新调用的端点（FNOS-010-08-AC-04）：强制重查两个平台的用量端点。
 *
 * 与 `usage` 分开而不是给它加参数：只读端点被搜索链路与其它读取方复用，让「读」
 * 顺带触发平台请求会让每次读取都产生外部调用。刷新是显式的写意图，单独一个端点。
 */
export const FAILOVER_REFRESH_ENDPOINT = 'refresh'

/** 配置区调用的端点：读取账号的 key 掩码（secret 明文永不出现在返回里）。 */
export const FAILOVER_ACCOUNTS_ENDPOINT = 'accounts'

/** 配置区调用的端点：按账号取出 key 明文，仅供用户点击「复制」时使用。 */
export const FAILOVER_REVEAL_ENDPOINT = 'reveal-key'

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

/**
 * 取单个账号 key 明文的请求。
 *
 * 平台 + 账号代号共同定位账号，不用下标：下标在并发增删后会指向另一个账号，而用户
 * 点「复制」的意图是**那一个**账号（与 `buildPool` 的代号生成规则一致）。
 */
export interface RevealKeyRequest {
  /** 平台 id：`tinyfish` / `tavily`。 */
  readonly platform: string
  /** 账号代号（备注名或 `平台-序号`）。 */
  readonly label: string
}

/** 取单个账号 key 明文的返回面。 */
export interface RevealKeySnapshot {
  /**
   * key 明文。
   *
   * 只在这个显式端点里跨线：配置读取面（`settings.describe`）按 secret 角色把明文整体
   * 移除，因此日常渲染路径拿不到它；这里由用户点击复制触发，取回后立即写入剪贴板，
   * 不落任何缓存与日志。
   */
  readonly key: string
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
