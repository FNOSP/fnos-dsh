import { describe, expect, it } from 'vitest'
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
    ) as { fixedModelName: string, baseUrl: string, envFile: string, family: string }
    expect(snapshot.fixedModelName).toBe('dsh-model')
    expect(snapshot.baseUrl).toBe('http://127.0.0.1:8787/v1')
    expect(snapshot.envFile).toContain('MIDSCENE_MODEL_NAME="dsh-model"')
    // 家族候选必须是 Midscene 白名单，否则用户会在运行时才踩 Invalid MIDSCENE_MODEL_FAMILY。
    // 家族是自动推导的，不再是用户可选项；未选模型时回落到配置里的当前值。
    expect(snapshot.family).toBe('glm-v')
    // 家族不再是「可选值列表」：它是自动推导的内部结果，界面不呈现。
    expect(snapshot).not.toHaveProperty('families')
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

describe('协议家族由实际使用的模型推导（不是用户配置项）', () => {
  it('用 GLM 模型时家族是 glm-v，用 DeepSeek 模型时自动变成 deepseek', async () => {
    // 这是「用户不需要理解家族」的实现点：家族随模型自动跟随，因此不可能出现
    // 「家族与模型不匹配」的静默错位组合。
    const models = [
      { id: 'codebuddy/glm-5.3', name: 'GLM-5.3', vision: true },
      { id: 'codebuddy/deepseek-v4.1-flash', name: 'DeepSeek', vision: true },
    ]
    const forModel = async (id: string): Promise<string> => {
      const snapshot = await statusSnapshotForTest({
        readConfig: () => ({ ...config, models: [id] }),
        listModels: () => Promise.resolve(models),
        resolveModel: () => Promise.resolve(id),
      }) as { family: string, envFile: string }
      // .env 里的家族必须与实际模型一致——Midscene 就是按它解析坐标的。
      expect(snapshot.envFile).toContain(`MIDSCENE_MODEL_FAMILY="${snapshot.family}"`)
      return snapshot.family
    }
    expect(await forModel('codebuddy/glm-5.3')).toBe('glm-v')
    expect(await forModel('codebuddy/deepseek-v4.1-flash')).toBe('deepseek')
  })

  it('Midscene 名单外的识图模型回落到通用家族（用户选它也能正常使用）', async () => {
    // 需求要点：模型不在 Midscene 适配器名单里、但具备识图能力时，也必须能跑。
    // 做法是回落通用家族（bbox/xy/1000，10 个家族共用的主导协议；实测 hy3 在其下
    // 定位 3/3 命中）。
    const snapshot = await statusSnapshotForTest({
      readConfig: () => ({ ...config, models: ['codebuddy/hy3'] }),
      listModels: () => Promise.resolve([{ id: 'codebuddy/hy3', name: 'Hy3', vision: true }]),
      resolveModel: () => Promise.resolve('codebuddy/hy3'),
    }) as { family: string, familyReason: string }
    expect(snapshot.family).toBe('glm-v')
    expect(snapshot.familyReason).toContain('通用协议')
  })

  it('快照只列出具备识图能力的模型（界面不呈现无视觉模型）', async () => {
    const snapshot = await statusSnapshotForTest({
      readConfig: () => ({ ...config, models: [] }),
      listModels: () => Promise.resolve([
        { id: 'codebuddy/glm-5.3', name: 'GLM-5.3', vision: true },
        { id: 'deepseek-official/deepseek-v4-pro', name: 'V4 Pro', vision: false },
      ]),
    }) as { availableModels: readonly { id: string }[] }
    expect(snapshot.availableModels.map(m => m.id)).toEqual(['codebuddy/glm-5.3'])
  })
})

describe('写入校验', () => {
  it('忽略请求里的 family（家族自动推导，不是用户字段）', () => {
    // 旧版界面或脚本可能仍会发送 family；桥按真实模型推导，因此这里静默忽略而不是报错。
    expect(normalizePatchForTest({ family: 'gpt-6' })).toEqual({})
    expect(normalizePatchForTest({ family: 'dsh-model', models: ['a/b'] })).toEqual({ models: ['a/b'] })
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
