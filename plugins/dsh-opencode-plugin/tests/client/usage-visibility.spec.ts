import { describe, expect, it } from 'vitest'
import { modelKey, OPENCODE_PROVIDER } from '../../src/contracts/identity.ts'
import { readSelectedModel, readSelectedProvider, usageCapsuleVisible } from '../../src/client/services/usage-visibility.ts'

const goModel = modelKey('go', 'deepseek-v4.1-flash')
const zenModel = modelKey('zen', 'deepseek-v4.1-flash')

/**
 * 胶囊显隐的真值表。
 *
 * 合并后的供应商只有一个路由，模型用 `go:` / `zen:` 前缀区分；套餐额度只属于
 * `go:` 模型，`auto` 下选中 `zen:` 模型或别家供应商都不挂出。
 */
describe('OpenCode 用量胶囊显隐', () => {
  it('auto：选中 go: 模型时显示', () => {
    expect(usageCapsuleVisible({ visibility: 'auto', provider: OPENCODE_PROVIDER, model: goModel })).toBe(true)
  })

  it('auto：选中 zen: 模型时不显示套餐额度', () => {
    expect(usageCapsuleVisible({ visibility: 'auto', provider: OPENCODE_PROVIDER, model: zenModel })).toBe(false)
  })

  it('auto：读不到模型或供应商时不显示', () => {
    expect(usageCapsuleVisible({ visibility: 'auto' })).toBe(false)
    expect(usageCapsuleVisible({ visibility: 'auto', provider: OPENCODE_PROVIDER })).toBe(false)
    expect(usageCapsuleVisible({ visibility: 'auto', provider: 'codex', model: goModel })).toBe(false)
  })

  it('auto：已确认未登录时不挂出空胶囊', () => {
    expect(usageCapsuleVisible({ visibility: 'auto', provider: OPENCODE_PROVIDER, model: goModel, signedIn: false })).toBe(false)
    expect(usageCapsuleVisible({ visibility: 'auto', provider: OPENCODE_PROVIDER, model: goModel, signedIn: undefined })).toBe(true)
  })

  it('always：常驻，不看供应商与登录状态', () => {
    expect(usageCapsuleVisible({ visibility: 'always' })).toBe(true)
    expect(usageCapsuleVisible({ visibility: 'always', provider: 'codex' })).toBe(true)
    expect(usageCapsuleVisible({ visibility: 'always', provider: 'codex', signedIn: false })).toBe(true)
  })

  it('off：始终隐藏', () => {
    expect(usageCapsuleVisible({ visibility: 'off', provider: OPENCODE_PROVIDER, model: goModel })).toBe(false)
    expect(usageCapsuleVisible({ visibility: 'off', provider: OPENCODE_PROVIDER, model: goModel, signedIn: true })).toBe(false)
  })

  it('readSelectedProvider / readSelectedModel 优先 pending，其次 lastUsed', () => {
    expect(readSelectedProvider({ pending: { provider: OPENCODE_PROVIDER, model: goModel } })).toBe(OPENCODE_PROVIDER)
    expect(readSelectedModel({ pending: { provider: OPENCODE_PROVIDER, model: goModel } })).toBe(goModel)
    expect(readSelectedProvider({ pending: null, lastUsed: { provider: OPENCODE_PROVIDER, model: zenModel } })).toBe(OPENCODE_PROVIDER)
    expect(readSelectedModel({ pending: null, lastUsed: { provider: OPENCODE_PROVIDER, model: zenModel } })).toBe(zenModel)
    expect(readSelectedProvider({ pending: { provider: 'codex', model: 'x' }, lastUsed: { provider: OPENCODE_PROVIDER, model: goModel } })).toBe('codex')
    expect(readSelectedProvider(undefined)).toBeUndefined()
    expect(readSelectedModel(undefined)).toBeUndefined()
    expect(readSelectedProvider({ pending: { provider: '' } })).toBeUndefined()
    expect(readSelectedModel({ pending: { model: '' } })).toBeUndefined()
  })
})
