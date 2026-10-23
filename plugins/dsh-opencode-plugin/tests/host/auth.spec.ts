import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenCodeAuthService } from '../../src/host/auth.ts'
import { OpenCodeConsoleClient } from '../../src/host/console-client.ts'
import { OpenCodeCredentialStore } from '../../src/host/credentials.ts'
import type {
  OpenCodeAuthStatus,
  OpenCodeCredentialRecord,
} from '../../src/contracts/auth.ts'

const DEVICE_RESPONSE = {
  device_code: 'device-1',
  user_code: 'USER-1',
  verification_uri_complete: '/console/device?user_code=USER-1&client_id=opencode-cli',
  expires_in: 600,
  interval: 30,
}

const TOKEN_RESPONSE = {
  access_token: 'access-1',
  refresh_token: 'refresh-1',
  expires_in: 3600,
  org_id: 'org-1',
}

const EXPIRED_CREDENTIAL: OpenCodeCredentialRecord = {
  version: 1,
  method: 'oauth',
  access: 'old-access',
  refresh: 'refresh-1',
  expiresAt: Date.now() - 60_000,
  server: 'https://opencode.ai/console',
  orgId: 'org-1',
  orgName: 'Team One',
  accountId: 'user-1',
  accountEmail: 'dev@example.com',
}

interface ConsoleRoutes {
  device?: () => Response
  token?: (body: Record<string, unknown>, call: number) => Response | Promise<Response>
  user?: () => Response
  organizations?: () => Response
  usage?: () => Response
}

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

function pending(): Response {
  return json({ error: 'authorization_pending' }, 400)
}

function consoleFetch(routes: ConsoleRoutes = {}): {
  fetchImpl: typeof fetch
  urls: string[]
  deviceCalls: () => number
  tokenCalls: () => number
  usageCalls: () => number
} {
  let deviceCalls = 0
  let tokenCalls = 0
  let usageCalls = 0
  const urls: string[] = []
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = requestUrl(input)
    urls.push(url)
    if (url.endsWith('/auth/device/code')) {
      deviceCalls += 1
      return routes.device === undefined ? json(DEVICE_RESPONSE) : routes.device()
    }
    if (url.endsWith('/auth/device/token')) {
      tokenCalls += 1
      const body = requestJson(init)
      return routes.token === undefined ? json(TOKEN_RESPONSE) : routes.token(body, tokenCalls)
    }
    if (url.endsWith('/go/v1/usage')) {
      usageCalls += 1
      return routes.usage === undefined ? json({ usage: {} }) : routes.usage()
    }
    if (url.endsWith('/api/user')) {
      return routes.user === undefined ? json({ id: 'user-1', email: 'dev@example.com' }) : routes.user()
    }
    if (url.endsWith('/api/orgs')) {
      return routes.organizations === undefined
        ? json([{ id: 'org-1', name: 'Team One' }])
        : routes.organizations()
    }
    throw new Error(`未预期的请求：${url}`)
  }
  return {
    fetchImpl,
    urls,
    deviceCalls: () => deviceCalls,
    tokenCalls: () => tokenCalls,
    usageCalls: () => usageCalls,
  }
}

const temporaryDirectories: string[] = []

async function temporaryStore(): Promise<OpenCodeCredentialStore> {
  const directory = await mkdtemp(join(import.meta.dirname, 'tmp-auth-'))
  temporaryDirectories.push(directory)
  return new OpenCodeCredentialStore(join(directory, 'auth.json'))
}

async function waitForStatus(
  auth: OpenCodeAuthService,
  expected: OpenCodeAuthStatus['status'],
): Promise<OpenCodeAuthStatus> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const status = await auth.status()
    if (status.status === expected) return status
    await new Promise(resolve => setTimeout(resolve, 2))
  }
  throw new Error(`OpenCode 登录状态未变成 ${expected}`)
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })),
  )
})

