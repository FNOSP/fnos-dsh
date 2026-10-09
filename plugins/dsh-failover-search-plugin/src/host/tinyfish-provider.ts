/**
 * TinyFish 搜索与用量适配。
 *
 * 上游契约（2026-10-09 用真实 key 实测，HTTP 200）：
 * - `GET https://api.search.tinyfish.ai`，鉴权头 `X-API-Key`，参数 `query` 必填；
 * - 响应 `{ query, results[], total_results, page }`，
 *   `results[]{ position, site_name, title, snippet, url, date }`；
 * - `date` 是自然语言或英文日期（实测 `"Nov 13, 2025"`），需要容错解析；
 * - 搜索在任意余额（含 0）下免费，限流默认 30 req/min/key；
 * - `GET https://agent.tinyfish.ai/v1/wallet`（免费）返回
 *   `available_balance`、`currency`、`as_of`、`auto_reload: { state }`、`rates.meters[]`。
 */
import type { WebSearchRequest, WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-web'
import { TINYFISH_RATE_LIMIT_PER_MINUTE, TINYFISH_SEARCH_ENDPOINT, TINYFISH_WALLET_ENDPOINT } from '../contracts/constants.ts'
import type { SourceAdapter, UsageAdapter, UsageReading } from '../contracts/types.ts'
import { parsePublishedAt } from './date.ts'
import { readNumber, readRecord, readString, requestJson } from './http.ts'

/** TinyFish 搜索响应里的一条结果。 */
interface TinyFishResult {
  readonly url?: unknown
  readonly title?: unknown
  readonly snippet?: unknown
  readonly date?: unknown
}

/**
 * 还原一条结果的目标地址。
 *
 * TinyFish 的 `url` **不总是绝对地址**：实测（2026-10-09）部分查询返回搜索平台自己的
 * 相对重定向包装，形如 `/url?opi=…&q=https://real-target&sa=U&ved=…`，其中 `q`
 * 参数才是真正的目标。接缝要求 `source.url` 是可引用的地址，把包装原样透传会让搜索
 * 卡片里的链接指向错误主机名，因此：
 *
 * - 绝对地址原样返回；
 * - 相对包装里能取到 `q` 目标时返回该目标（解码一层，如 `item%3Fid%3D` → `item?id=`）；
 * - 其余相对地址返回 undefined，由调用方跳过该条目——宁可少一条，也不给一条坏链接。
 *
 * @param raw - 来源返回的 url 字段。
 * @returns 可引用的绝对地址，或 undefined。
 */
export function resolveResultUrl(raw: unknown): string | undefined {
  const value = readString(raw)
  if (value === undefined || value.length === 0) return undefined
  if (isAbsoluteHttpUrl(value)) return value

  const target = readRedirectTarget(value)
  if (target === undefined) return undefined
  return isAbsoluteHttpUrl(target) ? target : undefined
}

/** 判断字符串是否为可用的绝对 http(s) 地址。 */
function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/** 从相对重定向包装里取目标地址；没有目标参数时返回 undefined。 */
function readRedirectTarget(value: string): string | undefined {
  const queryStart = value.indexOf('?')
  const query = queryStart === -1 ? '' : value.slice(queryStart + 1)
  for (const [key, entry] of new URLSearchParams(query)) {
    if (key !== 'q' && key !== 'url') continue
    if (entry.length === 0) continue
    // URLSearchParams 已解码一层；目标里再嵌套编码时（如 `item%3Fid%3D`）需要再解一次。
    const decoded = safeDecode(entry)
    if (isAbsoluteHttpUrl(decoded)) return decoded
    if (isAbsoluteHttpUrl(entry)) return entry
  }
  return undefined
}

/** 解码一层；非法编码序列时原样返回。 */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** 把一条 TinyFish 结果映射成接缝来源；无可引用地址的条目返回 undefined。 */
function toSource(entry: TinyFishResult, now: Date): WebSearchSource | undefined {
  const url = resolveResultUrl(entry.url)
  if (url === undefined) return undefined

  const source: {
    url: string
    title?: string
    snippet?: string
    publishedAt?: string
  } = { url }

  const title = readString(entry.title)
  if (title !== undefined && title.length > 0) source.title = title
  const snippet = readString(entry.snippet)
  if (snippet !== undefined && snippet.length > 0) source.snippet = snippet
  // 解析失败即省略 publishedAt：需求约定「按无日期呈现」，不产生乱码或占位。
  const publishedAt = parsePublishedAt(entry.date, now)
  if (publishedAt !== undefined) source.publishedAt = publishedAt

  return source
}

/** TinyFish 搜索适配器。 */
export class TinyFishAdapter implements SourceAdapter {
  readonly platform = 'tinyfish' as const

  /**
   * @param options - 注入面。
   * @param options.fetch - 替换网络实现（测试 seam；省略时用全局 fetch）。
   * @param options.now - 相对时间的参考时刻（测试 seam）。
   */
  constructor(private readonly options: { fetch?: typeof fetch, now?: () => Date } = {}) {}

  /**
   * 用指定 key 执行一次 TinyFish 搜索。
   * @param request - 接缝搜索请求。
   * @param apiKey - 本次尝试的账号 key。
   * @param signal - 上层取消信号。
   * @returns 归一后的接缝结果（数量截断留给接缝）。
   */
  async search(request: WebSearchRequest, apiKey: string, signal?: AbortSignal): Promise<WebSearchResult> {
    const url = new URL(TINYFISH_SEARCH_ENDPOINT)
    url.searchParams.set('query', request.query)

    const body = await requestJson(
      url.toString(),
      { method: 'GET', headers: { 'X-API-Key': apiKey } },
      { fetch: this.options.fetch, signal, platform: this.platform },
    )

    const results = readRecord(body).results
    if (!Array.isArray(results)) {
      // 结构不可识别时按空来源返回：TinyFish 没有结果就是没有结果，
      // 不是失败——失败已在 requestJson 的错误分类里处理。
      return { sources: [], truncated: false }
    }

    const now = this.options.now?.() ?? new Date()
    const sources = results
      .map(entry => toSource(readRecord(entry), now))
      .filter((source): source is WebSearchSource => source !== undefined)

    return { sources, truncated: false }
  }
}

/** TinyFish 钱包用量的展示适配器。 */
export class TinyFishUsageAdapter implements UsageAdapter {
  readonly platform = 'tinyfish' as const

  /**
   * @param options - 注入面。
   * @param options.fetch - 替换网络实现（测试 seam；省略时用全局 fetch）。
   */
  constructor(private readonly options: { fetch?: typeof fetch } = {}) {}

  /**
   * 查询一个账号的钱包余额与自动充值状态。
   *
   * 钱包端点失败不抛出：需求要求「用量端点查询失败时展示区给出可理解的失败提示，
   * 搜索功能不受影响」，因此失败在这里折成带 error 的读数。
   *
   * @param apiKey - 账号 key。
   * @param signal - 取消信号。
   * @returns 该账号的用量读数。
   */
  async fetchUsage(apiKey: string, signal?: AbortSignal): Promise<UsageReading> {
    try {
      const body = await requestJson(
        TINYFISH_WALLET_ENDPOINT,
        { method: 'GET', headers: { 'X-API-Key': apiKey } },
        { fetch: this.options.fetch, signal, platform: this.platform },
      )

      const record = readRecord(body)
      const balance = readString(record.available_balance) ?? '未知'
      const currency = readString(record.currency) ?? 'USD'
      const details: Record<string, string> = {
        balance: `${balance} ${currency}`,
      }

      const autoReload = readAutoReloadState(record.auto_reload)
      if (autoReload !== undefined) details.autoReload = autoReload

      // 搜索单价来自 rates.meters 里的 TinyFish Search 条目；缺失时不编造。
      const searchRate = readSearchRate(record.rates)
      if (searchRate !== undefined) details.searchRate = searchRate

      // TinyFish 搜索免费、无服务端额度概念：钱包余额不构成「额度不足」判定。
      return { details }
    } catch (error) {
      return { details: {}, error: error instanceof Error ? error.message : String(error) }
    }
  }
}

/** 读取自动充值状态；上游是 `{ state }` 对象，旧文档形态是字符串，两者都接受。 */
function readAutoReloadState(value: unknown): string | undefined {
  const fromObject = readString(readRecord(value).state)
  if (fromObject !== undefined) return fromObject
  return readString(value)
}

/** 从 `rates.meters[]` 里取搜索单价文本。 */
function readSearchRate(rates: unknown): string | undefined {
  const meters = readRecord(rates).meters
  if (!Array.isArray(meters)) return undefined
  for (const meter of meters) {
    const record = readRecord(meter)
    if (readString(record.label) !== 'TinyFish Search') continue
    const amount = readString(record.unit_amount) ?? readNumber(record.unit_amount)?.toString()
    const per = readString(record.per)
    if (amount === undefined) continue
    const currency = readString(record.currency) ?? 'USD'
    return per === undefined ? `${amount} ${currency}` : `${amount} ${currency}/${per}`
  }
  return undefined
}

/** 平台限流上限：用于本地限流窗口记账（按 key 计，实测文档 30 req/min）。 */
export const TINYFISH_LIMIT_PER_MINUTE = TINYFISH_RATE_LIMIT_PER_MINUTE
