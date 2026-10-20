/**
 * 把账号登录的回调 origin 改写成**运行 DSH 的那台机器**的 loopback 地址。
 *
 * 背景：DSH 的账号登录只接受 loopback 回调（`loginOrigin()` 的正则与平台
 * `auth_init` 的 schema 都只认 http + localhost/127.0.0.1/[::1]）。经 fnOS 网关
 * 访问时，浏览器页面的 origin 是 `http://<设备>:5666`，于是校验立即失败——
 * 用户看到「点了没反应」。
 *
 * 本模块做的**不是**让非 loopback 变合法（两端都写死，做不到），而是把回调目标
 * 换成 DSH 自己所在机器的 loopback：授权码因此指向「运行 DSH 的机器」，由本插件
 * 在服务端取回并完成交换，不再依赖用户浏览器的回环地址。
 *
 * 只在传入 origin **不是** loopback 时才改写：本机访问行为完全不变。
 *
 * @module dsh-fnos/login-origin-bridge
 */

import type { Context } from '@deepseek-ai/cordis'

/** 与账号服务白名单一致的 loopback 判定。 */
function isLoopbackOrigin(origin: string): boolean {
  return /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d+$/.test(origin)
}

/**
 * 由 Web 服务实际监听端口推导 loopback origin。
 *
 * 不写死端口：端口可能被 `--port` 改成别的值，写死会让改写后的地址与真实监听
 * 对不上，作者收到的是「换了个方式失败」。
 *
 * @param port - 监听端口；尚未 bind 时为 `undefined`。
 * @returns `http://127.0.0.1:<port>`，端口未知时返回 `undefined`。
 */
export function loopbackOriginFor(port: number | undefined): string | undefined {
  if (port === undefined || !Number.isSafeInteger(port) || port <= 0 || port > 65_535) return undefined
  return `http://127.0.0.1:${port}`
}

/** 账号服务的最小结构：只需要 we 改写的那一个方法。 */
interface AccountService {
  startSignIn: (client: unknown, callbackOrigin: string, loginSource: 'web' | 'desktop') => Promise<unknown>
}

/** 环境变量名：设置后启用改写。 */
export const LOGIN_ORIGIN_ENV = 'DSH_FNOS_LOGIN_ORIGIN'

/**
 * 读取并校验配置的回调 origin。
 *
 * 只接受 `http://127.0.0.1:<端口>` 形态——与账号服务自身的白名单保持一致，
 * 否则改写出来的值照样会被 `loginOrigin()` 拒绝，问题只是从「看不懂的失败」
 * 变成「另一个看不懂的失败」。
 *
 * @returns 规范化后的 origin；未配置或形态非法时返回 `undefined`。
 */
export function configuredLoginOrigin(): string | undefined {
  const raw = process.env[LOGIN_ORIGIN_ENV]?.trim()
  if (raw === undefined || raw.length === 0) return undefined
  const match = /^http:\/\/127\.0\.0\.1:(\d+)$/.exec(raw.replace(/\/+$/, ''))
  if (match === null) return undefined
  const port = Number(match[1])
  if (!Number.isSafeInteger(port) || port <= 0 || port > 65_535) return undefined
  return `http://127.0.0.1:${port}`
}

/**
 * 在账号服务上安装 origin 改写。
 *
 * 用**实例方法替换**而不是另注册一个服务：账号服务由 `dsh-base` 组合挂在固定
 * 位置，替换整条挂载会影响设置页、余额、流式订阅等全部调用面；只改写一个参数
 * 的爆炸半径最小，卸载时也能精确还原。
 *
 * @param ctx - 宿主上下文。
 */
/**
 * 在账号服务实例上安装改写（抽出以便单测直接驱动，无需 Cordis 容器）。
 *
 * @param account - 账号服务实例。
 * @param origin - 目标 loopback origin。
 * @returns 卸载函数，恢复原方法。
 */
export function patchAccountSignIn(account: AccountService, origin: string): () => void {
  const original = account.startSignIn.bind(account)
  account.startSignIn = (client, callbackOrigin, loginSource) => original(
    client,
    isLoopbackOrigin(callbackOrigin) ? callbackOrigin : origin,
    loginSource,
  )
  return () => {
    account.startSignIn = original
  }
}

export function applyLoginOriginBridge(ctx: Context): void {
  ctx.inject(['webServer'], webCtx => {
    const server = (webCtx as unknown as { webServer?: { port?: number } }).webServer
    const origin = loopbackOriginFor(server?.port)
    if (origin === undefined) return
    webCtx.inject(['deepseekAccount'], child => {
      const account = (child as unknown as { deepseekAccount?: AccountService }).deepseekAccount
      if (account === undefined || typeof account.startSignIn !== 'function') return
      const restore = patchAccountSignIn(account, origin)
      child.effect(() => restore)
    })
  })
}
