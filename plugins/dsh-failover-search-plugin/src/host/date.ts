/**
 * 发布日期的容错解析：把各来源的日期表达统一成接缝要求的 ISO-8601。
 *
 * - Tavily 的 `published_date` 是 RFC2822；
 * - TinyFish 的 `date` 是自然语言或英文日期（`1 month ago`、`Aug 16, 2026`），
 *   官方文档未穷尽格式全集（调研结论标注「部分核实」），因此这里对**任何**无法
 *   可靠解析的取值返回 `undefined`，由调用方省略 `publishedAt`——需求的行为
 *   约定是「解析失败按无日期呈现」，而不是发明一个日期。
 */

/** 相对时间的单位与其毫秒换算。 */
const RELATIVE_UNITS: Record<string, number> = {
  second: 1000,
  seconds: 1000,
  minute: 60 * 1000,
  minutes: 60 * 1000,
  hour: 60 * 60 * 1000,
  hours: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  days: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  weeks: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
  months: 30 * 24 * 60 * 60 * 1000,
  year: 365 * 24 * 60 * 60 * 1000,
  years: 365 * 24 * 60 * 60 * 1000,
}

/** 英文月份名缩写与全称。 */
const MONTHS: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
}

/** 把毫秒时间戳格式化成 UTC ISO-8601；无效时间返回 undefined。 */
function toIso(timestamp: number): string | undefined {
  if (!Number.isFinite(timestamp)) return undefined
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return undefined
  return date.toISOString()
}

/** 解析 `1 month ago` / `yesterday` / `just now` 这类相对表达。 */
function parseRelative(text: string, now: Date): string | undefined {
  const lower = text.toLowerCase().trim()
  if (lower === 'yesterday') return toIso(now.getTime() - 24 * 60 * 60 * 1000)
  if (lower === 'today' || lower === 'just now' || lower === 'now') return toIso(now.getTime())

  const match = /^(\d+)\s*(second|minute|hour|day|week|month|year)s?\s+ago$/u.exec(lower)
  if (match === null) return undefined
  const amount = Number(match[1])
  const unit = match[2] ?? ''
  if (!Number.isFinite(amount)) return undefined

  // 月与年是日历单位，不是固定时长：「1 month ago」从 9 月 30 日应回到 8 月 30 日，
  // 而按 30 天算会得到 8 月 31 日。按日历回退，其余单位用固定毫秒。
  if (unit === 'month' || unit === 'year') {
    const date = new Date(now.getTime())
    date.setUTCMonth(date.getUTCMonth() - amount * (unit === 'year' ? 12 : 1))
    return toIso(date.getTime())
  }

  const scale = RELATIVE_UNITS[unit]
  if (scale === undefined) return undefined
  return toIso(now.getTime() - amount * scale)
}

/** 解析 `Aug 16, 2026` / `16 Aug 2026` 这类英文日期（可选时间部分）。 */
function parseEnglishDate(text: string): string | undefined {
  const match = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?$/u.exec(text.trim())
    ?? /^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/u.exec(text.trim())
  if (match === null) return undefined

  // 两种写法把月/日放在不同分组，按是否有月份名分别取值。
  const isMonthFirst = MONTHS[(match[1] ?? '').toLowerCase()] !== undefined
  const monthName = isMonthFirst ? match[1] : match[2]
  const day = Number(isMonthFirst ? match[2] : match[1])
  const year = Number(match[3])
  const month = MONTHS[(monthName ?? '').toLowerCase()]
  if (month === undefined || !Number.isFinite(day) || !Number.isFinite(year)) return undefined

  let hour = Number(match[4] ?? 0)
  const minute = Number(match[5] ?? 0)
  const second = Number(match[6] ?? 0)
  const meridiem = (match[7] ?? '').toLowerCase()
  if (meridiem === 'pm' && hour < 12) hour += 12
  if (meridiem === 'am' && hour === 12) hour = 0
  if (hour > 23 || minute > 59 || second > 59) return undefined

  const date = new Date(Date.UTC(year, month, day, hour, minute, second))
  // Date.UTC 会把 2 月 31 日滚到 3 月：回读一次确认日期未被改写。
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) return undefined
  return date.toISOString()
}

/**
 * 把来源返回的日期表达解析成 UTC ISO-8601。
 *
 * @param value - 来源返回的日期字段（可能是 RFC2822、ISO、英文日期、相对时间）。
 * @param now - 计算相对时间用的参考时刻，默认当前时间。
 * @returns ISO-8601 字符串；无权成为事实的取值返回 undefined。
 */
export function parsePublishedAt(value: unknown, now: Date = new Date()): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (text.length === 0) return undefined

  const relative = parseRelative(text, now)
  if (relative !== undefined) return relative

  const english = parseEnglishDate(text)
  if (english !== undefined) return english

  // 纯数字字符串在 `new Date()` 下会被当成毫秒时间戳，而来源不会这样表达日期：
  // 交给日期解析只会得到一个荒谬的结果，因此直接拒绝。
  if (/^\d+$/u.test(text)) return undefined

  const timestamp = Date.parse(text)
  if (Number.isNaN(timestamp)) return undefined
  return toIso(timestamp)
}
