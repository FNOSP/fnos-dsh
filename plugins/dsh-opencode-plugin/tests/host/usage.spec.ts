import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseOpenCodeUsage, OpenCodeUsageService } from '../../src/host/usage.ts'
import type { OpenCodeUsage } from '../../src/contracts/usage.ts'

const NOW = 1_761_200_000_000
const RESET_ISO = '2026-10-24T00:00:00.000Z'
const RESET_MS = Date.parse(RESET_ISO)

function windowPayload(): Record<string, unknown> {
  return {
    rolling: { status: 'ok', percent: 12.5, resetsAt: RESET_ISO },
    weekly: { status: 'ok', percent: 30, resetsAt: RESET_ISO },
    monthly: { status: 'rate-limited', percent: 100, resetsAt: RESET_ISO },
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('OpenCode 用量归一化', () => {
  it('解析 Console 的 usage 包装形态', () => {
    const usage = parseOpenCodeUsage({
      usage: windowPayload(),
      plan: 'opencode-go',
    }, NOW)

    expect(usage.fetchedAt).toBe(NOW)
    expect(usage.plan).toBe('opencode-go')
    expect(usage.rolling).toEqual({ status: 'ok', percent: 12.5, resetsAt: RESET_ISO })
    expect(usage.monthly).toEqual({ status: 'rate-limited', percent: 100, resetsAt: RESET_ISO })
  })

  it('接受顶层 windows 包装与顶层窗口两种变体', () => {
    const viaWindows = parseOpenCodeUsage({ windows: windowPayload() }, NOW)
    expect(viaWindows.weekly.percent).toBe(30)

    const viaTopLevel = parseOpenCodeUsage({ ...windowPayload(), planName: 'Go' }, NOW)
    expect(viaTopLevel.rolling.percent).toBe(12.5)
    expect(viaTopLevel.plan).toBe('Go')
  })

  it('接受 used_percent / usedPercent 字段与秒、毫秒、数字字符串时间戳', () => {
    const usage = parseOpenCodeUsage({
      usage: {
        rolling: { status: 'ok', used_percent: 40, resets_at: RESET_MS / 1000 },
        weekly: { status: 'ok', usedPercent: '55', reset_at: RESET_MS },
        monthly: { status: 'rate_limited', used_percent: 100, resetsAt: String(RESET_MS / 1000) },
      },
    }, NOW)

    expect(usage.rolling).toEqual({ status: 'ok', percent: 40, resetsAt: RESET_ISO })
    expect(usage.weekly).toEqual({ status: 'ok', percent: 55, resetsAt: RESET_ISO })
    expect(usage.monthly).toEqual({ status: 'rate-limited', percent: 100, resetsAt: RESET_ISO })
  })

  it('缺少状态时按百分比推断，但不补任何缺失的数值', () => {
    const usage = parseOpenCodeUsage({
      usage: {
        rolling: { percent: 0, resetsAt: RESET_ISO },
        weekly: { percent: 100, resetsAt: RESET_ISO },
        monthly: { percent: 99.9, resetsAt: RESET_ISO },
      },
    }, NOW)

    expect(usage.rolling.status).toBe('ok')
    expect(usage.weekly.status).toBe('rate-limited')
    expect(usage.monthly.status).toBe('ok')
  })

  it.each([
    ['非对象', null, '不是对象'],
    ['数组', [], '不是对象'],
    ['缺 rolling 窗口', { usage: { weekly: windowPayload().weekly, monthly: windowPayload().monthly } }, '缺少 rolling 窗口'],
    ['缺百分比', { usage: { ...windowPayload(), rolling: { status: 'ok', resetsAt: RESET_ISO } } }, '缺少已用百分比'],
    ['百分比不是数字', { usage: { ...windowPayload(), rolling: { status: 'ok', percent: 'abc', resetsAt: RESET_ISO } } }, '缺少已用百分比'],
    ['百分比越界', { usage: { ...windowPayload(), rolling: { status: 'ok', percent: 120, resetsAt: RESET_ISO } } }, '超出 0..100'],
    ['重置时间非法', { usage: { ...windowPayload(), rolling: { status: 'ok', percent: 10, resetsAt: 'not-a-date' } } }, '缺少有效的重置时间'],
    ['重置时间为 0', { usage: { ...windowPayload(), rolling: { status: 'ok', percent: 10, resetsAt: 0 } } }, '缺少有效的重置时间'],
    ['状态无法识别', { usage: { ...windowPayload(), rolling: { status: 'weird', percent: 10, resetsAt: RESET_ISO } } }, '状态无法识别'],
  ])('非法数据抛错：%s', (_label, payload, message) => {
    expect(() => parseOpenCodeUsage(payload)).toThrow(message)
  })
})

describe('OpenCode 用量服务', () => {
  it('超时配置必须是正数', () => {
    expect(() => new OpenCodeUsageService({ resolveToken: async () => undefined, timeoutMs: 0 })).toThrow(TypeError)
  })

  it('未登录时返回 undefined 且不发起请求', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const service = new OpenCodeUsageService({
      resolveToken: async () => undefined,
      fetchImpl,
    })

    await expect(service.read()).resolves.toBeUndefined()
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(service.error()).toBeUndefined()
  })

  it('读取用量、按缓存复用并在失效后重新请求', async () => {
    let now = NOW
    let fetchCalls = 0
    const fetchImpl: typeof fetch = async (_input, init) => {
      fetchCalls += 1
      expect(init?.redirect).toBe('error')
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer access-1')
      return json({ usage: windowPayload() })
    }
    const service = new OpenCodeUsageService({
      resolveToken: async () => 'access-1',
      fetchImpl,
      now: () => now,
      cacheMs: 60_000,
    })

    const first = await service.read()
    expect(first?.fetchedAt).toBe(NOW)
    expect(first?.rolling.percent).toBe(12.5)

    await service.read()
    expect(fetchCalls).toBe(1)

    now += 60_000
    await service.read()
    expect(fetchCalls).toBe(2)

    service.invalidate()
    await service.read()
    expect(fetchCalls).toBe(3)
  })

  it('请求失败抛可读错误并记录到 error()', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => json({ error: 'rate_limited' }, 429))
    const service = new OpenCodeUsageService({
      resolveToken: async () => 'access-1',
      fetchImpl,
      cacheMs: 0,
    })

    await expect(service.read()).rejects.toThrow('HTTP 429')
    expect(service.error()).toContain('HTTP 429')

    fetchImpl.mockResolvedValue(json({ usage: windowPayload() }))
    await expect(service.read()).resolves.toMatchObject({ fetchedAt: expect.any(Number) })
    expect(service.error()).toBeUndefined()
  })

  it('403 归类为未订阅 Go 套餐，而不是网络失败', async () => {
    const fetchImpl: typeof fetch = async () => json({ error: 'subscription_required' }, 403)
    const service = new OpenCodeUsageService({
      resolveToken: async () => 'sk-opencode-key-123',
      fetchImpl,
      cacheMs: 0,
    })

    const message = await service.read().then(
      () => '',
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    )
    expect(message).toContain('没有 OpenCode Go 套餐订阅')
    expect(message).toContain('subscription_required')
    expect(message).not.toContain('网络')
  })

  it('网络失败明确标注网络，而不是套餐问题', async () => {
    const fetchImpl: typeof fetch = async () => { throw new TypeError('fetch failed') }
    const service = new OpenCodeUsageService({
      resolveToken: async () => 'access-1',
      fetchImpl,
      cacheMs: 0,
    })

    const message = await service.read().then(
      () => '',
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    )
    expect(message).toContain('网络请求失败')
    expect(message).not.toContain('套餐订阅')
  })

  it('401 归类为凭据无效', async () => {
    const fetchImpl: typeof fetch = async () => json({ error: 'unauthorized' }, 401)
    const service = new OpenCodeUsageService({
      resolveToken: async () => 'sk-opencode-key-123',
      fetchImpl,
      cacheMs: 0,
    })

    await expect(service.read()).rejects.toThrow('凭据无效或已过期')
  })

  it('API Key 与 OAuth token 走同一条读取路径', async () => {
    const seen: string[] = []
    const fetchImpl: typeof fetch = async (_input, init) => {
      seen.push(new Headers(init?.headers).get('authorization') ?? '')
      return json({ usage: windowPayload() })
    }
    const service = new OpenCodeUsageService({
      resolveToken: async () => 'sk-opencode-key-123',
      fetchImpl,
      cacheMs: 0,
    })

    const usage = await service.read()
    expect(usage?.weekly.percent).toBe(30)
    expect(seen).toEqual(['Bearer sk-opencode-key-123'])
  })

  it('响应格式非法时抛错，不补 0', async () => {
    const fetchImpl: typeof fetch = async () => json({ usage: { rolling: windowPayload().rolling } })
    const service = new OpenCodeUsageService({
      resolveToken: async () => 'access-1',
      fetchImpl,
      cacheMs: 0,
    })

    await expect(service.read()).rejects.toThrow('缺少 weekly 窗口')
    expect(service.error()).toContain('缺少 weekly 窗口')
  })

  it('非 JSON 响应与空响应都给出可读错误', async () => {
    const invalidJson: typeof fetch = async () => new Response('not json', { status: 200 })
    const invalidService = new OpenCodeUsageService({ resolveToken: async () => 'access-1', fetchImpl: invalidJson })
    await expect(invalidService.read()).rejects.toThrow('不是合法 JSON')

    const empty: typeof fetch = async () => new Response('', { status: 200 })
    const emptyService = new OpenCodeUsageService({ resolveToken: async () => 'access-1', fetchImpl: empty })
    await expect(emptyService.read()).rejects.toThrow('响应为空')
  })

  it('解析当前 token 失败时也以可读错误上抛', async () => {
    const service = new OpenCodeUsageService({
      resolveToken: async () => { throw new Error('token 刷新失败') },
      fetchImpl: vi.fn<typeof fetch>(),
    })

    await expect(service.read()).rejects.toThrow('token 刷新失败')
    expect(service.error()).toContain('token 刷新失败')
  })

  it('退出登录后清掉上一账号的快照', async () => {
    let token: string | undefined = 'access-1'
    const fetchImpl: typeof fetch = async () => json({ usage: windowPayload() })
    const service = new OpenCodeUsageService({
      resolveToken: async () => token,
      fetchImpl,
      now: () => NOW,
      cacheMs: 60_000,
    })

    await expect(service.read()).resolves.toBeDefined()
    const cached: OpenCodeUsage | undefined = await service.read()
    expect(cached).toBeDefined()

    token = undefined
    await expect(service.read()).resolves.toBeUndefined()
  })
})
