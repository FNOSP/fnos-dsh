import { describe, expect, it, vi } from 'vitest'
import { ZCodeAuthService } from '../../src/host/auth.ts'
import type { ZCodeCredentialStore } from '../../src/host/credentials.ts'
import type { ZCodeCredentialRecord } from '../../src/contracts/auth.ts'
import type { ZCodeConsoleClient, ZCodeOAuthPoll } from '../../src/host/console-client.ts'

function memoryStore(initial?: ZCodeCredentialRecord): ZCodeCredentialStore & {
  readonly current: () => ZCodeCredentialRecord | undefined
  readonly writes: () => number
} {
  let value = initial
  let writes = 0
  return {
    filename: 'memory',
    read: async () => value,
    write: async (credential: ZCodeCredentialRecord) => {
      value = credential
      writes += 1
      return credential
    },
    delete: async () => { value = undefined },
    current: () => value,
    writes: () => writes,
  } as unknown as ZCodeCredentialStore & {
    readonly current: () => ZCodeCredentialRecord | undefined
    readonly writes: () => number
  }
}

function clientWith(poll: () => Promise<ZCodeOAuthPoll>): ZCodeConsoleClient {
  return {
    initDeviceFlow: async (family: 'bigmodel' | 'zai') => ({
      flowId: `flow-${family}`,
      authorizeUrl: `https://example.test/${family}`,
      expiresAt: Date.now() + 600_000,
      intervalSeconds: 1,
    }),
    pollDeviceFlow: poll,
  } as unknown as ZCodeConsoleClient
}

async function settle(ms = 300): Promise<void> {
  await new Promise(resolve => { setTimeout(resolve, ms) })
}

describe('ZCode 登录服务', () => {
  it('未登录时状态是 signed-out', async () => {
    const auth = new ZCodeAuthService({ store: memoryStore(), client: clientWith(async () => ({ status: 'pending' })) })
    await expect(auth.status()).resolves.toEqual({ status: 'signed-out' })
    auth.dispose()
  })

  it('发起授权后进入 signing-in 并带出授权地址', async () => {
    const auth = new ZCodeAuthService({
      store: memoryStore(),
      client: clientWith(async () => ({ status: 'pending' })),
      generatePollToken: () => 'poll-token',
    })
    const challenge = await auth.login('zai')
    expect(challenge.family).toBe('zai')
    expect(challenge.authorizeUrl).toBe('https://example.test/zai')
    expect(challenge.intervalSeconds).toBe(1)
    const status = await auth.status()
    expect(status.status).toBe('signing-in')
    auth.dispose()
  })

  it('授权 ready 后写入凭据并通知监听者', async () => {
    const store = memoryStore()
    const changed = vi.fn()
    const auth = new ZCodeAuthService({
      store,
      client: clientWith(async () => ({
        status: 'ready',
        zcodeJwt: 'zcode-jwt',
        accessToken: 'maas',
        refreshToken: 'refresh',
        user: { userId: '409', email: 'a@b.c', name: 'Tester' },
      })),
      onCredentialChange: changed,
    })
    await auth.login('bigmodel')
    await settle()
    const saved = store.current()
    expect(saved).toMatchObject({
      version: 1,
      family: 'bigmodel',
      zcodeJwt: 'zcode-jwt',
      accessToken: 'maas',
      refreshToken: 'refresh',
      userId: '409',
      email: 'a@b.c',
    })
    expect(changed).toHaveBeenCalled()
    await expect(auth.zcodeJwt()).resolves.toBe('zcode-jwt')
    await expect(auth.status()).resolves.toMatchObject({ status: 'signed-in', email: 'a@b.c' })
    auth.dispose()
  })

  it('授权失败时把原因留在状态里', async () => {
    const auth = new ZCodeAuthService({
      store: memoryStore(),
      client: clientWith(async () => ({ status: 'failed', message: '用户拒绝授权' })),
    })
    await auth.login('bigmodel')
    await settle()
    const status = await auth.status()
    expect(status).toEqual({ status: 'error', message: '用户拒绝授权' })
    auth.dispose()
  })

  it('重复 login 复用同一个进行中的 flow，不换掉用户已打开的链接', async () => {
    const init = vi.fn(async () => ({
      flowId: 'flow-1',
      authorizeUrl: 'https://example.test/one',
      expiresAt: Date.now() + 600_000,
      intervalSeconds: 1,
    }))
    const auth = new ZCodeAuthService({
      store: memoryStore(),
      client: { initDeviceFlow: init, pollDeviceFlow: async () => ({ status: 'pending' }) } as unknown as ZCodeConsoleClient,
    })
    const first = await auth.login('bigmodel')
    const second = await auth.login('bigmodel')
    expect(init).toHaveBeenCalledTimes(1)
    expect(second.authorizeUrl).toBe(first.authorizeUrl)
    auth.dispose()
  })

  it('取消授权回到未登录状态，不删除已有凭据', async () => {
    const existing: ZCodeCredentialRecord = { version: 1, family: 'bigmodel', zcodeJwt: 'keep-me' }
    const store = memoryStore(existing)
    const auth = new ZCodeAuthService({
      store,
      client: clientWith(async () => ({ status: 'pending' })),
    })
    await auth.login('bigmodel')
    auth.cancel()
    await expect(auth.status()).resolves.toMatchObject({ status: 'signed-in' })
    expect(store.current()?.zcodeJwt).toBe('keep-me')
    auth.dispose()
  })

  it('退出登录删除凭据并回到未登录', async () => {
    const store = memoryStore({ version: 1, family: 'bigmodel', zcodeJwt: 'jwt' })
    const changed = vi.fn()
    const auth = new ZCodeAuthService({
      store,
      client: clientWith(async () => ({ status: 'pending' })),
      onCredentialChange: changed,
    })
    await auth.logout()
    expect(store.current()).toBeUndefined()
    await expect(auth.status()).resolves.toEqual({ status: 'signed-out' })
    expect(changed).toHaveBeenCalled()
    auth.dispose()
  })

  it('凭据过期时不再提供 JWT', async () => {
    const auth = new ZCodeAuthService({
      store: memoryStore({
        version: 1,
        family: 'bigmodel',
        zcodeJwt: 'jwt',
        expiresAt: 5_000,
      }),
      client: clientWith(async () => ({ status: 'pending' })),
      now: () => 10_000,
    })
    await expect(auth.zcodeJwt()).resolves.toBeUndefined()
    auth.dispose()
  })

  it('轮询失败不会把凭据写成半成品', async () => {
    const store = memoryStore()
    const auth = new ZCodeAuthService({
      store,
      client: clientWith(async () => ({ status: 'ready', zcodeJwt: '' })),
    })
    await auth.login('bigmodel')
    await settle()
    expect(store.current()).toBeUndefined()
    auth.dispose()
  })
})