describe('OpenCode 设备码登录', () => {
  it('登录成功后写入 oauth 凭据并填充账号与组织', async () => {
    const store = await temporaryStore()
    const { fetchImpl } = consoleFetch()
    const changes: Array<OpenCodeCredentialRecord | undefined> = []
    const auth = new OpenCodeAuthService({
      store,
      client: new OpenCodeConsoleClient({ fetchImpl }),
      onCredentialChange: record => changes.push(record),
    })

    const challenge = await auth.signIn()
    expect(challenge).toEqual({
      userCode: 'USER-1',
      verificationUri: 'https://opencode.ai/console/device?user_code=USER-1&client_id=opencode-cli',
      expiresInSeconds: 600,
      intervalSeconds: 30,
    })

    const status = await waitForStatus(auth, 'signed-in')
    expect(status).toMatchObject({
      status: 'signed-in',
      method: 'oauth',
      accountId: 'user-1',
      email: 'dev@example.com',
      organizationId: 'org-1',
      organizationName: 'Team One',
    })
    const record = await auth.credential()
    expect(record).toMatchObject({
      method: 'oauth',
      access: 'access-1',
      refresh: 'refresh-1',
      orgId: 'org-1',
      orgName: 'Team One',
      accountId: 'user-1',
      accountEmail: 'dev@example.com',
      server: 'https://opencode.ai/console',
    })
    expect(await auth.accessToken()).toBe('access-1')
    expect(changes).toHaveLength(1)
    expect(changes[0]?.access).toBe('access-1')
  })

  it('账号/组织读取失败不阻断登录', async () => {
    const store = await temporaryStore()
    const { fetchImpl } = consoleFetch({
      token: async () => json({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600 }),
      user: () => json({ error: 'server_error' }, 500),
      organizations: () => json({ error: 'server_error' }, 500),
    })
    const logger = { warn: vi.fn() }
    const auth = new OpenCodeAuthService({
      store,
      client: new OpenCodeConsoleClient({ fetchImpl }),
      logger,
    })

    await auth.signIn()
    await waitForStatus(auth, 'signed-in')

    const record = await auth.credential()
    expect(record?.access).toBe('access-1')
    expect(record?.accountId).toBeUndefined()
    expect(record?.orgId).toBeUndefined()
    expect(logger.warn).toHaveBeenCalled()
  })

  it('signIn 幂等：进行中的登录返回同一个 challenge', async () => {
    const store = await temporaryStore()
    const { fetchImpl, deviceCalls } = consoleFetch({ token: () => pending() })
    const auth = new OpenCodeAuthService({
      store,
      client: new OpenCodeConsoleClient({ fetchImpl }),
    })

    const first = await auth.signIn()
    const second = await auth.signIn()

    expect(second).toBe(first)
    expect(deviceCalls()).toBe(1)
    expect(await auth.status()).toMatchObject({ status: 'signing-in', challenge: first })

    await auth.cancel()
    expect((await auth.status()).status).toBe('signed-out')
  })

  it('取消未完成的登录不会删除已保存的凭据', async () => {
    const store = await temporaryStore()
    await store.write(EXPIRED_CREDENTIAL)
    const { fetchImpl } = consoleFetch({ token: () => pending() })
    const auth = new OpenCodeAuthService({
      store,
      client: new OpenCodeConsoleClient({ fetchImpl }),
    })

    await auth.signIn()
    await auth.cancel()

    expect((await store.read())?.access).toBe('old-access')
    expect((await auth.status()).status).toBe('signed-in')
  })

  it('退出登录删除凭据并回到未登录', async () => {
    const store = await temporaryStore()
    await store.write(EXPIRED_CREDENTIAL)
    const auth = new OpenCodeAuthService({
      store,
      client: new OpenCodeConsoleClient({ fetchImpl: consoleFetch().fetchImpl }),
    })

    await auth.signOut()

    await expect(store.read()).resolves.toBeUndefined()
    expect((await auth.status()).status).toBe('signed-out')
  })

  it('设备码请求失败进入 error 状态，取消后回到未登录', async () => {
    const store = await temporaryStore()
    const { fetchImpl } = consoleFetch({ device: () => json({ error: 'server_error' }, 500) })
    const auth = new OpenCodeAuthService({
      store,
      client: new OpenCodeConsoleClient({ fetchImpl }),
    })

    await expect(auth.signIn()).rejects.toThrow('设备码请求失败')
    const status = await auth.status()
    expect(status.status).toBe('error')
    if (status.status === 'error') expect(status.message).toContain('HTTP 500')

    await auth.cancel()
    expect((await auth.status()).status).toBe('signed-out')
  })
})

