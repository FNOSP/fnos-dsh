/**
 * 来源适配器共用的 HTTP 与取值读取工具。
 *
 * 这一层只做三件事：发请求并分类失败、把未知 JSON 安全地读成期望形状、
 * 生成**不含 key** 的错误文本。字段映射留给各平台适配器。
 */
import { WebError } from '@deepseek-ai/dsh-web'
import { WEB_ABORTED, WEB_PROVIDER_ERROR } from './web-error.ts'

/** 请求的可注入依赖与上下文。 */
export interface RequestOptions {
  /** fetch 实现；省略时用全局 fetch（测试注入 seam）。 */
  readonly fetch?: typeof fetch | undefined
  /** 上层取消信号。 */
  readonly signal?: AbortSignal | undefined
  /** 平台 id，进入错误信息用于排障。 */
  readonly platform: string
}

/**
 * 发送一次请求并把响应解析成 JSON。
 *
 * 失败分类（供转移链判定「这一级失败、该换下一级」）：
 * - 用户中止（signal 已 abort）→ `WEB_ABORTED`，复合提供方直接上抛；
 * - 网络错误、非 2xx、响应体不是 JSON → `WEB_PROVIDER_ERROR`。
 *
 * 错误文本只包含平台、状态码与响应片段，**不含 key 与完整 query**
 * （需求的行为约束：key 全程不以明文出现在会话记录中）。
 *
 * @param url - 完整请求 URL。
 * @param init - fetch 参数（方法、头、体）；`signal` 由本函数附加。
 * @param options - fetch 实现、取消信号与平台标识。
 * @returns 解析后的响应体。
 * @throws {WebError} 上述分类下的错误。
 */
export async function requestJson(
  url: string,
  init: Omit<RequestInit, 'signal'>,
  options: RequestOptions,
): Promise<unknown> {
  const fetchImpl = options.fetch ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') {
    throw new WebError(`${options.platform} 适配缺少 fetch 实现`, WEB_PROVIDER_ERROR)
  }

  let response: Response
  try {
    response = await fetchImpl(url, { ...init, ...(options.signal === undefined ? {} : { signal: options.signal }) })
  } catch (error) {
    throw normalizeFetchFailure(error, options, url)
  }

  if (!response.ok) {
    const detail = await safeSnippet(response)
    throw new WebError(`${options.platform} 返回 HTTP ${response.status}${detail}`, WEB_PROVIDER_ERROR)
  }

  const text = await response.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new WebError(`${options.platform} 响应不是 JSON`, WEB_PROVIDER_ERROR)
  }
}

/** 把 fetch 抛出的错误折成接缝错误分类；用户中止保持 `WEB_ABORTED` 码。 */
function normalizeFetchFailure(error: unknown, options: RequestOptions, url: string): WebError {
  const aborted = options.signal?.aborted === true
    || (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError'))
  if (aborted) return new WebError('搜索已取消', WEB_ABORTED, { cause: error })

  const reason = error instanceof Error ? error.message : String(error)
  // 只报主机名，不把可能带参数的完整 URL 抄进错误文本。
  const host = safeHost(url)
  return new WebError(`${options.platform} 请求 ${host} 失败：${reason}`, WEB_PROVIDER_ERROR, { cause: error })
}

/** 读取 URL 的主机名；解析失败时返回占位文本。 */
function safeHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return '端点'
  }
}

/** 读取响应体前 200 字符作为失败线索，读取本身失败时返回空串。 */
async function safeSnippet(response: Response): Promise<string> {
  try {
    const text = await response.text()
    const trimmed = text.trim()
    return trimmed.length === 0 ? '' : `：${trimmed.slice(0, 200)}`
  } catch {
    return ''
  }
}

/** 把未知取值读成记录；不是记录时返回空记录。 */
export function readRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

/** 把未知取值读成字符串；非字符串或空串返回 undefined。 */
export function readString(value: unknown): string | undefined {
  if (typeof value === 'string') return value.length === 0 ? undefined : value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

/** 把未知取值读成有限数字；否则返回 undefined。 */
export function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}
