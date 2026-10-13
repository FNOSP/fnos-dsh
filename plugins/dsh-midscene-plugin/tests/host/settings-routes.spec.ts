import { describe, expect, it } from 'vitest'
import { filterModelsByFamily } from '../../src/contracts/model-family.ts'
import { normalizePatchForTest, statusSnapshotForTest } from './helpers/settings-routes-harness.ts'

/**
 * 接入设置端点的字段校验（FNOS-013-05/14 的设置页）。
 *
 * 只测纯函数部分（快照组装与写入校验）：端点的 HTTP 层依赖 `ctx.webServer`，
 * 由 DSH 宿主提供，包级测试里用纯函数覆盖业务规则更有价值——那里才是真正会
 * 出错的地方（白名单、列表归一化、目录读取失败时的退化）。
 */

const config = {
  port: 8787,
  apiKey: 'k'.repeat(32),
  family: 'glm-v',
  models: [] as readonly string[],
  requestTimeoutMs: 1000,
  logRequests: false,
}

describe('设置快照', () => {
  it('包含固定模型名、基址与 .env 文本（界面据此渲染，无需二次拼装）', async () => {
    const snapshot = await statusSnapshotForTest(
      { readConfig: () => config, listModels: async () => [] },
    ) as { fixedModelName: string, baseUrl: string, envFile: string, families: string[] }
    expect(snapshot.fixedModelName).toBe('dsh-model')
    expect(snapshot.baseUrl).toBe('http://127.0.0.1:8787/v1')
    expect(snapshot.envFile).toContain('MIDSCENE_MODEL_NAME="dsh-model"')
    // 家族候选必须是 Midscene 白名单，否则用户会在运行时才踩 Invalid MIDSCENE_MODEL_FAMILY。
    expect(snapshot.families).toContain('glm-v')
    expect(snapshot.families).not.toContain('dsh-model')
  })

  it('目录读取失败时快照仍生成（设置页要能打开）', async () => {
    const snapshot = await statusSnapshotForTest({
      readConfig: () => config,
      listModels: async () => { throw new Error('boom') },
    }) as { availableModels: unknown[] }
    expect(snapshot.availableModels).toEqual([])
  })

  it('密钥为空时快照给出一个可用密钥（首装自举）', async () => {
    const snapshot = await statusSnapshotForTest({
      readConfig: () => ({ ...config, apiKey: '' }),
      listModels: async () => [],
    }) as { apiKey: string, envFile: string }
    expect(snapshot.apiKey).toMatch(/^[0-9a-f]{32}$/u)
    expect(snapshot.envFile).toContain(snapshot.apiKey)
  })
})

describe('快照里的家族信息（界面据此过滤，必须与过滤器一致）', () => {
  it('每个模型带出的 family 与 filterModelsByFamily 的判定一致', async () => {
    // 界面按 `model.family`（宿主算好的）过滤，而宿主另有 filterModelsByFamily 这个纯函数；
    // 两者若漂移，会出现「界面列出的模型不属于当前家族」这种静默错配。这里锁住不变量。
    const models = [
      { id: 'codebuddy/glm-5.3', name: 'GLM-5.3', vision: true },
      { id: 'codebuddy/deepseek-v4.1-flash', name: 'DeepSeek', vision: true },
      { id: 'codebuddy/hy3', name: 'Hy3', vision: true },
    ]
    const snapshot = await statusSnapshotForTest({
      readConfig: () => ({ ...config, family: 'glm-v', models: [] }),
      listModels: () => Promise.resolve(models),
    })
    const annotated = snapshot.availableModels as readonly { id: string, family?: string }[]
    // 带 family 的条目必须恰好是过滤器认可的那些。
    const annotatedIds = annotated.filter(m => m.family !== undefined).map(m => m.id).sort()
    const filteredIds = [...filterModelsByFamily(models, 'glm-v'), ...filterModelsByFamily(models, 'deepseek')]
      .map(m => m.id).sort()
    expect(annotatedIds).toEqual(filteredIds)
    // 无法判断家族的模型（hy3）不带 family 字段——界面据此要求手选而不是猜。
    expect(annotated.find(m => m.id === 'codebuddy/hy3')?.family).toBeUndefined()
    expect(annotated.find(m => m.id === 'codebuddy/glm-5.3')?.family).toBe('glm-v')
  })
})

describe('写入校验', () => {
  it('拒绝不在白名单内的家族（在配置面就拦住，不等运行时）', () => {
    expect(() => normalizePatchForTest({ family: 'dsh-model' }))
      .toThrow(/unknown family/u)
    // 只给家族时会连带把模型清空：家族与模型是一致性约束的两端，留下「新家族 + 旧家族的
    // 模型」是静默错位的组合（实测过这种配置）。带模型时按新家族过滤（见下一条）。
    expect(normalizePatchForTest({ family: 'gpt-6' })).toEqual({ family: 'gpt-6', models: [] })
    expect(normalizePatchForTest({ family: 'gpt-6', models: [] })).toEqual({ family: 'gpt-6', models: [] })
  })

  it('接受空家族（「未选择」是真实状态：界面据此隐藏模型字段）', () => {
    expect(normalizePatchForTest({ family: '', models: [] })).toEqual({ family: '', models: [] })
  })

  it('换家族时剔除不属于新家族的模型，保留目录里查不到的（那可能只是暂时不可用）', () => {
    expect(normalizePatchForTest({
      family: 'deepseek',
      models: ['codebuddy/glm-5.3', 'codebuddy/deepseek-v4.1-flash', 'uninstalled/provider-model'],
    })).toEqual({
      family: 'deepseek',
      // glm-5.3 属于 glm-v，被剔除；无法判断家族的条目保留（交由界面提示为「已失效」）。
      models: ['codebuddy/deepseek-v4.1-flash', 'uninstalled/provider-model'],
    })
  })

  it('只给模型时不按家族过滤（调用方负责与当前家族一致）', () => {
    expect(normalizePatchForTest({ models: ['codebuddy/glm-5.3'] }))
      .toEqual({ models: ['codebuddy/glm-5.3'] })
  })

  it('模型列表去空白项并拒绝非字符串', () => {
    expect(normalizePatchForTest({ models: ['a/b', '  ', ' c/d '] })).toEqual({ models: ['a/b', 'c/d'] })
    expect(() => normalizePatchForTest({ models: [1] })).toThrow(/provider\/model/u)
  })

  it('无受支持字段时返回空补丁（调用方据此回 400）', () => {
    expect(normalizePatchForTest({ action: 'update' })).toEqual({})
    expect(normalizePatchForTest({ family: 123, models: 'nope' })).toEqual({})
  })
})
