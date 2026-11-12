/**
 * fnOS 账号登录回调的契约（宿主与客户端共用）。
 *
 * ## 为什么需要它
 *
 * DSH 官方的账号登录只接受 **loopback** 回调（`http://127.0.0.1:<port>` 或
 * `localhost`），而且这条白名单在**两层**都写死：
 *
 * 1. 宿主 `deepseekAccount.startSignIn` 的 `loginOrigin()` 校验；
 * 2. 平台服务端 `auth_init` 的 `redirect_uri` schema。
 *
 * 经 fnOS 网关远程访问时，`window.location.origin` 是网关地址
 * （如 `http://192.168.0.17:5666`），校验在发出任何请求之前就抛错——用户看到
 * 「点了没反应」，没有任何可诊断的信息。
 *
 * 服务端白名单改不到，浏览器地址栏也改不了，所以这里不改白名单，而是把
 * **授权码的交付路径**改道：
 *
 * ```
 * ① 宿主把 callbackOrigin 改写成 http://127.0.0.1:<DSH 实际端口>
 * ② auth_init 通过 → 授权页正常打开 → 用户授权
 * ③ 平台 302 到 127.0.0.1:<port>/oauth/callback?code=…&state=…
 *    ★ 这一跳落在用户自己的电脑上，浏览器显示「无法访问此网站」，
 *      但地址栏里带着一个有效的 code
 * ④ 用户把那条地址粘回插件界面
 * ⑤ 插件在 NAS 服务端请求本机 /oauth/callback?code&state → PKCE 换码 → 登录完成
 * ```
 *
 * @module dsh-fnos/account-login-contract
 */

/**
 * 登录中继路由（相对 DSH Web 根）。
 *
 * 只接受 `code` 与 `state` 两个具名参数；目标 URL 固定为本机回调路由，
 * **不接受调用方给 URL**（否则就是 SSRF 入口）。
 */
export const FNOS_ACCOUNT_LOGIN_RELAY_ROUTE = '/plugins/dsh-fnos/account/login-relay'

/** 指令式登录发起路由：由宿主驱动 `startSignIn` 并返回授权地址。 */
export const FNOS_ACCOUNT_LOGIN_START_ROUTE = '/plugins/dsh-fnos/account/login-start'

/** 取消当前登录尝试。 */
export const FNOS_ACCOUNT_LOGIN_CANCEL_ROUTE = '/plugins/dsh-fnos/account/login-cancel'

/** 读取当前登录尝试状态（客户端据此驱动对话框切态）。 */
export const FNOS_ACCOUNT_LOGIN_STATE_ROUTE = '/plugins/dsh-fnos/account/login-state'

/** 中继请求体。 */
export interface AccountLoginRelayPayload {
  /** 平台回调里的授权码。 */
  readonly code: string
  /** 平台回调里的 state，用于与本次尝试对齐。 */
  readonly state: string
}

/** 中继结果。 */
export interface AccountLoginRelayResult {
  /** 登录是否成功完成（平台回调是否接受本次 code）。 */
  readonly ok: boolean
  /** 上游 `/oauth/callback` 的 HTTP 状态，便于诊断失败原因。 */
  readonly upstreamStatus?: number
}

/** 发起登录的结果。 */
export interface AccountLoginStartResult {
  /** 需要用户在新标签页打开的授权页地址。 */
  readonly authorizeUrl?: string
  /** 失败原因（拿到它说明这次尝试根本没起来）。 */
  readonly error?: string
}

/** 登录尝试的阶段，取自官方 `attempt.phase`。 */
export interface AccountLoginAttemptView {
  /** 官方阶段值；`undefined` 表示当前没有进行中的尝试。 */
  readonly phase?: string
  /** 授权页地址。 */
  readonly authorizeUrl?: string
  /** 本次尝试的标识，用于客户端判断是否同一轮。 */
  readonly attemptId?: string
}
