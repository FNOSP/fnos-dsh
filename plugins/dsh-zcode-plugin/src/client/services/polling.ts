/**
 * 定时器与自动刷新节流。
 *
 * 组件不直接用 `setInterval`：DSH 客户端在页面隐藏/卸载时需要能统一释放
 * 定时器，直接用全局定时器会在 iframe 复用场景泄漏。宿主注入的 `timer`
 * 服务的 `interval` 返回一个清理函数，正好适配 React 的 effect 清理。
 *
 * 刷新间隔按偏好换算，并有下限与上限；0 表示关闭自动刷新。
 *
 * @module dsh-zcode/client/polling
 */

import { ZCODE_REFRESH_MINUTES } from '../../contracts/preferences.ts'

/** 定时器心跳：即使刷新间隔是 15 分钟，也按分钟检查可见性与到期时间。 */
export const POLL_HEARTBEAT_MS = 60_000

/** 合法刷新间隔的下限（毫秒）：0 表示关闭，非 0 时至少 1 分钟。 */
export const MIN_AUTO_REFRESH_MS = 60_000

/** 合法刷新间隔的上限（毫秒），与契约的 `ZCODE_REFRESH_MINUTES.max` 对齐。 */
export const MAX_AUTO_REFRESH_MS = ZCODE_REFRESH_MINUTES.max * 60_000

/** 宿主的定时器服务（与会话/连接服务一样由 Cordis 注入）。 */
export interface TimerService {
  interval(callback: () => void, delay: number): () => void
}

/**
 * 把偏好里的分钟数转成轮询间隔。
 * @param minutes - 自动刷新间隔（分钟）。
 * @returns 毫秒间隔；`0` 或非法值表示关闭自动刷新。
 */
export function autoRefreshIntervalMs(minutes: number): number {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0) return 0
  const interval = Math.round(minutes * 60_000)
  return Math.min(MAX_AUTO_REFRESH_MS, Math.max(MIN_AUTO_REFRESH_MS, interval))
}

/** 一次轮询判定的输入。 */
export interface PollGateInput {
  /** 页面是否隐藏（`document.hidden`）。 */
  readonly hidden: boolean
  /** 自动刷新间隔（毫秒）；0 表示关闭。 */
  readonly intervalMs: number
  /** 上一次成功发起请求的时间；从未请求时省略。 */
  readonly lastPolledAt?: number | undefined
  /** 当前时间（epoch 毫秒）。 */
  readonly now: number
}

/**
 * 这一拍是否应发起请求。
 *
 * 页面隐藏一律不请求；首次（没有 `lastPolledAt`）返回 true，让调用方在恢复
 * 可见后立即补一次。
 */
export function shouldPoll(input: PollGateInput): boolean {
  if (input.hidden) return false
  if (input.intervalMs <= 0) return false
  if (input.lastPolledAt === undefined) return true
  // 容忍时钟回拨：算出的差值变小只会推迟一拍，不会触发密集请求。
  return input.now - input.lastPolledAt >= input.intervalMs
}

/** 等待指定毫秒。 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => {
    const handle = setTimeout(resolve, ms)
    handle.unref?.()
  })
}
