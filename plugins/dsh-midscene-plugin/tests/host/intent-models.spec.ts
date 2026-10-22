import { describe, expect, it } from 'vitest'
import { resolveIntentModels } from '../../src/host/model-choice.ts'
import type { IntentModelConfig } from '../../src/host/model-choice.ts'
import type { ModelCatalogSnapshot } from '../../src/host/catalog.ts'

/**
 * 按职责决策模型（FNOS-021-02）。
 *
 * 这里锁定三条上游语义，任何一条错了都会**静默**失效（模型不生效但不报错）：
 * 1. 专用职责**未配置**时沿用默认职责，而不是回落会话模型；
 * 2. 专用职责的家族按**它自己的模型**推导，不沿用默认职责的家族；
 * 3. 专用职责配了但目录里没有该模型时，回落默认职责并**如实登记**，不改选别的。
 */

/** 造一份目录快照。 */
function snapshot(ids: readonly string[]): ModelCatalogSnapshot {
  return {
    entries: ids.map(id => ({
      id,
      name: id,
      owned_by: id.slice(0, id.indexOf('/')),
      vision: true,
    })),
    providers: [...new Set(ids.map(id => id.slice(0, id.indexOf('/'))))],
    fetchedAt: 0,
  }
}

/** 造一份职责配置（默认全空）。 */
function config(overrides: Partial<IntentModelConfig> = {}): IntentModelConfig {
  return {
    model: '',
    locateModel: '',
    planningModel: '',
    insightModel: '',
    family: 'glm-v',
    ...overrides,
  }
}

/** 没有会话模型（目录兜底会挑第一个识图模型）。 */
const noSession = { current: (): string | undefined => undefined }

describe('resolveIntentModels：留空即继承', () => {
  it('四个职责全空时，专用职责都沿用默认职责的结果', () => {
    const slots = resolveIntentModels(snapshot(['codebuddy/glm-5.3', 'codebuddy/deepseek-v4.1-flash']), config(), noSession)
    // 默认职责没指定模型 → 兜底挑目录里第一个识图模型。
    expect(slots.default.modelId).toBe('codebuddy/glm-5.3')
    for (const intent of ['locate', 'planning', 'insight'] as const) {
      expect(slots[intent].modelId, intent).toBe('codebuddy/glm-5.3')
      expect(slots[intent].family, intent).toBe('glm-v')
      expect(slots[intent].dedicated, intent).toBe(false)
      expect(slots[intent].source, intent).toBe('inherited')
    }
  })

  it('只配默认职责时，其余职责跟着默认走（不是回落会话模型）', () => {
    const slots = resolveIntentModels(
      snapshot(['codebuddy/glm-5.3', 'codebuddy/kimi-k3-1']),
      config({ model: 'codebuddy/kimi-k3-1' }),
      // 会话模型是另一个模型：若专用职责错误地回落会话模型，这里会立刻暴露。
      { current: () => 'codebuddy/glm-5.3' },
    )
    expect(slots.default.modelId).toBe('codebuddy/kimi-k3-1')
    expect(slots.default.source).toBe('configured')
    for (const intent of ['locate', 'planning', 'insight'] as const) {
      expect(slots[intent].modelId, intent).toBe('codebuddy/kimi-k3-1')
      expect(slots[intent].source, intent).toBe('inherited')
    }
  })
})

describe('resolveIntentModels：专用职责用自己的模型与家族', () => {
  it('配了定位模型后，定位用该模型且家族按它推导（不沿用默认家族）', () => {
    const slots = resolveIntentModels(
      snapshot(['codebuddy/glm-5.3', 'codebuddy/deepseek-v4.1-flash']),
      config({ model: 'codebuddy/glm-5.3', locateModel: 'codebuddy/deepseek-v4.1-flash' }),
      noSession,
    )
    expect(slots.default.family).toBe('glm-v')
    expect(slots.locate.modelId).toBe('codebuddy/deepseek-v4.1-flash')
    // 关键：家族随该职责自己的模型变，不是继续用 glm-v——否则坐标解析协议用错、点击偏移。
    expect(slots.locate.family).toBe('deepseek')
    expect(slots.locate.dedicated).toBe(true)
    expect(slots.locate.source).toBe('configured')
  })

  it('三个专用职责可以各用不同系列，互不串用', () => {
    const slots = resolveIntentModels(
      snapshot(['p/glm-5.3', 'p/deepseek-v4.1-flash', 'p/gpt-6-luna', 'p/kimi-k3-1']),
      config({
        model: 'p/glm-5.3',
        locateModel: 'p/deepseek-v4.1-flash',
        planningModel: 'p/gpt-6-luna',
        insightModel: 'p/kimi-k3-1',
      }),
      noSession,
    )
    expect(slots.locate.family).toBe('deepseek')
    expect(slots.planning.family).toBe('gpt-6')
    expect(slots.insight.family).toBe('kimi3')
  })
})

describe('resolveIntentModels：不存在的模型如实登记', () => {
  it('专用职责配了目录里没有的模型 → 回落默认并登记，不静默改选别的', () => {
    const slots = resolveIntentModels(
      snapshot(['codebuddy/glm-5.3']),
      config({ model: 'codebuddy/glm-5.3', locateModel: 'codebuddy/gone' }),
      noSession,
    )
    expect(slots.locate.dedicated).toBe(false)
    expect(slots.locate.modelId).toBe('codebuddy/glm-5.3')
    // 界面据此提示「目录中已不存在」，同时保留用户的选择。
    expect(slots.locate.skippedConfigured).toEqual(['codebuddy/gone'])
  })

  it('默认职责配了不存在的模型时仍走既有优先级（会话模型 → 识图兜底）', () => {
    const slots = resolveIntentModels(
      snapshot(['codebuddy/glm-5.3', 'codebuddy/kimi-k3-1']),
      config({ model: 'codebuddy/gone' }),
      { current: () => 'codebuddy/kimi-k3-1' },
    )
    expect(slots.default.modelId).toBe('codebuddy/kimi-k3-1')
    expect(slots.default.source).toBe('session')
    expect(slots.default.skippedConfigured).toContain('codebuddy/gone')
  })

  it('目录为空时所有职责都没有模型，且不抛错', () => {
    const slots = resolveIntentModels(snapshot([]), config({ model: 'a/b' }), noSession)
    for (const intent of ['default', 'locate', 'planning', 'insight'] as const) {
      expect(slots[intent].modelId, intent).toBeUndefined()
    }
  })
})
