import { describe, expect, it } from 'vitest'
import { OPENCODE_REASONING_LEVELS } from '../../src/contracts/catalog.ts'
import type { OpenCodeModel } from '../../src/contracts/catalog.ts'
import {
  apiKindLabelKey,
  countCatalogModels,
  featureLabelKey,
  filterCatalogModels,
  formatTokenCount,
  matchesPlanFilter,
  modelFeatures,
  modelMatchesTerms,
  planLabelKey,
  reasoningLevelLabelKey,
  reasoningLevels,
  searchTerms,
  supportedFeatureIds,
  supportsImageInput,
  withModelVisibility,
} from '../../src/client/services/catalog-search.ts'
import type { OpenCodeFeatureId } from '../../src/client/services/catalog-search.ts'
import { en, zh } from '../../src/client/locales.ts'

/** 构造一个目录条目；只覆盖需要断言的字段。 */
function model(overrides: Partial<OpenCodeModel> & Pick<OpenCodeModel, 'id' | 'name'>): OpenCodeModel {
  return {
    api: 'openai-completions',
    baseURL: 'https://opencode.ai/inference/go/openai/v1',
    reasoning: false,
    input: ['text'],
    contextWindow: 128_000,
    maxTokens: 8_192,
    plan: 'zen',
    tools: false,
    free: false,
    ...overrides,
  }
}

const claude = model({
  id: 'claude-sonnet-4',
  name: 'Claude Sonnet 4',
  family: 'claude',
  api: 'anthropic-messages',
  description: 'Anthropic flagship',
})
const gpt = model({
  id: 'gpt-5',
  name: 'GPT-5',
  family: 'gpt',
  api: 'openai-responses',
})
const gemini = model({
  id: 'gemini-2.5-pro',
  name: 'Gemini 2.5 Pro',
  family: 'gemini',
  api: 'google-generative-ai',
})
const goModel = model({
  id: 'minimax-m2',
  name: 'MiniMax M2',
  plan: 'go',
  tools: true,
  free: true,
})

describe('目录搜索', () => {
  it('空搜索返回全部并保持顺序', () => {
    expect(filterCatalogModels([claude, gpt, gemini], '')).toEqual([claude, gpt, gemini])
    expect(filterCatalogModels([claude, gpt, gemini], '   ')).toEqual([claude, gpt, gemini])
  })

  it('按名称 / id / 家族大小写不敏感匹配', () => {
    expect(filterCatalogModels([claude, gpt, gemini], 'CLAUDE')).toEqual([claude])
    expect(filterCatalogModels([claude, gpt, gemini], 'sonnet')).toEqual([claude])
    expect(filterCatalogModels([claude, gpt, gemini], 'gemini')).toEqual([gemini])
  })

  it('按协议族匹配', () => {
    expect(filterCatalogModels([claude, gpt, gemini], 'anthropic')).toEqual([claude])
    expect(filterCatalogModels([claude, gpt, gemini], 'generative-ai')).toEqual([gemini])
  })

  it('多个词按 AND 组合', () => {
    expect(filterCatalogModels([claude, gpt, gemini], 'gpt 5')).toEqual([gpt])
    expect(filterCatalogModels([claude, gpt, gemini], 'gpt claude')).toEqual([])
  })

  it('搜索词与命中判断单独可测', () => {
    expect(searchTerms('  GPT   5 ')).toEqual(['gpt', '5'])
    expect(modelMatchesTerms(gpt, ['gpt'])).toBe(true)
    expect(modelMatchesTerms(gpt, ['claude'])).toBe(false)
    expect(modelMatchesTerms(gpt, [])).toBe(true)
  })
})

describe('容量展示', () => {
  it('压缩成 K / M', () => {
    expect(formatTokenCount(200_000)).toBe('200K')
    expect(formatTokenCount(128_000)).toBe('128K')
    expect(formatTokenCount(1_000_000)).toBe('1M')
    expect(formatTokenCount(1_048_576)).toBe('1M')
    expect(formatTokenCount(1_500_000)).toBe('1.5M')
    expect(formatTokenCount(8_192)).toBe('8.2K')
    expect(formatTokenCount(999)).toBe('999')
  })

  it('非法或非正数不渲染数字', () => {
    expect(formatTokenCount(undefined)).toBeUndefined()
    expect(formatTokenCount(0)).toBeUndefined()
    expect(formatTokenCount(-1)).toBeUndefined()
    expect(formatTokenCount(Number.NaN)).toBeUndefined()
  })
})

describe('模型分组', () => {
  it('all 不过滤，go / zen 只保留本组条目', () => {
    const models = [claude, goModel]
    expect(matchesPlanFilter(claude, 'all')).toBe(true)
    expect(matchesPlanFilter(goModel, 'all')).toBe(true)
    expect(filterCatalogModels(models, '', 'all')).toEqual(models)
    expect(filterCatalogModels(models, '', 'go')).toEqual([goModel])
    expect(filterCatalogModels(models, '', 'zen')).toEqual([claude])
  })

  it('分组与搜索词是 AND 关系', () => {
    const models = [claude, goModel]
    expect(filterCatalogModels(models, 'minimax', 'go')).toEqual([goModel])
    expect(filterCatalogModels(models, 'minimax', 'zen')).toEqual([])
    expect(filterCatalogModels(models, 'claude', 'go')).toEqual([])
  })

  it('计数覆盖全部分组', () => {
    expect(countCatalogModels([])).toEqual({ all: 0, go: 0, zen: 0 })
    expect(countCatalogModels([claude, gpt, goModel])).toEqual({ all: 3, go: 1, zen: 2 })
  })

  it('分组标签走 locale：Go / 按量', () => {
    expect(planLabelKey('go')).toBe('catalogPlanGo')
    expect(planLabelKey('zen')).toBe('catalogPlanZen')
    expect(en[planLabelKey('go')]).toBe('Go')
    expect(zh[planLabelKey('zen')]).toBe('按量')
    expect(en[planLabelKey('zen')]).toBeTruthy()
    expect(zh[planLabelKey('go')]).toBeTruthy()
  })
})

