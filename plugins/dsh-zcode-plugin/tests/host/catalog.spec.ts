import { describe, expect, it, vi } from 'vitest'
import {
  isUnauthorized,
  modelIdsFromBalances,
  thinkingLevelMapOf,
  toBalanceEntries,
  toModel,
  ZCODE_BUILTIN_MODEL_IDS,
  ZCODE_FALLBACK_CONTEXT_WINDOW,
  ZCODE_FALLBACK_MAX_TOKENS,
  ZCodeCatalogService,
} from '../../src/host/catalog.ts'
import { normalizeModelId, modelIdOfCapability } from '../../src/contracts/catalog.ts'
import type { ZCodeBalanceEntry } from '../../src/contracts/catalog.ts'
import { ZCodeConsoleError, type ZCodeConsoleClient } from '../../src/host/console-client.ts'

function balance(capability: string | undefined, showName = 'GLM-5.3'): ZCodeBalanceEntry {
  return {
    entitlementId: capability ?? showName,
    showName,
    ...(capability === undefined ? {} : { capability }),
    totalUnits: 100,
    usedUnits: 10,
    remainingUnits: 90,
  }
}

function serviceWith(client: Partial<ZCodeConsoleClient>, options: {
  token?: string | undefined
  family?: 'bigmodel' | 'zai' | undefined
} = {}): ZCodeCatalogService {
  const token = 'token' in options ? options.token : 'jwt'
  const family = 'family' in options ? options.family : 'bigmodel'
  return new ZCodeCatalogService({
    client: client as ZCodeConsoleClient,
    resolveToken: async () => token,
    resolveFamily: async () => family,
    now: () => 1_000,
  })
}

describe('capability 与模型 id 归一', () => {
  it('剥掉 model: 前缀并保留原始形态', () => {
    expect(modelIdOfCapability('model:glm-5.3')).toBe('glm-5.3')
    expect(modelIdOfCapability('MODEL:GLM-5.3')).toBe('GLM-5.3')
    expect(modelIdOfCapability('model:')).toBeUndefined()
    expect(modelIdOfCapability('tokens:glm-5.3')).toBeUndefined()
  })

  it('把额度接口的小写 id 还原成官方大小写', () => {
    expect(normalizeModelId('glm-5.3')).toBe('GLM-5.3')
    expect(normalizeModelId('glm-5.3-flash')).toBe('GLM-5.3-Flash')
    expect(normalizeModelId('GLM-5.2')).toBe('GLM-5.2')
    // 未在表里的保持原样，不猜。
    expect(normalizeModelId('some-new-model')).toBe('some-new-model')
    expect(normalizeModelId('   ')).toBe('')
  })

  it('从额度条目推导模型 id，保序去重并跳过非模型额度', () => {
    const ids = modelIdsFromBalances([
      balance('model:glm-5.3'),
      balance('model:glm-5.3-flash'),
      balance('model:glm-5.3'),
      balance(undefined, '账号总额度'),
    ])
    expect(ids).toEqual(['GLM-5.3', 'GLM-5.3-Flash'])
  })

  it('额度条目保留周期与重置时间', () => {
    const entries = toBalanceEntries([
      {
        showName: 'GLM-5.3',
        capability: 'model:glm-5.3',
        totalUnits: 3_000_000,
        usedUnits: 1_500_000,
        remainingUnits: 1_500_000,
        period: 'daily',
        periodEnd: '2026-10-25T00:00:00+08:00',
      },
    ])
    expect(entries[0]).toMatchObject({
      entitlementId: 'model:glm-5.3',
      period: 'daily',
      periodEnd: '2026-10-25T00:00:00+08:00',
    })
  })
})

describe('思考等级映射', () => {
  it('上游只给 low/high/max 时中间等级向上取整而不是透传', () => {
    const { map, reasoning } = thinkingLevelMapOf(['low', 'high', 'max'])
    expect(reasoning).toBe(true)
    expect(map.off).toBeNull()
    expect(map.minimal).toBe('low')
    expect(map.low).toBe('low')
    expect(map.medium).toBe('high')
    expect(map.high).toBe('high')
    expect(map.xhigh).toBe('max')
    expect(map.max).toBe('max')
  })

  it('没有思考等级时不支持思考', () => {
    expect(thinkingLevelMapOf(undefined)).toEqual({ map: {}, reasoning: false })
    expect(thinkingLevelMapOf([])).toEqual({ map: {}, reasoning: false })
  })

  it('给了未知等级时不臆造支持', () => {
    expect(thinkingLevelMapOf(['turbo'])).toEqual({ map: { off: null }, reasoning: false })
  })
})

describe('模型投影', () => {
  it('缺少能力描述时使用保守默认值', () => {
    const model = toModel({ id: 'GLM-5.3', family: 'bigmodel' })
    expect(model.contextWindow).toBe(ZCODE_FALLBACK_CONTEXT_WINDOW)
    expect(model.maxTokens).toBe(ZCODE_FALLBACK_MAX_TOKENS)
    expect(model.input).toEqual(['text'])
    expect(model.api).toBe('anthropic-messages')
    expect(model.tools).toBe(true)
  })

  it('有图片能力时声明 image 输入', () => {
    const model = toModel({
      id: 'GLM-5.3-Flash',
      family: 'zai',
      clientModel: {
        modelId: 'GLM-5.3-Flash',
        name: 'GLM-5.3-Flash',
        contextWindow: 1_000_000,
        maxCompletionTokens: 128_000,
        supportsImage: true,
      },
    })
    expect(model.input).toEqual(['text', 'image'])
    expect(model.contextWindow).toBe(1_000_000)
    expect(model.accountFamily).toBe('zai')
  })
})

