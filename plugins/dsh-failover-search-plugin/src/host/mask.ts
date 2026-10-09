/**
 * 账号 key 的可辨识掩码。
 *
 * 为什么掩码在 **host** 侧生成：key 是 secret 角色，配置读取面（`settings.describe`）
 * 会把明文整体移除，客户端**根本拿不到** key。因此「让用户在表单里看出配的是哪个
 * key」只能由持有明文的一方产出一个不可还原的摘要再送出去——掩码保留首尾极短片段，
 * 足以区分同平台的多个账号，但不足以重建 key。
 *
 * 掩码不是「脱敏后的密钥」：它刻意只留首尾各几个字符，中段不可推导，且短 key 整体
 * 掩掉。日志、事件与错误信息仍然不携带任何片段。
 */

/** 完全掩掉时使用的占位符。 */
const FULLY_MASKED = '••••••'

/** 短于等于该长度的 key 整体掩掉（首尾片段在该长度下已接近整个 key）。 */
const SHORT_KEY_MAX = 8

/** 长于该长度时才允许露出较长的首尾片段。 */
const LONG_KEY_MIN = 20

/**
 * 生成一个不可还原的 key 掩码。
 *
 * 规则：长度 ≤ {@link SHORT_KEY_MAX} 时整体掩掉；中等长度只露首尾各 2 个字符；
 * 较长的 key 露首 6 个、尾 5 个字符。任何长度下可见字符都远少于 key 长度。
 *
 * @param key - 明文 key（只在 host 侧使用，不进入返回值以外的任何地方）。
 * @returns 形如 `sk-tin…KFFtn` 的掩码；空值与空白返回占位符。
 */
export function maskApiKey(key: string): string {
  const trimmed = key.trim()
  if (trimmed.length <= SHORT_KEY_MAX) return FULLY_MASKED

  const [head, tail] = trimmed.length >= LONG_KEY_MIN ? [6, 5] : [2, 2]
  return `${trimmed.slice(0, head)}…${trimmed.slice(trimmed.length - tail)}`
}
