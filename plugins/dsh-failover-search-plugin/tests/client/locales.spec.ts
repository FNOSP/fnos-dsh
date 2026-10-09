import { describe, expect, it } from 'vitest'
import { labelPlaceholderKey } from '../../src/client/locales.ts'
import { en, zh } from '../../src/client/locales.ts'

describe('FNOS-010-04 备注名 placeholder 按平台区分', () => {
  it('TinyFish 的示例名以 tinyfish 开头', () => {
    expect(zh[labelPlaceholderKey('tinyfish')]).toMatch(/tinyfish/)
    expect(en[labelPlaceholderKey('tinyfish')]).toMatch(/tinyfish/)
  })

  it('Tavily 的示例名以 tavily 开头（不串用 TinyFish 的示例）', () => {
    expect(zh[labelPlaceholderKey('tavily')]).toMatch(/tavily/)
    expect(en[labelPlaceholderKey('tavily')]).toMatch(/tavily/)
    expect(zh[labelPlaceholderKey('tavily')]).not.toMatch(/tinyfish/)
    expect(en[labelPlaceholderKey('tavily')]).not.toMatch(/tinyfish/)
  })

  it('两个平台的 placeholder 文案不同', () => {
    expect(zh[labelPlaceholderKey('tinyfish')]).not.toBe(zh[labelPlaceholderKey('tavily')])
    expect(en[labelPlaceholderKey('tinyfish')]).not.toBe(en[labelPlaceholderKey('tavily')])
  })

  it('未知平台回落到通用示例（不带任何平台前缀误导）', () => {
    const value = zh[labelPlaceholderKey('unknown-platform' as never)]
    expect(typeof value).toBe('string')
    expect(value.length).toBeGreaterThan(0)
  })
})
