import { describe, expect, it } from 'vitest'
import { filterModels, modelSearchHaystack, splitHidden } from '../../src/client/services/catalog-search.ts'
import { formatTokens, describeDuration, formatIsoTimestamp } from '../../src/client/services/format.ts'
import type { ZCodeModel } from '../../src/contracts/catalog.ts'

function model(id: string, name = id): ZCodeModel {
  return {
    id,
    name,
    api: 'anthropic-messages',
    baseURL: 'https://zcode.z.ai/api/v1/zcode-plan/anthropic',
    reasoning: false,
    input: ['text'],
    contextWindow: 1,
    maxTokens: 1,
    tools: true,
    accountFamily: 'bigmodel',
  }
}

const models = [model('GLM-5.3'), model('GLM-5.3-Flash'), model('GLM-5.2'), model('GLM-5-Turbo')]

describe('目录搜索', () => {
  it('空查询返回全部', () => {
    expect(filterModels(models, '')).toHaveLength(4)
    expect(filterModels(models, '   ')).toHaveLength(4)
  })

  it('大小写不敏感且空格等价于连字符', () => {
    expect(filterModels(models, 'glm 5.3').map(m => m.id)).toEqual(['GLM-5.3', 'GLM-5.3-Flash'])
    expect(filterModels(models, 'FLASH').map(m => m.id)).toEqual(['GLM-5.3-Flash'])
  })

  it('无匹配时返回空列表', () => {
    expect(filterModels(models, 'nope')).toEqual([])
  })

  it('按隐藏集合拆分并保持顺序', () => {
    const { visible, hidden } = splitHidden(models, new Set(['GLM-5.2']))
    expect(visible.map(m => m.id)).toEqual(['GLM-5.3', 'GLM-5.3-Flash', 'GLM-5-Turbo'])
    expect(hidden.map(m => m.id)).toEqual(['GLM-5.2'])
  })

  it('搜索关键字包含 id 与显示名', () => {
    expect(modelSearchHaystack(model('GLM-5.3', 'GLM 5.3 Pro'))).toBe('glm-5.3 glm 5.3 pro')
  })
})

describe('格式化', () => {
  it('token 数量压缩成 K/M', () => {
    expect(formatTokens(512)).toBe('512')
    expect(formatTokens(128_000)).toBe('128K')
    expect(formatTokens(1_000_000)).toBe('1M')
    expect(formatTokens(1_500_000)).toBe('1.5M')
    expect(formatTokens(0)).toBe('0')
    expect(formatTokens(Number.NaN)).toBe('0')
  })

  it('时长按分钟/小时/天分档', () => {
    expect(describeDuration(30_000)).toEqual({ value: 1, unit: 'minutes' })
    expect(describeDuration(90 * 60_000)).toEqual({ value: 2, unit: 'hours' })
    expect(describeDuration(72 * 3_600_000)).toEqual({ value: 3, unit: 'days' })
  })

  it('非法 ISO 时间返回 undefined 而不是 Invalid Date', () => {
    expect(formatIsoTimestamp(undefined)).toBeUndefined()
    expect(formatIsoTimestamp('not-a-date')).toBeUndefined()
    expect(formatIsoTimestamp('2026-10-25T00:00:00+08:00')).toBeTypeOf('string')
  })
})
