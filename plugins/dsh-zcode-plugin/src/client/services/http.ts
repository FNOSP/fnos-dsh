/**
 * 插件同源 HTTP 路由的请求收口。
 *
 * 所有路由的非 2xx 响应都是 `{ error: string }`（见宿主 `host/routes.ts`），
 * 这里把错误码与文案一起抛给界面；界面按需把已知错误码换成 locale 文案。
 *
 * @module dsh-zcode/client/http
 */

/** 宿主拒绝跨站请求时返回的错误码（与 `host/routes.ts` 同名常量一致）。 */
export const ZCODE_ORIGIN_NOT_TRUSTED = 'remote-web-origin-not-trusted'

/** 带宿主错误码的请求失败；`message` 可直接展示给用户。 */
export class ZCodeRequestError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ZCodeRequestError'
    this.code = code
  }
}

/** 从错误响应里取出可读文案：优先宿主给的 `error`，否则退回 HTTP 状态码。 */
function responseMessage(value: unknown, status: number): string {
  if (value !== null && typeof value === 'object' && 'error' in value) {
    const message = (value as { error?: unknown }).error
    if (typeof message === 'string' && message.length > 0) return message
  }
  return `HTTP ${status}`
}

/**
 * 请求一个插件路由并解析 JSON。
 *
 * `credentials: 'same-origin'` 让 fnOS iframe 与独立浏览器两种形态都带上
 * 同源 Cookie 语义；`cache: 'no-store'` 避免状态/额度被中间层缓存。
 *
 * @param path - `contracts/routes.ts` 里的路径常量。
 * @param method - HTTP 方法。
 * @param body - 可选的 JSON 请求体。
 * @returns 解析后的响应体。
 * @throws {ZCodeRequestError} 非 2xx 时抛出带宿主错误码的异常。
 */
export async function requestJson<T>(
  path: string,
  method: 'GET' | 'POST' | 'PUT' = 'GET',
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' }
  if (body !== undefined) headers['content-type'] = 'application/json'
  const response = await fetch(path, {
    method,
    headers,
    cache: 'no-store',
    credentials: 'same-origin',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const value: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    const message = responseMessage(value, response.status)
    throw new ZCodeRequestError(message, message)
  }
  return value as T
}

/** 把任意异常收敛成可展示文案。 */
export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.length > 0) return error.message
  if (typeof error === 'string' && error.length > 0) return error
  return fallback
}

/** 该异常是否来自「浏览器来源不受信任」。 */
export function isOriginNotTrusted(error: unknown): boolean {
  return error instanceof ZCodeRequestError && error.code === ZCODE_ORIGIN_NOT_TRUSTED
}
