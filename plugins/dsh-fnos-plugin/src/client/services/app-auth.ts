/**
 * fnOS 授权入口：把「选目录」按运行环境分流成两条路径。
 *
 * ## 两条路径
 *
 * | 环境 | 路径 | 用户体验 |
 * | --- | --- | --- |
 * | `embedded` | `sdk.pickSharedFile()` 直调 | 宿子弹窗，选完即回 |
 * | `standalone` | `sdk.openAppAuth('pickSharedFile')` | 新标签页授权，回调通知原页 |
 *
 * 官方文档（`api/authorization/shared-access.md`）明确：`isStandaloneWeb` 为
 * true 时，文件选择与授权必须走 `openAppAuth`，通过 `redirectUri` 接收结果；
 * 独立浏览器页面里没有宿主桥，直调 `pickSharedFile` 只会抛
 * `Host bridge is not available outside iframe or app runtime`。
 *
 * ## 回调链路
 *
 * 授权页完成跳转到 `redirectUri`（同源的静态页），该页用
 * `parseAppAuthCallback` 解析结果，再 `postMessage` 通知原页面。原页面按
 * `state` 校验来源后刷新授权目录列表。
 *
 * 也存在「回调页拿不到 opener」的情况（移动端分屏、浏览器拦截），因此原页面
 * 必须保留手动刷新的能力——用户回到页面时能看到按钮并自行刷新。
 *
 * @module dsh-fnos/services/app-auth
 */

import { detectFnosEnvironment } from './environment.ts'

/**
 * 授权页回调落地的同源路径。
 *
 * 由应用网关内联返回（`packages/fnos-gateway/src/middleware/app-auth-callback.ts`），
 * 因此不需要在 DSH 应用资源目录里放文件。相对 `<base>` 解析，保证与授权页、
 * 原页面同源——跨源的话 `postMessage` 无法通过同源校验。
 */
export const APP_AUTH_CALLBACK_PATH = 'fnos-auth-callback'

/** 回调页发给原页面的消息类型。 */
export const APP_AUTH_MESSAGE_TYPE = 'dsh-fnos:auth-result'

/** 应用在 fnOS 里的名字（`openAppAuth` 的 `appName`）。 */
export const FNOS_APP_NAME = 'fn-deepseek-harness'

/** 授权回调结果。 */
export interface FnosAppAuthResult {
  readonly status?: 'success' | 'cancel' | 'error'
  readonly error?: string
  readonly method?: string
  readonly appName?: string
  readonly state?: string
  readonly path?: readonly string[]
}

/**
 * `pickSharedFile` 授权的参数形状。
 *
 * 只声明本插件实际会传的字段：真实 SDK 的 `AppAuthParams` 还有可选项，但那些
 * 与这里无关，列出来只会让假实现更难写。
 */
export interface PickSharedFileAuthParams {
  readonly appName: string
  readonly redirectUri: string
  readonly state: string
  readonly sidebarGroup: readonly string[]
}

/**
 * 打开授权页的最小能力面。
 *
 * 传函数而不是 sdk 对象：真实 `TrimApp` 用泛型把 method 与 params 绑在一起，
 * 用一个宽泛接口去描述它会在参数逆变上失败；这里只要「能带 method、参数和
 * 窗口选项发起一次授权」，调用方用箭头函数适配即可。
 */
export type OpenAppAuthFn = (
  method: 'pickSharedFile',
  params: PickSharedFileAuthParams,
  options?: { target?: string, features?: string },
) => Promise<unknown>

/**
 * 生成一次性 `state`。
 *
 * 用于确认回调确实来自本次授权请求：少了它，任何页面都能伪造一个
 * `postMessage` 让原页面以为拿到了授权。
 * @returns 随机字符串。
 */
export function createAuthState(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `fnos-${String(Date.now())}-${Math.random().toString(16).slice(2)}`
}

/**
 * 回调页的同源绝对路径。
 *
 * 应用被网关托管时页面 `<base>` 指向 `/app/<应用名>/`，因此相对路径即可解析
 * 到同源回调页。文档也建议 `redirectUri` 用同域路径，否则回调页与原页面
 * 跨源，`postMessage` 无法通过同源校验。
 * @returns `/app/<应用名>/fnos-auth-callback.html`。
 */
export function appAuthRedirectUri(): string {
  const fallback = `/app/${FNOS_APP_NAME}/${APP_AUTH_CALLBACK_PATH}`
  if (typeof document === 'undefined') return fallback
  const base = document.querySelector('base')?.href
  if (base === undefined) return fallback
  try {
    return new URL(APP_AUTH_CALLBACK_PATH, base).pathname
  } catch {
    return fallback
  }
}

/**
 * 打开 fnOS 授权页。
 *
 * 必须由用户点击触发：文档明确，在页面加载、定时器或异步回调里自动打开会被
 * 浏览器拦截为弹窗。
 *
 * @param openAppAuth - SDK 的 `openAppAuth` 适配函数。
 * @param state - 本次授权的 `state`，回调时校验。
 * @returns 授权页地址，或 `undefined`（当前环境不支持）。
 */
export async function openFnosAppAuth(
  openAppAuth: OpenAppAuthFn,
  state: string,
): Promise<string | undefined> {
  if (detectFnosEnvironment() !== 'standalone') return undefined
  const params: PickSharedFileAuthParams = {
    appName: FNOS_APP_NAME,
    redirectUri: appAuthRedirectUri(),
    state,
    // 与直调路径保持同一套侧边栏分组，用户看到的目录范围不变。
    sidebarGroup: ['myFiles', 'otherShare', 'external', 'remote', 'favorites'],
  }
  // `_blank` + 尺寸：授权过程不打断原页面，桌面端表现与宿子弹窗接近。
  const url = await openAppAuth('pickSharedFile', params, {
    target: '_blank',
    features: 'width=750,height=630',
  })
  return typeof url === 'string' ? url : undefined
}

/**
 * 当前环境是否走授权页路径（而不是宿主直调）。
 * @returns 是否为独立浏览器页面。
 */
export function usesAppAuthFlow(): boolean {
  return detectFnosEnvironment() === 'standalone'
}

/**
 * 在原页面监听授权回调。
 *
 * 校验了 `event.origin` 与 `state`：前者挡跨源伪造，后者挡同源但非本次请求的
 * 消息。
 *
 * @param state - 本次授权的 `state`。
 * @param onResult - 校验通过后的回调。
 * @returns 解除监听的函数。
 */
export function listenFnosAppAuthResult(
  state: string,
  onResult: (result: FnosAppAuthResult) => void,
): () => void {
  if (typeof window === 'undefined') return () => undefined
  const listener = (event: MessageEvent): void => {
    if (event.origin !== window.location.origin) return
    const data = event.data as { type?: string, result?: FnosAppAuthResult } | null
    if (data?.type !== APP_AUTH_MESSAGE_TYPE || data.result === undefined) return
    if (data.result.state !== state) return
    onResult(data.result)
  }
  window.addEventListener('message', listener)
  return () => { window.removeEventListener('message', listener) }
}
