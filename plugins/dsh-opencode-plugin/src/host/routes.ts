/**
 * 插件同源 Web 路由。
 *
 * 浏览器只通过这里读写状态：账号凭据、模型目录与套餐用量都留在宿主侧，
 * 响应体里没有 token。变更类请求先做同源/本机校验，与 Codex Auth 插件保持
 * 同一套信任边界。
 *
 * @module dsh-opencode/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { OpenCodeCatalog } from '../contracts/catalog.ts'
import type { OpenCodePlan } from '../contracts/identity.ts'
import { OPENCODE_ROUTES } from '../contracts/routes.ts'
import type { OpenCodeAuthService } from './auth.ts'
import { applyCatalogView } from './catalog.ts'
import type { OpenCodeCatalogService } from './catalog.ts'
import type { OpenCodePreferencesStore } from './preferences.ts'
import type { OpenCodeRouteStatus } from './provider.ts'
import type { OpenCodeUsageService } from './usage.ts'

/** 请求体上限：只有少量表单字段。 */
const REQUEST_BODY_LIMIT = 16 * 1024

/** 来源不受信任时的错误码（与客户端文案对应）。 */
export const OPENCODE_ORIGIN_NOT_TRUSTED = 'remote-web-origin-not-trusted'
/** 用量读取失败的错误码。 */
export const OPENCODE_USAGE_UNAVAILABLE = 'opencode-usage-unavailable'
/** 目录刷新失败的错误码。 */
export const OPENCODE_CATALOG_UNAVAILABLE = 'opencode-catalog-unavailable'

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
    ?? ((req.socket as IncomingMessage['socket'] & { encrypted?: boolean }).encrypted === true ? 'https' : 'http')
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

/** 错误文本脱敏：绝不把 token 或一次性代码回显给浏览器。 */
function safeMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, '[redacted token]')
    .replace(/(\b(?:code|token|refresh_token|access_token|apiKey)=)[^&\s]+/giu, '$1[redacted]')
    .slice(0, 1000)
}

/** 路由依赖。 */
export interface OpenCodeRoutesOptions {
  readonly auth: OpenCodeAuthService
  readonly usage: OpenCodeUsageService
  readonly catalog: OpenCodeCatalogService
  readonly preferences: OpenCodePreferencesStore
  /** 登录状态变化后刷新目录与用量。 */
  readonly refresh: (force: boolean) => Promise<void>
  /** 偏好被写入后让宿主侧重新调度刷新。 */
  readonly preferencesChanged: () => Promise<void>
  /** 两组供应商路由的注册状态，供详情页诊断。 */
  readonly routes: () => readonly OpenCodeRouteStatus[]
  /**
   * 账号套餐来源，用于去掉跨来源重复的模型条目。
   *
   * 同一模型在 zen 与 go 都出现时目录里只保留这一侧的条目；不传时保留全部。
   */
  readonly ownedPlan?: () => Promise<OpenCodePlan>
  /**
   * 当前生效的推理端点策略。
   *
   * 目录响应按它改写 `baseURL`，让详情页展示的端点与实际发请求的端点一致；
   * 不传时保持各模型的原生端点。
   */
  readonly endpointPlan?: () => Promise<OpenCodePlan | 'auto'>
}

/**
 * 注册全部插件路由；返回的清理函数由 `ctx.effect` 管理。
 */
