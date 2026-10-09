/**
 * 平台账号池：轮转均摊、健康度跳过与账号级失败转移。
 *
 * 每个平台一个池，账号 = 一个 key（含供展示的备注名）。均摊游标持久在内存，
 * 被探测排除或请求失败的账号在**同一次搜索**内不再重试，其余按轮转推进。
 *
 * 为什么是轮转：TinyFish 限流按 key 计（多 key 有真实扩容收益），Tavily 配额按
 * 账户计（多个 key 提供失效冗余与单 key 限流分散）。轮转实现简单、分布均匀、
 * 结果可解释，符合计划「均摊策略」决策；最少连接/加权等策略在均摊效果可验证前
 * 不引入。
 */
import type { AccountConfig } from '../contracts/config.ts'
import type { PlatformId } from '../contracts/types.ts'

/** 池中一个账号：key 与展示用代号。 */
export interface PoolAccount {
  /** 平台 API key（只传给适配器，不进入事件与日志）。 */
  readonly key: string
  /** 账号代号：备注名或 `平台-序号`，用于展示与事件。 */
  readonly label: string
}

/**
 * 把一个平台的配置列表转成池账号列表。
 *
 * 代号规则：有备注名用备注名，否则用 `平台-序号`。序号是**配置位置**（1 起），
 * 与备注名一起构成展示与事件里的账号身份；同一平台不允许两个账号共用代号，
 * 否则探测排除会误伤同名账号。
 *
 * @param platform - 平台 id，用于生成默认代号。
 * @param accounts - 配置里的账号列表。
 * @returns 池账号列表；显式备注名与默认代号相同时保留第一次出现的位置。
 */
export function buildPool(platform: PlatformId, accounts: readonly AccountConfig[]): PoolAccount[] {
  const pool: PoolAccount[] = []
  const used = new Set<string>()
  accounts.forEach((account, index) => {
    const key = account.key
    if (key.length === 0) return
    let label = account.label?.trim() ?? ''
    if (label.length === 0) label = `${platform}-${index + 1}`
    // 代号重复时补后缀：探测按代号排除，重名会让排除范围超出用户预期。
    let unique = label
    let suffix = 2
    while (used.has(unique)) {
      unique = `${label}#${suffix}`
      suffix += 1
    }
    used.add(unique)
    pool.push({ key, label: unique })
  })
  return pool
}

/**
 * 一个平台的轮转游标。
 *
 * 游标按「账号集合的大小」取模而不是记住具体账号：配置增删后集合变化，游标不必
 * 重新对齐，下一次取模自然落到集合内（避免删除账号后游标越界）。
 */
export class RoundRobinCursor {
  private next = 0

  /**
   * 在一组候选账号上取下一个起点。
   * @param accounts - 本次可用的候选账号（至少一个）。
   * @returns 轮转选中的起点下标。
   */
  take(accounts: readonly PoolAccount[]): number {
    if (accounts.length === 0) return -1
    const index = this.next % accounts.length
    this.next = (this.next + 1) % accounts.length
    return index
  }
}
