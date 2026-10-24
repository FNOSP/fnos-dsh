import { opencodeProvider } from '@earendil-works/pi-ai/providers/opencode'
import { opencodeGoProvider } from '@earendil-works/pi-ai/providers/opencode-go'
import { describe, expect, it } from 'vitest'
import type { OpenCodeModel } from '../../src/contracts/catalog.ts'
import {
  OPENCODE_GO_PROVIDER,
  OPENCODE_PROVIDER,
  providerForPlan,
} from '../../src/contracts/identity.ts'
import {
  createOpenCodePiAdapter,
  createOpenCodeProfile,
  createOpenCodeProvider,
  toPiModel,
} from '../../src/host/provider.ts'

const zenRoute = providerForPlan('zen')
const goRoute = providerForPlan('go')

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

describe('动态 provider 投影', () => {
  it('保留协议、端点、思考等级、能力与图片输入', () => {
    const pi = toPiModel(model(), OPENCODE_PROVIDER)
    expect(pi.id).toBe('demo')
    expect(pi.provider).toBe(OPENCODE_PROVIDER)
    expect(pi.api).toBe('openai-completions')
    expect(pi.baseUrl).toBe('https://opencode.ai/inference/openai/v1')
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
      zenRoute,
      async () => 'token',
    )
    expect(provider.id).toBe(OPENCODE_PROVIDER)
    expect(provider.name).toBe('OpenCode Zen')
    expect(provider.getModels().map(entry => entry.id)).toEqual(['on'])
  })

  it('混合协议可以同时出现在一组 provider 中', () => {
    const provider = createOpenCodeProvider([
      model({ id: 'chat', api: 'openai-completions', baseURL: 'https://opencode.ai/inference/openai/v1' }),
      model({ id: 'responses', api: 'openai-responses', baseURL: 'https://opencode.ai/inference/openai/v1' }),
      model({ id: 'anthropic', api: 'anthropic-messages', baseURL: 'https://opencode.ai/inference/anthropic' }),
      model({ id: 'google', api: 'google-generative-ai', baseURL: 'https://opencode.ai/inference/google/v1beta' }),
    ], zenRoute, async () => 'token')
    expect(provider.getModels().map(entry => [entry.id, entry.api])).toEqual([
      ['chat', 'openai-completions'],
      ['responses', 'openai-responses'],
      ['anthropic', 'anthropic-messages'],
      ['google', 'google-generative-ai'],
    ])
  })

  it('provider 的鉴权解析返回当前 token，未登录时不返回凭据', async () => {
    let token: string | undefined
    const provider = createOpenCodeProvider([model()], zenRoute, async () => token)
    const auth = provider.auth.apiKey
    expect(auth).toBeDefined()
    const ctx = { env: async () => undefined, fileExists: async () => false }
    expect(await auth?.resolve({ ctx, signal: new AbortController().signal })).toBeUndefined()
    token = 'secret-token'
    const resolved = await auth?.resolve({ ctx, signal: new AbortController().signal })
    expect(resolved?.auth).toEqual({ apiKey: 'secret-token' })
  })

  it('两组内置目录都能被投影（协议与端点自洽）', () => {
    for (const [route, entries] of [
      [zenRoute, opencodeProvider().getModels()],
      [goRoute, opencodeGoProvider().getModels()],
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
          plan: route.plan,
          tools: true,
          free: false,
        }, route.id)
        expect(pi.api).toBe(entry.api)
        expect(pi.provider).toBe(route.id)
      }
    }
  })
})

describe('pi-ai 适配器集成', () => {
  it('未登录时 listModels 返回空目录，登录后返回全部模型', async () => {
    let token: string | undefined
    const profile = createOpenCodeProfile(zenRoute, [model({ id: 'a' }), model({ id: 'b' })], async () => token)
    const adapter = createOpenCodePiAdapter({
      profiles: () => new Map([[OPENCODE_PROVIDER, profile]]),
      resolveAccessToken: async () => token,
    })
    expect(await adapter.listModels(OPENCODE_PROVIDER)).toEqual([])
    token = 'token'
    expect((await adapter.listModels(OPENCODE_PROVIDER)).map(entry => entry.id)).toEqual(['a', 'b'])
  })

  it('两组路由分别暴露自己的模型与供应商名称', async () => {
    const zenProfile = createOpenCodeProfile(zenRoute, [model({ id: 'zen-model' })], async () => 'token')
    const goProfile = createOpenCodeProfile(goRoute, [model({ id: 'go-model', plan: 'go' })], async () => 'token')
    const adapter = createOpenCodePiAdapter({
      profiles: () => new Map([
        [OPENCODE_PROVIDER, zenProfile],
        [OPENCODE_GO_PROVIDER, goProfile],
      ]),
      resolveAccessToken: async () => 'token',
    })
    expect((await adapter.listModels(OPENCODE_PROVIDER)).map(entry => entry.id)).toEqual(['zen-model'])
    expect((await adapter.listModels(OPENCODE_GO_PROVIDER)).map(entry => entry.id)).toEqual(['go-model'])
    expect(adapter.providerInfo(OPENCODE_PROVIDER).name).toBe('OpenCode Zen')
    expect(adapter.providerInfo(OPENCODE_GO_PROVIDER).name).toBe('OpenCode Go')
  })

  it('resolveModelInfo 暴露思考等级、图片输入与上下文窗口', async () => {
    const profile = createOpenCodeProfile(zenRoute, [
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
    const info = await adapter.resolveModel(OPENCODE_PROVIDER, 'thinking')
    expect(info.provider).toBe(OPENCODE_PROVIDER)
    expect(info.context?.contextWindow).toBe(1_000_000)
    expect(info.inputModalities).toEqual(['text', 'image'])
    expect(info.reasoning?.efforts.map(effort => effort.id)).toEqual(['off', 'low', 'medium', 'high', 'max'])
  })

  it('目录更新后适配器读到新的模型集合', async () => {
    let mode: 'a' | 'b' = 'a'
    const profiles = () => new Map([
      [OPENCODE_PROVIDER, createOpenCodeProfile(zenRoute, [model({ id: mode })], async () => 'token')],
    ])
    const adapter = createOpenCodePiAdapter({ profiles, resolveAccessToken: async () => 'token' })
    expect((await adapter.listModels(OPENCODE_PROVIDER)).map(entry => entry.id)).toEqual(['a'])
    mode = 'b'
    expect((await adapter.listModels(OPENCODE_PROVIDER)).map(entry => entry.id)).toEqual(['b'])
  })
})
