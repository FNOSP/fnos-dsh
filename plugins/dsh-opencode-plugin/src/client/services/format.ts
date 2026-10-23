/** 展示用的小型格式化工具。 */

/**
 * 把 epoch 毫秒格式化为本地短日期时间。
 * @param value - epoch 毫秒；缺失或非法时返回 undefined。
 * @returns 本地化时间文本。
 */
export function formatTimestamp(value: number | undefined): string | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return undefined
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(date)
}