export function registerOpenCodeRoutes(ctx: Context, options: OpenCodeRoutesOptions): void {
  ctx.effect(() => {
    /**
     * 目录响应只影响展示：与模型选择器走同一条口径（按账号套餐去重 + 端点策略），
     * 让详情页看到的模型与选择器里能选到的一致。
     */
    const displayCatalog = async (
      snapshot: OpenCodeCatalog | undefined,
    ): Promise<OpenCodeCatalog | undefined> => {
      if (snapshot === undefined) return snapshot
      const ownedPlan = options.ownedPlan === undefined ? undefined : await options.ownedPlan()
      const endpointPlan = options.endpointPlan === undefined ? undefined : await options.endpointPlan()
      const models = applyCatalogView(snapshot.models, { ownedPlan, endpointPlan })
      return models === snapshot.models ? snapshot : { ...snapshot, models }
    }
    const authorize = (req: IncomingMessage, res: ServerResponse): boolean => {
      if (trustedRequest(req)) return true
      json(res, 403, { error: OPENCODE_ORIGIN_NOT_TRUSTED })
      return false
    }
    const authState = async (): Promise<void> => {
      await options.auth.status().catch(() => undefined)
    }
    const routes = [
      ctx.webServer.register({
        kind: 'exact',
        path: OPENCODE_ROUTES.status,
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
        path: OPENCODE_ROUTES.login,
        handler: async (req, res) => {
          if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
          if (!authorize(req, res)) return
          try {
            json(res, 200, await options.auth.signIn())
          } catch (error) {
            json(res, 500, { error: safeMessage(error) })
          }
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: OPENCODE_ROUTES.cancel,
        handler: async (req, res) => {
          if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
          if (!authorize(req, res)) return
          try {
            await options.auth.cancel()
            await authState()
            json(res, 200, await options.auth.status())
          } catch (error) {
            json(res, 500, { error: safeMessage(error) })
          }
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: OPENCODE_ROUTES.logout,
        handler: async (req, res) => {
          if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
          if (!authorize(req, res)) return
          try {
            await options.auth.signOut()
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
        path: OPENCODE_ROUTES.keyLogin,
        handler: async (req, res) => {
          if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
          if (!authorize(req, res)) return
          try {
            const body = await readJsonBody(req)
            const apiKey = body !== null && typeof body === 'object' && !Array.isArray(body)
              ? (body as Record<string, unknown>).apiKey
              : undefined
            if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
              return json(res, 400, { error: '请输入 OpenCode API Key' })
            }
            json(res, 200, await options.auth.signInWithKey(apiKey.trim()))
          } catch (error) {
            json(res, 400, { error: safeMessage(error) })
          }
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: OPENCODE_ROUTES.usage,
        handler: async (req, res) => {
          if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' })
          if (!authorize(req, res)) return
          const status = await options.auth.status().catch(() => ({ status: 'signed-out' as const }))
          const signedIn = status.status === 'signed-in'
          if (!signedIn) return json(res, 200, { signedIn: false })
          try {
            const usage = await options.usage.read()
            json(res, 200, usage === undefined ? { signedIn: true } : { signedIn: true, usage })
          } catch (error) {
            json(res, 200, { signedIn: true, error: safeMessage(error) || OPENCODE_USAGE_UNAVAILABLE })
          }
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: OPENCODE_ROUTES.catalog,
        handler: async (req, res) => {
          if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' })
          if (!authorize(req, res)) return
          try {
            const current = options.catalog.current() ?? await options.catalog.refreshIfStale()
            json(res, 200, {
              catalog: await displayCatalog(current),
              ...(options.catalog.consoleDiagnostic() === undefined ? {} : { consoleError: options.catalog.consoleDiagnostic() }),
              ...(options.catalog.error() === undefined ? {} : { error: options.catalog.error() }),
              routes: options.routes(),
            })
          } catch (error) {
            json(res, 200, {
              catalog: null,
              error: safeMessage(error) || OPENCODE_CATALOG_UNAVAILABLE,
              routes: options.routes(),
            })
          }
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: OPENCODE_ROUTES.catalogRefresh,
        handler: async (req, res) => {
          if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
          if (!authorize(req, res)) return
          try {
            await options.refresh(true)
            const current = options.catalog.current()
            json(res, 200, {
              catalog: await displayCatalog(current),
              ...(options.catalog.consoleDiagnostic() === undefined ? {} : { consoleError: options.catalog.consoleDiagnostic() }),
              ...(options.catalog.error() === undefined ? {} : { error: options.catalog.error() }),
              routes: options.routes(),
            })
          } catch (error) {
            json(res, 200, { catalog: await displayCatalog(options.catalog.current()) ?? null, error: safeMessage(error) || OPENCODE_CATALOG_UNAVAILABLE })
          }
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: OPENCODE_ROUTES.preferences,
        handler: async (req, res) => {
          if (req.method !== 'GET' && req.method !== 'PUT') return json(res, 405, { error: 'method not allowed' })
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
      for (const dispose of routes) dispose()
      await options.auth.dispose()
    }
  }, 'dsh-opencode: Web 路由')
}
