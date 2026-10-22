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
  model: '',
  locateModel: '',
  planningModel: '',
  insightModel: '',
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
        readConfig: () => ({ ...config, model: 'id' }),
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
      readConfig: () => ({ ...config, model: 'codebuddy/hy3' }),
      listModels: () => Promise.resolve([{ id: 'codebuddy/hy3', name: 'Hy3', vision: true }]),
      resolveModel: () => Promise.resolve('codebuddy/hy3'),
    }) as { family: string, familyReason: string }
    expect(snapshot.family).toBe('glm-v')
    expect(snapshot.familyReason).toContain('通用协议')
  })

  it('快照只列出具备识图能力的模型（界面不呈现无视觉模型）', async () => {
    const snapshot = await statusSnapshotForTest({
      readConfig: () => ({ ...config, model: '' }),
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
    expect(normalizePatchForTest({ family: 'dsh-model', model: 'a/b' })).toEqual({ model: 'a/b' })
  })

  it('接受单个模型，空串表示跟随 DSH 会话模型', () => {
    expect(normalizePatchForTest({ model: 'codebuddy/glm-5.3' })).toEqual({ model: 'codebuddy/glm-5.3' })
    // 首尾空白去掉（手填或脚本可能带空格）。
    expect(normalizePatchForTest({ model: '  codebuddy/glm-5.3  ' })).toEqual({ model: 'codebuddy/glm-5.3' })
    // 空串是合法值：清空选择 = 跟随会话模型。
    expect(normalizePatchForTest({ model: '' })).toEqual({ model: '' })
    // 非字符串被忽略（调用方据此回 400）。
    expect(normalizePatchForTest({ model: 1 })).toEqual({})
    // 数组形态（旧版界面的多选）不再是受支持字段：忽略而不是报错，避免用户被卡住。
    expect(normalizePatchForTest({ model: ['a/b'] })).toEqual({})
  })

  it('无受支持字段时返回空补丁（调用方据此回 400）', () => {
    expect(normalizePatchForTest({ action: 'update' })).toEqual({})
    expect(normalizePatchForTest({ family: 123, models: 'nope' })).toEqual({})
  })
})

describe('各职责的模型状态（FNOS-021-02）', () => {
  /** 造一份逐职责决策结果，模拟桥的 resolveIntentModels 输出。 */
  function slotsOf(overrides: Partial<Record<'default' | 'locate' | 'planning' | 'insight', {
    modelId?: string
    family: string
    dedicated: boolean
  }>> = {}): Record<string, unknown> {
    const base = {
      intent: 'default',
      modelId: 'codebuddy/glm-5.3',
      family: 'glm-v',
      dedicated: false,
      source: 'inherited',
      skippedConfigured: [],
    }
    return {
      default: { ...base, intent: 'default', source: 'configured', ...overrides.default },
      locate: { ...base, intent: 'locate', ...overrides.locate },
      planning: { ...base, intent: 'planning', ...overrides.planning },
      insight: { ...base, intent: 'insight', ...overrides.insight },
    } as never
  }

  it('快照里四个职责都有一份状态，顺序即 Tab 顺序', async () => {
    const snapshot = await statusSnapshotForTest({
      readConfig: () => config,
      listModels: async () => [{ id: 'codebuddy/glm-5.3', vision: true }],
      resolveSlots: async () => slotsOf() as never,
    }) as { slots: { intent: string, configuredModel: string, resolvedModel?: string, family: string, dedicated: boolean }[] }

    expect(snapshot.slots.map(slot => slot.intent)).toEqual(['default', 'locate', 'planning', 'insight'])
    // 未配置专用职责：configuredModel 为空，resolvedModel 沿用默认，dedicated 为 false。
    expect(snapshot.slots[1]).toMatchObject({
      intent: 'locate',
      configuredModel: '',
      resolvedModel: 'codebuddy/glm-5.3',
      dedicated: false,
    })
  })

  it('专用职责配了模型后，快照如实反映「选了什么」与「实际用什么」', async () => {
    const snapshot = await statusSnapshotForTest({
      readConfig: () => ({ ...config, locateModel: 'codebuddy/deepseek-v4.1-flash' }),
      listModels: async () => [
        { id: 'codebuddy/glm-5.3', vision: true },
        { id: 'codebuddy/deepseek-v4.1-flash', vision: true },
      ],
      resolveSlots: async () => slotsOf({
        locate: { modelId: 'codebuddy/deepseek-v4.1-flash', family: 'deepseek', dedicated: true },
      }) as never,
    }) as {
      slots: { intent: string, configuredModel: string, resolvedModel?: string, family: string, dedicated: boolean }[]
      envFile: string
    }

    expect(snapshot.slots[1]).toMatchObject({
      intent: 'locate',
      configuredModel: 'codebuddy/deepseek-v4.1-flash',
      resolvedModel: 'codebuddy/deepseek-v4.1-flash',
      family: 'deepseek',
      dedicated: true,
    })
    // 接入配置预览同步变长：追加定位那一组，且家族用该职责自己的。
    expect(snapshot.envFile).toContain('MIDSCENE_LOCATE_MODEL_NAME="dsh-model@locate"')
    expect(snapshot.envFile).toContain('MIDSCENE_LOCATE_MODEL_FAMILY="deepseek"')
  })

  it('专用职责只在真的单独配置时才让接入配置变长（未配置不写变量组）', async () => {
    const snapshot = await statusSnapshotForTest({
      readConfig: () => config,
      listModels: async () => [{ id: 'codebuddy/glm-5.3', vision: true }],
      resolveSlots: async () => slotsOf() as never,
    }) as { envFile: string }
    expect(snapshot.envFile).not.toContain('MIDSCENE_LOCATE_MODEL')
  })

  it('没有逐职责结果时（旧调用方）只有默认职责有效，其余沿用', async () => {
    const snapshot = await statusSnapshotForTest({
      readConfig: () => ({ ...config, locateModel: 'codebuddy/gone' }),
      listModels: async () => [{ id: 'codebuddy/glm-5.3', vision: true }],
      resolveModel: async () => 'codebuddy/glm-5.3',
    }) as { slots: { intent: string, resolvedModel?: string, dedicated: boolean }[] }

    // 配了但无法确认存在：保守地不认为它是专用职责，接入配置不追加（上游会回落默认）。
    expect(snapshot.slots[1]).toMatchObject({ intent: 'locate', resolvedModel: 'codebuddy/glm-5.3', dedicated: false })
  })
})

describe('写入校验：三个专用职责字段', () => {
  it('接受三个专用职责字段并去掉首尾空白', () => {
    expect(normalizePatchForTest({
      locateModel: '  codebuddy/deepseek-v4.1-flash ',
      planningModel: 'codebuddy/glm-5.3',
      insightModel: 'codebuddy/kimi-k3-1',
    })).toEqual({
      locateModel: 'codebuddy/deepseek-v4.1-flash',
      planningModel: 'codebuddy/glm-5.3',
      insightModel: 'codebuddy/kimi-k3-1',
    })
  })

  it('空串表示「沿用默认职责」（合法值）', () => {
    expect(normalizePatchForTest({ locateModel: '' })).toEqual({ locateModel: '' })
  })

  it('非字符串被忽略（调用方据此回 400）', () => {
    expect(normalizePatchForTest({ locateModel: 1, planningModel: null })).toEqual({})
  })
})
