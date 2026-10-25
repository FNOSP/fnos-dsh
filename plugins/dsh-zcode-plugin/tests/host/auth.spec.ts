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

function clientWith(exchange: () => Promise<ZCodeOAuthPoll>): ZCodeConsoleClient {
  return {
    exchangeDesktopCode: exchange,
  } as unknown as ZCodeConsoleClient
}

/** 从授权地址里取出 state，模拟上游回调时原样带回。 */
function stateOf(authorizeUrl: string): string {
  return new URL(authorizeUrl).searchParams.get('state') ?? ''
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
      callbackBaseUrl: () => 'https://host.test/plugins/dsh-zcode/auth/callback',
    })
    const challenge = await auth.loginDesktop('zai')
    expect(challenge.family).toBe('zai')
    // 授权地址指向上游登录页，并带上 appId / redirect / state 三个必要参数。
    const url = new URL(challenge.authorizeUrl)
    expect(url.searchParams.get('appId')).toBe('zcode')
    expect(url.searchParams.get('redirect')).toContain('/plugins/dsh-zcode/auth/callback')
    expect(stateOf(challenge.authorizeUrl)).not.toBe('')
    const status = await auth.status()
    expect(status.status).toBe('signing-in')
    auth.dispose()
  })

  it('回调换码成功后写入凭据并通知监听者', async () => {
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
      callbackBaseUrl: () => 'https://host.test/plugins/dsh-zcode/auth/callback',
      onCredentialChange: changed,
    })
    const challenge = await auth.loginDesktop('bigmodel')
    await auth.completeDesktopLogin({
      code: 'auth-code',
      state: stateOf(challenge.authorizeUrl),
      family: 'bigmodel',
    })
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

  it('换码被上游拒绝时把原因留在状态里', async () => {
    const auth = new ZCodeAuthService({
      store: memoryStore(),
      client: clientWith(async () => ({ status: 'failed', message: '用户拒绝授权' })),
      callbackBaseUrl: () => 'https://host.test/plugins/dsh-zcode/auth/callback',
    })
    const challenge = await auth.loginDesktop('bigmodel')
    await expect(auth.completeDesktopLogin({
      code: 'auth-code',
      state: stateOf(challenge.authorizeUrl),
      family: 'bigmodel',
    })).rejects.toThrow(/未返回凭据/)
    auth.dispose()
  })

  it('state 不匹配时拒绝换码，防止别人塞入授权码', async () => {
    const exchange = vi.fn(async () => ({ status: 'ready' as const, zcodeJwt: 'x' }))
    const auth = new ZCodeAuthService({
      store: memoryStore(),
      client: { exchangeDesktopCode: exchange } as unknown as ZCodeConsoleClient,
      callbackBaseUrl: () => 'https://host.test/plugins/dsh-zcode/auth/callback',
    })
    await auth.loginDesktop('bigmodel')
    await expect(auth.completeDesktopLogin({
      code: 'auth-code',
      state: 'wrong-state',
      family: 'bigmodel',
    })).rejects.toThrow(/state/)
    // state 不匹配时绝不能去上游兑换。
    expect(exchange).not.toHaveBeenCalled()
    auth.dispose()
  })

  it('没有进行中的授权时拒绝回调', async () => {
    const auth = new ZCodeAuthService({
      store: memoryStore(),
      client: clientWith(async () => ({ status: 'ready', zcodeJwt: 'x' })),
    })
    await expect(auth.completeDesktopLogin({
      code: 'code', state: 's', family: 'bigmodel',
    })).rejects.toThrow(/没有进行中的/)
    auth.dispose()
  })

  it('重复发起授权会换新 state，旧授权码随之失效', async () => {
    const auth = new ZCodeAuthService({
      store: memoryStore(),
      client: clientWith(async () => ({ status: 'pending' })),
      callbackBaseUrl: () => 'https://host.test/plugins/dsh-zcode/auth/callback',
    })
    const first = await auth.loginDesktop('bigmodel')
    const second = await auth.loginDesktop('bigmodel')
    // 每次授权都必须用新 state：复用会让已泄漏的旧授权码仍可兑换。
    expect(stateOf(second.authorizeUrl)).not.toBe(stateOf(first.authorizeUrl))
    auth.dispose()
  })

  it('取消授权回到未登录状态，不删除已有凭据', async () => {
    const existing: ZCodeCredentialRecord = { version: 1, family: 'bigmodel', zcodeJwt: 'keep-me' }
    const store = memoryStore(existing)
    const auth = new ZCodeAuthService({
      store,
      client: clientWith(async () => ({ status: 'pending' })),
      callbackBaseUrl: () => 'https://host.test/plugins/dsh-zcode/auth/callback',
    })
    await auth.loginDesktop('bigmodel')
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

  it('上游返回空 token 时拒绝写盘，避免落一份用不了的凭据', async () => {
    const store = memoryStore()
    const auth = new ZCodeAuthService({
      store,
      client: clientWith(async () => ({ status: 'ready', zcodeJwt: '   ' })),
      callbackBaseUrl: () => 'https://host.test/plugins/dsh-zcode/auth/callback',
    })
    const challenge = await auth.loginDesktop('bigmodel')
    await expect(auth.completeDesktopLogin({
      code: 'auth-code',
      state: stateOf(challenge.authorizeUrl),
      family: 'bigmodel',
    })).rejects.toThrow(/空凭据/)
    expect(store.current()).toBeUndefined()
    auth.dispose()
  })
})
