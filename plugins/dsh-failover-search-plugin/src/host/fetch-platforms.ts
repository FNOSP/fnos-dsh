/**
 * 平台网页抓取适配器（FNOS-010-11）。
 *
 * 两个平台都提供独立于搜索的内容抓取端点，抓取发生在**平台服务端**，不受用户
 * 本机 DNS/代理/反爬影响——这是它们能兜底 `web_fetch` 的根本原因：
 *
 * - TinyFish Fetch：`POST https://api.fetch.tinyfish.ai`，body `{"urls":[...]}`；
 *   服务端真浏览器渲染后返回干净正文（`results[].text`），对 JS 重度页面可用。
 *   Search 与 Fetch 全计划免费（Fetch 限 150 URL/分钟）。
 * - Tavily Extract：`POST https://api.tavily.com/extract`，body `{"urls":[...]}`；
 *   返回 `results[].raw_content`。basic 抽取计 1 credit / 5 个成功 URL，消耗套餐
 *   配额——这是它排在 TinyFish 之后的次序依据。
 *
 * 归一目标：适配器把平台响应收敛成接缝的 `WebFetchResult`（`body.kind: 'text'`），
 * 让模型侧 `web_fetch` 的使用方式与本地抓取无差异（AC-03）。
 */
import type { WebFetchRequest, WebFetchResult } from '@deepseek-ai/dsh-web'
import { WebError } from '@deepseek-ai/dsh-web'

/** 归一平台返回的正文：空视为失败（平台 200 但没有可用内容）。 */
export function normalizeExtractedText(text: string, platform: string): string {
  if (text.trim().length === 0) {
    throw new WebError(`${platform} fetch returned empty content`, 'WEB_PROVIDER_ERROR')
  }
  return text
}

/** 从平台错误响应里提取可读原因，并**剥离 key**（脱敏红线）。 */
function readErrorDetail(body: string, apiKey: string): string {
  const detail = body.replaceAll(apiKey, '***').slice(0, 300)
  return detail.length > 0 ? detail : '(no body)'
}

/** 平台抓取适配器的公共请求面（便于测试注入 fetch 实现）。 */
export interface PlatformFetchAdapterOptions {
  readonly apiKey: string
  readonly endpoint: string
  readonly fetchImpl?: typeof fetch
}

/** TinyFish Fetch 适配器：创建一个只做「取一个 URL」的后端。 */
export function createTinyfishFetchAdapter(options: PlatformFetchFetchOptions): TinyfishFetchAdapter {
  return new TinyfishFetchAdapter(options)
}

/** Tavily Extract 适配器：创建一个只做「取一个 URL」的后端。 */
export function createTavilyExtractAdapter(options: PlatformFetchAdapterOptions): TavilyExtractAdapter {
  return new TavilyExtractAdapter(options)
}

/** TinyFish Fetch 适配的选项（别名保持调用点语义清晰）。 */
export type PlatformFetchFetchOptions = PlatformFetchAdapterOptions

/** TinyFish Fetch：服务端渲染后返回 `results[].text`。 */
export class TinyfishFetchAdapter {
  readonly #apiKey: string
  readonly #endpoint: string
  readonly #fetchImpl: typeof fetch

  constructor(options: PlatformFetchAdapterOptions) {
    this.#apiKey = options.apiKey
    this.#endpoint = options.endpoint
    this.#fetchImpl = options.fetchImpl ?? fetch
  }

  /**
   * TinyFish 账号可用即后端可用（账号存在性由账号池保证）。
   *
   * 绑定到实例：复合 provider 会把 `available` 取出后单独调用，方法引用一旦
   * 脱离实例，私有字段访问就抛 TypeError。
   */
  available = (): boolean => this.#apiKey.trim().length > 0

  /**
   * 取回一个 URL；平台失败抛带可读原因的 `WEB_PROVIDER_ERROR`。
   *
   * 与 `available` 同理绑定实例：复合 provider 把方法与后端对象分离后调用。
   */
  fetch = async (request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> => {
    if (signal?.aborted) throw new WebError('web fetch aborted', 'WEB_ABORTED')
    let response: Response
    try {
      response = await this.#fetchImpl(this.#endpoint, {
        method: 'POST',
        headers: { 'X-API-Key': this.#apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: [request.url] }),
        ...(signal === undefined ? {} : { signal }),
      })
    } catch (error) {
      if (signal?.aborted) throw new WebError('web fetch aborted', 'WEB_ABORTED')
      throw new WebError(`tinyfish fetch failed: ${error instanceof Error ? error.message : String(error)}`, 'WEB_PROVIDER_ERROR')
    }

    if (!response.ok) {
      const detail = readErrorDetail(await response.text().catch(() => ''), this.#apiKey)
      throw new WebError(`tinyfish fetch returned HTTP ${response.status}: ${detail}`, 'WEB_PROVIDER_ERROR')
    }

    const payload = (await response.json().catch(() => undefined)) as { results?: { url?: string, text?: string }[], failed_results?: { url?: string, error?: string }[] } | undefined
    const failed = payload?.failed_results?.[0]
    if (failed?.error !== undefined) {
      throw new WebError(`tinyfish fetch failed: ${failed.error}`, 'WEB_PROVIDER_ERROR')
    }
    const hit = payload?.results?.find(entry => entry.url === request.url) ?? payload?.results?.[0]
    const text = hit?.text ?? ''
    const content = normalizeExtractedText(text, 'tinyfish')
    return { url: request.url, statusCode: 200, body: { kind: 'text', content }, truncated: false }
  }
}

/** Tavily Extract：返回 `results[].raw_content`。 */
export class TavilyExtractAdapter {
  readonly #apiKey: string
  readonly #endpoint: string
  readonly #fetchImpl: typeof fetch

  constructor(options: PlatformFetchAdapterOptions) {
    this.#apiKey = options.apiKey
    this.#endpoint = options.endpoint
    this.#fetchImpl = options.fetchImpl ?? fetch
  }

  /** Tavily 账号可用即后端可用（绑定实例，理由同 TinyFish 侧）。 */
  available = (): boolean => this.#apiKey.trim().length > 0

  /** 取回一个 URL；平台失败抛带可读原因的 `WEB_PROVIDER_ERROR`（绑定实例，理由同上）。 */
  fetch = async (request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> => {
    if (signal?.aborted) throw new WebError('web fetch aborted', 'WEB_ABORTED')
    let response: Response
    try {
      response = await this.#fetchImpl(this.#endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.#apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: [request.url] }),
        ...(signal === undefined ? {} : { signal }),
      })
    } catch (error) {
      if (signal?.aborted) throw new WebError('web fetch aborted', 'WEB_ABORTED')
      throw new WebError(`tavily extract failed: ${error instanceof Error ? error.message : String(error)}`, 'WEB_PROVIDER_ERROR')
    }

    if (!response.ok) {
      const detail = readErrorDetail(await response.text().catch(() => ''), this.#apiKey)
      throw new WebError(`tavily extract returned HTTP ${response.status}: ${detail}`, 'WEB_PROVIDER_ERROR')
    }

    const payload = (await response.json().catch(() => undefined)) as { results?: { url?: string, raw_content?: string }[], failed_results?: { url?: string }[] } | undefined
    const hit = payload?.results?.find(entry => entry.url === request.url) ?? payload?.results?.[0]
    const content = normalizeExtractedText(hit?.raw_content ?? '', 'tavily')
    return { url: request.url, statusCode: 200, body: { kind: 'text', content }, truncated: false }
  }
}
