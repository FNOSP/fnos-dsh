import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { describe, expect, it, vi } from 'vitest'
import { createThemePersistence } from '../../src/client/services/theme-persistence.ts'
import type { FnosSettings } from '../../src/contracts/theme-contract.ts'

function makeScope(initial: Partial<ConfigFormSnapshot<FnosSettings>> = {}) {
  let snapshot: ConfigFormSnapshot<FnosSettings> = {
    status: 'ready',
    value: undefined,
    base: undefined,
    user: undefined,
    revision: 0,
    writable: true,
    ...initial,
  }
  const set = vi.fn(() => Promise.resolve(true))
  const unset = vi.fn(() => Promise.resolve(true))
  const scope: ConfigForm<FnosSettings> = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    set,
    unset,
    mutate: vi.fn(() => Promise.resolve(true)),
  }
  return {
    scope,
    set,
    unset,
    publish(value: FnosSettings | undefined, revision?: number) {
      snapshot = { ...snapshot, value, ...(revision === undefined ? {} : { revision }) }
    },
    get revision() { return snapshot.revision },
  }
}

/** 让在途写入结算（微任务队列排空）。 */
const settle = () => new Promise<void>(resolve => { setTimeout(resolve, 0) })

describe('fnOS theme persistence', () => {
  it('stores the resolved fnOS theme while DSH follows the system', async () => {
    const host = makeScope()
    createThemePersistence(host.scope).sync('system', 'dark')
    expect(host.set).toHaveBeenCalledWith('systemTheme', 'dark')
    expect(host.unset).not.toHaveBeenCalled()
    await settle()
  })

  it('does not write an unchanged cache or write from a read-only scope', async () => {
    const cached = makeScope({ value: { systemTheme: 'light' } })
    createThemePersistence(cached.scope).sync('system', 'light')
    expect(cached.set).not.toHaveBeenCalled()
    expect(cached.unset).not.toHaveBeenCalled()

    // 上游 0.2.1 移除了 memory 模式：只读场景由 `writable: false` 表达。
    const readOnly = makeScope({ writable: false })
    createThemePersistence(readOnly.scope).sync('system', 'dark')
    expect(readOnly.set).not.toHaveBeenCalled()
    await settle()
  })

  it('clears the cached theme when DSH chooses an explicit theme', async () => {
    const host = makeScope({ value: { systemTheme: 'dark' } })
    createThemePersistence(host.scope).sync('light', null)
    expect(host.unset).toHaveBeenCalledWith('systemTheme')
    expect(host.set).not.toHaveBeenCalled()
    await settle()
  })

  it('coalesces repeated writes while the settings request is pending', async () => {
    let resolve!: () => void
    const host = makeScope()
    host.set.mockImplementation(() => new Promise<boolean>(done => { resolve = () => done(true) }))
    const persistence = createThemePersistence(host.scope)
    persistence.sync('system', 'dark')
    persistence.sync('system', 'dark')
    expect(host.set).toHaveBeenCalledTimes(1)
    resolve()
    await settle()
  })

  it('does not resend after a request resolves before the snapshot updates', async () => {
    let resolve!: () => void
    const host = makeScope()
    host.set.mockImplementation(() => new Promise<boolean>(done => { resolve = () => done(true) }))
    const persistence = createThemePersistence(host.scope)

    persistence.sync('system', 'dark')
    resolve()
    await settle()
    persistence.sync('system', 'dark')

    expect(host.set).toHaveBeenCalledTimes(1)
  })

  /**
   * issue #13 的核心回归：写入被拒绝后，旧实现清除抑制标记，下一轮通知再写，
   * 形成随通知数线性增长的写入风暴（实测 20 次通知 → 21 次写）。
   */
  it('stops retrying after the host rejects the write (issue #13)', async () => {
    const host = makeScope({ value: { systemTheme: 'light' } })
    host.unset.mockImplementation(() => Promise.reject(new Error('host refused unset')))
    const persistence = createThemePersistence(host.scope)

    persistence.sync('light', null)
    await settle()
    for (let round = 0; round < 19; round++) {
      persistence.sync('light', null)
      await settle()
    }

    expect(host.unset).toHaveBeenCalledTimes(1)
    expect(persistence.unwritableFields.has('systemTheme')).toBe(true)
  })

  /**
   * 宿主「接受但未收敛」：unset 返回 true，revision 不前进或视图仍返回原值。
   * 旧实现每轮都重发；新实现以 revision 收敛为依据，不重发。
   */
  it('does not resend when the host accepts but the snapshot never converges', async () => {
    const host = makeScope({ value: { systemTheme: 'light' }, revision: 10 })
    const persistence = createThemePersistence(host.scope)

    persistence.sync('light', null)
    await settle()
    // 通知 10 次，revision 始终停在同一值（宿主未真正落盘）
    for (let round = 0; round < 10; round++) {
      persistence.sync('light', null)
      await settle()
    }
    expect(host.unset).toHaveBeenCalledTimes(1)
  })

  it('allows a new write once the host revision advances', async () => {
    vi.useFakeTimers()
    try {
      const host = makeScope({ value: { systemTheme: 'light' }, revision: 10 })
      const persistence = createThemePersistence(host.scope)

      persistence.sync('light', null)
      await vi.advanceTimersByTimeAsync(0)
      // 宿主推进 revision：说明上一次写入已生效，允许新的目标写入
      host.publish({ systemTheme: 'light' }, 11)
      vi.setSystemTime(Date.now() + 2_000)
      persistence.sync('system', 'dark')

      expect(host.set).toHaveBeenCalledWith('systemTheme', 'dark')
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the cache updateable when the fnOS theme really changes', async () => {
    const host = makeScope({ value: { systemTheme: 'light' }, revision: 10 })
    const persistence = createThemePersistence(host.scope)

    persistence.sync('system', 'light')
    await settle()
    expect(host.set).not.toHaveBeenCalled() // 已是目标值

    // 主题真实变化：必须写入
    persistence.sync('system', 'dark')
    expect(host.set).toHaveBeenCalledWith('systemTheme', 'dark')
    await settle()
  })

  it('does not block a different field when one is unwritable', async () => {
    // 降级只作用于 systemTheme，不阻碍后续新的目标写入
    const host = makeScope({ value: { systemTheme: 'light' }, revision: 10 })
    host.unset.mockImplementation(() => Promise.reject(new Error('refused')))
    const persistence = createThemePersistence(host.scope)

    persistence.sync('light', null)
    await settle()
    expect(persistence.unwritableFields.has('systemTheme')).toBe(true)

    // 单字段降级后，同一字段的任何写入都停止（含 set）
    persistence.sync('system', 'dark')
    expect(host.set).not.toHaveBeenCalled()
    await settle()
  })
})
