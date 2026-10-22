import { describe, expect, it, vi } from 'vitest'
import { parseThinkingIntent, pickReasoningEffort, resolveReasoningEffort } from '../../src/host/reasoning.ts'

/**
 * 思考开关透传（FNOS-021-03）。
 *
 * 两组断言对应验收条件：
 * - AC-01：Midscene 关闭原生思考时，桥发出的请求不带「开启思考」的设置；
 * - AC-02：模型不支持对应档位时请求照常发出，不返回 `UNSUPPORTED_REASONING_EFFORT`。
 *
 * 关键约束是「只用宿主真实披露的档位 id」——自行拼一个不存在的字符串会在发起请求前
 * 被宿主拦下，等于把本来能用的请求打成失败。
 */

/** 造一份宿主档位表（按由弱到强排序）。 */
function efforts(...ids: string[]): { id: string, name: string }[] {
  return ids.map(id => ({ id, name: id.charAt(0).toUpperCase() + id.slice(1) }))
}

describe('parseThinkingIntent：各家族的思考字段形态', () => {
  it('豆包 / GLM / DeepSeek / Kimi / MiMo：thinking.type', () => {
    expect(parseThinkingIntent({ thinking: { type: 'disabled' } })).toEqual({ kind: 'disabled' })
    expect(parseThinkingIntent({ thinking: { type: 'enabled' } })).toEqual({ kind: 'enabled' })
    // 开启并带档位：按档位走，而不是笼统的「开启」。
    expect(parseThinkingIntent({ thinking: { type: 'enabled' }, reasoning_effort: 'medium' }))
      .toEqual({ kind: 'effort', value: 'medium' })
  })

  it('千问：enable_thinking 布尔', () => {
    expect(parseThinkingIntent({ enable_thinking: false })).toEqual({ kind: 'disabled' })
    expect(parseThinkingIntent({ enable_thinking: true })).toEqual({ kind: 'enabled' })
  })

  it('GPT 系：单独的 reasoning_effort，none 表示关闭', () => {
    expect(parseThinkingIntent({ reasoning_effort: 'none' })).toEqual({ kind: 'disabled' })
    expect(parseThinkingIntent({ reasoning_effort: 'low' })).toEqual({ kind: 'effort', value: 'low' })
  })

  it('Gemini：extra_body.google.thinking_config.thinking_level', () => {
    const gemini = (level: string): Record<string, unknown> => ({
      extra_body: { google: { thinking_config: { thinking_level: level } } },
    })
    // Gemini 自己的 minimal 就是「几乎不思考」，归到关闭意图。
    expect(parseThinkingIntent(gemini('minimal'))).toEqual({ kind: 'disabled' })
    expect(parseThinkingIntent(gemini('medium'))).toEqual({ kind: 'effort', value: 'medium' })
  })

  it('没有任何思考字段时返回 undefined（与升级前一致，不动请求）', () => {
    expect(parseThinkingIntent({})).toBeUndefined()
    expect(parseThinkingIntent({ temperature: 0.2, thinking_budget: 1024 })).toBeUndefined()
    // 空字符串不算「指定了值」。
    expect(parseThinkingIntent({ reasoning_effort: '   ' })).toBeUndefined()
    expect(parseThinkingIntent({ thinking: { type: '' } })).toBeUndefined()
  })

  it('字段类型不对时不影响判断（客户端可能发怪东西）', () => {
    expect(parseThinkingIntent({ thinking: 'disabled' })).toBeUndefined()
    expect(parseThinkingIntent({ reasoning_effort: 1 })).toBeUndefined()
    expect(parseThinkingIntent({ enable_thinking: 'false' })).toBeUndefined()
  })
})

