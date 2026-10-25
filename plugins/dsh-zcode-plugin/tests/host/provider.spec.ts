import { describe, expect, it } from 'vitest'

import { ZCodeHttpAdapter } from '../../src/host/http/adapter.ts'
import { reasoningEffortsOf } from '../../src/host/provider.ts'
import { reasoningEffort, resolveEffort } from '../../src/host/http/adapter.ts'
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
      // 与 provider.ts 的真实投影保持一致，否则测不到思考等级链路。
      ...(model.thinkingLevelMap === undefined
        ? {}
        : {
          efforts: reasoningEffortsOf(model.thinkingLevelMap),
          thinkingLevelMap: model.thinkingLevelMap,
        }),
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

/**
 * 会话选择器能否切换思考等级，取决于 `resolveModel` 是否透出 efforts。
 * 曾经完全不透出（选择器里只有默认档），这里逐项锁定。
 */
describe('思考等级透出', () => {
  it('上游 low/high/max 三档只透出三档，不重复列出映射到同一上游值的档位', async () => {
    const model = toModel({
      id: 'GLM-5.3',
      family: 'bigmodel',
      clientModel: {
        modelId: 'GLM-5.3',
        name: 'GLM-5.3',
        reasoningLevels: ['low', 'high', 'max'],
      },
    })
    const resolved = await adapterOf([model]).resolveModel(ZCODE_PROVIDER, 'GLM-5.3')

    const efforts = resolved.reasoning?.efforts ?? []
    // 上游只有 low/high/max：minimal→low、medium→high、xhigh→max 都是重复映射，
    // 列出来会让用户以为能选到不同档位，实际发出去的请求完全一样。
    expect(efforts.map(effort => String(effort.id))).toEqual(['low', 'high', 'max'])
    expect(efforts.map(effort => effort.name)).toEqual(['Low', 'High', 'Max'])
    expect(resolved.reasoning?.defaultEffort).toBe(String(efforts.at(-1)?.id))
  })

  it('上游只支持部分等级时只透出支持的档位', async () => {
    const model = toModel({
      id: 'GLM-5.2',
      family: 'bigmodel',
      clientModel: { modelId: 'GLM-5.2', name: 'GLM-5.2', reasoningLevels: ['high'] },
    })
    const resolved = await adapterOf([model]).resolveModel(ZCODE_PROVIDER, 'GLM-5.2')

    // 上游只给 high：medium→high 与 high→high 同值，只保留 high。
    const ids = (resolved.reasoning?.efforts ?? []).map(effort => String(effort.id))
    expect(ids).toEqual(['high'])
    // 不支持的档位不能出现，否则选中后会被上游拒绝。
    expect(ids).not.toContain('max')
    expect(ids).not.toContain('minimal')
  })

  it('不支持思考的模型不透出 reasoning', async () => {
    const resolved = await adapterOf([toModel({ id: 'GLM-5.2', family: 'bigmodel' })])
      .resolveModel(ZCODE_PROVIDER, 'GLM-5.2')
    expect(resolved.reasoning).toBeUndefined()
  })
})

/** 历史会话可能存着已被过滤掉的等级，不能把内部 id 原样发出去或显示出来。 */
describe('思考等级回退', () => {
  const model = {
    id: 'GLM-5.3-Flash',
    name: 'GLM-5.3-Flash',
    contextWindow: 200000,
    maxTokens: 80000,
    reasoning: true,
    efforts: [
      { id: reasoningEffort('low', 'Low').id, name: 'Low' },
      { id: reasoningEffort('high', 'High').id, name: 'High' },
      { id: reasoningEffort('max', 'Max').id, name: 'Max' },
    ],
    thinkingLevelMap: { low: 'low', medium: 'high', high: 'high', xhigh: 'max', max: 'max' },
  }

  it('可用等级原样保留', () => {
    expect(resolveEffort('high', model)).toBe('high')
  })

  it('已下线的等级回退到最高档，而不是透传', () => {
    // xhigh 在旧目录里存在，现在被去重过滤掉了。
    expect(resolveEffort('xhigh', model)).toBe('max')
    expect(resolveEffort('minimal', model)).toBe('max')
  })

  it('未指定等级时交给上游默认', () => {
    expect(resolveEffort(undefined, model)).toBeUndefined()
  })
})
