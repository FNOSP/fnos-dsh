import { describe, expect, it } from 'vitest'
import type { LlmModelInfo, LlmProviderInfo, LlmRuntime } from '@deepseek-ai/dsh-llm'
import { buildCatalog, modelSupportsImage, toOpenAiModel } from '../../src/host/catalog.ts'

/**
 * 模型目录映射（FNOS-013-02）。
 *
 * 覆盖 AC-01（全量模型、「提供方/模型」标识）、AC-02（图片能力标注与宿主元数据
 * 一致）与 AC-03 的映射侧（新增提供方无需改桥）。
 */

/** 构造一个最小可用的宿主模型层替身。 */
function fakeLlm(providers: LlmProviderInfo[], models: Record<string, readonly LlmModelInfo[]>): LlmRuntime {
  return {
    listProviders: () => providers,
    listModels: async (provider: string) => models[provider] ?? [],
  } as unknown as LlmRuntime
}

describe('toOpenAiModel', () => {
  it('标识为「提供方/模型」且保留可读名与归属', () => {
    const entry = toOpenAiModel({
      provider: 'codebuddy',
      id: 'glm-5.3-flash',
      name: 'GLM-5.3-Flash',
    })
    expect(entry.id).toBe('codebuddy/glm-5.3-flash')
    expect(entry.name).toBe('GLM-5.3-Flash')
    expect(entry.owned_by).toBe('codebuddy')
  })

  it('图片能力与宿主元数据一致：显式含 image 时为 true', () => {
    const entry = toOpenAiModel({
      provider: 'codebuddy',
      id: 'glm-5.3-flash',
      name: 'GLM-5.3-Flash',
      inputModalities: ['text', 'image'],
    })
    expect(entry.vision).toBe(true)
    expect(entry.input_modalities).toEqual(['text', 'image'])
  })

  it('元数据缺省（未知）时按不支持处理，且不伪造 input_modalities 字段', () => {
    // 宿主契约：inputModalities 缺省表示「未知」，显式不含 image 表示「不支持」。
    // 桥把未知按不支持处理（AC-02 的能力门控），但不编造字段值。
    const entry = toOpenAiModel({ provider: 'p', id: 'm', name: 'M' })
    expect(entry.vision).toBe(false)
    expect('input_modalities' in entry).toBe(false)
  })

  it('显式 text-only 与缺省同样判为不支持', () => {
    expect(modelSupportsImage({ inputModalities: ['text'] })).toBe(false)
    expect(modelSupportsImage({})).toBe(false)
  })

  it('保留宿主给出的 description', () => {
    const entry = toOpenAiModel({ provider: 'p', id: 'm', name: 'M', description: '说明' })
    expect(entry.description).toBe('说明')
  })

  it('模型 id 自含 / 时标识仍可被解析回来', () => {
    const entry = toOpenAiModel({ provider: 'openrouter', id: 'deepseek/deepseek-chat', name: 'DS' })
    expect(entry.id).toBe('openrouter/deepseek/deepseek-chat')
  })
})

describe('buildCatalog', () => {
  it('聚合全部提供方的模型（AC-01）', async () => {
    const llm = fakeLlm(
      [{ id: 'deepseek-official', name: 'DeepSeek' }, { id: 'codebuddy', name: 'CodeBuddy' }],
      {
        'deepseek-official': [{ provider: 'deepseek-official', id: 'deepseek-chat', name: 'DeepSeek Chat' }],
        codebuddy: [
          { provider: 'codebuddy', id: 'glm-5.3-flash', name: 'GLM', inputModalities: ['text', 'image'] },
          { provider: 'codebuddy', id: 'hy3', name: 'Hy3' },
        ],
      },
    )
    const snapshot = await buildCatalog(llm)
    expect(snapshot.entries.map(entry => entry.id)).toEqual([
      'deepseek-official/deepseek-chat',
      'codebuddy/glm-5.3-flash',
      'codebuddy/hy3',
    ])
    expect(snapshot.providers).toEqual(['deepseek-official', 'codebuddy'])
  })

  it('单个提供方列举失败不拖垮整张目录（AC-03 的健壮性）', async () => {
    const llm = {
      listProviders: () => [{ id: 'broken', name: 'Broken' }, { id: 'ok', name: 'OK' }],
      listModels: async (provider: string) => {
        if (provider === 'broken') throw new Error('endpoint unreachable')
        return [{ provider: 'ok', id: 'm', name: 'M' }]
      },
    } as unknown as LlmRuntime
    const snapshot = await buildCatalog(llm)
    // 失败提供方记为零模型，其余提供方照常可用。
    expect(snapshot.entries.map(entry => entry.id)).toEqual(['ok/m'])
    expect(snapshot.providers).toEqual(['broken', 'ok'])
  })

  it('宿主无提供方时返回空目录而不是抛错', async () => {
    const snapshot = await buildCatalog(fakeLlm([], {}))
    expect(snapshot.entries).toEqual([])
    expect(snapshot.providers).toEqual([])
  })

  it('快照带取数时刻（供列表 created 字段使用）', async () => {
    const before = Date.now()
    const snapshot = await buildCatalog(fakeLlm([], {}))
    expect(snapshot.fetchedAt).toBeGreaterThanOrEqual(before)
  })
})