describe('pickReasoningEffort：只用宿主披露的档位', () => {
  it('关闭意图优先命中真正的「关闭」档位', () => {
    expect(pickReasoningEffort({ kind: 'disabled' }, efforts('off', 'low', 'high'))).toBe('off')
    // 各家的写法不一致：none / disabled 同样视为关闭。
    expect(pickReasoningEffort({ kind: 'disabled' }, efforts('none', 'low'))).toBe('none')
    expect(pickReasoningEffort({ kind: 'disabled' }, efforts('disabled', 'low'))).toBe('disabled')
    // 名字而不是 id 命中也可以（宿主 name 是可读名）。
    expect(pickReasoningEffort({ kind: 'disabled' }, [{ id: 'o1', name: 'Off' }])).toBe('o1')
  })

  it('没有关闭档位时退到最低档（minimal）', () => {
    expect(pickReasoningEffort({ kind: 'disabled' }, efforts('minimal', 'low', 'high'))).toBe('minimal')
  })

  it('既无关闭也无最低档时**不传**（AC-02：宁可少传，不可乱传）', () => {
    // 这是关键取舍：拼一个不存在的档位会让宿主在发起请求前报 UNSUPPORTED_REASONING_EFFORT，
    // 把本来能用的请求打成失败。
    expect(pickReasoningEffort({ kind: 'disabled' }, efforts('low', 'medium', 'high'))).toBeUndefined()
    expect(pickReasoningEffort({ kind: 'disabled' }, [])).toBeUndefined()
  })

  it('开启意图取「能思考」里最省的一档，不一路拉到 max', () => {
    expect(pickReasoningEffort({ kind: 'enabled' }, efforts('off', 'low', 'high', 'max'))).toBe('low')
    // 只有 off：没有可用的「开启」档位 → 不传。
    expect(pickReasoningEffort({ kind: 'enabled' }, efforts('off'))).toBeUndefined()
  })

  it('指定档位时精确匹配，匹配不上就不传（绝不猜近似值）', () => {
    expect(pickReasoningEffort({ kind: 'effort', value: 'high' }, efforts('off', 'low', 'high'))).toBe('high')
    expect(pickReasoningEffort({ kind: 'effort', value: 'HIGH' }, efforts('off', 'low', 'high'))).toBe('high')
    // xhigh 不在可选列表里：不传，而不是降级成 high。
    expect(pickReasoningEffort({ kind: 'effort', value: 'xhigh' }, efforts('low', 'high'))).toBeUndefined()
  })
})

describe('resolveReasoningEffort：整条链路的降级行为', () => {
  it('没检索到思考字段时根本不查模型元数据（不制造额外开销）', async () => {
    const resolveModelInfo = vi.fn()
    const result = await resolveReasoningEffort({ resolveModelInfo } as never, 'p', 'm', {})
    expect(result).toBeUndefined()
    expect(resolveModelInfo).not.toHaveBeenCalled()
  })

  it('模型不支持推理时返回 undefined（请求照常发出）', async () => {
    const result = await resolveReasoningEffort(
      { resolveModelInfo: async () => ({ provider: 'p', id: 'm', name: 'M' }) } as never,
      'p',
      'm',
      { thinking: { type: 'disabled' } },
    )
    expect(result).toBeUndefined()
  })

  it('命中档位时返回该 id', async () => {
    const result = await resolveReasoningEffort(
      {
        resolveModelInfo: async () => ({
          provider: 'p',
          id: 'm',
          name: 'M',
          reasoning: { efforts: efforts('off', 'low', 'high') },
        }),
      } as never,
      'p',
      'm',
      { thinking: { type: 'disabled' } },
    )
    expect(result).toBe('off')
  })

  it('resolveModelInfo 抛错时降级为不传（元数据缺失不该让请求失败）', async () => {
    const result = await resolveReasoningEffort(
      {
        resolveModelInfo: async () => { throw new Error('adapter unavailable') },
      } as never,
      'p',
      'm',
      { thinking: { type: 'disabled' } },
    )
    expect(result).toBeUndefined()
  })
})
