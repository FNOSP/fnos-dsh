import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { opencodeGoProvider } from '@earendil-works/pi-ai/providers/opencode-go'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_TOKENS,
  baseURLForApi,
  buildCatalog,
  buildCatalogEntry,
  consoleModelsFromConsoleConfig,
  thinkingLevelMapFromReasoning,
} from '../../src/host/catalog.ts'

async function fixture<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), 'utf8')) as T
}

const builtin = opencodeGoProvider().getModels()

describe('openCode 模型目录归一化', () => {
  it('公开目录 + roster 合并出全部 Go 模型，协议与端点逐条正确', async () => {
    const catalog = buildCatalog({
      catalog: await fixture('catalog.json'),
      goRoster: await fixture('go-models.json'),
      builtin,
      now: 1,
    })

    expect(catalog.source).toBe('public')
    expect(catalog.fetchedAt).toBe(1)
    // roster 是活清单：36 条条目都能从 Go 目录、Zen 目录或内置目录补齐元数据。
    expect(catalog.models.length).toBeGreaterThanOrEqual(36)
    for (const model of catalog.models) {
      expect(model.id.length).toBeGreaterThan(0)
      expect(model.baseURL).toBe(baseURLForApi(model.api))
      expect(model.input).toContain('text')
      expect(model.contextWindow).toBeGreaterThan(0)
      expect(model.maxTokens).toBeGreaterThan(0)
      expect(model.go).toBe(true)
    }
  })

  it('DeepSeek V4.1 Flash 的协议、容量、图片输入与思考等级对齐目录', async () => {
    const catalog = buildCatalog({
      catalog: await fixture('catalog.json'),
      goRoster: await fixture('go-models.json'),
      builtin,
    })
    const model = catalog.models.find(entry => entry.id === 'deepseek-v4.1-flash')
    expect(model).toBeDefined()
    expect(model?.api).toBe('openai-completions')
    expect(model?.baseURL).toBe('https://opencode.ai/inference/go/openai/v1')
    expect(model?.input).toEqual(['text', 'image'])
    expect(model?.contextWindow).toBe(1_000_000)
    expect(model?.maxTokens).toBe(384_000)
    expect(model?.reasoning).toBe(true)
    // 目录声明 effort [low, high, max] 且没有 toggle/budget：Off 不受支持。
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

  it('按 AI SDK 包名区分三种网关协议与端点', async () => {
    const catalog = buildCatalog({
      catalog: await fixture('catalog.json'),
      goRoster: await fixture('go-models.json'),
      builtin,
    })
    const byId = new Map(catalog.models.map(model => [model.id, model]))
    expect(byId.get('gpt-5.6-luna')?.api).toBe('openai-responses')
    expect(byId.get('gpt-5.6-luna')?.baseURL).toBe('https://opencode.ai/inference/go/openai/v1')
    expect(byId.get('minimax-m3')?.api).toBe('anthropic-messages')
    expect(byId.get('minimax-m3')?.baseURL).toBe('https://opencode.ai/inference/go/anthropic')
    expect(byId.get('gemini-4-argon-contributor')?.api).toBe('google-generative-ai')
    expect(byId.get('gemini-4-argon-contributor')?.baseURL).toBe('https://opencode.ai/inference/go/google/v1beta')
    expect(byId.get('kimi-k3')?.api).toBe('openai-completions')
  })

  it('gpt-5.6-luna 的思考等级覆盖 none 与 xhigh/max', async () => {
    const catalog = buildCatalog({
      catalog: await fixture('catalog.json'),
      goRoster: await fixture('go-models.json'),
      builtin,
    })
    const model = catalog.models.find(entry => entry.id === 'gpt-5.6-luna')
    // 目录声明 effort [none, low, medium, high, xhigh, max]：没有 minimal。
    expect(model?.thinkingLevelMap).toEqual({
      off: 'none',
      minimal: null,
      low: 'low',
      medium: 'medium',
      high: 'high',
      xhigh: 'xhigh',
      max: 'max',
    })
  })

  it('Console 条目是增补而不是全集：roster 模型全部保留，禁用标记与能力覆盖生效', () => {
    const consoleConfig = {
      providers: {
        'opencode-go': {
          package: 'aisdk:@ai-sdk/openai-compatible',
          headers: { 'x-opencode-org-id': 'wrk_test', authorization: 'Bearer leak' },
          models: {
            'kimi-k3': { name: 'Kimi K3', capabilities: { input: ['text', 'image'], output: ['text'], reasoning: { supported: true, toggle: true } }, limit: { context: 1048576, output: 131072 } },
            'glm-5.3': { name: 'GLM 5.3', capabilities: { input: ['text'], output: ['text'], reasoning: { supported: true, effort: ['low', 'high', 'max'] } }, limit: { context: 1000000, output: 131072 } },
            'step-5-preview': { name: 'Step 5', disabled: true, capabilities: { input: ['text'], output: ['text'] }, limit: { context: 128000, output: 32000 } },
          },
        },
      },
    }
    const catalog = buildCatalog({ consoleConfig, catalog: undefined, goRoster: { data: [{ id: 'kimi-k3' }, { id: 'glm-5.3' }] }, builtin })
    expect(catalog.source).toBe('console')
    // roster 两条都在，Console 额外的 step-5-preview 被追加。
    expect(catalog.models.map(model => model.id)).toEqual(['kimi-k3', 'glm-5.3', 'step-5-preview'])
    expect(catalog.models.find(model => model.id === 'step-5-preview')?.disabled).toBe(true)
    // Console 只给了输入/输出与思考控制，协议从 `aisdk:` 包名解析。
    expect(catalog.models.find(model => model.id === 'kimi-k3')?.api).toBe('openai-completions')
    expect(catalog.models.find(model => model.id === 'glm-5.3')?.thinkingLevelMap).toEqual({
      off: null,
      minimal: null,
      low: 'low',
      medium: null,
      high: 'high',
      xhigh: null,
      max: 'max',
    })
  })

  it('Console 的 Go 模型表为空时仍视为账号目录，模型全集取活 roster', () => {
    const catalog = buildCatalog({
      consoleConfig: { providers: { 'opencode-go': { name: 'OpenCode Go', headers: { 'x-opencode-org-id': 'wrk_test' }, models: {} } } },
      catalog: undefined,
      goRoster: { data: [{ id: 'kimi-k3' }, { id: 'glm-5.3' }] },
      builtin,
    })
    expect(catalog.source).toBe('console')
    expect(catalog.models.map(model => model.id)).toEqual(['kimi-k3', 'glm-5.3'])
  })

  it('Console 配置只暴露 x-opencode-* 路由头，凭据头被丢弃', () => {
    const scope = consoleModelsFromConsoleConfig({
      providers: {
        'opencode-go': {
          headers: { 'x-opencode-org-id': 'wrk_test', authorization: 'Bearer leak', 'api-key': 'leak', 'x-opencode-workspace': 'w' },
          models: {},
        },
      },
    })
    expect(scope?.headers).toEqual({ 'x-opencode-org-id': 'wrk_test', 'x-opencode-workspace': 'w' })
  })

  it('图片生成模型被排除并给出说明', () => {
    const result = buildCatalogEntry({
      id: 'image-model',
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

  it('roster 独有且三份元数据都缺失时按 chat completions 推断并提示', () => {
    const result = buildCatalogEntry({ id: 'omen-alpha' })
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
      catalogEntry: { name: 'Mystery', modalities: { input: ['text'], output: ['text'] }, reasoning: false },
      providerNpm: '@ai-sdk/mystery',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('无法识别的协议')
  })

  it('缺少容量时使用保守兜底', () => {
    const result = buildCatalogEntry({
      id: 'fresh',
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
    }
  })

  it('Console 配置解析能识别 modelID 别名并忽略缺失形状', () => {
    expect(consoleModelsFromConsoleConfig({
      providers: { 'opencode-go': { models: { alias: { modelID: 'real-id' } } } },
    })).toEqual({ providerId: 'opencode-go', models: [{ id: 'real-id', entry: { modelID: 'real-id' } }] })
    expect(consoleModelsFromConsoleConfig({ providers: {} })).toBeUndefined()
    expect(consoleModelsFromConsoleConfig('nope')).toBeUndefined()
    expect(consoleModelsFromConsoleConfig(undefined)).toBeUndefined()
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
