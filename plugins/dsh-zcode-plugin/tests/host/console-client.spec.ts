import { describe, expect, it, vi } from 'vitest'
import {
  ZCodeConsoleClient,
  ZCodeConsoleError,
  zcodeMessagesUrl,
  zcodeModelHeaders,
  zcodeSourceHeaders,
} from '../../src/host/console-client.ts'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  }) as Response
}

function clientWith(
  handler: (url: string, init: RequestInit | undefined) => Response | Promise<Response>,
  deviceMid = 'device-1',
): ZCodeConsoleClient {
  return new ZCodeConsoleClient({
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) =>
      handler(String(input), init)) as typeof globalThis.fetch,
    deviceMid: () => deviceMid,
  })
}

describe('ZCode 控制面客户端', () => {
  it('设备授权按官方信封解析 flow_id 与授权地址', async () => {
    const client = clientWith(async (url, init) => {
      expect(url).toBe('https://zcode.z.ai/api/v1/oauth/cli/init')
      expect(init?.method).toBe('POST')
      expect((init?.headers as Record<string, string>).authorization).toBe('Bearer poll-token')
      expect(JSON.parse(String(init?.body))).toEqual({ provider: 'bigmodel' })
      return jsonResponse({
        code: 0,
        data: {
          flow_id: 'flow-1',
          authorize_url: 'https://bigmodel.cn/login?state=abc',
          expires_at: 1_800_000_000,
          poll_interval_sec: 3,
        },
      })
    })
    const init = await client.initDeviceFlow('bigmodel', 'poll-token')
    expect(init.flowId).toBe('flow-1')
    expect(init.authorizeUrl).toBe('https://bigmodel.cn/login?state=abc')
    expect(init.intervalSeconds).toBe(3)
    expect(init.expiresAt).toBe(1_800_000_000_000)
  })

  it('轮询把 pending 与 ready 分开，ready 提取 JWT 与家族令牌', async () => {
    const pending = clientWith(async () => jsonResponse({ code: 0, data: { status: 'pending' } }))
    await expect(pending.pollDeviceFlow('zai', 'flow-1', 't')).resolves.toEqual({ status: 'pending' })

    const ready = clientWith(async url => {
      expect(url).toBe('https://zcode.z.ai/api/v1/oauth/cli/poll/flow-1')
      return jsonResponse({
        code: 0,
        data: {
          status: 'ready',
          token: 'zcode-jwt',
          zai: { access_token: 'maas-token', refresh_token: 'refresh-1' },
          user: { user_id: '409', email: 'a@b.c', name: 'Tester' },
        },
      })
    })
    const result = await ready.pollDeviceFlow('zai', 'flow-1', 't')
    expect(result).toMatchObject({
      status: 'ready',
      zcodeJwt: 'zcode-jwt',
      accessToken: 'maas-token',
      refreshToken: 'refresh-1',
      user: { userId: '409', email: 'a@b.c', name: 'Tester' },
    })
  })

  it('额度接口必须带设备标识与裸 JWT，并把 capabilities 解析出来', async () => {
    const client = clientWith(async (url, init) => {
      expect(url).toContain('/api/v1/zcode-plan/billing/balance')
      const headers = init?.headers as Record<string, string>
      expect(headers['x-device-mid']).toBe('device-1')
      // 额度接口要裸 JWT，不能带 Bearer 前缀。
      expect(headers.authorization).toBe('zcode-jwt')
      return jsonResponse({
        code: 0,
        data: {
          plans: [{ plan_id: 'zcode-v3-start-plan-0817', name: 'Start Plan', status: 'active' }],
          balances: [
            {
              entitlement_id: 'ent_1',
              show_name: 'GLM-5.3',
              capabilities: ['model:glm-5.3'],
              total_units: 3_000_000,
              used_units: 1000,
              remaining_units: 2_999_000,
              period_start: 1_792_771_200,
              period_end: 1_792_857_599,
            },
          ],
        },
      })
    })
    const snapshot = await client.balance('zcode-jwt')
    expect(snapshot.plans).toHaveLength(1)
    expect(snapshot.plans[0]?.planId).toBe('zcode-v3-start-plan-0817')
    expect(snapshot.balances[0]).toMatchObject({
      showName: 'GLM-5.3',
      capability: 'model:glm-5.3',
      totalUnits: 3_000_000,
      usedUnits: 1000,
      remainingUnits: 2_999_000,
      periodStartSeconds: 1_792_771_200,
      periodEndSeconds: 1_792_857_599,
    })
  })

  it('缺 X-Device-Mid 时上游报 3001，客户端把它变成带码错误', async () => {
    const client = clientWith(async () => jsonResponse({ code: 3001, msg: 'parameter error' }))
    const first = client.balance('jwt')
    await expect(first).rejects.toMatchObject({ name: 'ZCodeConsoleError', code: 3001 })
    await expect(first).rejects.toBeInstanceOf(ZCodeConsoleError)
  })

  it('业务码 3012 保留原始提示，供界面区分风控与鉴权失败', async () => {
    const client = clientWith(async () =>
      jsonResponse(
        { code: 3012, msg: 'request has been blocked due to unusual activity.' },
        405,
      ))
    await expect(client.balance('jwt')).rejects.toMatchObject({
      code: 3012,
      status: 405,
      message: 'request has been blocked due to unusual activity.',
    })
  })

  it('客户端配置读出不重复的模型能力与验证码开关', async () => {
    const client = clientWith(async () =>
      jsonResponse({
        code: 0,
        data: {
          builtinModels: [
            {
              modelId: 'GLM-5.3',
              name: 'GLM-5.3',
              contextWindow: 1_000_000,
              maxCompletionTokens: 128_000,
              reasoning: { levels: { low: {}, high: {}, max: {} } },
            },
            { modelId: 'GLM-5.3', name: 'GLM-5.3 duplicate' },
            {
              modelId: 'GLM-5.3-Flash',
              name: 'GLM-5.3-Flash',
              capabilities: { vision: true },
            },
          ],
          configs: {
            captcha: { enabled: true, region: 'cn', skip_model_request: true },
            startPlanPreview: {
              entitlements: [{ showName: 'GLM-5.3', grantUnits: 3_000_000 }],
            },
          },
        },
      }))
    const snapshot = await client.clientConfigs('jwt')
    expect(snapshot.models).toHaveLength(2)
    expect(snapshot.models[0]).toMatchObject({
      modelId: 'GLM-5.3',
      contextWindow: 1_000_000,
      maxCompletionTokens: 128_000,
      reasoningLevels: ['low', 'high', 'max'],
    })
    expect(snapshot.models[1]).toMatchObject({ modelId: 'GLM-5.3-Flash', supportsImage: true })
    expect(snapshot.captcha).toEqual({ enabled: true, skipModelRequest: true, region: 'cn' })
    expect(snapshot.startPlanEntitlements).toEqual([{ showName: 'GLM-5.3', grantUnits: 3_000_000 }])
  })

  it('网络失败与超时都变成可读错误而不是抛出底层异常', async () => {
    const failing = clientWith(async () => { throw new Error('boom') })
    const failure = failing.balance('jwt')
    await expect(failure).rejects.toMatchObject({ name: 'ZCodeConsoleError' })

    vi.useFakeTimers()
    try {
      const hanging = new ZCodeConsoleClient({
        fetch: ((_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new Error('aborted'))
            })
          })) as typeof globalThis.fetch,
        timeoutMs: 10,
      })
      // 先挂上拒绝处理，再推进时钟：否则计时器触发时 Promise 还没有
      // rejection handler，Vitest 会把这次拒绝记成未处理错误。
      const settled = hanging.balance('jwt').then(
        () => { throw new Error('expected a timeout rejection') },
        (error: unknown) => error,
      )
      await vi.advanceTimersByTimeAsync(20)
      const timeoutError = await settled
      expect(timeoutError).toBeInstanceOf(ZCodeConsoleError)
      expect((timeoutError as ZCodeConsoleError).message).toMatch(/超时/u)
    } finally {
      vi.useRealTimers()
    }
  })

  it('推理请求头同时带 authorization 与 x-api-key，端点补 /v1/messages', () => {
    const headers = zcodeModelHeaders('device-1', 'token-1')
    expect(headers.authorization).toBe('Bearer token-1')
    expect(headers['x-api-key']).toBe('token-1')
    expect(headers['anthropic-version']).toBe('2023-06-01')
    expect(headers['x-device-mid']).toBe('device-1')
    expect(zcodeMessagesUrl()).toBe('https://zcode.z.ai/api/v1/zcode-plan/anthropic/v1/messages')
    expect(zcodeMessagesUrl('https://example.com/anthropic/')).toBe('https://example.com/anthropic/v1/messages')
  })

  it('来源身份头使用 zcode 域名与稳定 UA，便于网关归因', () => {
    const headers = zcodeSourceHeaders('device-9')
    expect(headers['http-referer']).toBe('https://zcode.z.ai')
    expect(headers['x-app-id']).toBe('zcode')
    expect(headers['user-agent']).toContain('ZCode/')
    expect(headers['x-device-mid']).toBe('device-9')
    expect(headers['x-release-channel']).toBe('production')
  })

  it('设备标识在进程内稳定，且可被显式恢复', () => {
    const client = new ZCodeConsoleClient({ deviceMid: () => 'generated' })
    expect(client.deviceMid()).toBe('generated')
    client.setDeviceMid('restored')
    expect(client.deviceMid()).toBe('restored')
    client.setDeviceMid('   ')
    expect(client.deviceMid()).toBe('restored')
  })
})

