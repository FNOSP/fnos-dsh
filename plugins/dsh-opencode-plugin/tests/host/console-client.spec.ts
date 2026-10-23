import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  OpenCodeConsoleClient,
  OpenCodeConsoleError,
  OPENCODE_CONSOLE_MAX_RESPONSE_BYTES,
  redactMessage,
} from '../../src/host/console-client.ts'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  return input instanceof URL ? input.href : input.url
}

function requestJson(init: RequestInit | undefined): Record<string, unknown> {
  if (typeof init?.body !== 'string') throw new Error('请求体不是 JSON 字符串')
  return JSON.parse(init.body) as Record<string, unknown>
}

const DEVICE_RESPONSE = {
  device_code: 'device-1',
  user_code: 'USER-1',
  verification_uri_complete: '/console/device?user_code=USER-1&client_id=opencode-cli',
  expires_in: 600,
  interval: 5,
}

afterEach(() => {
  vi.useRealTimers()
})

describe('OpenCode Console 设备码登录', () => {
  it('按 opencode CLI 的契约申请设备码，并把相对验证地址解析成绝对地址', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = []
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: requestUrl(input), init })
      return json(DEVICE_RESPONSE)
    }
    const client = new OpenCodeConsoleClient({ fetchImpl })

    const result = await client.requestDeviceCode()

    expect(result.deviceCode).toBe('device-1')
    expect(result.challenge).toEqual({
      userCode: 'USER-1',
      verificationUri: 'https://opencode.ai/console/device?user_code=USER-1&client_id=opencode-cli',
      expiresInSeconds: 600,
      intervalSeconds: 5,
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://opencode.ai/console/auth/device/code')
    expect(calls[0]?.init?.method).toBe('POST')
    expect(calls[0]?.init?.redirect).toBe('error')
    expect(requestJson(calls[0]?.init)).toEqual({
      client_id: 'opencode-cli',
      supports_org_scope: true,
    })
  })

  it('按 authorization_pending → slow_down → 成功的顺序轮询', async () => {
    vi.useFakeTimers()
    let tokenCalls = 0
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = requestUrl(input)
      if (!url.endsWith('/auth/device/token')) throw new Error(`未预期的请求：${url}`)
      tokenCalls += 1
      expect(requestJson(init)).toMatchObject({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: 'device-1',
        client_id: 'opencode-cli',
      })
      if (tokenCalls === 1) return json({ error: 'authorization_pending' }, 400)
      if (tokenCalls === 2) return json({ error: 'slow_down' }, 400)
      return json({
        access_token: 'access-1',
        refresh_token: 'refresh-1',
        expires_in: 3600,
        org_id: 'org-1',
      })
    }
    const client = new OpenCodeConsoleClient({ fetchImpl })

    const pending = client.pollForToken({ deviceCode: 'device-1', intervalSeconds: 5, expiresInSeconds: 600 })
    // 第一次 pending 后等待 5 秒，随后 slow_down 把间隔加到 10 秒。
    await vi.advanceTimersByTimeAsync(5_000)
    expect(tokenCalls).toBe(2)
    await vi.advanceTimersByTimeAsync(10_000)
    const tokens = await pending

    expect(tokenCalls).toBe(3)
    expect(tokens.access).toBe('access-1')
    expect(tokens.refresh).toBe('refresh-1')
    expect(tokens.orgId).toBe('org-1')
    expect(tokens.expiresAt).toBe(Date.now() + 3_600_000)
  })

  it('外部取消会立即中止轮询并保留取消原因', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const fetchImpl: typeof fetch = async () => json({ error: 'authorization_pending' }, 400)
    const client = new OpenCodeConsoleClient({ fetchImpl })

    const pending = client.pollForToken({
      deviceCode: 'device-1',
      signal: controller.signal,
      intervalSeconds: 30,
      expiresInSeconds: 600,
    })
    await vi.advanceTimersByTimeAsync(0)
    controller.abort(new Error('用户取消'))

    await expect(pending).rejects.toThrow('用户取消')
  })

  it('设备码过期后停止轮询', async () => {
    vi.useFakeTimers()
    const fetchImpl: typeof fetch = async () => json({ error: 'authorization_pending' }, 400)
    const client = new OpenCodeConsoleClient({ fetchImpl })

    const pending = client.pollForToken({ deviceCode: 'device-1', intervalSeconds: 5, expiresInSeconds: 10 })
    const assertion = expect(pending).rejects.toThrow('已过期')
    await vi.advanceTimersByTimeAsync(10_000)
    await assertion
  })

  it('设备码响应缺字段时抛错而不是拼出半成品挑战', async () => {
    const fetchImpl: typeof fetch = async () => json({ ...DEVICE_RESPONSE, device_code: '' })
    const client = new OpenCodeConsoleClient({ fetchImpl })

    await expect(client.requestDeviceCode()).rejects.toThrow('缺少 device_code')
  })
})

