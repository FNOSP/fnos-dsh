import { describe, expect, it, vi } from 'vitest'
import { ZCodeUsageService } from '../../src/host/usage.ts'
import { remainingPercent, resetAfterMs, usagePercent } from '../../src/contracts/usage.ts'
import type { ZCodeUsageWindow } from '../../src/contracts/usage.ts'
import type { ZCodeConsoleClient } from '../../src/host/console-client.ts'

function serviceWith(
  client: Partial<ZCodeConsoleClient>,
  options: { readonly token?: string | undefined } = { token: 'jwt' },
): ZCodeUsageService {
  const token = 'token' in options ? options.token : 'jwt'
  return new ZCodeUsageService({
    client: client as ZCodeConsoleClient,
    resolveToken: async () => token,
    now: () => 1_000,
  })
}

const snapshot = {
  plans: [{ planId: 'zcode-v3-start-plan-0817', name: 'Start Plan' }],
  balances: [
    {
      showName: 'GLM-5.3',
      capability: 'model:glm-5.3',
      totalUnits: 3_000_000,
      usedUnits: 750_000,
      remainingUnits: 2_250_000,
      periodStartSeconds: 1_792_771_200,
      periodEndSeconds: 1_792_857_599,
    },
    {
      showName: 'GLM-5.3-Flash',
      capability: 'model:glm-5.3-flash',
      totalUnits: 5_000_000,
      usedUnits: 5_000_000,
      remainingUnits: 0,
      // 无 period_end 时退回 expires_at。
      expiresAtSeconds: 1_792_900_800,
    },
  ],
}

describe('额度百分比', () => {
  it('正常换算并夹到 0..100', () => {
    expect(usagePercent(50, 100)).toBe(50)
    expect(usagePercent(0, 100)).toBe(0)
    expect(usagePercent(200, 100)).toBe(100)
    expect(usagePercent(-1, 100)).toBe(0)
  })

  it('总量为 0 时给 0 而不是 NaN', () => {
    expect(usagePercent(0, 0)).toBe(0)
    expect(usagePercent(5, 0)).toBe(0)
    expect(usagePercent(Number.NaN, 100)).toBe(0)
  })

  it('剩余百分比与重置倒计时', () => {
    const window: ZCodeUsageWindow = {
      label: 'GLM-5.3',
      totalUnits: 100,
      usedUnits: 30,
      remainingUnits: 70,
      percent: 30,
      resetsAt: new Date(5_000).toISOString(),
      exhausted: false,
    }
    expect(remainingPercent(window)).toBe(70)
    expect(resetAfterMs(window, 1_000)).toBe(4_000)
    expect(resetAfterMs(window, 9_000)).toBe(0)
    const noReset: ZCodeUsageWindow = {
      label: 'GLM-5.3',
      totalUnits: 100,
      usedUnits: 30,
      remainingUnits: 70,
      percent: 30,
      exhausted: false,
    }
    expect(resetAfterMs(noReset, 1_000)).toBeUndefined()
    expect(resetAfterMs({ ...window, resetsAt: 'not-a-date' }, 1_000)).toBeUndefined()
  })
})

describe('额度服务', () => {
  it('把每份额度投影成独立窗口，耗尽的那份额度标出来', async () => {
    const usage = serviceWith({ balance: async () => snapshot })
    const result = await usage.read()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.usage.windows).toHaveLength(2)
    expect(result.usage.windows[0]).toMatchObject({
      label: 'GLM-5.3',
      percent: 25,
      exhausted: false,
      // 周期由 86399 秒窗口推导出来。
      period: 'daily',
      resetsAt: new Date(1_792_857_599_000).toISOString(),
    })
    expect(result.usage.windows[1]).toMatchObject({
      label: 'GLM-5.3-Flash',
      percent: 100,
      exhausted: true,
      resetsAt: new Date(1_792_900_800_000).toISOString(),
    })
    expect(result.usage.plans).toHaveLength(1)
  })

  it('未登录时返回 not-signed-in 而不抛错', async () => {
    const usage = serviceWith({}, { token: undefined })
    await expect(usage.read()).resolves.toMatchObject({ ok: false, reason: 'not-signed-in' })
  })

  it('上游失败时返回 request-failed 而不抛错', async () => {
    const usage = serviceWith({ balance: async () => { throw new Error('3012 blocked') } })
    await expect(usage.read()).resolves.toMatchObject({
      ok: false,
      reason: 'request-failed',
      message: '3012 blocked',
    })
  })

  it('缓存期内不重复请求，invalidate 后重新请求', async () => {
    const balance = vi.fn(async () => snapshot)
    const usage = new ZCodeUsageService({
      client: { balance } as unknown as ZCodeConsoleClient,
      resolveToken: async () => 'jwt',
      now: () => 1_000,
      cacheMs: 10_000,
    })
    await usage.read()
    await usage.read()
    expect(balance).toHaveBeenCalledTimes(1)
    usage.invalidate()
    await usage.read()
    expect(balance).toHaveBeenCalledTimes(2)
    await usage.read(true)
    expect(balance).toHaveBeenCalledTimes(3)
  })

  it('并发读取合并成一次请求', async () => {
    const balance = vi.fn(async () => snapshot)
    const usage = new ZCodeUsageService({
      client: { balance } as unknown as ZCodeConsoleClient,
      resolveToken: async () => 'jwt',
    })
    const [a, b] = await Promise.all([usage.read(), usage.read()])
    expect(balance).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
  })
})
