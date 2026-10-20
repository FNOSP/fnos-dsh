/**
 * 账号登录「回调中继」：把浏览器那一跳收到的授权码转发给本机的 DSH。
 *
 * 为什么需要它：账号登录的回调地址必须是 loopback（账号服务与平台都只认
 * `http://127.0.0.1:<端口>`）。经 fnOS 网关远程访问时，那个地址落在**用户自己的
 * 电脑**上，浏览器显示无法访问，但地址栏里带着 `code` 与 `state`——授权码本身
 * 是有效的，只是没人把它送到 NAS。
 *
 * 本路由就是那个「送」：客户端把带 code/state 的地址交给它，它在服务端请求
 * `http://127.0.0.1:<DSH 端口>/oauth/callback?code=…&state=…`，让账号服务完成
 * PKCE 交换。整个过程不接触浏览器，也不泄露凭据。
 *
 * 安全边界：
 * - 走本插件既有的 fnOS 同源校验，跨站请求一律 403；
 * - 只接受 `code`/`state` 两个参数，目标固定为本机回调路由，**不接受调用方给 URL**
 *   （否则就成了 SSRF 入口）；
 * - 授权码一次性、state 由账号服务随机生成并校验，重放无效。
 *
 * @module dsh-fnos/account-login-relay
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { isTrustedFnosRequest } from './authorized-directories.ts'

/** 中继路由路径。 */
export const FNOS_ACCOUNT_LOGIN_RELAY_PATH = '/plugins/dsh-fnos/account/login-callback'

/** 读取单个查询参数。 */
function queryValue(req: IncomingMessage, name: string): string | undefined {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const values = url.searchParams.getAll(name)
  return values.length === 1 && values[0] !== '' ? values[0] : undefined
}

/** 以 JSON 结束响应。 */
function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(JSON.stringify(value))
}

/**
 * 注册中继路由。
 *
 * @param ctx - 宿主上下文（需要 `webServer`）。
 */
export function registerAccountLoginRelayRoute(ctx: Context): void {
  ctx.inject(['webServer'], webCtx => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: FNOS_ACCOUNT_LOGIN_RELAY_PATH,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!isTrustedFnosRequest(req)) {
          json(res, 403, { error: 'remote-web-origin-not-trusted' })
          return
        }
        if (req.method !== 'POST' && req.method !== 'GET') {
          json(res, 405, { error: 'method-not-allowed' })
          return
        }
        const code = queryValue(req, 'code')
        const state = queryValue(req, 'state')
        if (code === undefined || state === undefined) {
          json(res, 400, { error: 'missing-code-or-state' })
          return
        }
        const port = webCtx.webServer.port
        if (port === undefined) {
          json(res, 503, { error: 'web-server-not-listening' })
          return
        }
        const target = new URL(`http://127.0.0.1:${port}/oauth/callback`)
        target.searchParams.set('code', code)
        target.searchParams.set('state', state)
        try {
          const response = await fetch(target, { redirect: 'manual' })
          if (!response.ok) {
            json(res, 502, { error: 'callback-rejected', status: response.status })
            return
          }
          json(res, 200, { ok: true })
        } catch (error) {
          console.error('[dsh-fnos] login relay failed', error)
          json(res, 502, { error: 'callback-unreachable' })
        }
      },
    }), 'dsh-fnos: account login relay')
  })
}
