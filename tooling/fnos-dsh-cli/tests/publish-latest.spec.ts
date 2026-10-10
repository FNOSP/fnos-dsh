import { describe, expect, it } from 'vitest'
import { generationOf, previousGenerationStable, revisionOf } from '../src/commands/publish-latest.js'

/**
 * `latest` 代际维护规则（FNOS-012-04）。
 *
 * 版本形态固定为 `<上游版本>.<修订>`（如 `0.2.0-rc.2.0`）；代际 = 去掉最后一个
 * 修订段的前缀。规则：新代际首版发布时把 `latest` 指向上一代最新稳定版，
 * 同代际迭代版不动。这里锁定代际解析与上一代解析两类纯函数。
 */

describe('generationOf（代际解析）', () => {
  it('去掉最后一个修订段得到代际', () => {
    expect(generationOf('0.2.0-rc.2.0')).toBe('0.2.0-rc.2')
    expect(generationOf('0.2.0-rc.2.1')).toBe('0.2.0-rc.2')
    expect(generationOf('0.1.7-rc.2.2')).toBe('0.1.7-rc.2')
  })

  it('裸上游号（预发布号后仅一个点段）不是带修订形态，返回 undefined', () => {
    expect(generationOf('0.2.0-rc.2')).toBeUndefined()
    expect(generationOf('0.1.0-rc.7')).toBeUndefined()
    expect(generationOf('1.0.0')).toBeUndefined()
  })
})

describe('revisionOf（修订序）', () => {
  it('取最后一段的数值；非数字段为 -1', () => {
    expect(revisionOf('0.2.0-rc.2.3')).toBe(3)
    expect(revisionOf('0.2.0-rc.2')).toBe(2) // 最后一段可解析即返回（分桶时不会用到裸上游号）
    expect(revisionOf('0.2.0-rc.beta')).toBe(-1)
  })
})

describe('previousGenerationStable（上一代最新稳定版）', () => {
  it('新代际首版：指向上一代的最大修订号', () => {
    const versions = [
      '0.1.7-rc.2.0', '0.1.7-rc.2.1', '0.1.7-rc.2.2',
      '0.2.0-rc.2.0', '0.2.0-rc.2.1',
    ]
    expect(previousGenerationStable(versions, '0.2.0-rc.2')).toBe('0.1.7-rc.2.2')
  })

  it('同代际迭代不产生上一代切换依据（上一代仍是它的前一代）', () => {
    const versions = ['0.1.7-rc.2.2', '0.2.0-rc.2.1']
    expect(previousGenerationStable(versions, '0.2.0-rc.2')).toBe('0.1.7-rc.2.2')
  })

  it('多代历史：取代际序最大的上一代，而非最早一代', () => {
    const versions = ['0.1.0-rc.7', '0.1.7-rc.2.2', '0.2.0-rc.2.0']
    expect(previousGenerationStable(versions, '0.2.0-rc.2')).toBe('0.1.7-rc.2.2')
  })

  it('上一代全部是裸上游号（无修订段）时不选出——裸号不构成代际', () => {
    // 裸上游号（0.2.0-rc.1）没有修订段，不构成代际分桶；上一代必须同样是
    // `<上游>.<修订>` 形态。这保证 latest 永远指向与本轮同形态的稳定版。
    const versions = ['0.2.0-rc.1', '0.2.0-rc.2.0']
    expect(previousGenerationStable(versions, '0.2.0-rc.2')).toBeUndefined()
  })

  it('没有上一代时返回 undefined', () => {
    expect(previousGenerationStable(['0.2.0-rc.2.0'], '0.2.0-rc.2')).toBeUndefined()
  })

  it('忽略无修订段的版本参与代际分桶之外的噪音（奇形版本不崩溃）', () => {
    const versions = ['0.1.7-rc.2.2', 'not-a-version', '0.2.0-rc.2.0']
    expect(previousGenerationStable(versions, '0.2.0-rc.2')).toBe('0.1.7-rc.2.2')
  })

  it('覆盖需求登记的 21 个历史版本形态中的代表序列', () => {
    // 自有插件的真实发布序列（节选自 npm versions 历史形态）。
    const versions = [
      '0.1.0-rc.1', '0.1.0-rc.7', '0.1.1-rc.2.0', '0.1.2-rc.1', '0.1.2-rc.1.2',
      '0.1.5-rc.2.0', '0.1.7-rc.1', '0.1.7-rc.2.0', '0.1.7-rc.2.1', '0.1.7-rc.2.2',
      '0.2.0-rc.1', '0.2.0-rc.2.0', '0.2.0-rc.2.1',
    ]
    // 发布 0.2.0-rc.2.0（新代际首版）→ latest 指向 0.1.7 代最新。
    expect(previousGenerationStable(versions, '0.2.0-rc.2')).toBe('0.1.7-rc.2.2')
    // 发布 0.2.0-rc.2.1（同代际）→ 上一代依然是 0.1.7-rc.2.2（不动 latest 的依据）。
    expect(previousGenerationStable(versions, '0.2.0-rc.2')).toBe('0.1.7-rc.2.2')
  })
})
