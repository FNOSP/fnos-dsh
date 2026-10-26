import { createProxyMiddleware } from 'http-proxy-middleware'
import { createHash } from 'node:crypto'
import type { RequestHandler } from 'http-proxy-middleware'
import { request as httpRequest, type ClientRequest, type ServerResponse, type IncomingMessage } from 'node:http'
import type { GatewayOptions } from '../types/gateway.js'
import { applyProxyRequestHeaders, copyRequestHeaders } from '../middleware/request-headers.js'
import { copyResponseHeaders } from '../middleware/response-headers.js'
import { rewriteHtml, rewriteCss, rewriteJavaScript } from '../middleware/content-rewrite.js'
import { gatewayBridgeScript } from './bridge-script.js'
import { attachSseKeepalive } from '../middleware/sse-keepalive.js'
import { BAD_GATEWAY_MESSAGE } from '../constants/index.js'
import { recoveryPage } from './recovery-page.js'
import {
  DSH_SESSION_COOKIE_PREFIX,
  browserSessionCookieNames,
  withSessionCookie,
  withoutSessionCookies,
  type UpstreamSession,
} from './upstream-session.js'

function sendBadGateway(res: ServerResponse, error: unknown, options?: GatewayOptions, req?: IncomingMessage): void {
  if (res.headersSent || res.writableEnded || res.destroyed) {
    res.destroy()
    return
  }
  const message = error instanceof Error ? error.message : String(error)
  if (options?.webProcess !== undefined && req?.method === 'GET' && String(req.headers.accept ?? '').includes('text/html')) {
    const html = recoveryPage(options.gatewayPrefix, message)
    res.writeHead(503, { 'content-type': 'text/html; charset=utf-8', 'content-length': String(Buffer.byteLength(html)) })
    res.end(html)
    return
  }
  res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
  res.end(`${BAD_GATEWAY_MESSAGE}: ${message}`)
}

function isImageResourceRequest(req: IncomingMessage): boolean {
  const pathname = (req.url ?? '').split('?', 1)[0] ?? ''
  return /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp)$/iu.test(pathname)
}

/** Whether the request targets DSH's application index document. */
function isIndexRequest(req: IncomingMessage): boolean {
  if (req.method !== 'GET') return false
  const pathname = (req.url ?? '').split('?', 1)[0] ?? ''
  return pathname === '' || pathname === '/'
}

/**
 * The DSH browser-session cookie name is bound to the loopback Host authority.
 *
 * 导出供测试按同一规则构造「已持 cookie」的请求；生产调用点只有本模块。
 */
export function browserSessionCookieName(upstreamHost: string, upstreamPort: number): string {
  return `dsh-auth-${createHash('sha256').update(`${upstreamHost}:${String(upstreamPort)}`).digest('base64url')}`
}

/** Path used by gateway releases that incorrectly scoped DSH cookies to the app mount. */
function legacyCookieMountPath(gatewayPrefix: string): string | undefined {
  const prefix = gatewayPrefix.replace(/^\/+|\/+$/gu, '')
  return prefix === '' ? undefined : `/${prefix}/`
}

/** 清除浏览器里旧版本网关留下的会话 Cookie：根路径与旧版挂载路径各一条过期指令。 */
function expireBrowserSessionCookies(names: string[], gatewayPrefix: string): string[] {
  const paths = ['/', legacyCookieMountPath(gatewayPrefix)].filter((path): path is string => path !== undefined)
  return names.flatMap(name => paths.map(path => `${name}=; Max-Age=0; Path=${path}; HttpOnly; SameSite=Strict`))
}

function stripLaunchTokenFromLocation(value: string): string {
  try {
    const url = new URL(value, 'http://fnos-gateway.invalid')
    if (!url.searchParams.has('token')) return value
    url.searchParams.delete('token')
    return `${url.pathname || '/'}${url.search}${url.hash}`
  } catch {
    return value
  }
}