describe('OpenCode API Key 登录', () => {
  it('先用用量接口探测，成功后再落盘并填充账号与组织', async () => {
    const store = await temporaryStore()
    const seen: string[] = []
    const { fetchImpl, tokenCalls, usageCalls } = consoleFetch({
      user: () => json({ id: 'key-user', email: 'key@example.com' }),
      organizations: () => json([{ id: 'org-9', name: 'Key Org' }]),
    })
    const auth = new OpenCodeAuthService({
      store,
      client: new OpenCodeConsoleClient({
        fetchImpl: async (input, init) => {
          if (requestUrl(input).endsWith('/go/v1/usage')) {
            seen.push(new Headers(init?.headers).get('authorization') ?? '')
          }
          return fetchImpl(input, init)
        },
      }),
    })

    const status = await auth.signInWithKey('  sk-opencode-key  ')

    expect(status).toMatchObject({
      status: 'signed-in',
      method: 'key',
      accountId: 'key-user',
      email: 'key@example.com',
      organizationId: 'org-9',
      organizationName: 'Key Org',
    })
    const record = await auth.credential()
    expect(record).toMatchObject({ method: 'key', access: 'sk-opencode-key' })
    expect(record?.refresh).toBeUndefined()
    expect(record?.expiresAt).toBeUndefined()
    expect(seen).toEqual(['Bearer sk-opencode-key'])
    expect(usageCalls()).toBe(1)
    // Key 登录不经过设备码 token 端点。
    expect(tokenCalls()).toBe(0)
    expect(await auth.accessToken()).toBe('sk-opencode-key')
  })

  it('401 判定 Key 无效，抛可读错误且不写文件', async () => {
    const store = await temporaryStore()
    const { fetchImpl, urls } = consoleFetch({ usage: () => json({ error: 'unauthorized' }, 401) })
    const auth = new OpenCodeAuthService({
      store,
      client: new OpenCodeConsoleClient({ fetchImpl }),
    })

    await expect(auth.signInWithKey('bad-key')).rejects.toThrow('API Key 无效或没有 OpenCode Go 访问权限')

    await expect(store.read()).resolves.toBeUndefined()
    expect((await auth.status()).status).toBe('signed-out')
    // 探测失败后不再读取账号/组织，更不应落盘。
    expect(urls.some(url => url.endsWith('/api/user'))).toBe(false)
    expect(urls.some(url => url.endsWith('/api/orgs'))).toBe(false)
  })

  it('403 同样判定为没有 Go 访问权限且不写文件', async () => {
    const store = await temporaryStore()
    const { fetchImpl, urls } = consoleFetch({ usage: () => json({ error: 'forbidden' }, 403) })
    const auth = new OpenCodeAuthService({
      store,
      client: new OpenCodeConsoleClient({ fetchImpl }),
    })

    await expect(auth.signInWithKey('bad-key')).rejects.toThrow('API Key 无效或没有 OpenCode Go 访问权限')
    await expect(store.read()).resolves.toBeUndefined()
    expect(urls.some(url => url.endsWith('/api/user'))).toBe(false)
  })

  it('探测网络失败仍允许落盘（Key 可能有效）', async () => {
    const store = await temporaryStore()
    const logger = { warn: vi.fn() }
    const { fetchImpl } = consoleFetch({
      usage: () => { throw new TypeError('fetch failed') },
    })
    const auth = new OpenCodeAuthService({
      store,
      client: new OpenCodeConsoleClient({ fetchImpl }),
      logger,
    })

    const status = await auth.signInWithKey('sk-opencode-key')

    expect(status).toMatchObject({ status: 'signed-in', method: 'key', accountId: 'user-1' })
    expect((await store.read())?.access).toBe('sk-opencode-key')
    expect(logger.warn).toHaveBeenCalledWith(
      'OpenCode API Key 用量探测失败，按有效处理',
      expect.anything(),
    )
  })

  it('探测 5xx 仍允许落盘，只记录诊断', async () => {
    const store = await temporaryStore()
    const logger = { warn: vi.fn() }
    const { fetchImpl } = consoleFetch({ usage: () => json({ error: 'unavailable' }, 503) })
    const auth = new OpenCodeAuthService({
      store,
      client: new OpenCodeConsoleClient({ fetchImpl }),
      logger,
    })

    const status = await auth.signInWithKey('sk-opencode-key')

    expect(status.status).toBe('signed-in')
    expect((await store.read())?.access).toBe('sk-opencode-key')
    expect(logger.warn).toHaveBeenCalledWith('OpenCode API Key 用量探测返回 HTTP 503，按有效处理')
  })
})

