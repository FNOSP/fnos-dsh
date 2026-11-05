import { describe, expect, it, vi } from 'vitest'
import {
  normalizeAccountPlan,
  OpenCodeEntitlementService,
} from '../../src/host/entitlement.ts'

const NOW = 1_761_200_000_000

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** 上游套餐接口的真实形态（字段已按 2026-11-05 实测裁剪）。 */
function statusPayload(product: string | undefined, renewalProduct = product): Record<string, unknown> {
  return {
    subscriberUserId: 'acc_test',
    ...(product === undefined ? {} : { product }),
    ...(renewalProduct === undefined ? {} : { renewalProduct }),
    access: {
      startsAt: '2026-10-15T08:59:50.000Z',
      endsAt: '2026-11-15T08:59:50.000Z',
      meters: {
        fiveHour: { startsAt: null, resetsAt: null, limitMicroCents: '1200000000', usedMicroCents: '0' },
        week: { startsAt: '2026-11-02T00:00:00.000Z', resetsAt: '2026-11-09T00:00:00.000Z', limitMicroCents: '3000000000', usedMicroCents: '940512601' },
        month: { resetsAt: '2026-11-15T08:59:50.000Z', limitMicroCents: '6000000000', usedMicroCents: '6000000000' },
      },
    },
  }
}

/** 按 URL 路由的假 fetch：两个接口各自独立返回。 */
function routedFetch(routes: {
  status?: () => Response | Promise<Response>
  usage?: () => Response | Promise<Response>
}): typeof fetch {
  return async (input) => {
    const url = String(input)
    if (url.includes('/console/api/go/status')) {
      if (routes.status === undefined) throw new Error('未预期的套餐接口请求')
      return routes.status()
    }
    if (url.includes('/inference/go/v1/usage')) {
      if (routes.usage === undefined) throw new Error('未预期的用量接口请求')
      return routes.usage()
    }
    throw new Error(`未预期的请求：${url}`)
  }
}

describe('套餐名归一化', () => {
  it.each([
    ['go', 'go'],
    ['Go', 'go'],
    ['GO', 'go'],
    ['go-plus', 'go-plus'],
    ['go_plus', 'go-plus'],
    ['Go_Plus', 'go-plus'],
    ['go-teams', 'go-teams'],
    ['go_teams', 'go-teams'],
    ['payg', 'payg'],
    ['pay-as-you-go', 'payg'],
    ['console', 'payg'],
    ['PAY_AS_YOU_GO', 'payg'],
  ])('归一化 %s → %s', (raw, expected) => {
    expect(normalizeAccountPlan(raw)).toBe(expected)
  })

  it.each([undefined, null, '', '   ', 'enterprise', 'go-pro', 42])('无法识别 %s 时返回 undefined', (raw) => {
    expect(normalizeAccountPlan(raw)).toBeUndefined()
  })
})

