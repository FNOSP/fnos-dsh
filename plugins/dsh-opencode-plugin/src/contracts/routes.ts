/**
 * 插件同源 Web 路由：宿主注册、浏览器调用，两端引用同一份常量。
 *
 * 不用 Remote API 命名空间，是因为这里只有低频率、无状态的读写；同源 HTTP
 * 路由的信任边界由宿主侧 `trustedRequest` 把关，与 Codex Auth 插件一致。
 *
 * @module dsh-opencode/routes
 */

/** 本插件 Web 路由的前缀。 */
export const OPENCODE_ROUTE_PREFIX = '/plugins/dsh-opencode'

export const OPENCODE_ROUTES = {
  /** 账号状态（含进行中的登录挑战）。 */
  status: `${OPENCODE_ROUTE_PREFIX}/auth/status`,
  /** 开始设备码登录；响应带一次性 user_code 与验证地址。 */
  login: `${OPENCODE_ROUTE_PREFIX}/auth/login`,
  /** 取消进行中的登录，不删除已保存凭据。 */
  cancel: `${OPENCODE_ROUTE_PREFIX}/auth/cancel`,
  /** 退出登录并删除凭据。 */
  logout: `${OPENCODE_ROUTE_PREFIX}/auth/logout`,
  /** 以 API Key 直接登录（设备码不可用时的兜底）。 */
  keyLogin: `${OPENCODE_ROUTE_PREFIX}/auth/key`,
  /** 套餐用量（Go 额度窗口）。 */
  usage: `${OPENCODE_ROUTE_PREFIX}/usage`,
  /** 当前模型目录快照。 */
  catalog: `${OPENCODE_ROUTE_PREFIX}/catalog`,
  /** 强制刷新模型目录。 */
  catalogRefresh: `${OPENCODE_ROUTE_PREFIX}/catalog/refresh`,
  /** 插件偏好设置。 */
  preferences: `${OPENCODE_ROUTE_PREFIX}/preferences`,
} as const

export type OpenCodeRoute = typeof OPENCODE_ROUTES[keyof typeof OPENCODE_ROUTES]
