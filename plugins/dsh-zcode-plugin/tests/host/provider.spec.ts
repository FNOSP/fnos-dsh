import { describe, expect, it } from 'vitest'

import { ZCodeHttpAdapter } from '../../src/host/http/adapter.ts'
import { toModel } from '../../src/host/catalog.ts'
import { ZCODE_PROVIDER, ZCODE_PROVIDER_NAME } from '../../src/contracts/identity.ts'

function adapterOf(models: ReturnType<typeof toModel>[]): ZCodeHttpAdapter {
  return new ZCodeHttpAdapter({
    models: () => models.map(model => ({
      id: model.id,
      name: model.name,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      reasoning: model.reasoning,
      inputModalities: model.input,
    })),
    baseUrl: () => 'https://zcode.z.ai/api/v1/zcode-plan/anthropic',
    apiKey: async () => 'test-key',
    deviceId: () => 'device-1',
  })
}

/**
 * 这条通道自己收发 Anthropic Messages，因此模型能力由这里投影给宿主。
 * 投影错了会让长对话被截断或思考等级不可选，所以逐项锁定。
 */
describe('HTTP 通道的模型投影', () => {
  it('把目录能力投影成宿主可读的模型信息', async () => {
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
    const resolved = await adapterOf([model]).resolveModel(ZCODE_PROVIDER, 'GLM-5.3')

    expect(resolved.id).toBe('GLM-5.3')
    expect(resolved.context).toEqual({ contextWindow: 1_000_000 })
    expect(resolved.defaultMaxTokens).toBe(128_000)
  })

  it('未知模型报未知模型错误，而不是静默用默认值', async () => {
    await expect(adapterOf([]).resolveModel(ZCODE_PROVIDER, 'nope')).rejects.toThrow(/未知模型/)
  })

  it('listModels 带上输入模态，供宿主决定是否发送图片块', async () => {
    const model = toModel({ id: 'GLM-5.3-Flash', family: 'bigmodel' })
    const listed = await adapterOf([model]).listModels(ZCODE_PROVIDER)
    expect(listed[0]?.id).toBe('GLM-5.3-Flash')
    expect(listed[0]?.inputModalities).toEqual(['text'])
  })
})

/** registry 在 registerAdapter 时立即缓存 providerInfo，显示名必须与此无关。 */
describe('供应商显示名', () => {
  it('providerInfo 返回显示名而不是路由 id', () => {
    const info = adapterOf([]).providerInfo(ZCODE_PROVIDER)
    expect(info).toEqual({ id: ZCODE_PROVIDER, name: ZCODE_PROVIDER_NAME })
    expect(info.name).toBe('zcode')
  })
})
