import { describe, expect, it } from 'vitest'
import type {
  OpenCodeAccountEntitlement,
  OpenCodeCatalog,
  OpenCodeModel,
} from '../../src/contracts/catalog.ts'
import { OPENCODE_ROUTES } from '../../src/contracts/routes.ts'
import { baseURLFor } from '../../src/host/catalog.ts'
import { effectiveEndpointPlan } from '../../src/index.ts'
import { registerOpenCodeRoutes, type OpenCodeRoutesOptions } from '../../src/host/routes.ts'

/**
 * 目录路由与套餐口径。
 *
 * 这里驱动真实 handler（而不是断言源码字符串），钉住三件事：
 *
 * 1. `/catalog` 与 `/catalog/refresh` 的 `entitlement` 字段结构；
 * 2. 详情页目录与模型选择器同口径：Go 账号只出 `go` 条目、按量账号只出 `zen`
 *    条目、`unknown` 按 Go 口径过滤；
 * 3. `auto` 端点策略的真值表——套餐读不出来时按 Go 端点走。
 */

interface CapturedRoute {
  kind: string
  path: string
  handler: (req: FakeRequest, res: FakeResponse) => void | Promise<void>
}

interface FakeRequest {
  method: string
  headers: Record<string, string>
  socket: { remoteAddress: string }
}

interface FakeResponse {
  statusCode?: number
  body?: unknown
  writeHead: (status: number, headers?: Record<string, string>) => void
  end: (value?: unknown) => void
}

function fakeRequest(method: string): FakeRequest {
  // 没有 Origin 头 + 回环地址：走本机同源分支，不需要伪造网关头部。
  return { method, headers: {}, socket: { remoteAddress: '127.0.0.1' } }
}

function fakeResponse(): FakeResponse {
  const res: FakeResponse = {
    writeHead(status) { res.statusCode = status },
    end(value) { res.body = value },
  }
  return res
}

function model(id: string, plan: 'zen' | 'go', extra: Partial<OpenCodeModel> = {}): OpenCodeModel {
  return {
    id,
    name: id,
    api: 'openai-completions',
    baseURL: baseURLFor(plan, 'openai-completions'),
    reasoning: false,
    input: ['text'],
    contextWindow: 1_000,
    maxTokens: 100,
    cost: { input: 1, output: 1 },
    tools: true,
    free: false,
    plan,
    ...extra,
  }
}

/**
 * 目录夹具：两侧各有一个独有条目，另有一个同名共享条目。
 *
 * Go 侧三条带额度：`go-unlimited` 是 `null`（不限量）、`go-big` / `go-small`
 * 是数值、`go-missing` 不在表里。
 */
const MODELS: readonly OpenCodeModel[] = [
  model('go-big', 'go', { estimatedRequestsPerMonth: 500 }),
  model('go-small', 'go', { estimatedRequestsPerMonth: 100 }),
  model('go-unlimited', 'go', { estimatedRequestsPerMonth: null }),
  model('go-missing', 'go'),
  model('zen-only', 'zen'),
  model('shared', 'zen'),
  model('shared', 'go', { estimatedRequestsPerMonth: 42 }),
]

function catalogSnapshot(): OpenCodeCatalog {
  return { fetchedAt: 1, source: 'public', models: MODELS, warnings: [] }
}

function entitlement(
  plan: OpenCodeAccountEntitlement['plan'],
  extra: Partial<OpenCodeAccountEntitlement> = {},
): OpenCodeAccountEntitlement {
  return {
    plan,
    source: plan === 'unknown' ? 'none' : 'console',
    fetchedAt: 1_700_000_000_000,
    ...extra,
  }
}

