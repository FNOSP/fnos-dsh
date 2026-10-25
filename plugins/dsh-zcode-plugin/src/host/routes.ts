/**
 * 插件同源 Web 路由。
 *
 * 浏览器只通过这里读写状态：账号凭据、模型目录与额度都留在宿主侧，响应体
 * 里没有 token。变更类请求先做同源/本机校验，与其它账号插件保持同一套信任
 * 边界。
 *
 * 登录入口只接受家族名（`bigmodel` / `zai`），不提供 API Key 形态。
 *
 * @module dsh-zcode/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { ZCodeCatalog } from '../contracts/catalog.ts'
import { ZCODE_FAMILIES, type ZCodeFamily } from '../contracts/identity.ts'
import { ZCODE_ROUTES } from '../contracts/routes.ts'
import type { ZCodeAuthService } from './auth.ts'
import type { ZCodeCatalogService } from './catalog.ts'
import type { ZCodePreferencesStore } from './preferences.ts'
import type { ZCodeRouteStatus } from './provider.ts'
import type { ZCodeUsageService } from './usage.ts'

/** 请求体上限：只有少量表单字段。 */
const REQUEST_BODY_LIMIT = 16 * 1024

/** 来源不受信任时的错误码（与客户端文案对应）。 */
export const ZCODE_ORIGIN_NOT_TRUSTED = 'remote-web-origin-not-trusted'
/** 目录刷新失败的错误码。 */
export const ZCODE_CATALOG_UNAVAILABLE = 'zcode-catalog-unavailable'

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name]
  return Array.isArray(value) ? value[0] : value
}

function firstForwarded(value: string | undefined): string | undefined {
  return value?.split(',')[0]?.trim() || undefined
}

function requestOrigin(req: IncomingMessage): string | undefined {
  const host = firstForwarded(header(req, 'x-forwarded-host')) ?? header(req, 'host')
  if (host === undefined) return undefined
  const proto = firstForwarded(header(req, 'x-forwarded-proto'))
    ?? ((req.socket as IncomingMessage['socket'] & { encrypted?: boolean }).encrypted === true
      ? 'https'
      : 'http')
  try {
    return new URL(`${proto}://${host}`).origin
  } catch {
    return undefined
  }
}

function normalizeOrigin(raw: string): string | undefined {
  try {
    return new URL(raw).origin
  } catch {
    return undefined
  }
}

function localPeer(req: IncomingMessage): boolean {
  const remote = req.socket.remoteAddress
  return remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1'
}

/** 允许同源页面与 fnOS 网关的回环代理；跨站请求一律拒绝。 */
export function trustedRequest(req: IncomingMessage): boolean {
  const fetchSite = header(req, 'sec-fetch-site')?.trim().toLowerCase()
  if (fetchSite === 'cross-site') return false
  const origin = header(req, 'origin')
  if (origin !== undefined) return requestOrigin(req) === normalizeOrigin(origin)
  return localPeer(req)
}

/** 浏览器整页跳转用的极简结果页（回调路径不在 SPA 内，需要自渲染）。 */
function html(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    // 结果页只需静态渲染，禁止脚本执行，避免回调参数被注入成可执行内容。
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
  })
  res.end(body)
}

/** 回调结果页：一句话结论 + 关闭提示，不引用任何外部资源。 */
function callbackPage(message: string, ok: boolean): string {
  const title = ok ? 'ZCode 登录成功' : 'ZCode 登录失败'
  const accent = ok ? '#12b886' : '#e03131'
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<title>${title}</title></head>`
    + `<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;`
    + `font:14px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8f9fa">`
    + `<div style="padding:32px 40px;border-radius:12px;background:#fff;box-shadow:0 2px 12px rgba(0,0,0,.08);`
    + `max-width:420px;text-align:center">`
    + `<h1 style="margin:0 0 12px;font-size:16px;color:${accent}">${title}</h1>`
    + `<p style="margin:0;color:#495057">${message}</p>`
    + `</div></body></html>`
}

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(JSON.stringify(value))
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = ''
    let size = 0
    let finished = false
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => {
      if (finished) return
      size += Buffer.byteLength(chunk)
      if (size > REQUEST_BODY_LIMIT) {
        finished = true
        reject(new Error('请求体过大'))
        return
      }
      body += chunk
    })
    req.on('end', () => {
      if (finished) return
      finished = true
      try {
        resolve(body.length === 0 ? {} : JSON.parse(body) as unknown)
      } catch {
        reject(new Error('请求体不是合法 JSON'))
      }
    })
    req.on('error', (error) => {
      if (finished) return
      finished = true
      reject(error)
    })
  })
}

/** 错误文本脱敏：绝不把 token 回显给浏览器。 */
function safeMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, '[redacted token]')
    .replace(/(\b(?:code|token|refresh_token|access_token|apiKey)=)[^&\s]+/giu, '$1[redacted]')
    .slice(0, 1000)
}

/** 从请求体解析账号家族；非法值返回 undefined。 */
function parseFamily(body: unknown): ZCodeFamily | undefined {
  const value = body !== null && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>).family
    : undefined
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  return ZCODE_FAMILIES.find(family => family === normalized)
}

/** 路由依赖。 */
export interface ZCodeRoutesOptions {
  readonly auth: ZCodeAuthService
  readonly usage: ZCodeUsageService
  readonly catalog: ZCodeCatalogService
  readonly preferences: ZCodePreferencesStore
  /** 登录状态变化后刷新目录与用量。 */
  readonly refresh: (force: boolean) => Promise<void>
  /** 偏好被写入后让宿主侧重新调度刷新。 */
  readonly preferencesChanged: () => Promise<void>
  /** 供应商路由的注册状态，供详情页诊断。 */
  readonly routes: () => readonly ZCodeRouteStatus[]
}

