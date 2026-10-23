import { describe, expect, it } from 'vitest'
import {
  autoRefreshIntervalMs,
  MAX_AUTO_REFRESH_MS,
  MIN_AUTO_REFRESH_MS,
  POLL_HEARTBEAT_MS,
  shouldPoll,
} from '../../src/client/services/polling.ts'

describe('自动刷新间隔', () => {
  it('分钟转毫秒', () => {
    expect(autoRefreshIntervalMs(15)).toBe(15 * 60_000)
    expect(autoRefreshIntervalMs(1)).toBe(MIN_AUTO_REFRESH_MS)
  })

  it('0 或非法值表示关闭自动刷新', () => {
    expect(autoRefreshIntervalMs(0)).toBe(0)
    expect(autoRefreshIntervalMs(-3)).toBe(0)
    expect(autoRefreshIntervalMs(Number.NaN)).toBe(0)
    expect(autoRefreshIntervalMs(Number.POSITIVE_INFINITY)).toBe(0)
  })

  it('夹在 1 分钟到 240 分钟之间', () => {
    expect(autoRefreshIntervalMs(0.2)).toBe(MIN_AUTO_REFRESH_MS)
    expect(autoRefreshIntervalMs(9999)).toBe(MAX_AUTO_REFRESH_MS)
    expect(MAX_AUTO_REFRESH_MS).toBe(240 * 60_000)
  })

  it('心跳是 1 分钟，与最小刷新间隔一致', () => {
    expect(POLL_HEARTBEAT_MS).toBe(60_000)
  })
})

describe('轮询节流判定', () => {
  const minute = 60_000

  it('页面隐藏时不请求', () => {
    expect(shouldPoll({ hidden: true, intervalMs: 10 * minute, now: 1_000_000 })).toBe(false)
    expect(shouldPoll({ hidden: true, intervalMs: 10 * minute, lastPolledAt: 0, now: 1_000_000 })).toBe(false)
  })

  it('关闭自动刷新时不请求', () => {
    expect(shouldPoll({ hidden: false, intervalMs: 0, now: 1_000_000 })).toBe(false)
  })

  it('从未请求过时立即请求（恢复可见的第一拍）', () => {
    expect(shouldPoll({ hidden: false, intervalMs: 10 * minute, now: 1_000_000 })).toBe(true)
  })

  it('距上次请求不足间隔时跳过', () => {
    expect(shouldPoll({ hidden: false, intervalMs: 10 * minute, lastPolledAt: 1_000_000 - 9 * minute, now: 1_000_000 })).toBe(false)
  })

  it('达到间隔后请求', () => {
    expect(shouldPoll({ hidden: false, intervalMs: 10 * minute, lastPolledAt: 1_000_000 - 10 * minute, now: 1_000_000 })).toBe(true)
    expect(shouldPoll({ hidden: false, intervalMs: 10 * minute, lastPolledAt: 1_000_000 - 11 * minute, now: 1_000_000 })).toBe(true)
  })

  it('时钟回拨只会推迟一拍，不会触发密集请求', () => {
    expect(shouldPoll({ hidden: false, intervalMs: 10 * minute, lastPolledAt: 2_000_000, now: 1_000_000 })).toBe(false)
  })
})
