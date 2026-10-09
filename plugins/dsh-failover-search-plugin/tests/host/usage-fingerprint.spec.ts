import { describe, expect, it } from 'vitest'
import { usageFingerprint } from '../../src/host/usage-fingerprint.ts'
import type { FailoverSearchSettings } from '../../src/contracts/config.ts'

/** 构造一次配置取值。 */
function settings(overrides: Partial<FailoverSearchSettings> = {}): FailoverSearchSettings {
  return {
    tinyfishAccounts: [],
    tavilyAccounts: [],
    sourceOrder: ['tinyfish', 'tavily', 'deepseek-official'],
    timeoutMs: 15000,
    samePlatformRetry: true,
    usageRefreshMinutes: 5,
    requestProbe: true,
    ...overrides,
  }
}

describe('FNOS-010-08 用量快照的配置指纹', () => {
  it('新增账号会改变指纹（快照该重取）', () => {
    const before = usageFingerprint(settings({ tavilyAccounts: [] }))
    const after = usageFingerprint(settings({ tavilyAccounts: [{ key: 'tv-1' }] }))

    expect(before).not.toBe(after)
  })

  it('删除账号会改变指纹', () => {
    const before = usageFingerprint(settings({ tinyfishAccounts: [{ key: 'a' }, { key: 'b' }] }))
    const after = usageFingerprint(settings({ tinyfishAccounts: [{ key: 'a' }] }))

    expect(before).not.toBe(after)
  })

  it('改备注名会改变指纹（展示代号变了）', () => {
    const before = usageFingerprint(settings({ tavilyAccounts: [{ key: 'k', label: 'old' }] }))
    const after = usageFingerprint(settings({ tavilyAccounts: [{ key: 'k', label: 'new' }] }))

    expect(before).not.toBe(after)
  })

  it('只换 key 明文也改变指纹（换了账号就该重取用量）', () => {
    const before = usageFingerprint(settings({ tavilyAccounts: [{ key: 'key-one' }] }))
    const after = usageFingerprint(settings({ tavilyAccounts: [{ key: 'key-two' }] }))

    expect(before).not.toBe(after)
  })

  it('指纹**不含** key 明文（它会进入比对逻辑与日志附近，不能携带凭据）', () => {
    const fingerprint = usageFingerprint(settings({
      tinyfishAccounts: [{ key: 'sk-tinyfish-SECRETVALUE', label: 'tinyfish-1' }],
      tavilyAccounts: [{ key: 'tvly-dev-SECRETVALUE' }],
    }))

    expect(fingerprint).not.toContain('SECRETVALUE')
    expect(fingerprint).not.toContain('sk-tinyfish')
    expect(fingerprint).not.toContain('tvly-dev')
  })

  it('配置未变时指纹稳定（不触发多余刷新）', () => {
    const config = settings({ tinyfishAccounts: [{ key: 'a', label: 'tinyfish-1' }] })

    expect(usageFingerprint(config)).toBe(usageFingerprint(config))
  })

  it('账号顺序变化算作变化（轮转顺序与展示顺序都变了）', () => {
    const before = usageFingerprint(settings({ tinyfishAccounts: [{ key: 'a' }, { key: 'b' }] }))
    const after = usageFingerprint(settings({ tinyfishAccounts: [{ key: 'b' }, { key: 'a' }] }))

    expect(before).not.toBe(after)
  })

  it('无关字段（超时、探测开关）变化不影响指纹', () => {
    const base = usageFingerprint(settings({ tinyfishAccounts: [{ key: 'a' }] }))
    const changed = usageFingerprint(settings({ tinyfishAccounts: [{ key: 'a' }], timeoutMs: 30000, requestProbe: false }))

    expect(base).toBe(changed)
  })
})
