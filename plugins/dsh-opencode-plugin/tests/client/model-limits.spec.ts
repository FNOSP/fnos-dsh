import { describe, expect, it } from 'vitest'
import { modelsWithToolLimit, OPENCODE_TOOL_LIMITS, toolLimitOf } from '../../src/client/services/model-limits.ts'

/** 目录模型的最小投影。 */
const model = (plan: string, id: string, extra: { disabled?: boolean; clientOnly?: boolean } = {}) =>
  ({ plan, id, ...extra })

describe('模型工具数量上限', () => {
  it('beam-free 记录为 128，其它模型没有上限', () => {
    expect(toolLimitOf('beam-free')).toBe(OPENCODE_TOOL_LIMITS['beam-free'])
    expect(toolLimitOf('beam-free')).toBe(128)
    expect(toolLimitOf('deepseek-v4.1-flash')).toBeUndefined()
  })

  it('带 plan 前缀的模型键也能查到', () => {
    expect(toolLimitOf('go:beam-free')).toBe(128)
    expect(toolLimitOf('zen:beam-free')).toBe(128)
    expect(toolLimitOf('go:deepseek-v4.1-flash')).toBeUndefined()
  })

  it('只挑可用模型：停用与仅官方客户端可用的条目不算', () => {
    const hits = modelsWithToolLimit([
      model('go', 'beam-free'),
      model('zen', 'beam-free', { clientOnly: true }),
      model('go', 'deepseek-v4.1-flash'),
      model('go', 'glm-5.3-flash', { disabled: true }),
    ])
    expect(hits).toEqual([{ id: 'beam-free', plan: 'go', limit: 128 }])
  })

  it('没有命中时返回空数组', () => {
    expect(modelsWithToolLimit([model('go', 'mimo-v2.6-flash')])).toEqual([])
  })
})