describe('OpenCode 套餐服务', () => {
  it('缓存时长与超时必须是合法数值', () => {
    expect(() => new OpenCodeEntitlementService({ resolveToken: async () => undefined, cacheMs: -1 })).toThrow(TypeError)
    expect(() => new OpenCodeEntitlementService({ resolveToken: async () => undefined, timeoutMs: 0 })).toThrow(TypeError)
  })

  it('未登录时返回 unknown 与 source=none，不带 error 且不发请求', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const service = new OpenCodeEntitlementService({
      resolveToken: async () => undefined,
      fetchImpl,
      now: () => NOW,
    })

    await expect(service.read()).resolves.toEqual({ plan: 'unknown', source: 'none', fetchedAt: NOW })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it.each([
    ['go', 'go'],
    ['go-plus', 'go-plus'],
    ['go-teams', 'go-teams'],
  ])('套餐接口读到 %s 时直接采信，source=console', async (product, expected) => {
    const fetchImpl = routedFetch({ status: () => json(statusPayload(product)) })
    const service = new OpenCodeEntitlementService({
      resolveToken: async () => ({ access: 'access-1' }),
      fetchImpl,
      now: () => NOW,
      cacheMs: 0,
    })

    const entitlement = await service.read()
    expect(entitlement.plan).toBe(expected)
    expect(entitlement.source).toBe('console')
    expect(entitlement.fetchedAt).toBe(NOW)
    expect(entitlement.error).toBeUndefined()
    expect(entitlement.renewalProduct).toBe(expected)
  })

  it.each([['payg'], ['pay-as-you-go'], ['console']])('按量套餐名 %s 归一为 payg', async (product) => {
    const fetchImpl = routedFetch({ status: () => json(statusPayload(product)) })
    const service = new OpenCodeEntitlementService({
      resolveToken: async () => ({ access: 'access-1' }),
      fetchImpl,
      now: () => NOW,
      cacheMs: 0,
    })

    const entitlement = await service.read()
    expect(entitlement.plan).toBe('payg')
    expect(entitlement.source).toBe('console')
  })

  it.each([[undefined], [''], ['   ']])('product 为 %s 时按按量处理', async (product) => {
    const fetchImpl = routedFetch({ status: () => json(statusPayload(product as string | undefined)) })
    const service = new OpenCodeEntitlementService({
      resolveToken: async () => ({ access: 'access-1' }),
      fetchImpl,
      cacheMs: 0,
    })

    await expect(service.read()).resolves.toMatchObject({ plan: 'payg', source: 'console' })
  })

  it('product 缺失时按按量处理', async () => {
    const fetchImpl = routedFetch({ status: () => json(statusPayload(undefined)) })
    const service = new OpenCodeEntitlementService({
      resolveToken: async () => ({ access: 'access-1' }),
      fetchImpl,
      now: () => NOW,
      cacheMs: 0,
    })

    await expect(service.read()).resolves.toMatchObject({ plan: 'payg', source: 'console' })
  })

  it('解析额度金额与重置时间，数字字符串转成数值', async () => {
    const fetchImpl = routedFetch({ status: () => json(statusPayload('go')) })
    const service = new OpenCodeEntitlementService({
      resolveToken: async () => ({ access: 'access-1' }),
      fetchImpl,
      now: () => NOW,
      cacheMs: 0,
    })

    const entitlement = await service.read()
    expect(entitlement.meters?.fiveHour).toEqual({ limitMicroCents: 1_200_000_000, usedMicroCents: 0 })
    expect(entitlement.meters?.week).toMatchObject({
      limitMicroCents: 3_000_000_000,
      usedMicroCents: 940_512_601,
      resetsAt: '2026-11-09T00:00:00.000Z',
    })
    expect(entitlement.meters?.month?.usedMicroCents).toBe(6_000_000_000)
  })

  it('套餐接口 404 时回退用量接口，读到 200 即视为 Go 订阅', async () => {
    const fetchImpl = routedFetch({
      status: () => json({ error: 'not_found' }, 404),
      usage: () => json({ usage: { rolling: {}, weekly: {}, monthly: {} } }),
    })
    const service = new OpenCodeEntitlementService({
      resolveToken: async () => ({ access: 'access-1' }),
      fetchImpl,
      now: () => NOW,
      cacheMs: 0,
    })

    const entitlement = await service.read()
    expect(entitlement.plan).toBe('go')
    expect(entitlement.source).toBe('usage')
    expect(entitlement.error).toBeUndefined()
  })

  it('套餐接口 401（API Key 无法访问 Console）时仍按用量接口认出 Go 订阅', async () => {
    const fetchImpl = routedFetch({
      status: () => json({ _tag: 'Unauthorized' }, 401),
      usage: () => json({ usage: {} }),
    })
    const service = new OpenCodeEntitlementService({
      resolveToken: async () => ({ access: 'sk-opencode-key-123' }),
      fetchImpl,
      now: () => NOW,
      cacheMs: 0,
    })

    await expect(service.read()).resolves.toMatchObject({ plan: 'go', source: 'usage' })
  })

  it('套餐接口 404 且用量接口也非 200 时判为按量账号', async () => {
    const fetchImpl = routedFetch({
      status: () => json({ error: 'not_found' }, 404),
      usage: () => json({ error: 'subscription_required' }, 403),
    })
    const service = new OpenCodeEntitlementService({
      resolveToken: async () => ({ access: 'access-1' }),
      fetchImpl,
      now: () => NOW,
      cacheMs: 0,
    })

    const entitlement = await service.read()
    expect(entitlement.plan).toBe('payg')
    expect(entitlement.source).toBe('console')
    expect(entitlement.error).toBeUndefined()
  })

  it('套餐接口 500 且用量接口失败时是 unknown 而不是按量（不误伤真 Go 账号）', async () => {
    const fetchImpl = routedFetch({
      status: () => json({ error: 'internal' }, 500),
      usage: () => json({ error: 'boom' }, 500),
    })
    const service = new OpenCodeEntitlementService({
      resolveToken: async () => ({ access: 'access-1' }),
      fetchImpl,
      now: () => NOW,
      cacheMs: 0,
    })

    const entitlement = await service.read()
    expect(entitlement.plan).toBe('unknown')
    expect(entitlement.source).toBe('none')
    expect(entitlement.error).toContain('无法确认 OpenCode 套餐')
    expect(entitlement.error).toContain('HTTP 500')
  })

  it('套餐接口 401 且用量接口也失败时同样是 unknown', async () => {
    const fetchImpl = routedFetch({
      status: () => json({ _tag: 'Unauthorized' }, 401),
      usage: () => json({ error: 'unauthorized' }, 401),
    })
    const service = new OpenCodeEntitlementService({
      resolveToken: async () => ({ access: 'access-1' }),
      fetchImpl,
      now: () => NOW,
      cacheMs: 0,
    })

    await expect(service.read()).resolves.toMatchObject({ plan: 'unknown', source: 'none' })
  })

  it('套餐接口网络失败且用量接口也网络失败时是 unknown，且文案标注网络', async () => {
    const fetchImpl = routedFetch({
      status: () => { throw new TypeError('fetch failed') },
      usage: () => { throw new TypeError('fetch failed') },
    })
    const service = new OpenCodeEntitlementService({
      resolveToken: async () => ({ access: 'access-1' }),
      fetchImpl,
      now: () => NOW,
      cacheMs: 0,
    })

    const entitlement = await service.read()
    expect(entitlement.plan).toBe('unknown')
    expect(entitlement.error).toContain('网络请求失败')
    expect(entitlement.error).not.toContain('access-1')
  })

  it('套餐名无法识别时走用量兜底，而不是硬判按量', async () => {
    const fetchImpl = routedFetch({
      status: () => json(statusPayload('go-pro')),
      usage: () => { throw new TypeError('fetch failed') },
    })
    const service = new OpenCodeEntitlementService({
      resolveToken: async () => ({ access: 'access-1' }),
      fetchImpl,
      now: () => NOW,
      cacheMs: 0,
    })

    const entitlement = await service.read()
    expect(entitlement.plan).toBe('unknown')
    expect(entitlement.error).toContain('无法识别的套餐')
    expect(entitlement.error).toContain('go-pro')
  })

  it('套餐接口响应不是合法 JSON 时按读不出来处理', async () => {
    const fetchImpl = routedFetch({
      status: () => new Response('not json', { status: 200 }),
      usage: () => json({ usage: {} }),
    })
    const service = new OpenCodeEntitlementService({
      resolveToken: async () => ({ access: 'access-1' }),
      fetchImpl,
      now: () => NOW,
      cacheMs: 0,
    })

    await expect(service.read()).resolves.toMatchObject({ plan: 'go', source: 'usage' })
  })

  it('超时给出可读原因，不把它当成按量', async () => {
    const fetchImpl: typeof fetch = async () => {
      const error = new DOMException('The operation was aborted.', 'TimeoutError')
      throw error
    }
    const service = new OpenCodeEntitlementService({
      resolveToken: async () => ({ access: 'access-1' }),
      fetchImpl,
      now: () => NOW,
      cacheMs: 0,
    })

    const entitlement = await service.read()
    expect(entitlement.plan).toBe('unknown')
    expect(entitlement.error).toContain('无法确认 OpenCode 套餐')
  })

  it('请求带 Bearer 与 user-agent，有 orgId 时才带 x-org-id', async () => {
    const seen: { readonly authorization: string | null, readonly org: string | null }[] = []
    const fetchImpl: typeof fetch = async (_input, init) => {
      const headers = new Headers(init?.headers)
      seen.push({ authorization: headers.get('authorization'), org: headers.get('x-org-id') })
      expect(init?.redirect).toBe('error')
      return json(statusPayload('go'))
    }

    const withOrg = new OpenCodeEntitlementService({
      resolveToken: async () => ({ access: 'access-1', orgId: 'wrk_1' }),
      fetchImpl,
      cacheMs: 0,
    })
    await withOrg.read()
    expect(seen.at(-1)).toEqual({ authorization: 'Bearer access-1', org: 'wrk_1' })

    const withoutOrg = new OpenCodeEntitlementService({
      resolveToken: async () => ({ access: 'access-1' }),
      fetchImpl,
      cacheMs: 0,
    })
    await withoutOrg.read()
    expect(seen.at(-1)).toEqual({ authorization: 'Bearer access-1', org: null })
  })

  it('自定义 server 决定套餐接口地址', async () => {
    const urls: string[] = []
    const fetchImpl: typeof fetch = async (input) => {
      urls.push(String(input))
      return json(statusPayload('go-plus'))
    }
    const service = new OpenCodeEntitlementService({
      resolveToken: async () => ({ access: 'access-1', server: 'https://example.test/console/' }),
      fetchImpl,
      cacheMs: 0,
    })

    await expect(service.read()).resolves.toMatchObject({ plan: 'go-plus' })
    expect(urls[0]).toBe('https://example.test/console/api/go/status')
  })

  it('按缓存复用并在 invalidate 后重新请求', async () => {
    let now = NOW
    let statusCalls = 0
    const fetchImpl: typeof fetch = async () => {
      statusCalls += 1
      return json(statusPayload('go'))
    }
    const service = new OpenCodeEntitlementService({
      resolveToken: async () => ({ access: 'access-1' }),
      fetchImpl,
      now: () => now,
      cacheMs: 60_000,
    })

    const first = await service.read()
    expect(first.plan).toBe('go')
    await service.read()
    expect(statusCalls).toBe(1)

    // 缓存期到点后重新请求。
    now += 60_000
    await service.read()
    expect(statusCalls).toBe(2)

    service.invalidate()
    await service.read()
    expect(statusCalls).toBe(3)
  })

  it('并发读取只发一轮请求（单飞）', async () => {
    let calls = 0
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const fetchImpl: typeof fetch = async () => {
      calls += 1
      await gate
      return json(statusPayload('go'))
    }
    const service = new OpenCodeEntitlementService({
      resolveToken: async () => ({ access: 'access-1' }),
      fetchImpl,
      now: () => NOW,
      cacheMs: 60_000,
    })

    const pending = [service.read(), service.read(), service.read()]
    release()
    const resolved = await Promise.all(pending)
    expect(calls).toBe(1)
    expect(resolved.every(entitlement => entitlement.plan === 'go')).toBe(true)
  })

  it('换账号后不复用上一账号的套餐', async () => {
    let token = 'access-1'
    const fetchImpl: typeof fetch = async () => json(statusPayload(token === 'access-1' ? 'go' : 'payg'))
    const service = new OpenCodeEntitlementService({
      resolveToken: async () => ({ access: token }),
      fetchImpl,
      now: () => NOW,
      cacheMs: 60_000,
    })

    await expect(service.read()).resolves.toMatchObject({ plan: 'go' })
    token = 'access-2'
    await expect(service.read()).resolves.toMatchObject({ plan: 'payg' })
  })

  it('unknown 结果不进缓存，下次读取会重新探测', async () => {
    let statusCalls = 0
    const fetchImpl: typeof fetch = async (input) => {
      if (String(input).includes('/console/api/go/status')) {
        statusCalls += 1
        return json({ error: 'internal' }, 500)
      }
      return json({ error: 'boom' }, 500)
    }
    const service = new OpenCodeEntitlementService({
      resolveToken: async () => ({ access: 'access-1' }),
      fetchImpl,
      now: () => NOW,
      cacheMs: 60_000,
    })

    await expect(service.read()).resolves.toMatchObject({ plan: 'unknown' })
    await expect(service.read()).resolves.toMatchObject({ plan: 'unknown' })
    expect(statusCalls).toBe(2)
  })

  it('解析凭据失败时返回 unknown 而不是抛出', async () => {
    const service = new OpenCodeEntitlementService({
      resolveToken: async () => { throw new Error('refresh 失败') },
      fetchImpl: vi.fn<typeof fetch>(),
    })

    const entitlement = await service.read()
    expect(entitlement.plan).toBe('unknown')
    expect(entitlement.error).toContain('refresh 失败')
  })

  it('错误文案里不出现 token 原文', async () => {
    const token = 'sk-opencode-very-secret-key'
    const fetchImpl: typeof fetch = async () => {
      throw new TypeError(`request with Authorization: Bearer ${token} failed`)
    }
    const service = new OpenCodeEntitlementService({
      resolveToken: async () => ({ access: token }),
      fetchImpl,
      cacheMs: 0,
    })

    const entitlement = await service.read()
    expect(entitlement.error).toBeDefined()
    expect(entitlement.error).not.toContain(token)
  })
})
