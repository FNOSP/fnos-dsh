/**
 * 自动刷新节流：偏好里的分钟数 → 轮询间隔，以及「这一拍该不该请求」。
 *
 * 定时器按固定的心跳运行，真正是否请求由 `shouldPoll` 判定：
 * 页面隐藏时不请求（`document.hidden` 由调用方传入），两次请求间隔不得小于
 * 配置的刷新间隔。这样切换前后台、偏好从 0 改为有效值时都不会出现请求风暴。
 *
 * @module dsh-opencode/client/polling
 */

import { OPENCODE_REFRESH_MINUTES } from '../../contracts/preferences.ts'

/** 定时器心跳：即使刷新间隔是 15 分钟，也按分钟检查可见性与到期时间。 */
export const POLL_HEARTBEAT_MS = 60_000

/** 合法刷新间隔的下限（毫秒）：0 表示关闭，非 0 时至少 1 分钟。 */
export const MIN_AUTO_REFRESH_MS = 60_000

/** 合法刷新间隔的上限（毫秒），与契约的 `OPENCODE_REFRESH_MINUTES.max` 对齐。 */
export const MAX_AUTO_REFRESH_MS = OPENCODE_REFRESH_MINUTES.max * 60_000

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
 * 页面隐藏一律不请求；首次（没有 `lastPolledAt`）由调用方直接请求，这里返回
 * true 以便恢复可见后立即补一次。
 * @param input - 可见性、间隔与上次请求时间。
 * @returns 应请求时为 true。
 */
export function shouldPoll(input: PollGateInput): boolean {
  if (input.hidden) return false
  if (input.intervalMs <= 0) return false
  if (input.lastPolledAt === undefined) return true
  // 容忍时钟回拨：算出的差值变小只会推迟一拍，不会触发密集请求。
  return input.now - input.lastPolledAt >= input.intervalMs
}
