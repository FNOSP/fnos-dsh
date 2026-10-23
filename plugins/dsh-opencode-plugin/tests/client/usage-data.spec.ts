import { describe, expect, it } from 'vitest'
import type { OpenCodeUsage } from '../../src/contracts/usage.ts'
import {
  usageSnapshotFromError,
  usageSnapshotFromResponse,
} from '../../src/client/services/usage-data.ts'
import type { OpenCodeUsageSnapshot } from '../../src/client/services/usage-data.ts'

const usage: OpenCodeUsage = {
  rolling: { status: 'ok', percent: 10, resetsAt: '2026-10-23T14:00:00.000Z' },
  weekly: { status: 'ok', percent: 20, resetsAt: '2026-10-27T09:00:00.000Z' },
  monthly: { status: 'rate-limited', percent: 30, resetsAt: '2026-11-22T09:00:00.000Z' },
  fetchedAt: Date.parse('2026-10-23T09:00:00.000Z'),
  plan: 'Go',
}

const ready: OpenCodeUsageSnapshot = { state: 'ready', signedIn: true, usage }

describe('用量快照推导', () => {
  it('读到额度时进入 ready 并替换旧窗口', () => {
    expect(usageSnapshotFromResponse({ signedIn: true, usage }, { state: 'loading' })).toEqual(ready)
    const next = usageSnapshotFromResponse({ signedIn: true, usage }, ready)
    expect(next).toEqual(ready)
  })

  it('已登录但本次读不到时保留旧窗口与获取时间', () => {
    const next = usageSnapshotFromResponse({ signedIn: true, error: 'upstream timeout' }, ready)
    expect(next.state).toBe('unavailable')
    expect(next.signedIn).toBe(true)
    expect(next.usage).toBe(usage)
    expect(next.message).toBe('upstream timeout')
  })

  it('已登录但没有历史窗口时不伪造窗口', () => {
    expect(usageSnapshotFromResponse({ signedIn: true }, { state: 'loading' })).toEqual({
      state: 'unavailable',
      signedIn: true,
    })
  })

  it('退出登录时丢弃旧窗口，避免把上一个账号的额度留在界面', () => {
    expect(usageSnapshotFromResponse({ signedIn: false }, ready)).toEqual({
      state: 'unavailable',
      signedIn: false,
    })
  })

  it('请求失败保留上次登录状态与窗口，并给出说明', () => {
    const next = usageSnapshotFromError(new Error('offline'), ready, 'fallback')
    expect(next).toEqual({
      state: 'unavailable',
      signedIn: true,
      usage,
      message: 'offline',
    })
  })

  it('从未成功读取时只给说明，不猜登录状态', () => {
    expect(usageSnapshotFromError(undefined, { state: 'loading' }, 'fallback')).toEqual({
      state: 'unavailable',
      message: 'fallback',
    })
  })
})
