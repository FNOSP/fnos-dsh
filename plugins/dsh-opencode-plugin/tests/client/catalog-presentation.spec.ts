/**
 * 界面展示层的纯函数与文案完整性。
 *
 * 这里不渲染 React：组件里可测的部分都已抽成纯函数（套餐文案键、判定依据键、
 * 千分位额度文本、目录视图降级），渲染本身由类型检查与真实界面目视核对覆盖。
 */

import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import type { OpenCodeCatalogEntitlement, OpenCodeModel } from '../../src/contracts/catalog.ts'
import {
  accountPlanLabelKey,
  accountPlanSourceKey,
  estimatedRequestsText,
  formatRequestCount,
} from '../../src/client/services/catalog-data.ts'
import {
  catalogViewFromError,
  catalogViewFromResponse,
  hasCatalogSnapshot,
  INITIAL_CATALOG_VIEW,
} from '../../src/components/catalog-snapshot.ts'
import { en, zh } from '../../src/client/locales.ts'
import { de } from '../../src/client/locales.de.ts'
import { es } from '../../src/client/locales.es.ts'
import { fr } from '../../src/client/locales.fr.ts'
import { it as itLocale } from '../../src/client/locales.it.ts'
import { ja } from '../../src/client/locales.ja.ts'
import { ko } from '../../src/client/locales.ko.ts'
import { ru } from '../../src/client/locales.ru.ts'

/** 构造一个目录条目；只覆盖需要断言的字段。 */
function model(overrides: Partial<OpenCodeModel> & Pick<OpenCodeModel, 'id' | 'name'>): OpenCodeModel {
  return {
    api: 'openai-completions',
    baseURL: 'https://opencode.ai/inference/go/openai/v1',
    reasoning: false,
    input: ['text'],
    contextWindow: 128_000,
    maxTokens: 8_192,
    plan: 'go',
    tools: false,
    free: false,
    ...overrides,
  }
}

/** 九种语言的字典，键名用于报错定位。 */
const LOCALES = { de, es, fr, it: itLocale, ja, ko, ru } as const

describe('九语言文案完整性', () => {
  it('七个附加语言的键集合与 en 完全一致', () => {
    const expected = Object.keys(en).sort()
    for (const [lang, dict] of Object.entries(LOCALES)) {
      expect(Object.keys(dict).sort(), `${lang} 键集合与 en 不一致`).toEqual(expected)
    }
  })

  it('中英文键集合一致', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
  })

  it('所有语言都没有空文案', () => {
    for (const dict of [en, zh, ...Object.values(LOCALES)]) {
      for (const [key, value] of Object.entries(dict)) {
        expect(value.trim().length, `${key} 是空文案`).toBeGreaterThan(0)
      }
    }
  })

  it('新文案键在每个语言里都存在', () => {
    const keys = [
      'accountPlanLabel',
      'accountPlanGo',
      'accountPlanGoPlus',
      'accountPlanGoTeams',
      'accountPlanPayg',
      'accountPlanUnknown',
      'accountPlanSourceLabel',
      'accountPlanSourceConsole',
      'accountPlanSourceUsage',
      'accountPlanSourceNone',
      'catalogConsoleLink',
      'catalogPlanScopeNotice',
      'catalogPlanScopeUnknown',
      'catalogPlanScopeHidden',
      'catalogEstimatedRequests',
      'catalogEstimatedUnlimited',
      'catalogEstimatedSource',
      'catalogEstimatedSourceLink',
    ] as const
    for (const key of keys) {
      expect(en, `en missing ${key}`).toHaveProperty(key)
      expect(zh, `zh missing ${key}`).toHaveProperty(key)
      for (const [lang, dict] of Object.entries(LOCALES)) {
        expect(dict, `${lang} missing ${key}`).toHaveProperty(key)
      }
    }
  })

  it('带参数的键在九语言里都保留了占位符', () => {
    // 漏掉占位符的翻译会显示成「已隐藏 个模型」这类残句。
    const withParams = {
      catalogPlanScopeNotice: ['{plan}'],
      catalogPlanScopeHidden: ['{count}'],
      catalogEstimatedSource: ['{date}'],
    } as const
    for (const [key, placeholders] of Object.entries(withParams)) {
      for (const dict of [en, zh, ...Object.values(LOCALES)]) {
        for (const placeholder of placeholders) {
          expect(dict[key as keyof typeof en]).toContain(placeholder)
        }
      }
    }
  })

  it('按量口径在九语言里都指向 Console，不再以 Zen 作为用户可见名称', () => {
    // 上游 2026-11-05 更名：功能名是 Console（pay-as-you-go），zen 只留作模型键后缀。
    const paygKeys = ['accountPlanPayg', 'catalogPlanZenHint', 'settingsEndpointZen'] as const
    for (const key of paygKeys) {
      for (const [lang, dict] of Object.entries({ en, zh, ...LOCALES })) {
        expect(dict[key], `${lang}.${key} 应含 Console`).toContain('Console')
      }
    }
  })
})

