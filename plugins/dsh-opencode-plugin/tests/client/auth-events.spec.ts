import { describe, expect, it, vi } from 'vitest'
import { authEpoch, bumpAuthEpoch, subscribeAuthEpoch } from '../../src/client/services/auth-events.ts'

describe('登录代际广播', () => {
  it('推进代际并通知订阅者，取消订阅后不再通知', () => {
    const before = authEpoch()
    const listener = vi.fn()
    const unsubscribe = subscribeAuthEpoch(listener)

    bumpAuthEpoch()
    expect(authEpoch()).toBe(before + 1)
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    bumpAuthEpoch()
    expect(authEpoch()).toBe(before + 2)
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