describe('客户端配置解析（Web 实测修正）', () => {
  it('从 builtinModels 读能力：contextWindow / maxCompletionTokens / 思考等级 / vision', async () => {
    // 真实载荷的结构：能力在 data.builtinModels，reasoning.levels 是**对象映射**，
    // 图片开关是 capabilities.vision。早前按 providers[].models[] + 数组读
    // levels + inputFormat.supportsImage，导致 GLM-5.3 退回默认值且丢失思考与视觉。
    const client = clientWith(async () =>
      jsonResponse({
        code: 0,
        data: {
          providers: [
            { providerId: 'bigmodel', models: [{ modelId: 'GLM-5.2', name: 'GLM-5.2' }] },
          ],
          builtinModels: [
            {
              modelId: 'GLM-5.3',
              name: 'GLM-5.3',
              contextWindow: 1_000_000,
              maxCompletionTokens: 128_000,
              capabilities: {},
              reasoning: {
                levels: { low: { anthropic: { set: [] } }, high: {}, max: {} },
                defaultLevel: 'max',
              },
            },
            {
              modelId: 'GLM-5.3-Flash',
              name: 'GLM-5.3-Flash',
              contextWindow: 1_000_000,
              maxCompletionTokens: 128_000,
              capabilities: { vision: true },
              reasoning: { levels: { low: {}, high: {}, max: {} } },
            },
          ],
        },
      }))
    const snapshot = await client.clientConfigs('jwt')
    expect(snapshot.models).toHaveLength(2)
    const [standard, flash] = snapshot.models
    expect(standard).toMatchObject({
      modelId: 'GLM-5.3',
      contextWindow: 1_000_000,
      maxCompletionTokens: 128_000,
      defaultReasoningLevel: 'max',
    })
    // levels 是对象 → 键名就是等级；顺序按插入序 low/high/max。
    expect(standard?.reasoningLevels).toEqual(['low', 'high', 'max'])
    expect(standard?.supportsImage).toBeUndefined()
    expect(flash?.supportsImage).toBe(true)
  })

  it('providers 里的旧模型不会顶替 builtinModels 的能力', async () => {
    const client = clientWith(async () =>
      jsonResponse({
        code: 0,
        data: {
          providers: [{ models: [{ modelId: 'GLM-5.3', name: 'stale', contextWindow: 1 }] }],
          builtinModels: [{ modelId: 'GLM-5.3', name: 'GLM-5.3', contextWindow: 1_000_000 }],
        },
      }))
    const snapshot = await client.clientConfigs('jwt')
    expect(snapshot.models).toHaveLength(1)
    expect(snapshot.models[0]?.contextWindow).toBe(1_000_000)
  })

  it('额度时间字段按 Unix 秒读取（不是 ISO 字符串）', async () => {
    const client = clientWith(async () =>
      jsonResponse({
        code: 0,
        data: {
          plans: [],
          balances: [{
            show_name: 'GLM-5.3',
            capabilities: ['model:glm-5.3'],
            total_units: 3_000_000,
            used_units: 0,
            remaining_units: 3_000_000,
            plan_id: 'zcode-v3-start-plan-0817',
            period_start: 1_792_771_200,
            period_end: 1_792_857_599,
            expires_at: 1_792_857_599,
            available_units: 3_000_000,
          }],
        },
      }))
    const snapshot = await client.balance('jwt')
    expect(snapshot.balances[0]).toMatchObject({
      showName: 'GLM-5.3',
      planId: 'zcode-v3-start-plan-0817',
      periodStartSeconds: 1_792_771_200,
      periodEndSeconds: 1_792_857_599,
      expiresAtSeconds: 1_792_857_599,
      availableUnits: 3_000_000,
    })
  })
})
