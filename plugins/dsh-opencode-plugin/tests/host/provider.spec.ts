import { opencodeProvider } from '@earendil-works/pi-ai/providers/opencode'
import { opencodeGoProvider } from '@earendil-works/pi-ai/providers/opencode-go'
import { describe, expect, it } from 'vitest'
import type { OpenCodeModel } from '../../src/contracts/catalog.ts'
import { modelKey, OPENCODE_PROVIDER, wireModelId } from '../../src/contracts/identity.ts'
import {
  createOpenCodePiAdapter,
  createOpenCodeProfile,
  createOpenCodeProvider,
  toPiModel,
} from '../../src/host/provider.ts'

function model(overrides: Partial<OpenCodeModel> = {}): OpenCodeModel {
  return {
    id: 'demo',
    name: 'Demo',
    api: 'openai-completions',
    baseURL: 'https://opencode.ai/inference/openai/v1',
    reasoning: true,
    thinkingLevelMap: { low: 'low', high: 'high', max: 'max' },
    input: ['text', 'image'],
    contextWindow: 100,
    maxTokens: 10,
    plan: 'zen',
    tools: true,
    free: false,
    ...overrides,
  }
}

describe('合并供应商的模型投影', () => {
  it('模型 id 带 plan 前缀，显示名带 · zen / · go 小尾巴', () => {
    const zen = toPiModel(model())
    const go = toPiModel(model({ plan: 'go' }))
    expect(zen.id).toBe('zen:demo')
    expect(zen.name).toBe('Demo · zen')
    expect(go.id).toBe('go:demo')
    expect(go.name).toBe('Demo · go')
    expect(zen.provider).toBe(OPENCODE_PROVIDER)
    expect(zen.api).toBe('openai-completions')
    expect(zen.baseUrl).toBe('https://opencode.ai/inference/openai/v1')
    expect(zen.reasoning).toBe(true)
    expect(zen.thinkingLevelMap).toEqual({ low: 'low', high: 'high', max: 'max' })
    expect(zen.input).toEqual(['text', 'image'])
    expect(zen.contextWindow).toBe(100)
    expect(zen.maxTokens).toBe(10)
    expect(zen.type).toBe('chat')
  })

  it('发请求前剥离 plan 前缀，还原网关模型 id', () => {
    expect(wireModelId('zen:deepseek-v4.1-flash')).toBe('deepseek-v4.1-flash')
    expect(wireModelId('go:deepseek-v4.1-flash')).toBe('deepseek-v4.1-flash')
    expect(wireModelId('gpt-5.6-luna')).toBe('gpt-5.6-luna')
    expect(modelKey('go', 'x')).toBe('go:x')
  })

  it('provider 过滤掉 Console 明确禁用的模型', () => {
    const provider = createOpenCodeProvider(
      [model({ id: 'on' }), model({ id: 'off', disabled: true })],
      async () => 'token',
    )
    expect(provider.id).toBe(OPENCODE_PROVIDER)
    expect(provider.name).toBe('OpenCode')
    expect(provider.getModels().map(entry => entry.id)).toEqual(['zen:on'])
  })

  it('混合协议可以同时出现在同一个 provider 中', () => {
    const provider = createOpenCodeProvider([
      model({ id: 'chat', api: 'openai-completions', baseURL: 'https://opencode.ai/inference/openai/v1' }),
      model({ id: 'responses', api: 'openai-responses', baseURL: 'https://opencode.ai/inference/openai/v1' }),
      model({ id: 'anthropic', api: 'anthropic-messages', baseURL: 'https://opencode.ai/inference/anthropic' }),
      model({ id: 'google', api: 'google-generative-ai', baseURL: 'https://opencode.ai/inference/google/v1beta' }),
    ], async () => 'token')
    expect(provider.getModels().map(entry => [entry.id, entry.api])).toEqual([
      ['zen:chat', 'openai-completions'],
      ['zen:responses', 'openai-responses'],
      ['zen:anthropic', 'anthropic-messages'],
      ['zen:google', 'google-generative-ai'],
    ])
  })

  it('provider 的鉴权解析返回当前 token，未登录时不返回凭据', async () => {
    let token: string | undefined
    const provider = createOpenCodeProvider([model()], async () => token)
    const auth = provider.auth.apiKey
    expect(auth).toBeDefined()
    const ctx = { env: async () => undefined, fileExists: async () => false }
    expect(await auth?.resolve({ ctx, signal: new AbortController().signal })).toBeUndefined()
    token = 'secret-token'
    const resolved = await auth?.resolve({ ctx, signal: new AbortController().signal })
    expect(resolved?.auth).toEqual({ apiKey: 'secret-token' })
  })

  it('两组内置目录都能被投影（协议与端点自洽）', () => {
    for (const [plan, entries] of [
      ['zen', opencodeProvider().getModels()],
      ['go', opencodeGoProvider().getModels()],
    ] as const) {
      for (const entry of entries) {
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
          plan,
          tools: true,
          free: false,
        })
        expect(pi.api).toBe(entry.api)
        expect(pi.provider).toBe(OPENCODE_PROVIDER)
        expect(pi.id).toBe(modelKey(plan, entry.id))
        expect(pi.name.endsWith(` · ${plan}`)).toBe(true)
      }
    }
  })
})

describe('pi-ai 适配器集成', () => {
  it('未登录时 listModels 返回空目录，登录后返回带前缀的模型集合', async () => {
    let token: string | undefined
    const profile = createOpenCodeProfile([model({ id: 'a' }), model({ id: 'b', plan: 'go' })], async () => token)
    const adapter = createOpenCodePiAdapter({
      profiles: () => new Map([[OPENCODE_PROVIDER, profile]]),
      resolveAccessToken: async () => token,
    })
    expect(await adapter.listModels(OPENCODE_PROVIDER)).toEqual([])
    token = 'token'
    expect((await adapter.listModels(OPENCODE_PROVIDER)).map(entry => entry.id)).toEqual(['zen:a', 'go:b'])
    expect(adapter.providerInfo(OPENCODE_PROVIDER).name).toBe('OpenCode')
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
    const adapter = createOpenCodePiAdapter({
      profiles: () => new Map([[OPENCODE_PROVIDER, profile]]),
      resolveAccessToken: async () => 'token',
    })
    const info = await adapter.resolveModel(OPENCODE_PROVIDER, 'zen:thinking')
    expect(info.provider).toBe(OPENCODE_PROVIDER)
    expect(info.name).toBe('Demo · zen')
    expect(info.context?.contextWindow).toBe(1_000_000)
    expect(info.inputModalities).toEqual(['text', 'image'])
    expect(info.reasoning?.efforts.map(effort => effort.id)).toEqual(['off', 'low', 'medium', 'high', 'max'])
  })

  it('目录更新后适配器读到新的模型集合', async () => {
    let mode: 'a' | 'b' = 'a'
    const profiles = () => new Map([
      [OPENCODE_PROVIDER, createOpenCodeProfile([model({ id: mode })], async () => 'token')],
    ])
    const adapter = createOpenCodePiAdapter({ profiles, resolveAccessToken: async () => 'token' })
    expect((await adapter.listModels(OPENCODE_PROVIDER)).map(entry => entry.id)).toEqual(['zen:a'])
    mode = 'b'
    expect((await adapter.listModels(OPENCODE_PROVIDER)).map(entry => entry.id)).toEqual(['zen:b'])
  })
})
