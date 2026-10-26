import { opencodeProvider } from '@earendil-works/pi-ai/providers/opencode'
import { opencodeGoProvider } from '@earendil-works/pi-ai/providers/opencode-go'
import type { ProviderStreams } from '@earendil-works/pi-ai'
import { describe, expect, it } from 'vitest'
import type { OpenCodeModel } from '../../src/contracts/catalog.ts'
import { modelKey, OPENCODE_PROVIDER, wireModelId } from '../../src/contracts/identity.ts'
import {
  createOpenCodePiAdapter,
  createOpenCodeProfile,
  createOpenCodeProvider,
  ensureOpenCodeSessionHeader,
  OPENCODE_FALLBACK_SESSION_ID,
  OpenCodeProviderRuntime,
  toPiModel,
  withOpenCodeSessionFallback,
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

describe('目录变化广播', () => {
  /** 最小可用的模型条目。 */
  const model = (id: string, plan: 'zen' | 'go'): OpenCodeModel => ({
    id,
    name: id,
    api: 'openai-completions',
    baseURL: 'https://opencode.ai/inference/go/openai/v1',
    reasoning: false,
    input: ['text'],
    contextWindow: 1000,
    maxTokens: 100,
    tools: true,
    free: false,
    plan,
  })

  /** 造一个只记录 llm 调用的 ctx。 */
  const makeCtx = () => {
    const calls = { register: 0, replace: [] as string[][] }
    const llm = {
      registerAdapter: () => {
        calls.register += 1
        const handle = (() => {}) as (() => void) & { replace: (providers: string[]) => void }
        handle.replace = (providers: string[]) => { calls.replace.push(providers) }
        return handle
      },
    }
    const ctx = {
      llm,
      logger: { warn: () => {}, info: () => {} },
      effect: (fn: () => () => void) => { fn() },
    }
    return { ctx, calls }
  }

  const runtime = (): OpenCodeProviderRuntime => new OpenCodeProviderRuntime({
    resolveAccessToken: async () => 'token',
    resolveAttachments: () => undefined,
    logger: { warn: () => {}, info: () => {} },
  })

  it('注册后目录变化会通过 replace 广播一次', () => {
    const { ctx, calls } = makeCtx()
    const instance = runtime()
    instance.register(ctx as never)
    expect(calls.register).toBe(1)

    instance.update([model('a', 'go')])
    expect(calls.replace).toEqual([[OPENCODE_PROVIDER]])
  })

  it('目录未变化时不重复广播，顺序变化会广播', () => {
    const { ctx, calls } = makeCtx()
    const instance = runtime()
    instance.register(ctx as never)
    const models = [model('a', 'go'), model('b', 'zen')]
    instance.update(models)
    instance.update(models)
    expect(calls.replace.length).toBe(1)

    instance.update([model('b', 'zen'), model('a', 'go')])
    expect(calls.replace.length).toBe(2)
  })

  it('未注册时更新只换快照，不广播', () => {
    const { calls } = makeCtx()
    const instance = runtime()
    instance.update([model('a', 'go')])
    expect(calls.register).toBe(0)
    expect(calls.replace).toEqual([])
  })
})

describe('辅助调用的会话头兜底', () => {
  type Captured = { headers?: Record<string, string | null>, sessionId?: string }

  it('无会话身份时补稳定兜底值', () => {
    const options: Captured = ensureOpenCodeSessionHeader({})
    expect(options.headers?.['x-opencode-session']).toBe(OPENCODE_FALLBACK_SESSION_ID)
  })

  it('有会话 id 时优先使用会话 id', () => {
    const options: Captured = ensureOpenCodeSessionHeader({ sessionId: 'session-a' })
    expect(options.headers?.['x-opencode-session']).toBe('session-a')
  })

  it('空会话 id 视为缺失，使用兜底值', () => {
    const options: Captured = ensureOpenCodeSessionHeader({ sessionId: '' })
    expect(options.headers?.['x-opencode-session']).toBe(OPENCODE_FALLBACK_SESSION_ID)
  })

  it('调用方已有的头（大小写不敏感）不被覆盖', () => {
    const options: Captured = ensureOpenCodeSessionHeader({ headers: { 'X-OPEncode-Session': 'given' } })
    expect(options.headers?.['X-OPEncode-Session']).toBe('given')
    const names = Object.keys(options.headers ?? {}).filter(key => key.toLowerCase() === 'x-opencode-session')
    expect(names).toHaveLength(1)
  })

  it('不改写原 options 对象', () => {
    const original = { sessionId: 'session-a' }
    const options: Captured = ensureOpenCodeSessionHeader(original)
    expect(options).not.toBe(original)
    expect('headers' in original).toBe(false)
  })

  it('stream 与 streamSimple 两条路径都会补齐', () => {
    const calls: Array<{ kind: string, options: Captured }> = []
    const streams = {
      stream: (_model: unknown, _context: unknown, options: Captured) => {
        calls.push({ kind: 'stream', options })
        return undefined as never
      },
      streamSimple: (_model: unknown, _context: unknown, options: Captured) => {
        calls.push({ kind: 'streamSimple', options })
        return undefined as never
      },
    } as unknown as ProviderStreams
    const wrapped = withOpenCodeSessionFallback(streams, 'fallback-x')
    wrapped.stream({} as never, {} as never, {})
    wrapped.streamSimple({} as never, {} as never, { sessionId: 'session-b' })
    expect(calls[0]?.options.headers?.['x-opencode-session']).toBe('fallback-x')
    expect(calls[1]?.options.headers?.['x-opencode-session']).toBe('session-b')
  })

  it('真实请求路径：无会话身份时请求头包含兜底值', async () => {
    const provider = createOpenCodeProvider([model({ id: 'demo' })], async () => 'token')
    const pi = toPiModel(model({ id: 'demo' }))
    const headers: Headers[] = []
    const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      headers.push(new Request(input as RequestInfo, init).headers)
      return new Response(JSON.stringify({ error: { message: 'stop' } }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      })
    }
    const context = { messages: [{ role: 'user', content: 'hi' }] }
    const run = async (options: Record<string, unknown>): Promise<void> => {
      const stream = provider.stream(pi, context as never, {
        apiKey: 'token',
        fetch: fakeFetch as never,
        ...options,
      } as never)
      for await (const _chunk of stream) { /* 消费到结束，确保请求已发出 */ }
    }
    await run({})
    await run({ sessionId: 'session-z' })
    expect(headers[0]?.get('x-opencode-session')).toBe(OPENCODE_FALLBACK_SESSION_ID)
    expect(headers[1]?.get('x-opencode-session')).toBe('session-z')
  })
})