export function createProxyHandler(options: GatewayOptions, session: UpstreamSession): RequestHandler {
  const { upstreamHost, upstreamPort, gatewayPrefix, sseKeepaliveInterval = 15_000 } = options
  // 网关托管 DSH Web 时会话由网关持有（FNOS-030）；未托管时（外部启动的 DSH）浏览器 Cookie 原样透传。
  const managed = options.webProcess !== undefined
  // 每个上游请求实际附带的会话，用于 401 时只丢弃那一枚。
  const sessionUsed = new WeakMap<IncomingMessage, string>()

  /** 上游请求的 Cookie：去掉浏览器的 `dsh-auth-*`，附上网关会话。 */
  const applySessionCookie = (proxyReq: ClientRequest, req: IncomingMessage): void => {
    if (!managed) return
    const held = session.current()
    const cookie = held === undefined ? withoutSessionCookies(req.headers.cookie) : withSessionCookie(req.headers.cookie, held)
    if (held !== undefined) sessionUsed.set(req, held)
    if (cookie === '') proxyReq.removeHeader('cookie')
    else proxyReq.setHeader('cookie', cookie)
  }

  /** 下游响应：会话 Cookie 不下发浏览器；浏览器带来的旧会话 Cookie 一并清除。 */
  const applyBrowserCookieHeaders = (headers: Record<string, string | string[]>, req: IncomingMessage): void => {
    const upstream = headers['set-cookie']
    const kept = (upstream === undefined ? [] : Array.isArray(upstream) ? upstream : [upstream])
      .filter(cookie => !cookie.trimStart().startsWith(DSH_SESSION_COOKIE_PREFIX))
    const cookies = [...kept, ...expireBrowserSessionCookies(browserSessionCookieNames(req.headers.cookie), gatewayPrefix)]
    if (cookies.length === 0) delete headers['set-cookie']
    else headers['set-cookie'] = cookies
  }

  const writeUpstreamResponse = (proxyRes: IncomingMessage, req: IncomingMessage, res: ServerResponse): void => {
    const contentType = String(proxyRes.headers['content-type'] || '').toLowerCase()
    const eventStream = contentType.startsWith('text/event-stream')
    // A plugin may return a fallback HTML document for a missing asset.
    // Never run that response through the HTML rewriter for an image URL;
    // preserve the upstream status, body, and headers for the browser.
    const imageResource = isImageResourceRequest(req)
    const rewriteBody = !eventStream
      && !imageResource
      && (
      contentType.includes('text/html')
      || contentType.includes('text/css')
      || contentType.includes('javascript')
      )
    const headers = copyResponseHeaders(proxyRes.headers, {
      rewriteBody,
      eventStream,
      gatewayPrefix,
    })
    if (typeof headers.location === 'string') headers.location = stripLaunchTokenFromLocation(headers.location)
    if (managed) applyBrowserCookieHeaders(headers, req)

    if (!rewriteBody) {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.statusMessage, headers)
      if (eventStream) {
        res.flushHeaders()
        attachSseKeepalive(res, { interval: sseKeepaliveInterval })
      }
      proxyRes.pipe(res)
      return
    }

    const chunks: Buffer[] = []
    proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk))
    proxyRes.on('error', (error: unknown) => sendBadGateway(res, error))
    proxyRes.on('end', () => {
      const rawBody = Buffer.concat(chunks)
      let rewrittenBody: string
      if (contentType.includes('text/html')) {
        const bridgeScript = gatewayBridgeScript({
          prefix: gatewayPrefix,
          customPaths: options.pathAllowlist?.snapshot().paths ?? [],
          eventsPath: '/__fnos-gateway/path-allowlist/events',
        })
        rewrittenBody = rewriteHtml(rawBody, gatewayPrefix, bridgeScript)
      } else if (contentType.includes('text/css')) {
        rewrittenBody = rewriteCss(rawBody, gatewayPrefix)
      } else {
        rewrittenBody = rewriteJavaScript(rawBody, req.url || '/', gatewayPrefix)
      }
      const body = Buffer.from(rewrittenBody)
      headers['content-length'] = String(body.length)
      res.writeHead(proxyRes.statusCode || 502, proxyRes.statusMessage, headers)
      res.end(body)
    })
  }

  /**
   * DSH 拒绝了网关会话后重放首页一次：换取新会话后按原地址再请求。
   * 只重放一次，仍被拒时把这次响应原样交给浏览器，不会循环。
   */
  const replayIndexWithFreshSession = (req: IncomingMessage, res: ServerResponse, fresh: string): void => {
    const headers = copyRequestHeaders(req, { host: upstreamHost, port: upstreamPort })
    headers.cookie = withSessionCookie(req.headers.cookie, fresh)
    const request = httpRequest({ host: upstreamHost, port: upstreamPort, method: 'GET', path: req.url ?? '/', headers }, upstreamResponse => {
      if (upstreamResponse.statusCode === 401) session.invalidate(fresh)
      writeUpstreamResponse(upstreamResponse, req, res)
    })
    request.on('error', error => sendBadGateway(res, error, options, req))
    request.end()
  }

  return createProxyMiddleware({
    target: `http://${upstreamHost}:${upstreamPort}`,
    ws: true,
    changeOrigin: false,
    selfHandleResponse: true,
    on: {
      proxyReq: (proxyReq, req) => {
        applyProxyRequestHeaders(proxyReq, req, { host: upstreamHost, port: upstreamPort })
        applySessionCookie(proxyReq, req)
      },
      // 升级走同步代理路径，不能在这里等待换取；会话由启动后的预热和先行的 HTTP 请求备好。
      proxyReqWs: (proxyReq, req) => {
        applyProxyRequestHeaders(proxyReq, req, { host: upstreamHost, port: upstreamPort })
        applySessionCookie(proxyReq, req)
      },
      proxyRes: (proxyRes, req, res) => {
        if (managed && proxyRes.statusCode === 401) {
          session.invalidate(sessionUsed.get(req))
          if (isIndexRequest(req)) {
            void session.ensure().catch(() => undefined).then(fresh => {
              if (fresh === undefined) {
                writeUpstreamResponse(proxyRes, req, res)
                return
              }
              proxyRes.resume()
              replayIndexWithFreshSession(req, res, fresh)
            })
            return
          }
        }
        writeUpstreamResponse(proxyRes, req, res)
      },
      error: (err, _req, res) => {
        const target = res as ServerResponse | undefined
        if (target && typeof target.writeHead === 'function') {
          sendBadGateway(target, err, options, _req)
        }
      },
    },
  })
}
