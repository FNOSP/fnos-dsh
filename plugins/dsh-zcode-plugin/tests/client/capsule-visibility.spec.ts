import { describe, expect, it } from 'vitest'
import { ZCODE_PROVIDER } from '../../src/contracts/identity.ts'
import {
  readSelectedModel,
  readSelectedProvider,
  shouldShowCapsule,
} from '../../src/client/services/capsule-visibility.ts'

const zcodeModel = 'GLM-5.3'

/**
 * ZCode 用量胶囊显隐的回归用例。
 *
 * 投影 wire view 的字段是 `next`（宿主状态里的 `pending` 不会下发）；
 * 这里钉住「切走模型后立即不显示」，防止退回读 `lastUsed` 或 `pending`。
 */
describe('ZCode 用量胶囊显隐', () => {
  it('next 指向本插件时显示', () => {
    const projection = { next: { provider: ZCODE_PROVIDER, model: zcodeModel } }
    expect(readSelectedProvider(projection)).toBe(ZCODE_PROVIDER)
    expect(readSelectedModel(projection)).toBe(zcodeModel)
    expect(shouldShowCapsule('auto', readSelectedProvider(projection))).toBe(true)
  })

  it('切到其它供应商时立即不显示（next 优先于 lastUsed）', () => {
    const projection = {
      next: { provider: 'codex', model: 'x' },
      lastUsed: { provider: ZCODE_PROVIDER, model: zcodeModel },
    }
    expect(readSelectedProvider(projection)).toBe('codex')
    expect(shouldShowCapsule('auto', readSelectedProvider(projection))).toBe(false)
  })

  it('next 为 null 时退回 lastUsed', () => {
    const projection = { next: null, lastUsed: { provider: ZCODE_PROVIDER, model: zcodeModel } }
    expect(readSelectedProvider(projection)).toBe(ZCODE_PROVIDER)
    expect(readSelectedModel(projection)).toBe(zcodeModel)
  })

  it('投影缺失或字段为空时按未选中处理', () => {
    expect(readSelectedProvider(undefined)).toBeUndefined()
    expect(readSelectedModel(undefined)).toBeUndefined()
    expect(readSelectedProvider({ next: { provider: '' } })).toBeUndefined()
    expect(readSelectedModel({ next: { model: '' } })).toBeUndefined()
    expect(shouldShowCapsule('auto', undefined)).toBe(false)
  })

  it('always 常驻、off 隐藏、未登录隐藏', () => {
    expect(shouldShowCapsule('always', 'codex')).toBe(true)
    expect(shouldShowCapsule('off', ZCODE_PROVIDER)).toBe(false)
    expect(shouldShowCapsule('auto', ZCODE_PROVIDER, false)).toBe(false)
  })
})
