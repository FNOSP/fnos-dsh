/**
 * 出站指纹改写：句首锚定、整句匹配、改一个词。
 *
 * 这些断言同时钉住「为什么不做得更宽」：任何放宽匹配范围的做法都会让
 * 下面「不该改写」的用例变红，从而避免误伤用户正文。
 */
import { describe, expect, it } from 'vitest'
import { AUDIT_FINGERPRINT_REWRITES, maskAuditFingerprints } from '../src/host/outbound-mask.ts'

const BANNER = 'You are an AI agent powered by DeepSeek Harness.'

describe('maskAuditFingerprints', () => {
  it('句首命中 → 改写一个词，其余内容逐字保留', () => {
    const input = `${BANNER}\n\nYou are a coding agent.`
    const output = maskAuditFingerprints(input)

    expect(output).not.toBe(input)
    expect(output.startsWith('You are an AI agent powered via DeepSeek Harness.')).toBe(true)
    // 语义保留：句尾标点与后续内容都不动。
    expect(output.endsWith('\n\nYou are a coding agent.')).toBe(true)
  })

  it('忽略大小写命中（上游的匹配同样忽略大小写）', () => {
    expect(maskAuditFingerprints(BANNER.toLowerCase()))
      .toBe('You are an AI agent powered via DeepSeek Harness.')
  })

  /** 上游只在句首比对，句中出现同一句不会触发拦截，因此也不该改写。 */
  it('非句首出现 → 逐字不变（同一字符串引用）', () => {
    const cases = [
      `\n${BANNER}`,
      `Hi ${BANNER}`,
      `Something else.\n${BANNER}`,
      `Prefix text. ${BANNER}`,
    ]
    for (const input of cases) {
      const output = maskAuditFingerprints(input)
      expect(output).toBe(input)
    }
  })

  it('未命中任何规则 → 返回原字符串引用（零拷贝）', () => {
    const input = 'You are a helpful assistant.'
    expect(maskAuditFingerprints(input)).toBe(input)
  })

  it('空串安全', () => {
    expect(maskAuditFingerprints('')).toBe('')
  })

  /**
   * 只有**整句**才命中：上游的匹配是整句精确匹配，所以这里也必须整句替换，
   * 不能退化为子串替换——否则会命中用户正文里引用的相似文本。
   */
  it('缺少句末标点或产品名后加字 → 不变（整句精确匹配）', () => {
    const cases = [
      'You are an AI agent powered by DeepSeek Harness', // 缺句号
      'You are an AI agent powered by DeepSeek Harness v2.', // 产品名后加字，整句不再成立
      'You are a coding agent powered by DeepSeek Harness.', // 措辞不同
    ]
    for (const input of cases) {
      expect(maskAuditFingerprints(input)).toBe(input)
    }
  })

  /**
   * 句首整句后接更多内容时**仍要改写**：实测「整句在句首但后面跟内容」同样被
   * 上游拦截，因此匹配的是句首那一段，而不是要求整条内容等于该句。
   */
  it('句首整句后接内容 → 仍改写', () => {
    const input = `${BANNER} extra content`
    expect(maskAuditFingerprints(input))
      .toBe('You are an AI agent powered via DeepSeek Harness. extra content')
  })

  it('改写只作用于第一处（句首），不会连带改写后续重复出现', () => {
    const input = `${BANNER}\n\n${BANNER}`
    const output = maskAuditFingerprints(input)
    expect(output.startsWith('You are an AI agent powered via DeepSeek Harness.')).toBe(true)
    // 第二处位于非句首，保持原样。
    expect(output.endsWith(`\n\n${BANNER}`)).toBe(true)
  })

  it('规则表里每条都是句首锚定且不含全局标志', () => {
    // 全局标志会让 `test` 推进 lastIndex，导致同一正则下次调用行为漂移；
    // 句首锚定是匹配语义的前提，两者都属于规则表的结构性约束。
    for (const rule of AUDIT_FINGERPRINT_REWRITES) {
      expect(rule.match.source.startsWith('^')).toBe(true)
      expect(rule.match.flags).not.toContain('g')
      expect(rule.match.flags).not.toContain('m')
      expect(rule.replacement.length).toBeGreaterThan(0)
    }
  })

  it('改写后不再命中任何规则（幂等，避免重复请求反复改写）', () => {
    const once = maskAuditFingerprints(BANNER)
    expect(maskAuditFingerprints(once)).toBe(once)
  })
})
