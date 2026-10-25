import { describe, expect, it } from 'vitest'
import { createZCodePiAdapter, toPiModel } from '../../src/host/provider.ts'
import { toModel } from '../../src/host/catalog.ts'
import { ZCODE_PROVIDER, ZCODE_PROVIDER_NAME } from '../../src/contracts/identity.ts'

describe('pi-ai 模型投影', () => {
  it('思考等级映射与端点随目录下发', () => {
    const model = toModel({
      id: 'GLM-5.3',
      family: 'bigmodel',
      clientModel: {
        modelId: 'GLM-5.3',
        name: 'GLM-5.3',
        contextWindow: 1_000_000,
        maxCompletionTokens: 128_000,
        reasoningLevels: ['low', 'high', 'max'],
      },
    })
    const pi = toPiModel(model) as unknown as Record<string, unknown>
    expect(pi.id).toBe('GLM-5.3')
    expect(pi.api).toBe('anthropic-messages')
    expect(pi.provider).toBe('dsh-zcode')
    expect(pi.baseUrl).toBe('https://zcode.z.ai/api/v1/zcode-plan/anthropic')
    expect(pi.contextWindow).toBe(1_000_000)
    expect(pi.maxTokens).toBe(128_000)
    expect(pi.reasoning).toBe(true)
    expect(pi.thinkingLevelMap).toMatchObject({ high: 'high', max: 'max' })
  })

  it('支持思考的模型带 forceAdaptiveThinking，让 pi-ai 发 output_config.effort', () => {
    const reasoning = toPiModel(toModel({
      id: 'GLM-5.3-Flash',
      family: 'bigmodel',
      clientModel: {
        modelId: 'GLM-5.3-Flash',
        name: 'GLM-5.3-Flash',
        reasoningLevels: ['low', 'high', 'max'],
      },
    })) as unknown as { compat?: { forceAdaptiveThinking?: boolean } }
    expect(reasoning.compat?.forceAdaptiveThinking).toBe(true)

    // 不支持思考的模型不带上这个开关，避免把 budget 之外的路径带进普通模型。
    const plain = toPiModel(toModel({ id: 'GLM-5.2', family: 'bigmodel' })) as unknown as {
      compat?: unknown
    }
    expect(plain.compat).toBeUndefined()
  })
})

describe('端点策略', () => {
  it('toPiModel 用覆盖的端点，未给时用目录端点', () => {
    const model = toModel({ id: 'GLM-5.3-Flash', family: 'bigmodel' })
    const withOverride = toPiModel(model, 'https://zcode.z.ai/api/v1/ultra/anthropic') as unknown as {
      baseUrl: string
    }
    expect(withOverride.baseUrl).toBe('https://zcode.z.ai/api/v1/ultra/anthropic')
    const plain = toPiModel(model) as unknown as { baseUrl: string }
    expect(plain.baseUrl).toBe('https://zcode.z.ai/api/v1/zcode-plan/anthropic')
  })
})

describe('供应商显示名', () => {
  it('注册时（profile 还为空）providerInfo 也返回显示名，而不是 provider id', () => {
    // registry 在 registerAdapter 时立即捕获 providerInfo 并永久缓存；这是
    // 「模型选择器分组显示成 dsh-zcode」的根因，回归锁在这里。
    const adapter = createZCodePiAdapter({
      profiles: () => new Map(),
      resolveToken: async () => undefined,
    })
    const info = adapter.providerInfo(ZCODE_PROVIDER)
    expect(info).toEqual({ id: ZCODE_PROVIDER, name: ZCODE_PROVIDER_NAME })
    expect(info.name).toBe('zcode')
  })
})
