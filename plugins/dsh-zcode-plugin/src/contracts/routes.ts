/**
 * 插件同源 Web 路由：宿主注册、浏览器调用，两端引用同一份常量。
 *
 * 不用 Remote API 命名空间，是因为这里只有低频率、无状态的读写；同源 HTTP
 * 路由的信任边界由宿主侧 `trustedRequest` 把关，与其他账号插件一致。
 *
 * @module dsh-zcode/routes
 */

/** 本插件 Web 路由的前缀。 */
export const ZCODE_ROUTE_PREFIX = '/plugins/dsh-zcode'

export const ZCODE_ROUTES = {
  /** 账号状态（含进行中的登录挑战）。 */
  status: `${ZCODE_ROUTE_PREFIX}/auth/status`,
  /** 开始设备授权；响应带授权地址。 */
  login: `${ZCODE_ROUTE_PREFIX}/auth/login`,
  /** 桌面授权码流程的回调地址：浏览器登录后回跳到这里完成换取。 */
  callback: `${ZCODE_ROUTE_PREFIX}/auth/callback`,
  /** 取消进行中的登录，不删除已保存凭据。 */
  cancel: `${ZCODE_ROUTE_PREFIX}/auth/cancel`,
  /** 退出登录并删除凭据。 */
  logout: `${ZCODE_ROUTE_PREFIX}/auth/logout`,
  /** Start Plan 额度。 */
  usage: `${ZCODE_ROUTE_PREFIX}/usage`,
  /** 当前模型目录快照。 */
  catalog: `${ZCODE_ROUTE_PREFIX}/catalog`,
  /** 强制刷新模型目录。 */
  catalogRefresh: `${ZCODE_ROUTE_PREFIX}/catalog/refresh`,
  /** 插件偏好设置。 */
  preferences: `${ZCODE_ROUTE_PREFIX}/preferences`,
} as const

export type ZCodeRoute = typeof ZCODE_ROUTES[keyof typeof ZCODE_ROUTES]
