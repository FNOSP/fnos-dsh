import { describe, expect, it } from 'vitest'
import { maskApiKey } from '../../src/host/mask.ts'

describe('FNOS-010-04 账号 key 的可辨识掩码', () => {
  it('保留首尾片段，中间以掩码替代（同平台多个 key 可区分）', () => {
    const masked = maskApiKey('sk-tinyfish-AAAABBBBCCCCDDDDEEEEFFFFgggg')

    expect(masked.startsWith('sk-tin')).toBe(true)
    expect(masked.endsWith('gggg')).toBe(true)
    // 中段是不可还原的掩码，且完整 key 不出现在结果里。
    expect(masked).toContain('…')
    expect(masked).not.toContain('AAAABBBBCCCCDDDDEEEE')
  })

  it('两个同平台 key 的掩码不同（用户据此区分账号）', () => {
    const first = maskApiKey('sk-tinyfish-AAAABBBBCCCCDDDDEEEEFFFFgggg')
    const second = maskApiKey('sk-tinyfish-ZZZZYYYYXXXXWWWWVVVVUUUUtttt')

    expect(first).not.toBe(second)
    expect(first.endsWith('gggg')).toBe(true)
    expect(second.endsWith('tttt')).toBe(true)
  })

  it('中等长度 key 只保留极短首尾，避免还原出过多字符', () => {
    const masked = maskApiKey('abcdefghijklmno')

    // 15 字符属于中等长度：只露首尾各 2 位。
    expect(masked).toBe('ab…no')
  })

  it('过短的 key 整体掩掉，不泄露任何字符', () => {
    expect(maskApiKey('short')).toBe('••••••')
    expect(maskApiKey('12345678')).toBe('••••••')
  })

  it('空值与空白返回占位而不是空串（界面需要明确显示「已配置」）', () => {
    expect(maskApiKey('')).toBe('••••••')
    expect(maskApiKey('   ')).toBe('••••••')
  })

  it('掩码结果不含原 key 的连续中段（长度不足以重建）', () => {
    const key = 'sk-tinyfish-ZZZZYYYYXXXXWWWWVVVVUUUUtttt'
    const masked = maskApiKey(key)

    // 明文长度的一半都露不出来：掩码后的可见字符数远小于 key 长度。
    const visible = masked.replace(/…/gu, '').length
    expect(visible).toBeLessThan(key.length / 3)
  })
})