describe('目录服务', () => {
  it('已登录时以额度接口为准，source 标记为 balance', async () => {
    const service = serviceWith({
      balance: async () => ({
        plans: [{ planId: 'zcode-v3-start-plan-0817', name: 'Start Plan' }],
        balances: [
          {
            showName: 'GLM-5.3',
            capability: 'model:glm-5.3',
            totalUnits: 3_000_000,
            usedUnits: 0,
            remainingUnits: 3_000_000,
          },
          {
            showName: 'GLM-5.3-Flash',
            capability: 'model:glm-5.3-flash',
            totalUnits: 5_000_000,
            usedUnits: 0,
            remainingUnits: 5_000_000,
          },
        ],
      }),
      clientConfigs: async () => ({ models: [] }),
    })
    const catalog = await service.refresh()
    expect(catalog.source).toBe('balance')
    expect(catalog.models.map(model => model.id)).toEqual(['GLM-5.3', 'GLM-5.3-Flash'])
    expect(catalog.plans).toHaveLength(1)
    expect(catalog.balances).toHaveLength(2)
  })

  it('额度接口失败时回落到内置清单并说明原因', async () => {
    const service = serviceWith({
      balance: async () => { throw new Error('network down') },
      clientConfigs: async () => ({ models: [] }),
    })
    const catalog = await service.refresh()
    expect(catalog.source).toBe('builtin')
    expect(catalog.models.map(model => model.id)).toEqual([...ZCODE_BUILTIN_MODEL_IDS])
    expect(catalog.warnings.join(' ')).toMatch(/额度接口不可读/u)
  })

  it('权益里没有模型时也回落内置清单', async () => {
    const service = serviceWith({
      balance: async () => ({ plans: [], balances: [] }),
      clientConfigs: async () => ({ models: [] }),
    })
    const catalog = await service.refresh()
    expect(catalog.source).toBe('builtin')
    expect(catalog.models.map(model => model.id)).toEqual([...ZCODE_BUILTIN_MODEL_IDS])
    expect(catalog.warnings.join(' ')).toMatch(/额度/u)
  })

  it('未登录时给出内置清单并提示登录', async () => {
    const service = serviceWith({}, { token: undefined, family: undefined })
    const catalog = await service.refresh()
    expect(catalog.source).toBe('builtin')
    expect(catalog.warnings.join(' ')).toMatch(/尚未登录/u)
  })

  it('并发刷新合并成一次上游请求', async () => {
    const balance = vi.fn(async () => ({
      plans: [],
      balances: [{
        showName: 'GLM-5.3',
        capability: 'model:glm-5.3',
        totalUnits: 1,
        usedUnits: 0,
        remainingUnits: 1,
      }],
    }))
    const service = serviceWith({ balance, clientConfigs: async () => ({ models: [] }) })
    const [first, second] = await Promise.all([service.refresh(), service.refresh()])
    expect(balance).toHaveBeenCalledTimes(1)
    expect(first).toBe(second)
  })

  it('客户端配置不可读时不影响目录，只补一条说明', async () => {
    const service = serviceWith({
      balance: async () => ({
        plans: [],
        balances: [{
          showName: 'GLM-5.3',
          capability: 'model:glm-5.3',
          totalUnits: 1,
          usedUnits: 0,
          remainingUnits: 1,
        }],
      }),
      clientConfigs: async () => { throw new Error('no configs') },
    })
    const catalog = await service.refresh()
    expect(catalog.source).toBe('balance')
    expect(catalog.models[0]?.contextWindow).toBe(ZCODE_FALLBACK_CONTEXT_WINDOW)
    expect(catalog.warnings.join(' ')).toMatch(/客户端配置不可读/u)
  })

  it('凭据失效（401）时给出「重新登录」而不是笼统的不可读', async () => {
    const service = serviceWith({
      balance: async () => {
        throw new ZCodeConsoleError('Start Plan 额度 失败（HTTP 401）', undefined, 401)
      },
      clientConfigs: async () => ({ models: [] }),
    })
    const catalog = await service.refresh()
    expect(catalog.source).toBe('builtin')
    expect(catalog.warnings.join(' ')).toMatch(/凭据已失效，请重新登录/u)
    expect(catalog.warnings.join(' ')).not.toMatch(/额度接口不可读/u)
  })

  it('401 与其它失败可区分', () => {
    expect(isUnauthorized(new ZCodeConsoleError('x', undefined, 401))).toBe(true)
    expect(isUnauthorized(new ZCodeConsoleError('x', undefined, 500))).toBe(false)
    expect(isUnauthorized(new ZCodeConsoleError('x', 3012, 405))).toBe(false)
    expect(isUnauthorized(new Error('boom'))).toBe(false)
  })
})
