import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { opencodeProvider } from '@earendil-works/pi-ai/providers/opencode'
import { opencodeGoProvider } from '@earendil-works/pi-ai/providers/opencode-go'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_TOKENS,
  baseURLFor,
  buildCatalog,
  buildCatalogEntry,
  consoleScopesFromConsoleConfig,
  safeConsoleHeaders,
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

  it('免费模型被标记（价格全为 0）', async () => {
    const catalog = await publicCatalog()
    expect(catalog.models.find(model => model.id === 'big-pickle' && model.plan === 'zen')?.free).toBe(true)
    expect(catalog.models.find(model => model.id === 'deepseek-v4.1-flash' && model.plan === 'go')?.free).toBe(false)
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

  it('思考等级映射：toggle 且无 none 时保留 Off，显式 none 时发送 none', () => {
    expect(thinkingLevelMapFromReasoning({ supported: true, toggle: true })).toBeUndefined()
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
