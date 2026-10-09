/**
 * 用量快照的配置指纹。
 *
 * 用途：账号配置变化（新增、删除、改名、换 key、调整顺序）后，缓存的用量快照就与
 * 现状对不上了——后台刷新周期默认 5 分钟，用户刚配好 Tavily 却看到「未配置账号」，
 * 会误以为配置没生效。指纹让服务端在配置变化时立即重取快照。
 *
 * 指纹**不含 key 明文**：它会被用于比较，可能进入日志或事件附近，携带凭据会扩大
 * 暴露面。这里对每个 key 取一个短的稳定散列，既能识别「换了 key」，又不可还原。
 */
import type { FailoverSearchSettings } from '../contracts/config.ts'

/**
 * 计算一个 key 的短散列。
 *
 * 用 FNV-1a（32 位）而不是加密散列：这里只需要「同不同」的判定，不需要抗碰撞强度；
 * 输出是 8 位十六进制，够短也不会把明文带出去。
 *
 * @param value - 要散列的文本。
 * @returns 8 位十六进制散列。
 */
function shortHash(value: string): string {
  let hash = 0x811C9DC5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    // FNV 素数乘法，用移位加法避免 32 位溢出精度问题。
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/**
 * 把一个平台的账号列表编码进指纹。
 *
 * 顺序参与编码：账号顺序同时决定轮转起点与展示顺序，变化了就该重取。
 *
 * @param accounts - 该平台的账号列表。
 * @returns 编码片段。
 */
function accountSegment(accounts: readonly { key: string, label?: string }[]): string {
  return accounts
    .map(account => `${shortHash(account.key)}:${account.label ?? ''}`)
    .join(',')
}

/**
 * 计算用量快照的配置指纹。
 *
 * 只有影响「查哪些账号」的字段参与：两个平台的账号列表。超时、探测开关、刷新间隔等
 * 与账号集合无关的字段变化不触发重取（刷新间隔变化在下一轮生效即可）。
 *
 * @param settings - 当前配置取值。
 * @returns 指纹字符串（不含任何 key 明文）。
 */
export function usageFingerprint(settings: FailoverSearchSettings): string {
  return `${accountSegment(settings.tinyfishAccounts)}|${accountSegment(settings.tavilyAccounts)}`
}
