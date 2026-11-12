/**
 * 账号登录：把回调改道到本机 loopback，并在服务端完成换码。
 *
 * 背景与完整链路见 `contracts/account-login-contract.ts`。这里只做两件事：
 *
 * 1. **改写 callbackOrigin**：`deepseekAccount.startSignIn` 收到非 loopback 的
 *    回调地址（fnOS 网关地址）时，替换成 `http://127.0.0.1:<DSH 实际端口>`。
 *    本机访问（已是 loopback）原样透传，行为不变。
 * 2. **中继换码**：接收用户粘贴回来的 `code`/`state`，在服务端请求本机
 *    `/oauth/callback`，让官方完成 PKCE 交换。
 *
 * ## 端口为什么不能写死
 *
 * `webServer.port` 是运行时真实端口。写死 `3080` 会在 `--port` 改过之后让改写值
 * 与实际监听端口对不上，回调落到一个没人监听的地址上。
 *
 * ## 安全边界
 *
 * 中继只接受 `code`/`state` 两个具名参数，目标 URL 固定为本机回调路由。
 * **不接受调用方给 URL**——那会变成 SSRF 入口（可以让 NAS 去请求任意内网地址）。
 *
 * @module dsh-fnos/account-login-relay
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import {
  FNOS_ACCOUNT_LOGIN_CANCEL_ROUTE,
  FNOS_ACCOUNT_LOGIN_RELAY_ROUTE,
  FNOS_ACCOUNT_LOGIN_START_ROUTE,
  FNOS_ACCOUNT_LOGIN_STATE_ROUTE,
} from '../contracts/account-login-contract.ts'

/** 只接受 http + loopback 的回调地址。 */
const LOOPBACK_ORIGIN = /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d+$/

/**
 * 账号服务实例上本模块用到的成员。
 *
 * 显式声明而不是直接用官方类型：这些是 `deepseekAccount` 服务在运行时的真实
 * 形状，官方没有导出对应的公开类型，用结构描述可以让「接口变了」在编译期暴露。
 */
export interface AccountServiceLike {
  startSignIn: (client: string, callbackOrigin: string, source: string) => Promise<unknown>
  getState: () => Promise<unknown>
  cancel?: () => Promise<unknown>
}

/**
 * 解析某次尝试里的授权页地址。
 *
 * 官方 `startSignIn` 返回时 `phase` 还是 `initializing`、`authorizeUrl` 尚未生成，
 * 所以要先等状态推进到 `waiting-browser`。这里用轮询，不猜内部事件。
 *
 * @param account - 账号服务实例。
 * @param timeoutMs - 最长等待时间。
 * @returns 授权页地址；超时返回 `undefined`。
 */
async function waitForAuthorizeUrl(
  account: AccountServiceLike,
  timeoutMs = 15_000,
): Promise<string | undefined> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const state = await account.getState() as { attempt?: { phase?: string, authorizeUrl?: string } } | undefined
      const attempt = state?.attempt
      if (attempt?.phase === 'waiting-browser' && typeof attempt.authorizeUrl === 'string' && attempt.authorizeUrl !== '') {
        return attempt.authorizeUrl
      }
      // 已经失败或取消：不再等，交给调用方报错。
      if (attempt?.phase === 'failed' || attempt?.phase === 'cancelled') return undefined
    } catch {
      // 状态读取失败不是致命错误，继续重试到超时即可。
    }
    await new Promise(resolve => setTimeout(resolve, 300))
  }
  return undefined
}

/**
 * 给账号服务装上 origin 改写。
 *
 * @param account - 账号服务实例。
 * @param resolveOrigin - 由传入 origin 决定实际使用的回调 origin。
 * @returns 卸载函数。
 */
export function patchCallbackOrigin(
  account: AccountServiceLike,
  resolveOrigin: (origin: string) => string,
): () => void {
  const original = account.startSignIn.bind(account)
  account.startSignIn = (client, callbackOrigin, loginSource) => {
    const used = resolveOrigin(callbackOrigin)
    return original(client, used, loginSource)
  }
  return () => { account.startSignIn = original }
}

/**
 * 同源判定：只比 `host`，与插件其它路由保持同一口径。
 * @param req - 请求。
 * @returns 是否可信。
 */
function trusted(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (origin === undefined) return true
  const host = req.headers.host
  if (host === undefined) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

/**
 * 读请求体。体积上限很小——这里只接受两条短字符串。
 * @param req - 请求。
 * @returns 解析后的 JSON；失败返回 undefined。
 */
async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    // 中继只需要 code/state，超过 8KB 一定是异常请求。
    if (size > 8 * 1024) return undefined
    chunks.push(buffer)
  }
  if (size === 0) return undefined
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return undefined
  }
}