describe('OpenCode Console token 刷新', () => {
  it('用 refresh_token grant 换取新凭据', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = []
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: requestUrl(input), init })
      return json({ access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 60 })
    }
    const client = new OpenCodeConsoleClient({ fetchImpl })

    const tokens = await client.refresh('refresh-1')

    expect(tokens.access).toBe('access-2')
    expect(tokens.refresh).toBe('refresh-2')
    expect(tokens.expiresAt).toBeGreaterThan(Date.now())
    expect(calls[0]?.url).toBe('https://opencode.ai/console/auth/device/token')
    expect(requestJson(calls[0]?.init)).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'refresh-1',
      client_id: 'opencode-cli',
    })
  })

  it('invalid_grant 以结构化错误码上抛，交给调用方判定重新登录', async () => {
    const fetchImpl: typeof fetch = async () => json({ error: 'invalid_grant' }, 400)
    const client = new OpenCodeConsoleClient({ fetchImpl })

    await expect(client.refresh('refresh-1')).rejects.toMatchObject({
      name: 'OpenCodeConsoleError',
      code: 'invalid_grant',
      status: 400,
    })
  })

  it('轮换响应缺 refresh_token 时沿用旧 refresh token', async () => {
    const fetchImpl: typeof fetch = async () => json({ access_token: 'access-2', expires_in: 60 })
    const client = new OpenCodeConsoleClient({ fetchImpl })

    await expect(client.refresh('refresh-1')).resolves.toMatchObject({ refresh: 'refresh-1' })
  })
})

describe('OpenCode Console 身份查询', () => {
  it('读取账号与组织，并携带 Bearer token', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = []
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = requestUrl(input)
      calls.push({ url, init })
      if (url.endsWith('/api/user')) return json({ id: 'user-1', email: 'dev@example.com' })
      if (url.endsWith('/api/orgs')) {
        return json([
          { id: 'org-1', name: 'Team One' },
          { id: 'org-2' },
          { id: 'org-1', name: '重复条目' },
          { id: 'org-3', name: 'Team Three' },
        ])
      }
      throw new Error(`未预期的请求：${url}`)
    }
    const client = new OpenCodeConsoleClient({ fetchImpl })

    await expect(client.user('access-1')).resolves.toEqual({ id: 'user-1', email: 'dev@example.com' })
    await expect(client.organizations('access-1')).resolves.toEqual([
      { id: 'org-1', name: 'Team One' },
      { id: 'org-3', name: 'Team Three' },
    ])
    expect(calls[0]?.url).toBe('https://opencode.ai/console/api/user')
    expect(new Headers(calls[0]?.init?.headers).get('authorization')).toBe('Bearer access-1')
    expect(calls[0]?.init?.redirect).toBe('error')
  })

  it('账号响应缺 id 时抛错', async () => {
    const fetchImpl: typeof fetch = async () => json({ email: 'dev@example.com' })
    const client = new OpenCodeConsoleClient({ fetchImpl })

    await expect(client.user('access-1')).rejects.toThrow('缺少 id')
  })

  it('组织响应不是数组时抛错', async () => {
    const fetchImpl: typeof fetch = async () => json({ orgs: [] })
    const client = new OpenCodeConsoleClient({ fetchImpl })

    await expect(client.organizations('access-1')).rejects.toThrow('不是数组')
  })
})

