import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { opencodeProvider } from '@earendil-works/pi-ai/providers/opencode'
import { opencodeGoProvider } from '@earendil-works/pi-ai/providers/opencode-go'
import { describe, expect, it } from 'vitest'
import type { OpenCodeModel } from '../../src/contracts/catalog.ts'
import { selectableModels } from '../../src/contracts/catalog.ts'
import {
  OPENCODE_GO_ESTIMATES,
  OPENCODE_GO_PLUS_ESTIMATES,
  estimatesForPlan,
  type OpenCodeEstimateTable,
} from '../../src/contracts/estimates.ts'
import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_TOKENS,
  apiFromUrl,
  applyCatalogView,
  applyEndpointPlan,
  baseURLFor,
  buildCatalog,
  dedupeByPlan,
  modelCostFrom,
  modelLimitFrom,
  modelReasoningFrom,
  buildCatalogEntry,
  consoleScopesFromConsoleConfig,
  safeConsoleHeaders,
  scopeToAccountPlan,
  sortCatalogModels,
  thinkingLevelMapFromReasoning,
} from '../../src/host/catalog.ts'

async function fixture<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), 'utf8')) as T
}

const builtin = {
  zen: opencodeProvider().getModels(),
  go: opencodeGoProvider().getModels(),
}

async function publicCatalog() {
  return buildCatalog({
    catalog: await fixture('catalog.json'),
    zenRoster: await fixture('zen-models.json'),
    goRoster: await fixture('go-models.json'),
    builtin,
    now: 1,
  })
}

