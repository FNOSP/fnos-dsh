/**
 * Tavily 搜索与用量适配。
 *
 * 上游契约（2026-10-09 用真实 key 实测，HTTP 200）：
 * - `POST https://api.tavily.com/search`，鉴权头 `Authorization: Bearer tvly-...`；
 * - 参数：`query`、`search_depth`（basic/advanced）、`max_results`、`include_answer` 等；
 * - 响应 `{ query, answer, results[], response_time, request_id }`，
 *   `results[]{ url, title, content, score, raw_content, id }`（**该版本没有 usage 字段**）；
 * - `content` 是摘要来源（映射到接缝 `snippet`）；`published_date` 为 RFC2822；
 * - basic 深度每次 1 credit；`include_answer` 第一版不开启（省 credit 与延迟）。
 * - `GET https://api.tavily.com/usage`（免费）返回两层结构：`key` 层与 `account` 层；
 *   该版本 `key.limit` 为 null，`account.plan_limit` 才是硬上限。
 */
import type { WebSearchRequest, WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-web'
import { TAVILY_SEARCH_ENDPOINT, TAVILY_USAGE_ENDPOINT } from '../contracts/constants.ts'
import type { SourceAdapter, UsageAdapter, UsageReading } from '../contracts/types.ts'
import { TAVILY_DEFAULT_SEARCH_DEPTH } from './constants.ts'
import { parsePublishedAt } from './date.ts'
import { readNumber, readRecord, readString, requestJson } from './http.ts'

/** Tavily 搜索响应里的一条结果。 */
interface TavilyResult {
  readonly url?: unknown
  readonly title?: unknown
  readonly content?: unknown
  readonly published_date?: unknown
}

/**
 * 把一条 Tavily 结果映射成接缝来源；无可引用地址的条目返回 undefined。
 *
 * 只接受绝对 http(s) 地址：接缝要求 `source.url` 可被引用，相对地址会让搜索卡片
 * 指向错误主机。Tavily 实测返回绝对地址，这里做的是防御性校验而不是格式转换。
 */
function toSource(entry: TavilyResult, now: Date): WebSearchSource | undefined {
  const url = readString(entry.url)
  if (url === undefined || !isAbsoluteHttpUrl(url)) return undefined

  const source: {
    url: string
    title?: string
    snippet?: string
    publishedAt?: string
  } = { url }

  const title = readString(entry.title)
  if (title !== undefined && title.length > 0) source.title = title
  // Tavily 的 `content` 就是摘要；接缝字段名是 snippet。
  const snippet = readString(entry.content)
  if (snippet !== undefined && snippet.length > 0) source.snippet = snippet
  const publishedAt = parsePublishedAt(entry.published_date, now)
  if (publishedAt !== undefined) source.publishedAt = publishedAt

  return source
}

/** 判断字符串是否为可用的绝对 http(s) 地址。 */
function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/** Tavily 搜索适配器。 */
export class TavilyAdapter implements SourceAdapter {
  readonly platform = 'tavily' as const

  /**
   * @param options - 注入面。
   * @param options.fetch - 替换网络实现（测试 seam；省略时用全局 fetch）。
   * @param options.now - 相对时间的参考时刻（测试 seam）。
   */
  constructor(private readonly options: { fetch?: typeof fetch, now?: () => Date } = {}) {}

  /**
   * 用指定 key 执行一次 Tavily 搜索。
   * @param request - 接缝搜索请求；`maxResults` 会作为请求级裁剪透传。
   * @param apiKey - 本次尝试的账号 key。
   * @param signal - 上层取消信号。
   * @returns 归一后的接缝结果。
   */
  async search(request: WebSearchRequest, apiKey: string, signal?: AbortSignal): Promise<WebSearchResult> {
    const payload: Record<string, unknown> = {
      query: request.query,
      search_depth: TAVILY_DEFAULT_SEARCH_DEPTH,
    }
    // 接缝负责最终截断；这里透传是省 credit 与延迟的请求级优化。
    if (request.maxResults !== undefined) payload.max_results = request.maxResults

    const body = await requestJson(
      TAVILY_SEARCH_ENDPOINT,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      { fetch: this.options.fetch, signal, platform: this.platform },
    )

    const results = readRecord(body).results
    if (!Array.isArray(results)) return { sources: [], truncated: false }

    const now = this.options.now?.() ?? new Date()
    const sources = results
      .map(entry => toSource(readRecord(entry), now))
      .filter((source): source is WebSearchSource => source !== undefined)

    // `answer` 不映射为 content：第一版不开启 include_answer，摘要不在本次请求范围内。
    return { sources, truncated: false }
  }
}

/** Tavily 用量（账户用量端点）适配器。 */
export class TavilyUsageAdapter implements UsageAdapter {
  readonly platform = 'tavily' as const

  /**
   * @param options - 注入面。
   * @param options.fetch - 替换网络实现（测试 seam；省略时用全局 fetch）。
   */
  constructor(private readonly options: { fetch?: typeof fetch } = {}) {}

  /**
   * 查询一个账号的 key 级与账户级用量。
   *
   * 账户配额耗尽（`plan_usage >= plan_limit`）时标记 `exhausted`：账号池据此在
   * 请求前排除**该账户的全部 key**（Tavily 配额按账户计，同账户多 key 不扩容）。
   *
   * @param apiKey - 账号 key。
   * @param signal - 取消信号。
   * @returns 该账号的用量读数；失败时携带 error 而不是抛出。
   */
  async fetchUsage(apiKey: string, signal?: AbortSignal): Promise<UsageReading> {
    try {
      const body = await requestJson(
        TAVILY_USAGE_ENDPOINT,
        { method: 'GET', headers: { Authorization: `Bearer ${apiKey}` } },
        { fetch: this.options.fetch, signal, platform: this.platform },
      )

      const record = readRecord(body)
      const keyLayer = readRecord(record.key)
      const accountLayer = readRecord(record.account)
      const details: Record<string, string> = {}

      const keyUsage = readNumber(keyLayer.usage)
      if (keyUsage !== undefined) details.keyUsage = String(keyUsage)

      const plan = readString(accountLayer.current_plan)
      if (plan !== undefined) details.plan = plan

      const planUsage = readNumber(accountLayer.plan_usage)
      const planLimit = readNumber(accountLayer.plan_limit)
      if (planUsage !== undefined) {
        details.planUsage = planLimit === undefined ? String(planUsage) : `${planUsage} / ${planLimit}`
      }

      const paygoLimit = readNumber(accountLayer.paygo_limit)
      if (paygoLimit !== undefined) {
        const paygoUsage = readNumber(accountLayer.paygo_usage) ?? 0
        details.paygoUsage = `${paygoUsage} / ${paygoLimit}`
      }

      const exhausted = planUsage !== undefined && planLimit !== undefined ? planUsage >= planLimit : undefined
      return exhausted === undefined ? { details } : { details, exhausted }
    } catch (error) {
      return { details: {}, error: error instanceof Error ? error.message : String(error) }
    }
  }
}