describe('OpenCode Console 用量探测', () => {
  it('用 inference 用量接口探测 Key，只依据状态码（不要求 JSON）', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = []
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: requestUrl(input), init })
      // 探测不解析响应体：即使上游返回 HTML 也不影响判定。
      return new Response('<html>ok</html>', { status: 200 })
    }
    const client = new OpenCodeConsoleClient({ fetchImpl })

    await expect(client.usageProbe('sk-opencode-key')).resolves.toEqual({ ok: true, status: 200 })
    expect(calls[0]?.url).toBe('https://opencode.ai/inference/go/v1/usage')
    expect(calls[0]?.init?.redirect).toBe('error')
    expect(new Headers(calls[0]?.init?.headers).get('authorization')).toBe('Bearer sk-opencode-key')
  })

  it('403 返回 ok:false 与状态码', async () => {
    const fetchImpl: typeof fetch = async () => new Response('', { status: 403 })
    const client = new OpenCodeConsoleClient({ fetchImpl })

    await expect(client.usageProbe('sk-opencode-key')).resolves.toEqual({ ok: false, status: 403 })
  })

  it('网络错误照常上抛，交给调用方决定是否容忍', async () => {
    const fetchImpl: typeof fetch = async () => { throw new TypeError('fetch failed') }
    const client = new OpenCodeConsoleClient({ fetchImpl })

    await expect(client.usageProbe('sk-opencode-key')).rejects.toThrow('请求失败')
  })
})

describe('OpenCode Console 错误与安全边界', () => {
  it('非 2xx 响应带上 HTTP 状态与上游错误码', async () => {
    const fetchImpl: typeof fetch = async () => json({ error: 'server_error' }, 502)
    const client = new OpenCodeConsoleClient({ fetchImpl })

    const error = await client.requestDeviceCode().catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(OpenCodeConsoleError)
    expect((error as OpenCodeConsoleError).status).toBe(502)
    expect((error as OpenCodeConsoleError).code).toBe('server_error')
    expect((error as OpenCodeConsoleError).message).toContain('HTTP 502')
  })

  it('超过体积上限的响应被拒绝，且错误里不含请求凭据', async () => {
    const fetchImpl: typeof fetch = async () => new Response('x'.repeat(OPENCODE_CONSOLE_MAX_RESPONSE_BYTES + 1), {
      status: 200,
    })
    const client = new OpenCodeConsoleClient({ fetchImpl })

    await expect(client.requestDeviceCode()).rejects.toThrow('字节上限')
  })

  it('脱敏函数清掉 Bearer/JWT/表单式 token', () => {
    const redacted = redactMessage(
      'Authorization: Bearer sk-live-secret123456; access_token=plain-token; refresh_token=another '
      + 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature',
    )

    expect(redacted).not.toContain('sk-live-secret123456')
    expect(redacted).not.toContain('plain-token')
    expect(redacted).not.toContain('another')
    expect(redacted).not.toContain('eyJhbGciOiJIUzI1NiJ9')
    expect(redacted).toContain('[redacted')
  })

  it('超时必须是正数', () => {
    expect(() => new OpenCodeConsoleClient({ timeoutMs: 0 })).toThrow(TypeError)
    expect(() => new OpenCodeConsoleClient({ timeoutMs: Number.NaN })).toThrow(TypeError)
  })

  it('拒绝非 http(s) 的 Console 地址', () => {
    expect(() => new OpenCodeConsoleClient({ server: 'ftp://opencode.ai/console' })).toThrow(TypeError)
    expect(() => new OpenCodeConsoleClient({ server: 'not a url' })).toThrow(TypeError)
  })
})
