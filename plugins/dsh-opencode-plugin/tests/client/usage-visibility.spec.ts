import { describe, expect, it } from 'vitest'
import { OPENCODE_GO_PROVIDER, OPENCODE_PROVIDER } from '../../src/contracts/identity.ts'
import { readSelectedProvider, usageCapsuleVisible } from '../../src/client/services/usage-visibility.ts'

/**
 * 胶囊显隐的真值表。
 *
 * 三个用量插件都挂在 `conversation.input.right`，只按自己的登录态判断会让
 * 别家的图标在选中一家模型时也显示。判断依据是会话投影 `modelSelection` 的
 * `provider`；读不到就不显示，不猜供应商。
 *
 * 套餐额度只属于 Go 组：`dsh-opencode`（Zen 按量）没有套餐窗口，`auto` 下不挂出。
 */
describe('OpenCode 用量胶囊显隐', () => {
  it('auto：选中 dsh-opencode-go 模型时显示', () => {
    expect(usageCapsuleVisible({ visibility: 'auto', provider: OPENCODE_GO_PROVIDER })).toBe(true)
  })

  it('auto：选中按量组（dsh-opencode）时不显示套餐额度', () => {
    expect(OPENCODE_PROVIDER).toBe('dsh-opencode')
    expect(usageCapsuleVisible({ visibility: 'auto', provider: OPENCODE_PROVIDER })).toBe(false)
  })

  it('auto：选中别家供应商时不显示', () => {
    expect(usageCapsuleVisible({ visibility: 'auto', provider: 'codex' })).toBe(false)
    expect(usageCapsuleVisible({ visibility: 'auto', provider: 'anthropic' })).toBe(false)
    expect(usageCapsuleVisible({ visibility: 'auto', provider: 'opencode' })).toBe(false)
  })

  it('auto：读不到供应商时不显示', () => {
    expect(usageCapsuleVisible({ visibility: 'auto' })).toBe(false)
    expect(usageCapsuleVisible({ visibility: 'auto', provider: undefined })).toBe(false)
  })

  it('auto：已确认未登录时不挂出空胶囊', () => {
    expect(usageCapsuleVisible({ visibility: 'auto', provider: OPENCODE_GO_PROVIDER, signedIn: false })).toBe(false)
    expect(usageCapsuleVisible({ visibility: 'auto', provider: OPENCODE_GO_PROVIDER, signedIn: undefined })).toBe(true)
  })

  it('always：常驻，不看供应商与登录状态', () => {
    expect(usageCapsuleVisible({ visibility: 'always' })).toBe(true)
    expect(usageCapsuleVisible({ visibility: 'always', provider: 'codex' })).toBe(true)
    expect(usageCapsuleVisible({ visibility: 'always', provider: 'codex', signedIn: false })).toBe(true)
  })

  it('off：始终隐藏', () => {
    expect(usageCapsuleVisible({ visibility: 'off', provider: OPENCODE_GO_PROVIDER })).toBe(false)
    expect(usageCapsuleVisible({ visibility: 'off', provider: OPENCODE_GO_PROVIDER, signedIn: true })).toBe(false)
  })

  it('readSelectedProvider 优先 next，其次 lastUsed', () => {
    expect(readSelectedProvider({ next: { provider: OPENCODE_GO_PROVIDER } })).toBe(OPENCODE_GO_PROVIDER)
    expect(readSelectedProvider({ next: null, lastUsed: { provider: OPENCODE_GO_PROVIDER } })).toBe(OPENCODE_GO_PROVIDER)
    // next 有值时不会被 lastUsed 覆盖。
    expect(readSelectedProvider({ next: { provider: 'codex' }, lastUsed: { provider: OPENCODE_GO_PROVIDER } })).toBe('codex')
    expect(readSelectedProvider(undefined)).toBeUndefined()
    expect(readSelectedProvider({ next: { provider: '' } })).toBeUndefined()
    expect(readSelectedProvider({ next: { provider: null } })).toBeUndefined()
  })
})