describe('模型能力特性', () => {
  const full = model({
    id: 'full',
    name: 'Full',
    reasoning: true,
    thinkingLevelMap: { off: 'off', low: 'low', medium: null },
    tools: true,
    input: ['text', 'image'],
    free: true,
  })

  it('固定顺序列出五项能力', () => {
    expect(modelFeatures(full).map(feature => feature.id)).toEqual(['reasoning', 'tools', 'image', 'text', 'free'])
    expect(modelFeatures(full).every(feature => feature.supported)).toBe(true)
  })

  it('按契约字段判定支持与否', () => {
    const features = modelFeatures(gpt)
    expect(features.find(feature => feature.id === 'reasoning')?.supported).toBe(false)
    expect(features.find(feature => feature.id === 'tools')?.supported).toBe(false)
    expect(features.find(feature => feature.id === 'image')?.supported).toBe(false)
    expect(features.find(feature => feature.id === 'text')?.supported).toBe(true)
    expect(features.find(feature => feature.id === 'free')?.supported).toBe(false)
  })

  it('推理能力带上受支持的等级明细', () => {
    const reasoning = modelFeatures(full).find(feature => feature.id === 'reasoning')
    expect(reasoning?.levels).toEqual(['off', 'low'])
    const noMap = modelFeatures(model({ id: 'r', name: 'R', reasoning: true }))
      .find(feature => feature.id === 'reasoning')
    expect(noMap?.supported).toBe(true)
    expect(noMap?.levels).toBeUndefined()
  })

  it('图标只取受支持的能力，并保持固定顺序', () => {
    expect(supportedFeatureIds(full)).toEqual(['reasoning', 'tools', 'image', 'text', 'free'])
    expect(supportedFeatureIds(goModel)).toEqual(['tools', 'text', 'free'])
    expect(supportedFeatureIds(model({ id: 'bare', name: 'Bare', input: [] }))).toEqual([])
  })

  it('能力标签走 locale', () => {
    const ids: readonly OpenCodeFeatureId[] = ['reasoning', 'tools', 'image', 'text', 'free']
    for (const id of ids) {
      const key = featureLabelKey(id)
      expect(en[key]).toBeTruthy()
      expect(zh[key]).toBeTruthy()
    }
  })
})

describe('思考等级与图片输入', () => {
  it('只保留 thinkingLevelMap 里非 null 的等级，顺序按契约', () => {
    const reasoning = model({
      id: 'reasoning',
      name: 'Reasoning',
      reasoning: true,
      thinkingLevelMap: { low: 'low', medium: null, high: 'high', off: 'off' },
    })
    expect(reasoningLevels(reasoning)).toEqual(['off', 'low', 'high'])
  })

  it('不支持思考或没有映射时为空', () => {
    expect(reasoningLevels(gpt)).toEqual([])
    expect(reasoningLevels(model({ id: 'r', name: 'R', reasoning: true }))).toEqual([])
  })

  it('契约里的等级全集有稳定顺序', () => {
    expect(OPENCODE_REASONING_LEVELS[0]).toBe('off')
    expect(OPENCODE_REASONING_LEVELS.at(-1)).toBe('max')
  })

  it('思考等级标签走 locale', () => {
    for (const level of OPENCODE_REASONING_LEVELS) {
      const key = reasoningLevelLabelKey(level)
      expect(en[key]).toBeTruthy()
      expect(zh[key]).toBeTruthy()
    }
  })

  it('图片输入按 input 判断', () => {
    expect(supportsImageInput(gpt)).toBe(false)
    expect(supportsImageInput(model({ id: 'vision', name: 'Vision', input: ['text', 'image'] }))).toBe(true)
  })
})

describe('模型显隐写入', () => {
  it('隐藏时追加，显示时移除', () => {
    expect(withModelVisibility([], 'gpt-5', false)).toEqual(['gpt-5'])
    expect(withModelVisibility(['claude-sonnet-4', 'gpt-5'], 'gpt-5', true)).toEqual(['claude-sonnet-4'])
  })

  it('重复隐藏不产生重复项', () => {
    expect(withModelVisibility(['gpt-5'], 'gpt-5', false)).toEqual(['gpt-5'])
  })
})

describe('协议族文案键', () => {
  it('四种协议族都有中英文案', () => {
    const keys = [
      apiKindLabelKey('openai-completions'),
      apiKindLabelKey('openai-responses'),
      apiKindLabelKey('anthropic-messages'),
      apiKindLabelKey('google-generative-ai'),
    ]
    expect(new Set(keys).size).toBe(4)
    for (const key of keys) {
      expect(en[key]).toBeTruthy()
      expect(zh[key]).toBeTruthy()
    }
  })
})
