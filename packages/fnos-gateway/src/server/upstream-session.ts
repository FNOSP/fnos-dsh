import { request as httpRequest } from 'node:http'
import type { WebProcessController } from './web-process.js'

/** DSH 浏览器会话 Cookie 的名字前缀；名字其余部分由上游权威派生。 */
export const DSH_SESSION_COOKIE_PREFIX = 'dsh-auth-'

/** 换取会话的默认超时；上游挂起时不让首个请求无限等待。 */
const DEFAULT_EXCHANGE_TIMEOUT_MS = 10_000

export interface UpstreamSessionOptions {
  upstreamHost: string
  upstreamPort: number
  /** 与上游权威对应的会话 Cookie 名（`browserSessionCookieName`）。 */
  cookieName: string
  webProcess?: Pick<WebProcessController, 'getLaunchToken'> & Partial<Pick<WebProcessController, 'waitForLaunchToken'>>
  /** 换取会话的请求超时，默认 10 秒。 */
  exchangeTimeoutMs?: number
}

/**
 * 网关持有的 DSH 浏览器会话（FNOS-030）。
 *
 * DSH 的会话 Cookie 带 `SameSite=Strict`，与 NAS 不同站的 App 套壳里浏览器不保存它；
 * 因此由网关用启动 Token 换取一次，存在内存里，替每个上游请求附带。
 * 只存内存、不落盘；DSH 的签名密钥持久保存，网关重启后重新换取即可。
 */
export class UpstreamSession {
  private cookie: string | undefined
  private minting: Promise<string | undefined> | undefined

  constructor(private readonly options: UpstreamSessionOptions) {}

  /** 当前持有的会话（`名=值`），尚未换取时为 undefined。 */
  current(): string | undefined {
    return this.cookie
  }

  /** 返回可用会话；没有时换取一次，并发调用共享同一次换取。Token 未就绪或换取失败时为 undefined。 */
  async ensure(): Promise<string | undefined> {
    if (this.cookie !== undefined) return this.cookie
    this.minting ??= this.mint().finally(() => { this.minting = undefined })
    return await this.minting
  }

  /** DSH 拒绝了 `stale` 时丢弃它；已被并发换取替换的新会话不受影响。 */
  invalidate(stale: string | undefined): void {
    if (stale !== undefined && this.cookie === stale) this.cookie = undefined
  }

  private async mint(): Promise<string | undefined> {
    const webProcess = this.options.webProcess
    if (webProcess === undefined) return undefined
    const token = webProcess.getLaunchToken() ?? await webProcess.waitForLaunchToken?.()
    if (token === undefined || token === '') return undefined
    const cookie = await this.exchange(token).catch(() => undefined)
    if (cookie !== undefined) this.cookie = cookie
    return cookie
  }

  /** 以 `GET /?token=` 向 DSH 换取会话；Host 必须是 loopback 权威，Cookie 绑定它。 */
  private exchange(token: string): Promise<string | undefined> {
    const { upstreamHost, upstreamPort, cookieName } = this.options
    const timeoutMs = this.options.exchangeTimeoutMs ?? DEFAULT_EXCHANGE_TIMEOUT_MS
    return new Promise((resolve, reject) => {
      const request = httpRequest({
        host: upstreamHost,
        port: upstreamPort,
        method: 'GET',
        path: `/?token=${encodeURIComponent(token)}`,
        headers: { host: `${upstreamHost}:${String(upstreamPort)}` },
      }, response => {
        response.resume()
        const setCookie = response.headers['set-cookie'] ?? []
        const pair = setCookie.map(value => value.split(';', 1)[0]?.trim() ?? '').find(value => value.startsWith(`${cookieName}=`))
        resolve(pair)
      })
      // 上游挂起时按时放弃：换取失败不缓存，后续请求可重试。
      request.setTimeout(timeoutMs, () => request.destroy(new Error('upstream session exchange timed out')))
      request.on('error', reject)
      request.end()
    })
  }
}

/** 浏览器 Cookie 去掉所有 `dsh-auth-*` 项；其它 Cookie 原样保留。 */
export function withoutSessionCookies(browserCookie: string | string[] | undefined): string {
  return (Array.isArray(browserCookie) ? browserCookie.join('; ') : browserCookie ?? '')
    .split(';')
    .map(pair => pair.trim())
    .filter(pair => pair !== '' && !pair.startsWith(DSH_SESSION_COOKIE_PREFIX))
    .join('; ')
}

/** 浏览器 Cookie 去掉所有 `dsh-auth-*` 项后附上网关会话。 */
export function withSessionCookie(browserCookie: string | string[] | undefined, session: string): string {
  return [withoutSessionCookies(browserCookie), session].filter(part => part !== '').join('; ')
}

/** 浏览器 Cookie 中出现的 `dsh-auth-*` 名字（旧版本网关留下的）。 */
export function browserSessionCookieNames(browserCookie: string | string[] | undefined): string[] {
  const names = (Array.isArray(browserCookie) ? browserCookie.join('; ') : browserCookie ?? '')
    .split(';')
    .map(pair => pair.trim().split('=', 1)[0] ?? '')
    .filter(name => name.startsWith(DSH_SESSION_COOKIE_PREFIX))
  return [...new Set(names)]
}
