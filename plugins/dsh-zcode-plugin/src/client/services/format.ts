/**
 * 展示用的小型格式化工具。
 *
 * @module dsh-zcode/client/format
 */

/** 把 token 数量压缩成可读文本（1.2M / 128K / 512）。 */
export function formatTokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0'
  if (value >= 1_000_000) {
    const millions = value / 1_000_000
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`
  }
  if (value >= 1_000) {
    const thousands = value / 1_000
    return `${Number.isInteger(thousands) ? thousands : thousands.toFixed(1)}K`
  }
  return String(Math.round(value))
}

/** 把 epoch 毫秒格式化为本地短日期时间。 */
export function formatTimestamp(value: number | undefined): string | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return undefined
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(date)
}

/**
 * 把 ISO 时间格式化为本地短日期时间。
 *
 * 上游给的是 `2026-10-25T00:00:00+08:00` 这类带时区的字符串；解析失败时
 * 返回 undefined，让调用方回落到「无重置时间」而不是显示 `Invalid Date`。
 */
export function formatIsoTimestamp(value: string | undefined): string | undefined {
  if (value === undefined || value.length === 0) return undefined
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return undefined
  return formatTimestamp(parsed)
}

/** 把毫秒差格式化成「N 分钟 / N 小时 / N 天」的数值与单位。 */
export function describeDuration(ms: number): { readonly value: number; readonly unit: 'minutes' | 'hours' | 'days' } {
  const safe = Math.max(0, ms)
  const minutes = Math.round(safe / 60_000)
  if (minutes < 60) return { value: Math.max(1, minutes), unit: 'minutes' }
  const hours = Math.round(minutes / 60)
  if (hours < 48) return { value: hours, unit: 'hours' }
  return { value: Math.round(hours / 24), unit: 'days' }
}