/** 只记录注册的路由，别的宿主能力都不需要。 */
function harness(options: Partial<OpenCodeRoutesOptions> & {
  entitlement?: () => Promise<OpenCodeAccountEntitlement>
  endpointPlan?: () => Promise<'go' | 'zen' | 'auto'>
  snapshot?: OpenCodeCatalog | undefined
}): Map<string, CapturedRoute> {
  const captured = new Map<string, CapturedRoute>()
  const ctx = {
    effect: (factory: () => unknown) => { factory() },
    webServer: {
      register: (route: CapturedRoute) => {
        captured.set(route.path, route)
        return () => undefined
      },
    },
  }
  const snapshot = 'snapshot' in options ? options.snapshot : catalogSnapshot()
  const fakeCatalog = {
    current: () => snapshot,
    refresh: async () => snapshot ?? catalogSnapshot(),
    refreshIfStale: async () => snapshot,
    consoleDiagnostic: () => undefined,
    error: () => undefined,
    requestHeaders: () => undefined,
  }
  registerOpenCodeRoutes(ctx as never, {
    auth: { status: async () => ({ status: 'signed-in' }), dispose: async () => undefined } as never,
    usage: { invalidate: () => undefined, read: async () => undefined } as never,
    catalog: fakeCatalog as never,
    preferences: { read: async () => ({ endpointPlan: 'auto' }) } as never,
    refresh: async () => undefined,
    preferencesChanged: async () => undefined,
    routes: () => [],
    ...options,
  })
  return captured
}

interface CatalogPayload {
  catalog: OpenCodeCatalog | null
  error?: string
  entitlement?: {
    plan: string
    source: string
    fetchedAt: number
    error?: string
    endpointPlan: string
    scoped: boolean
    filteredModelCount?: number
    estimates?: { fetchedAt: string, sourceUrl: string }
  }
}

async function invoke(routes: Map<string, CapturedRoute>, path: string, method = 'GET'): Promise<CatalogPayload> {
  const route = routes.get(path)
  if (route === undefined) throw new Error(`路由未注册：${path}`)
  const res = fakeResponse()
  await route.handler(fakeRequest(method), res)
  expect(res.statusCode).toBe(200)
  // handler 用 JSON.stringify 收尾；解回来才能断言结构。
  return JSON.parse(String(res.body)) as CatalogPayload
}

