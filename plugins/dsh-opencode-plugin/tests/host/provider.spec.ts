import { opencodeGoProvider } from '@earendil-works/pi-ai/providers/opencode-go'
import { describe, expect, it } from 'vitest'
import type { OpenCodeModel } from '../../src/contracts/catalog.ts'
import { OPENCODE_PROVIDER } from '../../src/contracts/identity.ts'
import { createOpenCodePiAdapter, createOpenCodeProfile, createOpenCodeProvider, toPiModel } from '../../src/host/provider.ts'

function model(overrides: Partial<OpenCodeModel> = {}): OpenCodeModel {
  return {
    id: 'demo',
    name: 'Demo',
    api: 'openai-completions',
    baseURL: 'https://opencode.ai/inference/go/openai/v1',
    reasoning: true,
    thinkingLevelMap: { low: 'low', high: 'high', max: 'max' },
    input: ['text', 'image'],
    contextWindow: 100,
    maxTokens: 10,
    go: true,
    ...overrides,
  }
}

describe('动态 provider 投影', () => {
  it('保留协议、端点、思考等级与图片能力', () => {
    const pi = toPiModel(model())
    expect(pi.id).toBe('demo')
    expect(pi.provider).toBe(OPENCODE_PROVIDER)
    expect(pi.api).toBe('openai-completions')
    expect(pi.baseUrl).toBe('https://opencode.ai/inference/go/openai/v1')
    expect(pi.reasoning).toBe(true)
    expect(pi.thinkingLevelMap).toEqual({ low: 'low', high: 'high', max: 'max' })
    expect(pi.input).toEqual(['text', 'image'])
    expect(pi.contextWindow).toBe(100)
    expect(pi.maxTokens).toBe(10)
    expect(pi.type).toBe('chat')
  })

  it('provider 过滤掉 Console 明确禁用的模型', () => {
    const provider = createOpenCodeProvider(
      [model({ id: 'on' }), model({ id: 'off', disabled: true })],
      async () => 'token',
    )
    expect(provider.getModels().map(entry => entry.id)).toEqual(['on'])
  })

  it('混合协议可以同时出现在一个 provider 中', () => {
    const provider = createOpenCodeProvider([
      model({ id: 'chat', api: 'openai-completions', baseURL: 'https://opencode.ai/inference/go/openai/v1' }),
      model({ id: 'responses', api: 'openai-responses', baseURL: 'https://opencode.ai/inference/go/openai/v1' }),
      model({ id: 'anthropic', api: 'anthropic-messages', baseURL: 'https://opencode.ai/inference/go/anthropic' }),
      model({ id: 'google', api: 'google-generative-ai', baseURL: 'https://opencode.ai/inference/go/google/v1beta' }),
    ], async () => 'token')
    expect(provider.getModels().map(entry => [entry.id, entry.api])).toEqual([
      ['chat', 'openai-completions'],
      ['responses', 'openai-responses'],
      ['anthropic', 'anthropic-messages'],
      ['google', 'google-generative-ai'],
    ])
  })

  it('provider 的鉴权解析返回当前 token，未登录时不返回凭据', async () => {
    let token: string | undefined
    const provider = createOpenCodeProvider([model()], async () => token)
    const auth = provider.auth.apiKey
    expect(auth).toBeDefined()
    const missing = await auth?.resolve({ ctx: { env: async () => undefined, fileExists: async () => false }, signal: new AbortController().signal })
    expect(missing).toBeUndefined()
    token = 'secret-token'
    const resolved = await auth?.resolve({ ctx: { env: async () => undefined, fileExists: async () => false }, signal: new AbortController().signal })
    expect(resolved?.auth).toEqual({ apiKey: 'secret-token' })
  })

  it('内置目录每条模型都能被投影（协议与端点自洽）', () => {
    for (const entry of opencodeGoProvider().getModels()) {
      const pi = toPiModel({
        id: entry.id,
        name: entry.name,
        api: entry.api as OpenCodeModel['api'],
        baseURL: entry.baseUrl,
        reasoning: entry.reasoning,
        ...(entry.thinkingLevelMap === undefined ? {} : { thinkingLevelMap: entry.thinkingLevelMap }),
        input: entry.input,
        contextWindow: entry.contextWindow,
        maxTokens: entry.maxTokens,
        go: true,
      })
      expect(pi.api).toBe(entry.api)
      expect(pi.reasoning).toBe(entry.reasoning)
    }
  })
})

describe('pi-ai 适配器集成', () => {
  it('未登录时 listModels 返回空目录，登录后返回全部模型', async () => {
    let token: string | undefined
    const profile = createOpenCodeProfile([model({ id: 'a' }), model({ id: 'b' })], async () => token)
    const adapter = createOpenCodePiAdapter({ profiles: () => new Map([[OPENCODE_PROVIDER, profile]]), resolveAccessToken: async () => token })
    expect(await adapter.listModels(OPENCODE_PROVIDER)).toEqual([])
    token = 'token'
    expect((await adapter.listModels(OPENCODE_PROVIDER)).map(entry => entry.id)).toEqual(['a', 'b'])
  })

  it('resolveModelInfo 暴露思考等级、图片输入与上下文窗口', async () => {
    const profile = createOpenCodeProfile([
      model({
        id: 'thinking',
        thinkingLevelMap: { off: 'none', minimal: null, low: 'low', medium: 'medium', high: 'high', xhigh: null, max: 'max' },
        contextWindow: 1_000_000,
        maxTokens: 131_072,
        input: ['text', 'image'],
      }),
    ], async () => 'token')
    const adapter = createOpenCodePiAdapter({ profiles: () => new Map([[OPENCODE_PROVIDER, profile]]), resolveAccessToken: async () => 'token' })
    const info = await adapter.resolveModel(OPENCODE_PROVIDER, 'thinking')
    expect(info.provider).toBe(OPENCODE_PROVIDER)
    expect(info.context?.contextWindow).toBe(1_000_000)
    expect(info.inputModalities).toEqual(['text', 'image'])
    expect(info.reasoning?.efforts.map(effort => effort.id)).toEqual(['off', 'low', 'medium', 'high', 'max'])
  })

  it('目录更新后适配器读到新的模型集合', async () => {
    let mode: 'a' | 'b' = 'a'
    const profiles = () => new Map([[OPENCODE_PROVIDER, createOpenCodeProfile([model({ id: mode })], async () => 'token')]])
    const adapter = createOpenCodePiAdapter({ profiles, resolveAccessToken: async () => 'token' })
    expect((await adapter.listModels(OPENCODE_PROVIDER)).map(entry => entry.id)).toEqual(['a'])
    mode = 'b'
    expect((await adapter.listModels(OPENCODE_PROVIDER)).map(entry => entry.id)).toEqual(['b'])
  })
})