describe('套餐文案映射', () => {
  it('五个档位各自映射到不同的文案键', () => {
    const keys = (['payg', 'go', 'go-plus', 'go-teams', 'unknown'] as const)
      .map(plan => accountPlanLabelKey(plan))
    expect(new Set(keys).size).toBe(5)
    for (const key of keys) {
      expect(en[key]).toBeTruthy()
      expect(zh[key]).toBeTruthy()
    }
  })

  it('三种判定依据各自映射到不同的文案键', () => {
    const keys = (['console', 'usage', 'none'] as const).map(source => accountPlanSourceKey(source))
    expect(new Set(keys).size).toBe(3)
    for (const key of keys) {
      expect(en[key]).toBeTruthy()
      expect(zh[key]).toBeTruthy()
    }
  })
})

describe('每月预计请求数展示', () => {
  it('数字用千分位，并按 lang 取分组符', () => {
    expect(formatRequestCount(226_600, 'en-US')).toBe('226,600')
    expect(formatRequestCount(1_080, 'en-US')).toBe('1,080')
    expect(formatRequestCount(845, 'en-US')).toBe('845')
    expect(formatRequestCount(0, 'en-US')).toBe('0')
    // 同一数字在不同语言里的分组符不同：不能用手写字符串拼接固化一种写法。
    expect(formatRequestCount(226_600, 'de-DE')).not.toBe(formatRequestCount(226_600, 'en-US'))
  })

  it('非法值不展示数字', () => {
    expect(formatRequestCount(Number.NaN)).toBeUndefined()
    expect(formatRequestCount(Number.POSITIVE_INFINITY)).toBeUndefined()
    expect(formatRequestCount(-1)).toBeUndefined()
  })

  it('三态：数字 / 不限量 / 不渲染', () => {
    expect(estimatedRequestsText(model({ id: 'a', name: 'A', estimatedRequestsPerMonth: 216_670 }), '不限量', 'en-US'))
      .toBe('216,670')
    expect(estimatedRequestsText(model({ id: 'b', name: 'B', estimatedRequestsPerMonth: null }), '不限量', 'en-US'))
      .toBe('不限量')
    // undefined 表示不属于 Go 侧或额度表里没有：整段不渲染，不是 0。
    expect(estimatedRequestsText(model({ id: 'c', name: 'C' }), '不限量', 'en-US')).toBeUndefined()
  })
})

describe('目录视图降级', () => {
  const entitlement: OpenCodeCatalogEntitlement = {
    plan: 'go',
    source: 'console',
    fetchedAt: 1_762_345_678_901,
    endpointPlan: 'auto',
    scoped: true,
  }

  it('有快照时进入 ready，并把本次错误留作提示', () => {
    const view = catalogViewFromResponse(
      { catalog: { fetchedAt: 1, source: 'console', models: [], warnings: [] }, error: '刷新失败', entitlement },
      '兜底',
    )
    expect(view.status).toBe('ready')
    expect(view.message).toBe('刷新失败')
    expect(hasCatalogSnapshot(view)).toBe(true)
    expect(view.response?.entitlement).toBe(entitlement)
  })

  it('catalog 为 null 时按失败展示，并优先用宿主原因', () => {
    const withError = catalogViewFromResponse({ catalog: null, error: '宿主原因' }, '兜底')
    expect(withError.status).toBe('error')
    expect(withError.message).toBe('宿主原因')
    const noError = catalogViewFromResponse({ catalog: null }, '兜底')
    expect(noError.message).toBe('兜底')
  })

  it('请求异常时保留已有快照，只更新原因', () => {
    const ready = catalogViewFromResponse(
      { catalog: { fetchedAt: 1, source: 'public', models: [], warnings: [] } },
      '兜底',
    )
    const failed = catalogViewFromError(ready, '网络错误')
    expect(failed.status).toBe('ready')
    expect(failed.message).toBe('网络错误')
    expect(failed.response).toBe(ready.response)
  })

  it('还没有快照时请求异常就是失败态', () => {
    const failed = catalogViewFromError(INITIAL_CATALOG_VIEW, '网络错误')
    expect(failed.status).toBe('error')
    expect(failed.message).toBe('网络错误')
    expect(hasCatalogSnapshot(INITIAL_CATALOG_VIEW)).toBe(false)
  })
})