function send(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

/**
 * 注册账号登录相关路由，并安装回调地址改写。
 *
 * @param ctx - 宿主上下文（需已注入 `webServer`）。
 */
export function registerAccountLoginRelay(ctx: Context): void {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: FNOS_ACCOUNT_LOGIN_START_ROUTE,
    handler: async (req, res) => {
      if (!trusted(req)) return send(res, 403, { error: 'remote-web-origin-not-trusted' })
      if (req.method !== 'POST') return send(res, 405, { error: 'method-not-allowed' })
      const service = readAccountService(ctx)
      if (service === undefined) return send(res, 503, { error: 'account-service-unavailable' })
      try {
        /*
          由宿主发起，而不是等客户端点官方按钮。原因：客户端要「拦截官方登录」，
          而官方两个渲染点的显示条件互相牵制（`loginVisible && !onboarding`），
          从外部改不到。走这条路，官方界面可以完全不参与登录流程。
        */
        const port = ctx.webServer.port
        if (port === undefined || !Number.isSafeInteger(port) || port <= 0) {
          return send(res, 503, { error: 'web-port-unavailable' })
        }
        await service.startSignIn('web', `http://127.0.0.1:${port}`, 'web')
        const authorizeUrl = await waitForAuthorizeUrl(service)
        send(res, 200, authorizeUrl === undefined ? { error: 'authorize-url-unavailable' } : { authorizeUrl })
      } catch (error) {
        send(res, 500, { error: 'start-sign-in-failed', message: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'dsh-fnos: account login start')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: FNOS_ACCOUNT_LOGIN_RELAY_ROUTE,
    handler: async (req, res) => {
      if (!trusted(req)) return send(res, 403, { error: 'remote-web-origin-not-trusted' })
      if (req.method !== 'POST') return send(res, 405, { error: 'method-not-allowed' })
      const payload = await readJson(req) as { code?: unknown, state?: unknown } | undefined
      const code = typeof payload?.code === 'string' ? payload.code : ''
      const state = typeof payload?.state === 'string' ? payload.state : ''
      if (code === '' || state === '') return send(res, 400, { error: 'missing-code-or-state' })
      /*
        目标永远用**真实端口**：用户电脑上的 127.0.0.1 是打不开的，只有 NAS 自己
        访问自己的 loopback 才能把码交回账号服务。这正是这个方案的核心一跳。
      */
      const relayPort = ctx.webServer.port
      if (relayPort === undefined || !Number.isSafeInteger(relayPort) || relayPort <= 0) {
        return send(res, 503, { error: 'web-port-unavailable' })
      }
      const target = new URL(`http://127.0.0.1:${relayPort}/oauth/callback`)
      target.searchParams.set('code', code)
      target.searchParams.set('state', state)
      try {
        // redirect: 'manual' —— 账号服务的回调会 302 回应用页，我们不跟这一跳。
        const response = await fetch(target, { redirect: 'manual' })
        send(res, 200, { ok: response.status >= 200 && response.status < 400, upstreamStatus: response.status })
      } catch (error) {
        send(res, 502, { error: 'callback-unreachable', message: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'dsh-fnos: account login relay')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: FNOS_ACCOUNT_LOGIN_STATE_ROUTE,
    handler: async (req, res) => {
      if (!trusted(req)) return send(res, 403, { error: 'remote-web-origin-not-trusted' })
      const service = readAccountService(ctx)
      if (service === undefined) return send(res, 503, { error: 'account-service-unavailable' })
      try {
        const state = await service.getState() as { attempt?: { phase?: string, authorizeUrl?: string, id?: string } } | undefined
        const attempt = state?.attempt
        send(res, 200, {
          phase: attempt?.phase,
          authorizeUrl: attempt?.authorizeUrl,
          attemptId: attempt?.id,
        })
      } catch (error) {
        send(res, 500, { error: 'state-read-failed', message: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'dsh-fnos: account login state')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: FNOS_ACCOUNT_LOGIN_CANCEL_ROUTE,
    handler: async (req, res) => {
      if (!trusted(req)) return send(res, 403, { error: 'remote-web-origin-not-trusted' })
      if (req.method !== 'POST') return send(res, 405, { error: 'method-not-allowed' })
      const service = readAccountService(ctx)
      if (service === undefined) return send(res, 503, { error: 'account-service-unavailable' })
      try {
        await service.cancel?.()
        send(res, 200, { ok: true })
      } catch (error) {
        send(res, 500, { error: 'cancel-failed', message: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'dsh-fnos: account login cancel')

  /*
    安装 origin 改写。

    `deepseekAccount` 不一定在插件加载时就绪（它由 DSH 自己的账号插件提供），
    所以用 `ctx.inject` 等到它出现再装，并在 effect 里登记卸载。
  */
  ctx.inject(['deepseekAccount'], child => {
    const service = (child as unknown as { deepseekAccount?: AccountServiceLike }).deepseekAccount
    if (service === undefined || typeof service.startSignIn !== 'function') return
    const port = ctx.webServer.port
    if (port === undefined || !Number.isSafeInteger(port) || port <= 0) return
    const loopback = `http://127.0.0.1:${port}`
    const restore = patchCallbackOrigin(service, origin => (LOOPBACK_ORIGIN.test(origin) ? origin : loopback))
    child.effect(() => restore)
  })
}

/**
 * 从上下文读账号服务实例。
 *
 * @param ctx - 宿主上下文。
 * @returns 服务实例；不可用时为 undefined。
 */
function readAccountService(ctx: Context): AccountServiceLike | undefined {
  const service = (ctx as unknown as { deepseekAccount?: AccountServiceLike }).deepseekAccount
  return service !== undefined && typeof service.startSignIn === 'function' ? service : undefined
}
