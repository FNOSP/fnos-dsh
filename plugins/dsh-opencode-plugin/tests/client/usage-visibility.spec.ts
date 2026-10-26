import { describe, expect, it } from 'vitest'
import { modelKey, OPENCODE_PROVIDER } from '../../src/contracts/identity.ts'
import { readSelectedModel, readSelectedProvider, usageCapsuleVisible } from '../../src/client/services/usage-visibility.ts'

const goModel = modelKey('go', 'deepseek-v4.1-flash')
const zenModel = modelKey('zen', 'deepseek-v4.1-flash')

/**
 * 胶囊显隐的真值表。
 *
 * 合并后的供应商只有一个路由，模型用 `go:` / `zen:` 前缀区分；两者都是本插件
 * 模型，`auto` 下供应商匹配即挂出（不再按套餐区分），别家供应商不挂出。
 */
describe('OpenCode 用量胶囊显隐', () => {
  it('auto：选中 go: 模型时显示', () => {
    expect(usageCapsuleVisible({ visibility: 'auto', provider: OPENCODE_PROVIDER })).toBe(true)
  })

  it('auto：选中 zen: 模型时也显示（不再区分套餐）', () => {
    expect(usageCapsuleVisible({ visibility: 'auto', provider: OPENCODE_PROVIDER })).toBe(true)
  })

  it('auto：读不到供应商时不显示', () => {
    expect(usageCapsuleVisible({ visibility: 'auto' })).toBe(false)
    expect(usageCapsuleVisible({ visibility: 'auto', provider: 'codex' })).toBe(false)
  })

  it('auto：已确认未登录时不挂出空胶囊', () => {
    expect(usageCapsuleVisible({ visibility: 'auto', provider: OPENCODE_PROVIDER, signedIn: false })).toBe(false)
    expect(usageCapsuleVisible({ visibility: 'auto', provider: OPENCODE_PROVIDER, signedIn: undefined })).toBe(true)
  })

  it('always：常驻，不看供应商与登录状态', () => {
    expect(usageCapsuleVisible({ visibility: 'always' })).toBe(true)
    expect(usageCapsuleVisible({ visibility: 'always', provider: 'codex' })).toBe(true)
    expect(usageCapsuleVisible({ visibility: 'always', provider: 'codex', signedIn: false })).toBe(true)
  })

  it('off：始终隐藏', () => {
    expect(usageCapsuleVisible({ visibility: 'off', provider: OPENCODE_PROVIDER })).toBe(false)
    expect(usageCapsuleVisible({ visibility: 'off', provider: OPENCODE_PROVIDER, signedIn: true })).toBe(false)
  })

  it('切到其它供应商时立即不显示（next 优先于 lastUsed）', () => {
    const projection = { next: { provider: 'codex', model: 'x' }, lastUsed: { provider: OPENCODE_PROVIDER, model: goModel } }
    expect(readSelectedProvider(projection)).toBe('codex')
    expect(usageCapsuleVisible({ visibility: 'auto', provider: readSelectedProvider(projection) })).toBe(false)
  })

  it('readSelectedProvider / readSelectedModel 优先 next，其次 lastUsed', () => {
    expect(readSelectedProvider({ next: { provider: OPENCODE_PROVIDER, model: goModel } })).toBe(OPENCODE_PROVIDER)
    expect(readSelectedModel({ next: { provider: OPENCODE_PROVIDER, model: goModel } })).toBe(goModel)
    expect(readSelectedProvider({ next: null, lastUsed: { provider: OPENCODE_PROVIDER, model: zenModel } })).toBe(OPENCODE_PROVIDER)
    expect(readSelectedModel({ next: null, lastUsed: { provider: OPENCODE_PROVIDER, model: zenModel } })).toBe(zenModel)
    expect(readSelectedProvider({ next: { provider: 'codex', model: 'x' }, lastUsed: { provider: OPENCODE_PROVIDER, model: goModel } })).toBe('codex')
    expect(readSelectedProvider(undefined)).toBeUndefined()
    expect(readSelectedModel(undefined)).toBeUndefined()
    expect(readSelectedProvider({ next: { provider: '' } })).toBeUndefined()
    expect(readSelectedModel({ next: { model: '' } })).toBeUndefined()
  })
})