describe('套餐过滤说明的显示条件', () => {
  /** 契约里 `filteredModelCount` 只在 scoped 时出现，且 0 表示「另一侧一条都没删」。 */
  const scope = (value?: number): OpenCodeCatalogEntitlement => ({
    plan: 'go',
    source: 'console',
    fetchedAt: 1,
    endpointPlan: 'auto',
    scoped: true,
    ...(value === undefined ? {} : { filteredModelCount: value }),
  })

  it('缺省与 0 都不该显示「已隐藏 N 个」', () => {
    const hiddenOf = (value?: number): number | undefined => {
      const count = scope(value).filteredModelCount
      return typeof count === 'number' && count > 0 ? count : undefined
    }
    expect(hiddenOf()).toBeUndefined()
    expect(hiddenOf(0)).toBeUndefined()
    expect(hiddenOf(2)).toBe(2)
  })

  it('未知套餐时不下发条数，界面走「暂不过滤」提示', () => {
    const unknown: OpenCodeCatalogEntitlement = {
      plan: 'unknown',
      source: 'none',
      fetchedAt: 1,
      endpointPlan: 'auto',
      scoped: false,
    }
    expect(unknown.filteredModelCount).toBeUndefined()
    expect(unknown.scoped).toBe(false)
  })
})

describe('卡片接线（源码级）', () => {
  const readSource = async (path: string): Promise<string> =>
    readFile(new URL(`../../src/${path}`, import.meta.url), 'utf8')

  it('目录只在区块里读一次，账号卡与目录卡共用同一份响应', async () => {
    const section = await readSource('components/OpenCodeSection.tsx')
    expect(section).toContain('useCatalogSnapshot(')
    // 套餐从目录响应里取，再作为 props 传给账号卡：两卡不能各读各的。
    expect(section).toContain('view.response?.entitlement')
    expect(section).toContain('<OpenCodeAccountCard')
    expect(section).toContain('entitlement={entitlement}')
    expect(section).toContain('view={view}')
    expect(section).toContain('load={load}')
  })

  it('账号卡不自己请求目录，只接收套餐 props', async () => {
    const account = await readSource('components/OpenCodeAccountCard.tsx')
    expect(account).not.toContain('readCatalog')
    expect(account).not.toContain('refreshCatalog')
    expect(account).toContain('entitlement?: OpenCodeCatalogEntitlement')
  })

  it('目录卡不再自己发请求，刷新走区块下发的 loader', async () => {
    const catalog = await readSource('components/OpenCodeCatalogCard.tsx')
    expect(catalog).not.toContain('readCatalog(')
    expect(catalog).not.toContain('refreshCatalog(')
    expect(catalog).toContain('load(true, false)')
    expect(catalog).toContain('estimatedRequestsText(')
  })

  it('额度列只在 Go 侧渲染，且 undefined 时整段不出现', async () => {
    const catalog = await readSource('components/OpenCodeCatalogCard.tsx')
    // 按量侧没有官方额度口径：不能把 undefined 渲染成 0。
    expect(catalog).toContain("model.plan === 'go'")
    expect(catalog).toContain('estimate === undefined ? null')
  })

  it('过滤说明按 scoped 与正数条数显示，不用 ?? 0', async () => {
    const catalog = await readSource('components/OpenCodeCatalogCard.tsx')
    expect(catalog).toContain("typeof hidden === 'number' && hidden > 0")
    expect(catalog).not.toContain('filteredModelCount ?? 0')
  })

  it('Console 新地址来自契约常量，不在组件里硬编码', async () => {
    const catalog = await readSource('components/OpenCodeCatalogCard.tsx')
    expect(catalog).toContain('OPENCODE_CONSOLE_ORIGIN')
    expect(catalog).not.toContain('https://opencode.ai/console/models')
  })
})
