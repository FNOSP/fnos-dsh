/**
 * 用量快照缓存：展示与请求前探测共用的一份数据。
 *
 * 设计要点（对应计划「用量快照与请求前探测」）：
 * - 快照是**内存缓存**，不落盘：可低成本重建（端点均为免费查询），而落盘会引入
 *   过期数据被误用的风险；
 * - 后台按配置周期刷新，配置变更（key 增删）触发立即刷新；
 * - 快照新鲜时才参与探测判定；过期或缺失按「无用量信息」处理，退化为响应式转移；
 * - TinyFish 无服务端搜索配额，探测只能依赖**本地限流窗口记账**（每 key 独立的
 *   30 req/min 滑窗；限流按 key 计，多 key 线性扩容）；
 * - Tavily 配额按账户计，由用量端点的 `plan_usage >= plan_limit` 反映，不做本地
 *   限流上限判断。
 */
import type { FailoverSearchSettings } from '../contracts/config.ts'
import { TAVILY_PLATFORM_ID, TINYFISH_PLATFORM_ID, TINYFISH_RATE_LIMIT_PER_MINUTE } from '../contracts/constants.ts'
import type { AccountUsage, PlatformId, UsageAdapter, UsageReading } from '../contracts/types.ts'
import { buildPool } from './account-pool.ts'
import { RATE_WINDOW_MS } from './constants.ts'

/** 构造用量快照缓存的依赖。 */
export interface UsageStoreOptions {
  /** 各平台的用量查询适配器；缺省表示该平台不查询。 */
  readonly adapters: Partial<Record<PlatformId, UsageAdapter>>
  /** 当前时刻（测试注入 seam）。 */
  readonly now?: (() => Date) | undefined
  /** 每分钟请求上限（默认 TinyFish 的 30 req/min/key）。 */
  readonly limitPerMinute?: number | undefined
}

/** 本地限流记账的滑窗条目：账号 → 最近请求时间戳。 */
type RateWindows = Map<string, number[]>

/** 用量快照缓存。 */
export class UsageStore {
  private entries: readonly AccountUsage[] = []
  private refreshedAt: number | undefined
  private freshForMs = 5 * 60 * 1000
  private readonly listeners = new Set<() => void>()
  private readonly windows: Record<PlatformId, RateWindows> = {
    [TINYFISH_PLATFORM_ID]: new Map(),
    [TAVILY_PLATFORM_ID]: new Map(),
  }

  /**
   * @param options - 用量适配器、当前时刻与本地限流上限。
   */
  constructor(private readonly options: UsageStoreOptions) {}

  /**
   * 刷新全部已配置账号的用量快照。
   *
   * 单个账号失败不会中止整批：失败被折成带 `error` 的快照（展示层给出可理解提示），
   * 搜索链路不受影响。适配器**抛出**的意外错误也在这里兜住，保证刷新自身不会
   * 把异常带到调用方。
   *
   * 平台、账号代号与获取时间由本层统一盖章：适配器只报告读数，身份与时间不会
   * 出现「适配器填错」的不一致。
   *
   * @param settings - 本次刷新的配置取值（决定查哪些账号与新鲜期长度）。
   * @param signal - 取消信号。
   */
  async refresh(settings: FailoverSearchSettings, signal?: AbortSignal): Promise<void> {
    this.freshForMs = Math.max(1, settings.usageRefreshMinutes) * 60 * 1000
    const fetchedAt = this.now().toISOString()
    const results: AccountUsage[] = []

    for (const platform of [TINYFISH_PLATFORM_ID, TAVILY_PLATFORM_ID] as const) {
      const adapter = this.options.adapters[platform]
      if (adapter === undefined) continue

      const accounts = platform === TINYFISH_PLATFORM_ID ? settings.tinyfishAccounts : settings.tavilyAccounts
      const pool = buildPool(platform, accounts)

      for (const account of pool) {
        const reading = await this.queryOne(adapter, account.key, signal)
        results.push({ platform, accountLabel: account.label, fetchedAt, ...reading })
      }
    }

    this.entries = results
    this.refreshedAt = this.now().getTime()
    this.publish()
  }

  /** 查询一个账号，把任何失败折成读数。 */
  private async queryOne(adapter: UsageAdapter, key: string, signal?: AbortSignal): Promise<UsageReading> {
    try {
      return await adapter.fetchUsage(key, signal)
    } catch (error) {
      return { details: {}, error: error instanceof Error ? error.message : String(error) }
    }
  }

  /**
   * 读取当前快照（只读，不发起网络请求）。
   * @returns 各账号的用量快照。
   */
  snapshot(): readonly AccountUsage[] {
    return this.entries
  }

  /**
   * 快照是否仍在新鲜期内。
   *
   * 从未刷新过（进程刚启动）时返回 false：探测因此不排除任何账号，退化为响应式
   * 转移——这是计划约定的「探测是优化不是正确性依赖」。
   *
   * @returns 是否新鲜。
   */
  isFresh(): boolean {
    if (this.refreshedAt === undefined) return false
    return this.now().getTime() - this.refreshedAt < this.freshForMs
  }

  /**
   * 记录一次真实发出的请求，用于本地限流窗口记账。
   * @param platform - 平台 id。
   * @param accountLabel - 账号代号。
   */
  recordRequest(platform: PlatformId, accountLabel: string): void {
    const window = this.windows[platform]
    const stamps = window.get(accountLabel) ?? []
    stamps.push(this.now().getTime())
    window.set(accountLabel, stamps)
  }

  /**
   * 该账号是否已在本地限流窗口内触限。
   *
   * 只对 TinyFish 生效：它的限流按 key 计且无服务端配额可查，所以本地滑窗是唯一
   * 的探测依据。Tavily 的配额按账户计、由服务端用量端点反映，本地不做上限判断。
   *
   * @param platform - 平台 id。
   * @param accountLabel - 账号代号。
   * @returns 是否触限。
   */
  locallyLimited(platform: PlatformId, accountLabel: string): boolean {
    if (platform !== TINYFISH_PLATFORM_ID) return false
    const limit = this.options.limitPerMinute ?? TINYFISH_RATE_LIMIT_PER_MINUTE
    const stamps = this.windows[platform].get(accountLabel)
    if (stamps === undefined || stamps.length === 0) return false

    const cutoff = this.now().getTime() - RATE_WINDOW_MS
    const live = stamps.filter(stamp => stamp > cutoff)
    // 顺手收缩过期记账，避免长时间运行后数组无限增长。
    this.windows[platform].set(accountLabel, live)
    return live.length >= limit
  }

  /**
   * 订阅快照更新（展示层只读订阅）。
   * @param listener - 快照变化后调用。
   * @returns 取消订阅的 disposer。
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** 通知订阅者快照已更新。 */
  private publish(): void {
    for (const listener of this.listeners) listener()
  }

  /** 当前时刻。 */
  private now(): Date {
    return this.options.now?.() ?? new Date()
  }
}