describe('目录路由的套餐口径', () => {
  it('Go 账号：只出 go 条目，响应带套餐字段与估算表来源', async () => {
    const routes = harness({ entitlement: async () => entitlement('go') })
    const payload = await invoke(routes, OPENCODE_ROUTES.catalog)

    expect(payload.entitlement).toMatchObject({
      plan: 'go',
      source: 'console',
      endpointPlan: 'auto',
      filteredModelCount: 2,
    })
    expect(payload.entitlement?.estimates?.sourceUrl).toBe('https://opencode.ai/v2/docs/console/go/')
    // 夹具共 7 条，Go 侧 5 条（含跨侧同名 shared），被过滤的是 2 条 zen 独有/共享条目。
    expect(payload.entitlement?.filteredModelCount).toBe(2)
    const plans = new Set(payload.catalog?.models.map(entry => entry.plan))
    expect([...plans]).toEqual(['go'])
  })

  it('Go 账号：按该档位的预计请求数降序，不限量置顶、表外条目沉底', async () => {
    const routes = harness({ entitlement: async () => entitlement('go') })
    const payload = await invoke(routes, OPENCODE_ROUTES.catalog)
    expect(payload.catalog?.models.map(entry => entry.id)).toEqual([
      'go-unlimited',
      'go-big',
      'go-small',
      'shared',
      'go-missing',
    ])
  })

  it('按量账号：只出 zen 条目，按老口径排序且不带估算表', async () => {
    const routes = harness({ entitlement: async () => entitlement('payg', { source: 'usage' }) })
    const payload = await invoke(routes, OPENCODE_ROUTES.catalog)

    expect(payload.entitlement).toMatchObject({ plan: 'payg', source: 'usage', endpointPlan: 'auto' })
    expect(payload.entitlement?.estimates).toBeUndefined()
    // 按量侧只留 2 条 zen（shared 与 zen-only），另 5 条 go 条目被隐藏。
    expect(payload.entitlement?.filteredModelCount).toBe(5)
    expect(payload.catalog?.models.map(entry => `${entry.plan}:${entry.id}`)).toEqual([
      'zen:shared',
      'zen:zen-only',
    ])
  })

  it('套餐未知：按 Go 口径整侧过滤，zen 条目全部消失', async () => {
    const routes = harness({ entitlement: async () => entitlement('unknown') })
    const payload = await invoke(routes, OPENCODE_ROUTES.catalog)

    expect(payload.entitlement).toMatchObject({ plan: 'unknown', source: 'none' })
    // 未知按 Go 处理：估算表与 Go 档一致，条数为被去掉的 zen 侧条目数。
    expect(payload.entitlement?.estimates?.fetchedAt).toBe('2026-11-05')
    expect(payload.entitlement?.filteredModelCount).toBe(2)
    const keys = payload.catalog?.models.map(entry => `${entry.plan}:${entry.id}`)
    expect(keys).not.toContain('zen:zen-only')
    expect(keys).not.toContain('zen:shared')
    expect(keys).toContain('go:go-missing')
    expect(keys).toContain('go:shared')
    // 与 Go 账号同一顺序：不限量置顶 → 额度降序 → 表外沉底。
    expect(payload.catalog?.models.map(entry => entry.id)).toEqual([
      'go-unlimited', 'go-big', 'go-small', 'shared', 'go-missing',
    ])
  })

  it('没有注入套餐服务时按未知处理，目录仍然可用', async () => {
    const routes = harness({})
    const payload = await invoke(routes, OPENCODE_ROUTES.catalog)
    expect(payload.entitlement).toMatchObject({ plan: 'unknown', endpointPlan: 'auto' })
    // 没有注入套餐服务时仍按 Go 口径过滤：目录只出 go 条目。
    expect(payload.catalog?.models.length).toBeGreaterThan(0)
    expect(payload.catalog?.models.every(entry => entry.plan === 'go')).toBe(true)
  })

  it('套餐读取失败时把可读错误透出，仍不过滤', async () => {
    const routes = harness({
      entitlement: async () => entitlement('unknown', { error: 'Console 套餐接口不可用（HTTP 500）' }),
    })
    const payload = await invoke(routes, OPENCODE_ROUTES.catalog)
    expect(payload.entitlement?.error).toBe('Console 套餐接口不可用（HTTP 500）')
    expect(payload.entitlement?.plan).toBe('unknown')
    expect(payload.catalog?.models.every(entry => entry.plan === 'go')).toBe(true)
  })

  it('Go Plus 也走整侧过滤，估算表来源与 Go 档一致', async () => {
    const routes = harness({ entitlement: async () => entitlement('go-plus') })
    const payload = await invoke(routes, OPENCODE_ROUTES.catalog)
    expect(payload.entitlement?.plan).toBe('go-plus')
    expect(payload.entitlement?.estimates?.fetchedAt).toBe('2026-11-05')
    expect(new Set(payload.catalog?.models.map(entry => entry.plan))).toEqual(new Set(['go']))
  })

  it('未知套餐 + 手选 go 端点：目录只剩 go 条目，端点原样下发', async () => {
    const routes = harness({
      entitlement: async () => entitlement('unknown'),
      endpointPlan: async () => 'go',
    })
    const payload = await invoke(routes, OPENCODE_ROUTES.catalog)
    expect(payload.entitlement?.endpointPlan).toBe('go')
    // 整侧过滤后没有 zen 条目；go 条目本来就走 go 端点，改写是幂等的。
    expect(payload.catalog?.models.every(entry => entry.plan === 'go')).toBe(true)
    for (const entry of payload.catalog?.models ?? []) {
      expect(entry.baseURL, entry.id).toBe(baseURLFor('go', entry.api))
    }
  })

  it('按量账号手选 go 端点也不会把模型打到空端点上', async () => {
    const routes = harness({
      entitlement: async () => entitlement('payg'),
      endpointPlan: async () => 'go',
    })
    const payload = await invoke(routes, OPENCODE_ROUTES.catalog)
    expect(payload.entitlement?.endpointPlan).toBe('go')
    for (const entry of payload.catalog?.models ?? []) {
      expect(entry.baseURL, entry.id).toBe(baseURLFor(entry.plan, entry.api))
    }
  })

  it('快照缺失时 catalog 为 null，套餐字段照常下发', async () => {
    const routes = harness({ entitlement: async () => entitlement('go'), snapshot: undefined })
    const payload = await invoke(routes, OPENCODE_ROUTES.catalog)
    expect(payload.catalog).toBeNull()
    expect(payload.entitlement?.plan).toBe('go')
  })

  it('/catalog/refresh 与 /catalog 下发同一套字段', async () => {
    const routes = harness({ entitlement: async () => entitlement('go-teams') })
    const refreshed = await invoke(routes, OPENCODE_ROUTES.catalogRefresh, 'POST')
    const plain = await invoke(routes, OPENCODE_ROUTES.catalog)
    expect(refreshed.entitlement).toEqual(plain.entitlement)
    expect(refreshed.catalog?.models.map(entry => entry.id)).toEqual(plain.catalog?.models.map(entry => entry.id))
  })

  it('套餐注入抛错时降级为未知，响应不缺 entitlement 字段', async () => {
    const routes = harness({
      entitlement: async () => { throw new Error('boom') },
    })
    const payload = await invoke(routes, OPENCODE_ROUTES.catalog)
    expect(payload.entitlement).toMatchObject({ plan: 'unknown', endpointPlan: 'auto' })
    expect(payload.catalog?.models.length).toBeGreaterThan(0)
  })

  it('端点策略注入抛错时退回 auto，不改写端点', async () => {
    const routes = harness({
      entitlement: async () => entitlement('go'),
      endpointPlan: async () => { throw new Error('boom') },
    })
    const payload = await invoke(routes, OPENCODE_ROUTES.catalog)
    expect(payload.entitlement?.endpointPlan).toBe('auto')
    for (const entry of payload.catalog?.models ?? []) {
      expect(entry.baseURL, entry.id).toBe(baseURLFor(entry.plan, entry.api))
    }
  })

  it('刷新抛错时仍返回当前目录与套餐，错误写进 error 字段', async () => {
    const routes = harness({
      entitlement: async () => entitlement('go'),
      refresh: async () => { throw new Error('上游不可用') },
    })
    const payload = await invoke(routes, OPENCODE_ROUTES.catalogRefresh, 'POST')
    expect(payload.error).toBe('上游不可用')
    expect(payload.entitlement?.plan).toBe('go')
    expect(payload.catalog?.models.length).toBeGreaterThan(0)
  })
})

describe('auto 端点策略真值表', () => {
  it('手选 zen / go 原样生效，与套餐无关', () => {
    for (const plan of ['payg', 'go', 'go-plus', 'go-teams', 'unknown'] as const) {
      expect(effectiveEndpointPlan('zen', plan), plan).toBe('zen')
      expect(effectiveEndpointPlan('go', plan), plan).toBe('go')
    }
  })

  it('auto 跟随套餐：Go 三档走 go 端点，按量走 zen 端点', () => {
    expect(effectiveEndpointPlan('auto', 'go')).toBe('go')
    expect(effectiveEndpointPlan('auto', 'go-plus')).toBe('go')
    expect(effectiveEndpointPlan('auto', 'go-teams')).toBe('go')
    expect(effectiveEndpointPlan('auto', 'payg')).toBe('zen')
  })

  it('auto + 未知套餐按 Go 端点，与目录口径一致', () => {
    expect(effectiveEndpointPlan('auto', 'unknown')).toBe('go')
  })
})