describe('OpenCode 模型目录归一化', () => {
  it('两组供应商分别以活 roster 为全集，协议与端点逐条正确', async () => {
    const catalog = await publicCatalog()
    expect(catalog.source).toBe('public')
    expect(catalog.fetchedAt).toBe(1)
    const zen = catalog.models.filter(model => model.plan === 'zen')
    const go = catalog.models.filter(model => model.plan === 'go')
    expect(go.length).toBe(36)
    expect(zen.length).toBe(85)
    for (const model of catalog.models) {
      expect(model.id.length).toBeGreaterThan(0)
      expect(model.baseURL).toBe(baseURLFor(model.plan, model.api))
      expect(model.input).toContain('text')
      expect(model.contextWindow).toBeGreaterThan(0)
      expect(model.maxTokens).toBeGreaterThan(0)
      expect(typeof model.tools).toBe('boolean')
    }
  })

  it('同名模型分属两组时端点不同（Go 走 /go，Zen 走按量网关）', async () => {
    const catalog = await publicCatalog()
    const zen = catalog.models.find(model => model.plan === 'zen' && model.id === 'deepseek-v4.1-flash')
    const go = catalog.models.find(model => model.plan === 'go' && model.id === 'deepseek-v4.1-flash')
    expect(zen?.baseURL).toBe('https://opencode.ai/inference/openai/v1')
    expect(go?.baseURL).toBe('https://opencode.ai/inference/go/openai/v1')
    expect(zen?.plan).toBe('zen')
    expect(go?.plan).toBe('go')
  })

  it('Go 套餐模型的能力字段来自公开目录', async () => {
    const catalog = await publicCatalog()
    const model = catalog.models.find(entry => entry.plan === 'go' && entry.id === 'deepseek-v4.1-flash')
    expect(model?.api).toBe('openai-completions')
    expect(model?.input).toEqual(['text', 'image'])
    expect(model?.contextWindow).toBe(1_000_000)
    expect(model?.maxTokens).toBe(384_000)
    expect(model?.reasoning).toBe(true)
    expect(model?.tools).toBe(true)
    expect(model?.free).toBe(false)
    expect(model?.thinkingLevelMap).toEqual({
      off: null,
      minimal: null,
      low: 'low',
      medium: null,
      high: 'high',
      xhigh: null,
      max: 'max',
    })
  })

  it('Zen 按量模型按 AI SDK 包名分流三种协议', async () => {
    const catalog = await publicCatalog()
    const byId = new Map(catalog.models.filter(model => model.plan === 'zen').map(model => [model.id, model]))
    expect(byId.get('glm-5')?.api).toBe('openai-completions')
    expect(byId.get('glm-5')?.baseURL).toBe('https://opencode.ai/inference/openai/v1')
    expect(byId.get('gpt-5')?.api).toBe('openai-responses')
    expect(byId.get('claude-haiku-4-5')?.api).toBe('anthropic-messages')
    expect(byId.get('claude-haiku-4-5')?.baseURL).toBe('https://opencode.ai/inference/anthropic')
    expect(byId.get('gemini-4-argon')?.api).toBe('google-generative-ai')
    expect(byId.get('gemini-4-argon')?.baseURL).toBe('https://opencode.ai/inference/google/v1beta')
  })

  it('Go roster 独有模型从 Zen 目录段继承逐模型协议（不退回 provider 缺省）', async () => {
    const catalog = await publicCatalog()
    const byId = new Map(catalog.models.filter(model => model.plan === 'go').map(model => [model.id, model]))
    expect(byId.get('grok-4.6')?.api).toBe('openai-responses')
    expect(byId.get('grok-4.6')?.baseURL).toBe('https://opencode.ai/inference/go/openai/v1')
    expect(byId.get('qwen3.6-plus')?.api).toBe('anthropic-messages')
    expect(byId.get('qwen3.6-plus')?.baseURL).toBe('https://opencode.ai/inference/go/anthropic')
    expect(byId.get('glm-5.1')?.api).toBe('openai-completions')
  })

  it('免费模型被标记（价格全为 0）', async () => {
    const catalog = await publicCatalog()
    expect(catalog.models.find(model => model.id === 'big-pickle' && model.plan === 'zen')?.free).toBe(true)
    expect(catalog.models.find(model => model.id === 'deepseek-v4.1-flash' && model.plan === 'go')?.free).toBe(false)
  })

  it('Zen 免费模型标为仅官方客户端可用，Go 免费模型不受限', async () => {
    const catalog = await publicCatalog()
    const zenFree = catalog.models.filter(model => model.plan === 'zen' && model.free)
    expect(zenFree.length).toBeGreaterThan(0)
    for (const model of zenFree) expect(model.clientOnly).toBe(true)
    // 同一个 beam-free 在两段都出现：zen 段禁用，go 段可用，各走自身端点。
    const beamZen = catalog.models.find(model => model.id === 'beam-free' && model.plan === 'zen')
    const beamGo = catalog.models.find(model => model.id === 'beam-free' && model.plan === 'go')
    expect(beamZen?.clientOnly).toBe(true)
    expect(beamGo?.free).toBe(true)
    expect(beamGo?.clientOnly).toBeUndefined()
    expect(beamZen?.baseURL).toBe('https://opencode.ai/inference/openai/v1')
    expect(beamGo?.baseURL).toBe('https://opencode.ai/inference/go/openai/v1')
  })

  it('selectableModels 剔除仅官方客户端可用的免费模型', async () => {
    const catalog = await publicCatalog()
    const selectable = selectableModels(catalog)
    expect(selectable.some(model => model.clientOnly === true)).toBe(false)
    expect(selectable.some(model => model.id === 'beam-free' && model.plan === 'go')).toBe(true)
    expect(selectable.length).toBeLessThan(catalog.models.length)
  })

  it('Console 配置按 plan 增补条目、应用禁用标记与工作空间头', () => {
    const consoleConfig = {
      providers: {
        'opencode': {
          headers: { 'x-opencode-org-id': 'wrk_zen', authorization: 'Bearer leak' },
          models: {
            'grok-build-0.1': { package: 'aisdk:@ai-sdk/openai-compatible', name: 'Grok Build', capabilities: { input: ['text'], output: ['text'], tools: true } },
          },
        },
        'opencode-go': {
          headers: { 'x-opencode-org-id': 'wrk_go' },
          models: {
            'glm-5.3': { disabled: true, capabilities: { input: ['text'], output: ['text'], reasoning: { supported: true, effort: ['low', 'high', 'max'] } } },
          },
        },
      },
    }
    const catalog = buildCatalog({
      consoleConfig,
      zenRoster: { data: [{ id: 'glm-5' }] },
      goRoster: { data: [{ id: 'glm-5.3' }, { id: 'kimi-k3' }] },
      builtin,
    })
    expect(catalog.source).toBe('console')
    const zen = catalog.models.filter(model => model.plan === 'zen').map(model => model.id)
    const go = catalog.models.filter(model => model.plan === 'go')
    expect(zen).toEqual(['glm-5', 'grok-build-0.1'])
    expect(go.map(model => model.id)).toEqual(['glm-5.3', 'kimi-k3'])
    expect(go.find(model => model.id === 'glm-5.3')?.disabled).toBe(true)
    expect(go.find(model => model.id === 'glm-5.3')?.thinkingLevelMap).toEqual({
      off: null,
      minimal: null,
      low: 'low',
      medium: null,
      high: 'high',
      xhigh: null,
      max: 'max',
    })
    const scopes = consoleScopesFromConsoleConfig(consoleConfig)
    expect(scopes.get('zen')?.headers).toEqual({ 'x-opencode-org-id': 'wrk_zen' })
    expect(scopes.get('go')?.headers).toEqual({ 'x-opencode-org-id': 'wrk_go' })
  })

  it('Console 只暴露 x-opencode-* 路由头，凭据头被丢弃', () => {
    expect(safeConsoleHeaders({
      'x-opencode-org-id': 'wrk_test',
      authorization: 'Bearer leak',
      'api-key': 'leak',
      'x-opencode-workspace': 'w',
    })).toEqual({ 'x-opencode-org-id': 'wrk_test', 'x-opencode-workspace': 'w' })
    expect(consoleScopesFromConsoleConfig({ providers: {} }).size).toBe(0)
    expect(consoleScopesFromConsoleConfig(undefined).size).toBe(0)
  })

  it('图片生成模型被排除并给出说明', () => {
    const result = buildCatalogEntry({
      id: 'image-model',
      plan: 'zen',
      catalogEntry: {
        name: 'Image',
        modalities: { input: ['text'], output: ['image'] },
        reasoning: false,
        provider: { npm: '@ai-sdk/openai-compatible' },
      },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('图片生成模型')
  })

  it('roster 独有且元数据缺失时按 chat completions 推断并提示', () => {
    const result = buildCatalogEntry({ id: 'omen-alpha', plan: 'go' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.model.api).toBe('openai-completions')
      expect(result.model.input).toEqual(['text'])
      expect(result.warnings?.join(' ')).toContain('推断')
      expect(result.warnings?.join(' ')).toContain('输入模态')
    }
  })

  it('显式声明了未知协议时跳过而不是伪造端点', () => {
    const result = buildCatalogEntry({
      id: 'mystery',
      plan: 'zen',
      catalogEntry: { name: 'Mystery', modalities: { input: ['text'], output: ['text'] }, reasoning: false },
      providerNpm: '@ai-sdk/mystery',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('无法识别的协议')
  })

  it('缺少容量时使用保守兜底', () => {
    const result = buildCatalogEntry({
      id: 'fresh',
      plan: 'zen',
      catalogEntry: {
        name: 'Fresh',
        modalities: { input: ['text'], output: ['text'] },
        reasoning: false,
        provider: { npm: '@ai-sdk/anthropic' },
      },
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.model.contextWindow).toBe(DEFAULT_CONTEXT_WINDOW)
      expect(result.model.maxTokens).toBe(DEFAULT_MAX_TOKENS)
      expect(result.model.plan).toBe('zen')
    }
  })

  it('思考等级映射：toggle 型关闭全部等级，显式 none 时发送 none', () => {
    // toggle 型（只有开关、没有档位）不接受档位参数：返回全 null 让选择器不出现
    // 档位切换，而不是返回 undefined 交给 pi-ai 默认等级（那会列出无效档位）。
    expect(thinkingLevelMapFromReasoning({ supported: true, toggle: true })).toEqual({
      minimal: null,
      low: null,
      medium: null,
      high: null,
      xhigh: null,
      max: null,
    })
    // toggle 型不写 off 键：保留协议原生的「关闭思考」（缺省即支持关闭）。
    expect(thinkingLevelMapFromReasoning({ supported: true, toggle: true }))
      .not.toHaveProperty('off')
    // budget 型连关闭也不由通用开关表达，显式标 null。
    expect(thinkingLevelMapFromReasoning({ supported: true, budget: true }))
      .toMatchObject({ off: null })
    // 单档模型沿用 pi-ai 内置口径：只把该档标为可用，其余不受支持。
    expect(thinkingLevelMapFromReasoning({ supported: true, effort: ['max'] })).toEqual({
      minimal: null,
      low: null,
      medium: null,
      high: null,
      xhigh: null,
      max: 'max',
      off: null,
    })
    expect(thinkingLevelMapFromReasoning({ supported: true, effort: ['none', 'high'] })).toEqual({
      minimal: null,
      low: null,
      medium: null,
      high: 'high',
      xhigh: null,
      max: null,
      off: 'none',
    })
    expect(thinkingLevelMapFromReasoning({ supported: false })).toBeUndefined()
    expect(thinkingLevelMapFromReasoning({ supported: true, effort: ['low'] })).toMatchObject({ off: null, low: 'low' })
  })
})

/**
 * 协议按 plan 独立解析。
 *
 * 官方目录里同一模型在两个 plan 可能是不同协议（Zen 的 `minimax-m3` 走 Chat
 * Completions，Go 的 `minimax-m3` 走 Anthropic Messages）。跨段声明只在「本段
 * 完全没有该模型」时才可用于补全，否则会把本段协议覆盖错。
 */
describe('协议按 plan 独立解析', () => {
  it('同段只给端点、没有 npm 时按端点方法判定协议', () => {
    const result = buildCatalogEntry({
      id: 'minimax-m3',
      plan: 'zen',
      catalogEntry: { provider: { api: 'https://opencode.ai/inference/openai/v1' } },
      fallbackCatalogEntry: { provider: { npm: '@ai-sdk/anthropic' } },
      providerNpm: '@ai-sdk/openai-compatible',
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.model.api).toBe('openai-completions')
  })

  it('同段 npm 优先于跨段 npm', () => {
    const result = buildCatalogEntry({
      id: 'claude-haiku-5-5',
      plan: 'zen',
      catalogEntry: { provider: { npm: '@ai-sdk/anthropic' } },
      fallbackCatalogEntry: { provider: { npm: '@ai-sdk/openai-compatible' } },
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.model.api).toBe('anthropic-messages')
  })

  it('模型不在本段时，才用另一段的逐模型声明', () => {
    const result = buildCatalogEntry({
      id: 'qwen3.6-plus',
      plan: 'go',
      fallbackCatalogEntry: { provider: { npm: '@ai-sdk/anthropic' } },
      providerNpm: '@ai-sdk/openai-compatible',
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.model.api).toBe('anthropic-messages')
  })

  it('本段有该模型且没声明协议时，用本 plan 的 provider 缺省，不跨段取', () => {
    const result = buildCatalogEntry({
      id: 'minimax-m3',
      plan: 'zen',
      catalogEntry: { name: 'MiniMax-M3' },
      fallbackCatalogEntry: { provider: { npm: '@ai-sdk/anthropic' } },
      providerNpm: '@ai-sdk/openai-compatible',
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.model.api).toBe('openai-completions')
  })

  it('apiFromUrl 只认带方法段的端点', () => {
    expect(apiFromUrl('https://opencode.ai/inference/openai/v1/chat/completions')).toBe('openai-completions')
    expect(apiFromUrl('https://opencode.ai/inference/openai/v1/responses')).toBe('openai-responses')
    expect(apiFromUrl('https://opencode.ai/inference/anthropic/v1/messages')).toBe('anthropic-messages')
    expect(apiFromUrl('https://opencode.ai/inference/google/v1beta/models/gemini-4-argon')).toBe('google-generative-ai')
    expect(apiFromUrl('https://opencode.ai/inference/openai/v1')).toBeUndefined()
    expect(apiFromUrl(undefined)).toBeUndefined()
  })
})

/**
 * 端点策略：把共用模型的请求统一打到账号付费的那一组端点。
 *
 * 账号只订阅 Go 时，共用模型走 Go 端点消耗套餐额度，而不是打到需要余额的
 * 按量端点。只存在于单一来源的模型必须保持原生端点，否则上游会返回
 * `Model is unavailable.`。
 */
describe('端点策略', () => {
  const models: readonly OpenCodeModel[] = [
    { id: 'shared', api: 'openai-completions', plan: 'zen' },
    { id: 'shared', api: 'openai-completions', plan: 'go' },
    { id: 'zen-only', api: 'openai-completions', plan: 'zen' },
    { id: 'go-only', api: 'openai-completions', plan: 'go' },
  ].map(entry => ({
    ...entry,
    name: entry.id,
    baseURL: baseURLFor(entry.plan as 'zen' | 'go', 'openai-completions'),
    reasoning: false,
    input: ['text'] as ('text' | 'image')[],
    contextWindow: 1000,
    maxTokens: 100,
    tools: true,
    free: false,
    api: entry.api as OpenCodeModel['api'],
    plan: entry.plan as OpenCodeModel['plan'],
  }))

  it('go：共用模型改到 Go 端点，Zen 独有模型不动', () => {
    const next = applyEndpointPlan(models, 'go')
    const find = (plan: string, id: string) => next.find(model => model.plan === plan && model.id === id)
    expect(find('zen', 'shared')?.baseURL).toBe('https://opencode.ai/inference/go/openai/v1')
    expect(find('go', 'shared')?.baseURL).toBe('https://opencode.ai/inference/go/openai/v1')
    expect(find('zen', 'zen-only')?.baseURL).toBe('https://opencode.ai/inference/openai/v1')
  })

  it('zen：共用模型改到按量端点，Go 独有模型不动', () => {
    const next = applyEndpointPlan(models, 'zen')
    const find = (plan: string, id: string) => next.find(model => model.plan === plan && model.id === id)
    expect(find('go', 'shared')?.baseURL).toBe('https://opencode.ai/inference/openai/v1')
    expect(find('go', 'go-only')?.baseURL).toBe('https://opencode.ai/inference/go/openai/v1')
  })

  it('auto 与重复调用都会回到原生端点', () => {
    const go = applyEndpointPlan(models, 'go')
    const back = applyEndpointPlan(go, 'auto')
    expect(back.map(model => model.baseURL)).toEqual(models.map(model => model.baseURL))
    const again = applyEndpointPlan(go, 'go')
    expect(again.map(model => model.baseURL)).toEqual(go.map(model => model.baseURL))
  })

  it('协议不同则不切换：端点按协议族固定，换了就是错端点', () => {
    const mixed: readonly OpenCodeModel[] = [
      { id: 'dual', api: 'openai-completions', plan: 'zen' },
      { id: 'dual', api: 'anthropic-messages', plan: 'go' },
    ].map(entry => ({
      ...entry,
      name: entry.id,
      baseURL: baseURLFor(entry.plan as 'zen' | 'go', entry.api as 'openai-completions' | 'anthropic-messages'),
      reasoning: false,
      input: ['text'] as ('text' | 'image')[],
      contextWindow: 1000,
      maxTokens: 100,
      tools: true,
      free: false,
      api: entry.api as OpenCodeModel['api'],
      plan: entry.plan as OpenCodeModel['plan'],
    }))
    const next = applyEndpointPlan(mixed, 'go')
    expect(next[0]?.baseURL).toBe('https://opencode.ai/inference/openai/v1')
  })
})

describe('跨来源去重', () => {
  const model = (id: string, plan: 'zen' | 'go'): OpenCodeModel => ({
    id,
    name: id,
    api: 'openai-completions',
    baseURL: baseURLFor(plan, 'openai-completions'),
    reasoning: false,
    input: ['text'],
    contextWindow: 1000,
    maxTokens: 100,
    tools: true,
    free: false,
    plan,
  })

  it('账号有 Go 时同一模型只保留 go 条目，zen 重复项被去掉', () => {
    const models = [model('beam-free', 'zen'), model('beam-free', 'go'), model('big-pickle', 'zen')]
    const next = dedupeByPlan(models, 'go')
    expect(next.map(m => `${m.plan}:${m.id}`)).toEqual(['go:beam-free', 'zen:big-pickle'])
  })

  it('账号只有 Zen 时保留 zen 条目，去掉 go 重复项', () => {
    const models = [model('beam-free', 'zen'), model('beam-free', 'go'), model('deepseek-v4-pro', 'go')]
    const next = dedupeByPlan(models, 'zen')
    expect(next.map(m => `${m.plan}:${m.id}`)).toEqual(['zen:beam-free', 'go:deepseek-v4-pro'])
  })

  it('真实 roster 上按 Go 去重后只去掉两段共享的模型', async () => {
    const catalog = await publicCatalog()
    const zenIds = new Set(catalog.models.filter(m => m.plan === 'zen').map(m => m.id))
    const shared = new Set(catalog.models.filter(m => m.plan === 'go' && zenIds.has(m.id)).map(m => m.id))
    expect(shared.size).toBeGreaterThan(0)
    const deduped = dedupeByPlan(catalog.models, 'go')
    expect(deduped.length).toBe(catalog.models.length - shared.size)
    const keys = deduped.map(m => `${m.plan}:${m.id}`)
    for (const id of shared) {
      expect(keys).toContain(`go:${id}`)
      expect(keys).not.toContain(`zen:${id}`)
    }
    // 单一来源模型照常保留。
    expect(keys).toContain('zen:big-pickle')
    expect(keys).toContain('go:deepseek-v4-pro')
  })

  it('没有重复项时原样返回同一个数组引用', () => {
    const models = [model('big-pickle', 'zen'), model('deepseek-v4-pro', 'go')]
    expect(dedupeByPlan(models, 'go')).toBe(models)
  })
})

describe('目录统一口径 applyCatalogView', () => {
  const model = (id: string, plan: 'zen' | 'go'): OpenCodeModel => ({
    id,
    name: id,
    api: 'openai-completions',
    baseURL: baseURLFor(plan, 'openai-completions'),
    reasoning: false,
    input: ['text'],
    contextWindow: 1000,
    maxTokens: 100,
    tools: true,
    free: false,
    plan,
  })

  it('同时应用去重与端点策略：共享模型只剩 go 条目且走 go 端点', () => {
    const models = [model('shared', 'zen'), model('shared', 'go'), model('zen-only', 'zen')]
    const view = applyCatalogView(models, { ownedPlan: 'go', endpointPlan: 'go' })
    expect(view.map(m => `${m.plan}:${m.id}`)).toEqual(['go:shared', 'zen:zen-only'])
    expect(view.find(m => m.id === 'shared')?.baseURL).toBe('https://opencode.ai/inference/go/openai/v1')
  })

  it('端点策略为 auto 时只去重，不改端点', () => {
    const models = [model('shared', 'zen'), model('shared', 'go')]
    const view = applyCatalogView(models, { ownedPlan: 'go', endpointPlan: 'auto' })
    expect(view.map(m => `${m.plan}:${m.id}`)).toEqual(['go:shared'])
  })

  it('缺省两个选项时只排序，不去重也不改端点', () => {
    const models = [model('shared', 'zen'), model('shared', 'go')]
    const view = applyCatalogView(models, {})
    // 同价同 id 时排序稳定，保持入参顺序。
    expect(view.map(m => `${m.plan}:${m.id}`)).toEqual(['zen:shared', 'go:shared'])
    expect(view.find(m => m.plan === 'zen')?.baseURL).toBe('https://opencode.ai/inference/openai/v1')
  })
})

describe('目录排序', () => {
  const model = (id: string, extra: Partial<OpenCodeModel>): OpenCodeModel => ({
    id,
    name: id,
    api: 'openai-completions',
    baseURL: baseURLFor('go', 'openai-completions'),
    reasoning: false,
    input: ['text'],
    contextWindow: 1000,
    maxTokens: 100,
    tools: true,
    free: false,
    plan: 'go',
    ...extra,
  })

  it('免费模型在最前（时间降序），付费按价格升序，禁用条目排最后', () => {
    const models = [
      model('paid-expensive', { cost: { input: 3, output: 9 } }),
      model('disabled-paid', { cost: { input: 1, output: 1 }, disabled: true }),
      model('free-old', { free: true, releasedAt: '2026-01-01' }),
      model('paid-cheap', { cost: { input: 0.1, output: 0.2 } }),
      model('free-new', { free: true, releasedAt: '2026-09-10' }),
      model('client-only', { free: true, clientOnly: true }),
    ]
    const order = sortCatalogModels(models).map(m => m.id)
    expect(order).toEqual([
      'free-new',
      'free-old',
      'paid-cheap',
      'paid-expensive',
      'client-only',
      'disabled-paid',
    ])
  })

  it('没有价格元数据的模型排在已知价格的付费模型之后', () => {
    const models = [
      model('no-cost', {}),
      model('priced', { cost: { input: 1, output: 2 } }),
    ]
    expect(sortCatalogModels(models).map(m => m.id)).toEqual(['priced', 'no-cost'])
  })

  it('缺少发布时间时排在免费档末尾，且不抛错', () => {
    const models = [
      model('free-no-date', { free: true }),
      model('free-dated', { free: true, releasedAt: '2026-05-01' }),
    ]
    expect(sortCatalogModels(models).map(m => m.id)).toEqual(['free-dated', 'free-no-date'])
  })

  it('真实 roster 上排序后首个是可用的免费模型，禁用条目全部在末尾', async () => {
    const catalog = await publicCatalog()
    const view = applyCatalogView(catalog.models, { ownedPlan: 'go', endpointPlan: 'auto' })
    const firstDisabled = view.findIndex(m => m.disabled === true || m.clientOnly === true)
    expect(firstDisabled).toBeGreaterThan(0)
    expect(view.slice(firstDisabled).every(m => m.disabled === true || m.clientOnly === true)).toBe(true)
    expect(view[0]?.disabled).not.toBe(true)
    expect(view[0]?.clientOnly).not.toBe(true)
  })
})

/** 构造测试模型：默认是 Go 侧可用的付费模型。 */
function scopedModel(id: string, plan: 'zen' | 'go', extra: Partial<OpenCodeModel> = {}): OpenCodeModel {
  return {
    id,
    name: id,
    api: 'openai-completions',
    baseURL: baseURLFor(plan, 'openai-completions'),
    reasoning: false,
    input: ['text'],
    contextWindow: 1000,
    maxTokens: 100,
    tools: true,
    free: false,
    plan,
    ...extra,
  }
}

describe('整侧归属过滤 scopeToAccountPlan', () => {
  const models = [
    scopedModel('shared', 'zen'),
    scopedModel('shared', 'go'),
    scopedModel('zen-only', 'zen'),
    scopedModel('go-only', 'go'),
  ]

  it.each([['go'], ['go-plus'], ['go-teams']] as const)('%s 档只保留 go 侧条目', (plan) => {
    const next = scopeToAccountPlan(models, plan)
    expect(next.map(model => model.id)).toEqual(['shared', 'go-only'])
    expect(next.every(model => model.plan === 'go')).toBe(true)
  })

  it('payg 只保留 zen 侧条目', () => {
    const next = scopeToAccountPlan(models, 'payg')
    expect(next.map(model => model.id)).toEqual(['shared', 'zen-only'])
    expect(next.every(model => model.plan === 'zen')).toBe(true)
  })

  it('unknown 按 Go 口径过滤（与 go 档结果一致）', () => {
    const next = scopeToAccountPlan(models, 'unknown')
    expect(next.map(model => model.id)).toEqual(['shared', 'go-only'])
    expect(next.every(model => model.plan === 'go')).toBe(true)
  })

  it('与 dedupeByPlan 的差别：单侧独有条目也会被整侧过滤', () => {
    // 旧口径下 zen-only 会因为「go 侧没有同名条目」保留下来，新口径不会。
    expect(dedupeByPlan(models, 'go').map(model => model.id)).toContain('zen-only')
    expect(scopeToAccountPlan(models, 'go').map(model => model.id)).not.toContain('zen-only')
  })

  it('真实 roster 上 Go 账号目录不含任何 zen 条目', async () => {
    const catalog = await publicCatalog()
    const next = scopeToAccountPlan(catalog.models, 'go')
    expect(next.length).toBeGreaterThan(0)
    expect(next.every(model => model.plan === 'go')).toBe(true)
    expect(next.map(model => model.id)).not.toContain('big-pickle')
  })

  it('真实 roster 上按量账号目录不含任何 go 条目', async () => {
    const catalog = await publicCatalog()
    const next = scopeToAccountPlan(catalog.models, 'payg')
    expect(next.every(model => model.plan === 'zen')).toBe(true)
  })
})

describe('按套餐额度排序', () => {
  const goModel = (id: string, estimated: number | null | undefined, extra: Partial<OpenCodeModel> = {}): OpenCodeModel =>
    scopedModel(id, 'go', {
      ...(estimated === undefined ? {} : { estimatedRequestsPerMonth: estimated }),
      ...extra,
    })

  it('Go 侧按每月预计请求数降序，null 不限量置顶，缺数据沉底', () => {
    const models = [
      goModel('missing-b', undefined),
      goModel('small', 490),
      goModel('unlimited-b', null),
      goModel('large', 216_670),
      goModel('missing-a', undefined),
      goModel('unlimited-a', null),
      goModel('medium', 21_130),
    ]
    const order = sortCatalogModels(models, OPENCODE_GO_ESTIMATES).map(model => model.id)
    expect(order).toEqual([
      'unlimited-a',
      'unlimited-b',
      'large',
      'medium',
      'small',
      'missing-a',
      'missing-b',
    ])
  })

  it('同额度时按 id 升序稳定', () => {
    const models = [goModel('zebra', 100), goModel('alpha', 100), goModel('beta', 100)]
    expect(sortCatalogModels(models, OPENCODE_GO_ESTIMATES).map(model => model.id)).toEqual(['alpha', 'beta', 'zebra'])
  })

  it('禁用与仅官方客户端可用的条目仍然排在最后', () => {
    const models = [
      goModel('disabled', 999_999, { disabled: true }),
      goModel('active', 10),
      goModel('client-only', 999_999, { clientOnly: true }),
      goModel('unlimited', null),
    ]
    const order = sortCatalogModels(models, OPENCODE_GO_ESTIMATES).map(model => model.id)
    expect(order.slice(0, 2)).toEqual(['unlimited', 'active'])
    expect(order.slice(2).sort()).toEqual(['client-only', 'disabled'])
  })

  it('不传估算表时保持老口径（免费优先 → 单价升序 → id）', () => {
    const models = [
      goModel('paid-expensive', 100, { cost: { input: 3, output: 9 } }),
      goModel('free', null, { free: true, releasedAt: '2026-01-01' }),
      goModel('paid-cheap', 50, { cost: { input: 0.1, output: 0.2 } }),
    ]
    expect(sortCatalogModels(models).map(model => model.id)).toEqual(['free', 'paid-cheap', 'paid-expensive'])
  })

  it('列表混入按量模型时回落到老口径，不把按量条目整体沉底', () => {
    const models = [
      scopedModel('zen-free', 'zen', { free: true, releasedAt: '2026-01-01' }),
      goModel('go-huge', 216_670),
      goModel('go-tiny', 490),
    ]
    const order = sortCatalogModels(models, OPENCODE_GO_ESTIMATES).map(model => model.id)
    expect(order[0]).toBe('zen-free')
  })

  it('未知套餐取 Go 档表（与目录口径同源）', () => {
    expect(estimatesForPlan('unknown')).toBe(OPENCODE_GO_ESTIMATES)
    expect(estimatesForPlan('unknown')).toBe(estimatesForPlan('go'))
    // 按量没有额度口径：不返回表，排序回落老口径。
    expect(estimatesForPlan('payg')).toBeUndefined()
  })

  it('Go Plus 档用自己那份表排序', async () => {
    const catalog = await publicCatalog()
    const plus = estimatesForPlan('go-plus')
    expect(plus).toBe(OPENCODE_GO_PLUS_ESTIMATES)
    const scoped = scopeToAccountPlan(catalog.models, 'go-plus')
    const order = sortCatalogModels(scoped, plus)
    const estimated = order
      .map(model => model.estimatedRequestsPerMonth)
      .filter((value): value is number => typeof value === 'number')
    expect(estimated).toEqual([...estimated].sort((left, right) => right - left))
  })
})

describe('buildCatalog 写入预计请求数', () => {
  it('Go 模型带上估算值，zen 模型不带', async () => {
    const catalog = await buildCatalog({
      catalog: await fixture('catalog.json'),
      zenRoster: await fixture('zen-models.json'),
      goRoster: await fixture('go-models.json'),
      builtin,
      estimates: OPENCODE_GO_ESTIMATES,
      now: 1,
    })
    const goModel = catalog.models.find(model => model.plan === 'go' && model.id === 'deepseek-v4.1-flash')
    expect(goModel?.estimatedRequestsPerMonth).toBe(216_670)
    const unlimited = catalog.models.find(model => model.plan === 'go' && model.id === 'beam-free')
    expect(unlimited?.estimatedRequestsPerMonth).toBeNull()
    for (const model of catalog.models.filter(entry => entry.plan === 'zen')) {
      expect(model.estimatedRequestsPerMonth).toBeUndefined()
    }
  })

  it('表里有但 roster 没有的模型不凭空造条目', async () => {
    const catalog = await buildCatalog({
      catalog: await fixture('catalog.json'),
      zenRoster: await fixture('zen-models.json'),
      goRoster: await fixture('go-models.json'),
      builtin,
      estimates: OPENCODE_GO_ESTIMATES,
      now: 1,
    })
    // 表里有些 id 不在 roster 内（如上架前的预留条目）：它们不会凭空变成模型。
    const tableOnly = Object.keys(OPENCODE_GO_ESTIMATES)
      .filter(id => !catalog.models.some(model => model.id === id))
    expect(tableOnly.length).toBeGreaterThan(0)
    for (const id of tableOnly) expect(catalog.models.map(model => model.id)).not.toContain(id)
  })

  it('不传估算表时字段缺省', async () => {
    const catalog = await publicCatalog()
    expect(catalog.models.every(model => model.estimatedRequestsPerMonth === undefined)).toBe(true)
  })

  it('Go 侧免费模型不在表里时按不限量置顶（上游新上架的免费模型）', () => {
    // 官方 Go 额度表里标 `Unlimited` 的恰好只有免费模型，FAQ 也写明「达到 Go 限制后
    // 可以继续使用免费模型」，因此上游新上架的免费模型在快照更新前就该按不限量处理，
    // 不能被当成「额度未知」沉到列表末尾。
    const freeEntry = {
      provider: { npm: '@ai-sdk/openai-compatible' },
      cost: { input: 0, output: 0 },
    }
    const result = buildCatalogEntry({
      id: 'crouton-alpha-free',
      plan: 'go',
      catalogEntry: freeEntry,
      estimates: { 'known-go': 1_000 },
    })
    expect(result.ok && result.model.free).toBe(true)
    expect(result.ok && result.model.estimatedRequestsPerMonth).toBeNull()
  })

  it('Go 侧付费模型不在表里时仍保持 undefined（不编造额度）', () => {
    const paidEntry = {
      provider: { npm: '@ai-sdk/openai-compatible' },
      cost: { input: 0.3, output: 1.2 },
    }
    const result = buildCatalogEntry({
      id: 'brand-new-paid',
      plan: 'go',
      catalogEntry: paidEntry,
      estimates: { 'known-go': 1_000 },
    })
    expect(result.ok && result.model.free).toBe(false)
    expect(result.ok && result.model.estimatedRequestsPerMonth).toBeUndefined()
  })

  it('表里明确标不限量时不被免费判定覆盖成数值', () => {
    // 回归：`??` 会把表里的 null 当作「没有数据」穿透掉，导致 beam-free 反而丢额度口径。
    const freeEntry = {
      provider: { npm: '@ai-sdk/openai-compatible' },
      cost: { input: 0, output: 0 },
    }
    const result = buildCatalogEntry({
      id: 'beam-free',
      plan: 'go',
      catalogEntry: freeEntry,
      estimates: { 'beam-free': null },
    })
    expect(result.ok && result.model.estimatedRequestsPerMonth).toBeNull()
  })

  it('按量侧免费模型不写预计请求数（没有 Go 额度口径）', () => {
    const freeEntry = {
      provider: { npm: '@ai-sdk/openai-compatible' },
      cost: { input: 0, output: 0 },
    }
    const result = buildCatalogEntry({
      id: 'big-pickle',
      plan: 'zen',
      catalogEntry: freeEntry,
      estimates: OPENCODE_GO_ESTIMATES,
    })
    expect(result.ok && result.model.free).toBe(true)
    expect(result.ok && result.model.estimatedRequestsPerMonth).toBeUndefined()
  })

  it('自定义估算表按模型 id 精确匹配', () => {
    const table: OpenCodeEstimateTable = { 'go-model': 12_345 }
    const result = buildCatalogEntry({ id: 'go-model', plan: 'go', estimates: table })
    expect(result.ok && result.model.estimatedRequestsPerMonth).toBe(12_345)

    const missing = buildCatalogEntry({ id: 'other', plan: 'go', estimates: table })
    expect(missing.ok && missing.model.estimatedRequestsPerMonth).toBeUndefined()
  })
})

describe('applyCatalogView 组合新口径', () => {
  const models = [
    scopedModel('shared', 'zen'),
    scopedModel('shared', 'go', { estimatedRequestsPerMonth: 500 }),
    scopedModel('zen-only', 'zen'),
    scopedModel('go-big', 'go', { estimatedRequestsPerMonth: 216_670 }),
    scopedModel('go-none', 'go'),
  ]

  it('过滤 → 排序 → 端点三步都生效', () => {
    const view = applyCatalogView(models, {
      accountPlan: 'go',
      estimates: OPENCODE_GO_ESTIMATES,
      endpointPlan: 'go',
    })
    expect(view.map(model => `${model.plan}:${model.id}`)).toEqual(['go:go-big', 'go:shared', 'go:go-none'])
    expect(view.every(model => model.baseURL === baseURLFor('go', model.api))).toBe(true)
  })

  it('unknown 套餐按 Go 口径过滤，accountPlan 优先于 ownedPlan', () => {
    const view = applyCatalogView(models, { accountPlan: 'unknown', ownedPlan: 'go' })
    const ids = view.map(model => `${model.plan}:${model.id}`)
    // 整侧过滤：zen 侧条目（含单侧独有的 zen-only）全部消失。
    expect(ids).not.toContain('zen:zen-only')
    expect(ids).not.toContain('zen:shared')
    expect(view.every(model => model.plan === 'go')).toBe(true)
  })

  it('unknown 套餐用 Go 档估算表排序，不回落老口径', () => {
    const table: OpenCodeEstimateTable = { 'go-big': 216_670 }
    const view = applyCatalogView(models, { accountPlan: 'unknown', estimates: table })
    // 额度降序：go-big(216,670) → shared(500) → go-none（无估算值，沉底）。
    expect(view.map(model => model.id)).toEqual(['go-big', 'shared', 'go-none'])
  })

  it('不传新字段时行为等于今天', () => {
    const view = applyCatalogView(models, { ownedPlan: 'go', endpointPlan: 'auto' })
    // 老口径：去重后按「免费优先 → 单价升序 → id」排序；这批模型都没有价格元数据，
    // 因此保持去重后的原顺序（与今天的实现一致）。
    expect(view.map(model => `${model.plan}:${model.id}`)).toEqual([
      'go:shared',
      'zen:zen-only',
      'go:go-big',
      'go:go-none',
    ])
    expect(view).toEqual(dedupeByPlan(models, 'go'))
  })

  it('payg 套餐只留按量侧，且按老口径排序', () => {
    const view = applyCatalogView(models, { accountPlan: 'payg' })
    expect(view.every(model => model.plan === 'zen')).toBe(true)
    expect(view.map(model => model.id)).toEqual(['shared', 'zen-only'])
  })

  it('真实 roster 上 Go 账号视图只含 go 条目且按额度降序', async () => {
    const catalog = await publicCatalog()
    const withEstimates = await buildCatalog({
      catalog: await fixture('catalog.json'),
      zenRoster: await fixture('zen-models.json'),
      goRoster: await fixture('go-models.json'),
      builtin,
      estimates: OPENCODE_GO_ESTIMATES,
      now: 1,
    })
    const view = applyCatalogView(withEstimates.models, {
      accountPlan: 'go',
      estimates: OPENCODE_GO_ESTIMATES,
      endpointPlan: 'auto',
    })
    expect(catalog.models.length).toBeGreaterThan(0)
    expect(view.every(model => model.plan === 'go')).toBe(true)
    const usable = view.filter(model => model.disabled !== true && model.clientOnly !== true)
    const quotas = usable.map(model => model.estimatedRequestsPerMonth)
    const known = quotas.filter((value): value is number => typeof value === 'number')
    expect(known.length).toBeGreaterThan(0)
    expect(known).toEqual([...known].sort((left, right) => right - left))
    expect(quotas.slice(0, quotas.filter(value => value === null).length).every(value => value === null)).toBe(true)
  })
})

describe('估算表与条目脱节时的降级', () => {
  it('传了表但条目上没有估算值：回到老口径而不是只按 id 排', () => {
    const models = [
      scopedModel('go-paid-expensive', 'go', { cost: { input: 3, output: 9 } }),
      scopedModel('go-first', 'go', { free: true, releasedAt: '2026-09-10' }),
      scopedModel('go-paid-cheap', 'go', { cost: { input: 0.1, output: 0.2 } }),
    ]
    const order = sortCatalogModels(models, OPENCODE_GO_ESTIMATES).map(model => model.id)
    expect(order).toEqual(['go-first', 'go-paid-cheap', 'go-paid-expensive'])
    expect(order).toEqual(sortCatalogModels(models).map(model => model.id))
  })
})

describe('活 roster 价格提取 modelCostFrom', () => {
  it('解析 roster 的分层 cost 形态并取基价', () => {
    const costs = modelCostFrom({
      data: [
        { id: 'paid', cost: { text: { input: { price: 0.14, cache: { read: 0.0028 } }, output: { price: 0.28 } }, multipliers: [{ factor: 2 }] } },
        { id: 'free', cost: { text: { input: { price: 0, cache: { read: 0 } }, output: { price: 0 } } } },
      ],
    })
    expect(costs.get('paid')).toEqual({ input: 0.14, output: 0.28, cacheRead: 0.0028 })
    expect(costs.get('free')).toEqual({ input: 0, output: 0, cacheRead: 0 })
  })

  it('形态不符、缺价或缺 id 时不写入', () => {
    const priced = { text: { input: { price: 1 }, output: { price: 1 } } }
    const costs = modelCostFrom({
      data: [
        { id: 'no-cost' },
        // roster 的分层形态缺失（扁平写法不认）：不写入
        { id: 'no-text', cost: { input: 1, output: 1 } },
        // 只有 input 价：不写入
        { id: 'half', cost: { text: { input: { price: 1 } } } },
        // id 缺失或为空串：不写入
        { cost: priced },
        { id: '', cost: priced },
        // 唯一合法条目
        { id: 'ok', cost: priced },
      ],
    })
    expect([...costs.keys()]).toEqual(['ok'])
  })

  it('响应不是列表形态时返回空表', () => {
    expect(modelCostFrom(undefined).size).toBe(0)
    expect(modelCostFrom([]).size).toBe(0)
    expect(modelCostFrom({ models: 'oops' }).size).toBe(0)
  })

  it('roster 价格排在兜底链尾，不覆盖公开目录', () => {
    const catalogEntry = { provider: { npm: '@ai-sdk/openai-compatible' }, cost: { input: 0.3, output: 1.2 } }
    const rosterCost = { input: 0.9, output: 3.6 }
    const withBoth = buildCatalogEntry({ id: 'm', plan: 'go', catalogEntry, estimates: {}, rosterCost })
    expect(withBoth.ok && withBoth.model.cost).toEqual({ input: 0.3, output: 1.2 })

    // 公开目录没有该模型时才用 roster
    const onlyRoster = buildCatalogEntry({ id: 'm', plan: 'go', estimates: {}, rosterCost })
    expect(onlyRoster.ok && onlyRoster.model.cost).toEqual(rosterCost)
    expect(onlyRoster.ok && onlyRoster.model.free).toBe(false)
  })

  it('models.dev 落后时靠 roster 价格把新免费模型判为免费', () => {
    // 复现线上场景：roster 有该模型且单价为 0，公开目录两段都没有条目。
    const goRoster = {
      data: [{ id: 'brand-new-free', created: 2, cost: { text: { input: { price: 0 }, output: { price: 0 } } } }],
    }
    const catalog = buildCatalog({ goRoster, estimates: {} })
    const model = catalog.models.find(entry => entry.id === 'brand-new-free')
    expect(model?.cost).toEqual({ input: 0, output: 0 })
    expect(model?.free).toBe(true)
    expect(model?.estimatedRequestsPerMonth).toBeNull()
  })
})

describe('额度口径下免费标记不再优先', () => {
  const goModel = (id: string, estimated: number | null | undefined, extra: Partial<OpenCodeModel> = {}): OpenCodeModel =>
    scopedModel(id, 'go', {
      ...(estimated === undefined ? {} : { estimatedRequestsPerMonth: estimated }),
      ...extra,
    })

  /** Lead 复核给出的复现输入：免费低额度、付费高额度、不限量、缺数据、禁用高额度。 */
  function reviewInput(): OpenCodeModel[] {
    return [
      goModel('free-low', 10, { free: true }),
      goModel('paid-high', 999),
      goModel('b', null),
      goModel('c', undefined),
      goModel('disabled', 5000, { disabled: true }),
    ]
  }

  it('免费但额度低的模型不得排在付费高额度模型之前', () => {
    const order = sortCatalogModels(reviewInput(), OPENCODE_GO_ESTIMATES).map(model => model.id)
    // null 最前 → 数值降序 → undefined 沉底；免费只影响没有估算表时的旧口径。
    expect(order).toEqual(['b', 'paid-high', 'free-low', 'c', 'disabled'])
    expect(order.indexOf('free-low')).toBeGreaterThan(order.indexOf('paid-high'))
  })

  it('禁用条目即使额度最高也沉底', () => {
    const order = sortCatalogModels(reviewInput(), OPENCODE_GO_ESTIMATES).map(model => model.id)
    expect(order.at(-1)).toBe('disabled')
  })

  it('仅官方客户端可用的条目同样沉底，且不按额度插队', () => {
    const models = [
      goModel('client-only-high', 9999, { clientOnly: true, free: true }),
      goModel('normal', 100),
    ]
    const order = sortCatalogModels(models, OPENCODE_GO_ESTIMATES).map(model => model.id)
    expect(order).toEqual(['normal', 'client-only-high'])
  })

  it('上游新上架的免费模型排在最前，不被当成额度未知沉底', () => {
    // 线上现象：Go 额度表更新前新模型会追加到列表末尾。走 buildCatalog 全链路，
    // 保证「免费 ⇒ 不限量」的推导在目录构建与排序两步之间不丢失。
    const goRoster = {
      object: 'list',
      data: [
        { id: 'known-paid', created: 1, cost: { text: { input: { price: 0.14 }, output: { price: 0.28 } } } },
        { id: 'brand-new-free', created: 2, cost: { text: { input: { price: 0 }, output: { price: 0 } } } },
      ],
    }
    const table: OpenCodeEstimateTable = { 'known-paid': 150_400 }
    const catalog = buildCatalog({ goRoster, estimates: table })
    const go = catalog.models.filter(model => model.plan === 'go')
    const newFree = go.find(model => model.id === 'brand-new-free')
    expect(newFree?.free).toBe(true)
    expect(newFree?.estimatedRequestsPerMonth).toBeNull()
    expect(sortCatalogModels(go, table).map(model => model.id)).toEqual(['brand-new-free', 'known-paid'])
  })

  it('免费高额度模型可以排在付费低额度模型之前（只看额度）', () => {
    const models = [
      goModel('free-high', 900, { free: true }),
      goModel('paid-low', 100),
    ]
    expect(sortCatalogModels(models, OPENCODE_GO_ESTIMATES).map(model => model.id)).toEqual(['free-high', 'paid-low'])
  })
})

/**
 * FNOS-051：账号清单（`/go/v1/models`）优先于静态目录与内置目录。
 *
 * 实测依据（2026-11-09，Go 订阅账号）：公开目录只收录 Go 侧 30 个模型中的 26 个，
 * 且对 minimax-m3、qwen3.8-max 给出的上下文低于账号清单；kimi-k3.1-pro 实测能
 * 处理 310,093 prompt tokens，远超默认 262,144。
 */
describe('FNOS-051 账号清单优先', () => {
  const roster = {
    data: [
      {
        id: 'kimi-k3.1-pro',
        limit: { context: 1_048_576, output: 131_072 },
        capabilities: { reasoning: { supported: true, effort: ['low', 'high', 'max'] } },
      },
      {
        id: 'mimo-v2.6-pro',
        limit: { context: 1_048_576, output: 131_072 },
        capabilities: { reasoning: { supported: true, toggle: true } },
      },
      {
        id: 'no-reasoning',
        limit: { context: 200_000, output: 8_192 },
        capabilities: { reasoning: { supported: false } },
      },
    ],
  }

  it('读出上下文与输出上限', () => {
    expect(modelLimitFrom(roster)).toEqual(new Map([
      ['kimi-k3.1-pro', { context: 1_048_576, output: 131_072 }],
      ['mimo-v2.6-pro', { context: 1_048_576, output: 131_072 }],
      ['no-reasoning', { context: 200_000, output: 8_192 }],
    ]))
  })

  it('有档位的模型读出真实档位', () => {
    const map = modelReasoningFrom(roster).get('kimi-k3.1-pro')
    expect(map).toMatchObject({ low: 'low', high: 'high', max: 'max', minimal: null })
  })

  it('只有开关的模型不提供任何档位', () => {
    const map = modelReasoningFrom(roster).get('mimo-v2.6-pro')
    expect(map).toEqual({ minimal: null, low: null, medium: null, high: null, xhigh: null, max: null })
    expect(map).not.toHaveProperty('off')
  })

  it('声明不支持的模型不进映射表', () => {
    expect(modelReasoningFrom(roster).has('no-reasoning')).toBe(false)
  })

  it('清单优先于公开目录：文档缺失的模型也能拿到真实能力', () => {
    // 公开目录完全没有 kimi-k3.1-pro（实测），之前的回落会落到默认 262,144。
    const models = buildCatalog({
      builtin: { zen: [], go: [] },
      goRoster: roster,
    }).models
    const kimi = models.find(model => model.id === 'kimi-k3.1-pro' && model.plan === 'go')
    expect(kimi?.contextWindow).toBe(1_048_576)
    expect(kimi?.reasoning).toBe(true)
    expect(kimi?.thinkingLevelMap).toMatchObject({ low: 'low', high: 'high', max: 'max' })
  })

  it('清单优先于公开目录：上下文不被低估', () => {
    const models = buildCatalog({
      builtin: { zen: [], go: [] },
      goRoster: roster,
      catalog: {
        opencode: {
          models: { 'kimi-k3.1-pro': { limit: { context: 262_144 }, reasoning: true } },
        },
      },
    }).models
    // 同名模型在 zen 与 go 两段各生成一条：取 go 段那条才对（清单属于 go）。
    const kimi = models.find(model => model.id === 'kimi-k3.1-pro' && model.plan === 'go')
    // 目录说 262,144，清单说 1,048,576 —— 采信清单。
    expect(kimi?.contextWindow).toBe(1_048_576)
  })
})
