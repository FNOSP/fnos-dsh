/** 套餐用量的同源路由调用与快照推导。 */

import { OPENCODE_ROUTES } from '../../contracts/routes.ts'
import type { OpenCodeUsage } from '../../contracts/usage.ts'
import { errorMessage, requestJson } from './http.ts'

/**
 * 用量端点响应。
 *
 * 未登录时宿主返回 `{ signedIn: false }`；已登录但上游暂时读不到时返回
 * `{ signedIn: true }` 或 `{ signedIn: true, error }`——两种情况都不是 HTTP
 * 错误，界面要区分「没登录」「读不到」与「请求失败」。
 */
export interface OpenCodeUsageResponse {
  readonly signedIn: boolean
  readonly usage?: OpenCodeUsage
  readonly error?: string
}

/** 读取当前账号的 Go 套餐额度。 */
export function readUsage(): Promise<OpenCodeUsageResponse> {
  return requestJson<OpenCodeUsageResponse>(OPENCODE_ROUTES.usage)
}

/** 一次用量快照的界面状态。 */
export interface OpenCodeUsageSnapshot {
  readonly state: 'loading' | 'ready' | 'unavailable'
  /** 宿主确认的登录状态；读取失败时为 undefined（不据此隐藏胶囊）。 */
  readonly signedIn?: boolean
  readonly usage?: OpenCodeUsage
  /** 宿主或网络给出的可读原因。 */
  readonly message?: string
}

/**
 * 从宿主响应推导下一份快照。
 *
 * 已登录但本次读不到额度时**保留最近一次成功读取的窗口与获取时间**：验收要求
 * 失败时显示说明与获取时间，且不把未读到的窗口显示成 0%。退出登录则丢弃旧
 * 窗口，避免把上一个账号的额度留在界面上。
 *
 * @param response - 用量端点响应。
 * @param previous - 当前快照。
 * @returns 下一份快照。
 */
export function usageSnapshotFromResponse(
  response: OpenCodeUsageResponse,
  previous: OpenCodeUsageSnapshot,
): OpenCodeUsageSnapshot {
  if (!response.signedIn) return { state: 'unavailable', signedIn: false }
  if (response.usage !== undefined) return { state: 'ready', signedIn: true, usage: response.usage }
  return {
    state: 'unavailable',
    signedIn: true,
    ...(previous.usage === undefined ? {} : { usage: previous.usage }),
    ...(response.error === undefined ? {} : { message: response.error }),
  }
}

/**
 * 请求失败时的快照。
 *
 * 保留上一次确认过的登录状态（一次网络失败不该让 `auto` 把胶囊藏起来）与最近
 * 成功读取的窗口；`signedIn` 未知时保持 undefined。
 *
 * @param error - 请求异常。
 * @param previous - 当前快照。
 * @param fallback - 无错误文案时的 locale 兜底。
 * @returns 下一份快照。
 */
export function usageSnapshotFromError(
  error: unknown,
  previous: OpenCodeUsageSnapshot,
  fallback: string,
): OpenCodeUsageSnapshot {
  return {
    state: 'unavailable',
    ...(previous.signedIn === undefined ? {} : { signedIn: previous.signedIn }),
    ...(previous.usage === undefined ? {} : { usage: previous.usage }),
    message: errorMessage(error, fallback),
  }
}