/** 目录响应的统一形状（列表/强制刷新共用）。 */
function catalogResponse(
  catalog: ZCodeCatalog | undefined,
  routes: readonly ZCodeRouteStatus[],
  error?: string,
): Record<string, unknown> {
  return {
    catalog: catalog ?? null,
    routes,
    ...(error === undefined ? {} : { error }),
  }
}

/** 注册全部插件路由；返回的清理函数由 `ctx.effect` 管理。 */
export function registerZCodeRoutes(ctx: Context, options: ZCodeRoutesOptions): void {
  ctx.effect(() => {
    const authorize = (req: IncomingMessage, res: ServerResponse): boolean => {
      if (trustedRequest(req)) return true
      json(res, 403, { error: ZCODE_ORIGIN_NOT_TRUSTED })
      return false
    }
    const handlers = [
      ctx.webServer.register({
        kind: 'exact',
        path: ZCODE_ROUTES.status,
        handler: async (req, res) => {
          if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' })
          if (!authorize(req, res)) return
          try {
            json(res, 200, await options.auth.status())
          } catch (error) {
            json(res, 500, { error: safeMessage(error) })
          }
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: ZCODE_ROUTES.login,
        handler: async (req, res) => {
          if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
          if (!authorize(req, res)) return
          try {
            const family = parseFamily(await readJsonBody(req)) ?? 'bigmodel'
            // 走授权码流程：上游对授权码与其它链路签发的凭据用途不同。
            // 回调地址取本次请求的 origin，代理与局域网访问都能落到正确地址。
            const challenge = await options.auth.loginDesktop(family, requestOrigin(req))
            json(res, 200, { status: 'signing-in', challenge })
          } catch (error) {
            json(res, 500, { error: safeMessage(error) })
          }
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: ZCODE_ROUTES.callback,
        handler: async (req, res) => {
          // 这是浏览器整页跳转（不是 fetch），因此不放行 CSRF 头校验，
          // 改成校验 state —— state 由本服务生成，只有发起登录的浏览器才知道。
          const url = new URL(req.url ?? '/', requestOrigin(req) ?? 'http://127.0.0.1')
          const code = url.searchParams.get('code') ?? url.searchParams.get('authCode')
          const state = url.searchParams.get('state')
          const family = parseFamily(url.searchParams.get('family')) ?? 'bigmodel'
          if (code === null || state === null) {
            return html(res, 400, callbackPage('授权回调缺少 code 或 state，请回到 DSH 重新登录。', false))
          }
          try {
            await options.auth.completeDesktopLogin({ code, state, family })
            return html(res, 200, callbackPage('登录成功，可以关闭此页并回到 DSH。', true))
          } catch (error) {
            return html(res, 400, callbackPage(safeMessage(error), false))
          }
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: ZCODE_ROUTES.cancel,
        handler: async (req, res) => {
          if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
          if (!authorize(req, res)) return
          try {
            options.auth.cancel()
            json(res, 200, await options.auth.status())
          } catch (error) {
            json(res, 500, { error: safeMessage(error) })
          }
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: ZCODE_ROUTES.logout,
        handler: async (req, res) => {
          if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
          if (!authorize(req, res)) return
          try {
            await options.auth.logout()
            options.usage.invalidate()
            await options.refresh(true).catch(() => undefined)
            json(res, 200, await options.auth.status())
          } catch (error) {
            json(res, 500, { error: safeMessage(error) })
          }
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: ZCODE_ROUTES.usage,
        handler: async (req, res) => {
          if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' })
          if (!authorize(req, res)) return
          const status = await options.auth.status().catch(() => ({ status: 'signed-out' as const }))
          if (status.status !== 'signed-in') return json(res, 200, { signedIn: false })
          const result = await options.usage.read()
          json(res, 200, result.ok
            ? { signedIn: true, usage: result.usage }
            : { signedIn: true, error: result.message, reason: result.reason })
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: ZCODE_ROUTES.catalog,
        handler: async (req, res) => {
          if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' })
          if (!authorize(req, res)) return
          try {
            const current = options.catalog.snapshot() ?? await options.catalog.refreshIfStale()
            json(res, 200, catalogResponse(current, options.routes()))
          } catch (error) {
            json(res, 200, catalogResponse(
              options.catalog.snapshot(),
              options.routes(),
              safeMessage(error) || ZCODE_CATALOG_UNAVAILABLE,
            ))
          }
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: ZCODE_ROUTES.catalogRefresh,
        handler: async (req, res) => {
          if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
          if (!authorize(req, res)) return
          try {
            await options.refresh(true)
            json(res, 200, catalogResponse(options.catalog.snapshot(), options.routes()))
          } catch (error) {
            json(res, 200, catalogResponse(
              options.catalog.snapshot(),
              options.routes(),
              safeMessage(error) || ZCODE_CATALOG_UNAVAILABLE,
            ))
          }
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: ZCODE_ROUTES.preferences,
        handler: async (req, res) => {
          if (req.method !== 'GET' && req.method !== 'PUT') {
            return json(res, 405, { error: 'method not allowed' })
          }
          if (!authorize(req, res)) return
          try {
            if (req.method === 'GET') return json(res, 200, await options.preferences.read())
            const next = await options.preferences.write(await readJsonBody(req))
            await options.preferencesChanged()
            json(res, 200, next)
          } catch (error) {
            json(res, 400, { error: safeMessage(error) })
          }
        },
      }),
    ]
    return async () => {
      for (const dispose of handlers) dispose()
      options.auth.dispose()
    }
  }, 'dsh-zcode: Web 路由')
}
