import { describe, expect, it } from 'vitest'
import { groupByPlatform, latestFetchedAt, projectAccount } from '../../src/client/usage-view.ts'
import type { AccountUsage } from '../../src/contracts/types.ts'

/** 构造一个快照条目。 */
function usage(overrides: Partial<AccountUsage> & Pick<AccountUsage, 'platform' | 'accountLabel'>): AccountUsage {
  return {
    fetchedAt: '2026-10-09T12:00:00.000Z',
    details: {},
    ...overrides,
  }
}

describe('FNOS-010-08 用量展示投影', () => {
  it('按条目顺序呈现真实存在的读数', () => {
    const card = projectAccount(usage({
      platform: 'tavily',
      accountLabel: 'tavily-1',
      details: { keyUsage: '0', plan: 'Researcher', planUsage: '167 / 1000' },
    }))

    expect(card.ok).toBe(true)
    expect(card.label).toBe('tavily-1')
    expect(card.entries.map(entry => entry.labelKey)).toEqual(['keyUsage', 'plan', 'planUsage'])
    expect(card.entries.map(entry => entry.value)).toEqual(['0', 'Researcher', '167 / 1000'])
  })

  it('缺失的读数不显示占位行（平台少给字段时界面就是没有那一行）', () => {
    const card = projectAccount(usage({
      platform: 'tinyfish',
      accountLabel: 'tinyfish-1',
      details: { balance: '11.6 USD' },
    }))

    expect(card.entries).toHaveLength(1)
    expect(card.entries[0]?.labelKey).toBe('balance')
  })

  it('读取失败时带可读提示且不呈现读数', () => {
    const card = projectAccount(usage({
      platform: 'tavily',
      accountLabel: 'tavily-1',
      details: {},
      error: 'WEB_PROVIDER_ERROR: tavily 返回 HTTP 500',
    }))

    expect(card.ok).toBe(false)
    expect(card.error).toContain('500')
    expect(card.entries).toEqual([])
  })

  it('按平台分组，顺序固定 TinyFish → Tavily', () => {
    const groups = groupByPlatform([
      usage({ platform: 'tavily', accountLabel: 'tavily-1' }),
      usage({ platform: 'tinyfish', accountLabel: 'tinyfish-1' }),
    ])

    expect(groups.map(group => group.platform)).toEqual(['tinyfish', 'tavily'])
    expect(groups[0]?.accounts[0]?.label).toBe('tinyfish-1')
    expect(groups[1]?.accounts[0]?.label).toBe('tavily-1')
  })

  it('空平台保留分组（用户能看出该平台还没配账号）', () => {
    const groups = groupByPlatform([])

    expect(groups).toHaveLength(2)
    expect(groups.every(group => group.accounts.length === 0)).toBe(true)
  })

  it('多账号在同一分组内并列呈现', () => {
    const groups = groupByPlatform([
      usage({ platform: 'tinyfish', accountLabel: 'tinyfish-1' }),
      usage({ platform: 'tinyfish', accountLabel: 'tinyfish-2' }),
    ])

    expect(groups[0]?.accounts.map(card => card.label)).toEqual(['tinyfish-1', 'tinyfish-2'])
  })

  it('整体时间戳取最新的一次获取时间', () => {
    const latest = latestFetchedAt([
      usage({ platform: 'tinyfish', accountLabel: 'a', fetchedAt: '2026-10-09T12:00:00.000Z' }),
      usage({ platform: 'tavily', accountLabel: 'b', fetchedAt: '2026-10-09T12:05:00.000Z' }),
    ])

    expect(latest).toBe('2026-10-09T12:05:00.000Z')
  })

  it('无快照时没有时间戳', () => {
    expect(latestFetchedAt([])).toBeUndefined()
  })

  it('展示模型不含任何 key 片段（快照本身就不携带）', () => {
    const groups = groupByPlatform([
      usage({ platform: 'tinyfish', accountLabel: 'tinyfish-1', details: { balance: '11.6 USD' } }),
    ])

    expect(JSON.stringify(groups)).not.toMatch(/sk-|tvly-/u)
  })
})