describe('OpenCode OAuth 刷新', () => {
  it('未登录时 accessToken 返回 undefined', async () => {
    const store = await temporaryStore()
    const auth = new OpenCodeAuthService({
      store,
      client: new OpenCodeConsoleClient({ fetchImpl: consoleFetch().fetchImpl }),
    })

    await expect(auth.accessToken()).resolves.toBeUndefined()
  })

  it('并发刷新单飞，并写回轮换后的 refresh token', async () => {
    const store = await temporaryStore()
    await store.write(EXPIRED_CREDENTIAL)
    const { fetchImpl, tokenCalls } = consoleFetch({
      token: async body => {
        expect(body.grant_type).toBe('refresh_token')
        expect(body.refresh_token).toBe('refresh-1')
        return json({ access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 3600 })
      },
    })
    const changes: Array<OpenCodeCredentialRecord | undefined> = []
    const auth = new OpenCodeAuthService({
      store,
      client: new OpenCodeConsoleClient({ fetchImpl }),
      onCredentialChange: record => changes.push(record),
    })

    const [first, second] = await Promise.all([auth.accessToken(), auth.accessToken()])

    expect(first).toBe('access-2')
    expect(second).toBe('access-2')
    expect(tokenCalls()).toBe(1)
    const record = await store.read()
    expect(record).toMatchObject({
      access: 'access-2',
      refresh: 'refresh-2',
      orgId: 'org-1',
      orgName: 'Team One',
      accountId: 'user-1',
      accountEmail: 'dev@example.com',
      server: 'https://opencode.ai/console',
    })
    expect(record?.expiresAt).toBeGreaterThan(Date.now())
    expect(changes).toHaveLength(1)
    expect(changes[0]?.refresh).toBe('refresh-2')
  })

  it('invalid_grant 删除凭据、通知变更且 status 回到 signed-out', async () => {
    const store = await temporaryStore()
    await store.write(EXPIRED_CREDENTIAL)
    const { fetchImpl } = consoleFetch({ token: () => json({ error: 'invalid_grant' }, 400) })
    const changes: Array<OpenCodeCredentialRecord | undefined> = []
    const logger = { warn: vi.fn() }
    const auth = new OpenCodeAuthService({
      store,
      client: new OpenCodeConsoleClient({ fetchImpl }),
      onCredentialChange: record => changes.push(record),
      logger,
    })

    await expect(auth.accessToken()).resolves.toBeUndefined()

    await expect(store.read()).resolves.toBeUndefined()
    expect((await auth.status()).status).toBe('signed-out')
    expect(changes).toEqual([undefined])
    expect(logger.warn).toHaveBeenCalled()
  })

  it('刷新遇到网络错误时上抛且不删除凭据', async () => {
    const store = await temporaryStore()
    await store.write(EXPIRED_CREDENTIAL)
    const { fetchImpl } = consoleFetch({ token: () => json({ error: 'server_error' }, 503) })
    const auth = new OpenCodeAuthService({
      store,
      client: new OpenCodeConsoleClient({ fetchImpl }),
    })

    await expect(auth.accessToken()).rejects.toThrow('HTTP 503')
    expect((await store.read())?.access).toBe('old-access')
    expect((await auth.status()).status).toBe('signed-in')
  })
})
