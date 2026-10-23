/**
 * OpenCode 账号登录编排：设备码登录、API Key 登录、token 刷新与状态机。
 *
 * 这一层只负责「持久化 + 状态」：设备码与 HTTP 细节在
 * `OpenCodeConsoleClient`，凭据文件在 `OpenCodeCredentialStore`。浏览器永远
 * 只看到 {@link OpenCodeAuthStatus}，看不到 token。
 *
 * 两条纪律：
 * - `cancel()` 只中止**本次**未完成的登录，不删除已保存的凭据；
 * - 刷新 token 单飞，并写回上游轮换后的 refresh token。
 *
 * @module dsh-opencode/auth
 */

import {
  isCredentialExpired,
  type OpenCodeAuthStatus,
  type OpenCodeCredentialRecord,
  type OpenCodeLoginChallenge,
} from '../contracts/auth.ts'
import {
  OpenCodeConsoleClient,
  OpenCodeConsoleError,
  redactMessage,
  safeErrorMessage,
  type OpenCodeTokenSet,
} from './console-client.ts'
import type { OpenCodeCredentialStore } from './credentials.ts'

/** 登录服务的依赖。 */
export interface OpenCodeAuthServiceOptions {
  store: OpenCodeCredentialStore
  client?: OpenCodeConsoleClient
  server?: string
  onCredentialChange?: (record: OpenCodeCredentialRecord | undefined) => void
  logger?: { warn(message: string, error?: unknown): void }
}

interface SignInWaiter {
  resolve(challenge: OpenCodeLoginChallenge): void
  reject(error: unknown): void
}

interface SignInOperation {
  readonly controller: AbortController
  readonly done: Promise<void>
}

/** 把凭据记录投影成浏览器可见的已登录状态。 */
function signedInStatus(record: OpenCodeCredentialRecord): OpenCodeAuthStatus {
  return {
    status: 'signed-in',
    method: record.method,
    ...(record.expiresAt === undefined ? {} : { expiresAt: record.expiresAt }),
    ...(record.accountId === undefined ? {} : { accountId: record.accountId }),
    ...(record.accountEmail === undefined ? {} : { email: record.accountEmail }),
    ...(record.orgId === undefined ? {} : { organizationId: record.orgId }),
    ...(record.orgName === undefined ? {} : { organizationName: record.orgName }),
  }
}

/**
 * 登录服务：设备码流程、API Key 登录与 OAuth 刷新都收敛在同一个状态机。
 *
 * 进程内单实例由 `index.ts` 持有；所有方法都可以被并发调用。
 */
export class OpenCodeAuthService {
  private readonly store: OpenCodeCredentialStore
  private readonly client: OpenCodeConsoleClient
  /** 实际使用的 Console 地址，随凭据一起落盘。 */
  private readonly server: string
  private readonly notifyCredentialChange: ((record: OpenCodeCredentialRecord | undefined) => void) | undefined
  private readonly logger: { warn(message: string, error?: unknown): void } | undefined

  private challenge: OpenCodeLoginChallenge | undefined
  private waiters: SignInWaiter[] = []
  private operation: SignInOperation | undefined
  private signingIn = false
  /** 用户主动取消后由 `cancel()` 独占收尾，避免竞态把状态写成 error。 */
  private cancelled = false
  private failure: string | undefined
  private refreshOperation: Promise<string | undefined> | undefined

  constructor(options: OpenCodeAuthServiceOptions) {
    this.store = options.store
    this.client = options.client ?? new OpenCodeConsoleClient({
      ...(options.server === undefined ? {} : { server: options.server }),
    })
    this.server = this.client.server
    this.notifyCredentialChange = options.onCredentialChange
    this.logger = options.logger
  }

  /**
   * 当前登录状态。
   *
   * 优先反映进行中的登录与最近一次登录失败；其余情况以落盘凭据为准。
   * 读取凭据失败（如权限异常）返回可读的 error 状态而不是把异常抛给路由。
   */
  async status(): Promise<OpenCodeAuthStatus> {
    if (this.signingIn) {
      return this.challenge === undefined
        ? { status: 'signing-in' }
        : { status: 'signing-in', challenge: this.challenge }
    }
    if (this.failure !== undefined) return { status: 'error', message: this.failure }
    let record: OpenCodeCredentialRecord | undefined
    try {
      record = await this.credential()
    } catch (error: unknown) {
      return { status: 'error', message: safeErrorMessage(error) }
    }
    return record === undefined ? { status: 'signed-out' } : signedInStatus(record)
  }

  /**
   * 发起设备码登录。
   *
   * 幂等：已有进行中的登录时返回同一个 challenge（或等待它的第一个 challenge）。
   * 失败时以可读错误 reject，并把状态置为 `error`。
   */
  signIn(): Promise<OpenCodeLoginChallenge> {
    if (this.challenge !== undefined) return Promise.resolve(this.challenge)
    if (this.operation !== undefined) {
      // 上一轮已结束但仍在执行 finally 收尾：让它先清掉，再开新一轮。
      if (!this.signingIn) return this.operation.done.then(() => this.signIn())
    } else {
      this.start()
    }
    if (this.challenge !== undefined) return Promise.resolve(this.challenge)
    return new Promise<OpenCodeLoginChallenge>((resolve, reject) => {
      this.waiters.push({ resolve, reject })
    })
  }

  /**
   * 取消进行中的登录。
   *
   * 只中止轮询、释放等待者；已保存的凭据原样保留——用户放弃的是这次授权，
   * 不是已经登录的账号。
   */
  async cancel(): Promise<void> {
    const operation = this.operation
    this.cancelled = true
    this.signingIn = false
    this.challenge = undefined
    const error = new Error('OpenCode 登录已取消')
    for (const waiter of this.waiters.splice(0)) waiter.reject(error)
    operation?.controller.abort(error)
    await operation?.done.catch(() => undefined)
    this.operation = undefined
    this.failure = undefined
  }

  /** 退出登录：取消未完成的登录并删除凭据。 */
  async signOut(): Promise<void> {
    await this.cancel()
    await this.store.delete()
    this.failure = undefined
    this.challenge = undefined
    this.signingIn = false
    this.notify(undefined)
  }

  /**
   * 以 Console API Key 登录（设备码不可用时的兜底）。
   *
   * **先探测再落盘**：错误 Key 若直接写文件，界面会显示「已登录」，随后目录与
   * 用量全部 401，用户无法判断是 Key 错了还是网络问题。探测走
   * `GET /inference/go/v1/usage`——与真实功能同一条凭据路径。不能用
   * `/api/user` 判定：服务账号 Key 不一定被 Console 会话接口接受。
   *
   * 401/403 判为无效且不写文件；404/5xx 与网络错误可能只是用量接口临时不可
   * 用，仍按有效落盘，只记录日志。账号/组织读取始终是 best-effort。
   */
  async signInWithKey(apiKey: string): Promise<OpenCodeAuthStatus> {
    const key = apiKey.trim()
    if (key.length === 0) throw new TypeError('OpenCode API Key 不能为空')
    if (key.length > 16_384) throw new TypeError('OpenCode API Key 过长')

    let probe: { ok: boolean; status: number } | undefined
    try {
      probe = await this.client.usageProbe(key)
    } catch (error: unknown) {
      // 网络失败不等于 Key 无效：允许落盘，让真正的功能请求暴露问题。
      this.warn('OpenCode API Key 用量探测失败，按有效处理', error)
    }
    if (probe !== undefined && !probe.ok) {
      if (probe.status === 401 || probe.status === 403) {
        throw new Error(`OpenCode API Key 无效或没有 OpenCode Go 访问权限（HTTP ${probe.status}）`)
      }
      // 404/5xx 只说明用量接口不可用，不代表 Key 无效。
      this.warn(`OpenCode API Key 用量探测返回 HTTP ${probe.status}，按有效处理`)
    }

    // 账号/组织是展示信息；失败不阻断登录，也不伪造组织名。
    const user = await this.client.user(key).catch((error: unknown) => {
      this.warn('读取 OpenCode 账号信息失败', error)
      return undefined
    })
    const organizations = await this.client.organizations(key).catch((error: unknown) => {
      this.warn('读取 OpenCode 组织列表失败', error)
      return undefined
    })
    const organization = organizations !== undefined && organizations.length === 1
      ? organizations[0]
      : undefined

    // 探测通过后才结束进行中的设备码登录，避免一次失败的 Key 登录打断它。
    await this.cancel()
    const stored = await this.store.write({
      version: 1,
      method: 'key',
      access: key,
      server: this.server,
      ...(user === undefined ? {} : { accountId: user.id }),
      ...(user?.email === undefined ? {} : { accountEmail: user.email }),
      ...(organization === undefined
        ? {}
        : { orgId: organization.id, orgName: organization.name }),
    })
    this.failure = undefined
    this.notify(stored)
    return this.status()
  }

  /**
   * 返回当前可用的 access token。
   *
   * 未登录返回 undefined。OAuth 凭据过期时单飞刷新；上游判定 refresh token
   * 已作废（`invalid_grant`）时删除凭据并返回 undefined，让 `status()` 回到
   * signed-out，而不是把异常抛进宿主请求链路。
   */
  async accessToken(): Promise<string | undefined> {
    const record = await this.store.read()
    if (record === undefined) return undefined
    if (record.method === 'key') return record.access
    if (!isCredentialExpired(record)) return record.access
    if (record.refresh === undefined) return undefined
    return this.refreshAccessToken(record.refresh)
  }

  /** 当前凭据；目录服务用它读取 `orgId` 与 `server`。 */
  async credential(): Promise<OpenCodeCredentialRecord | undefined> {
    return this.store.read()
  }

  /** 释放进行中的登录；不触碰凭据。 */
  async dispose(): Promise<void> {
    await this.cancel()
  }

  private start(): void {
    const controller = new AbortController()
    this.cancelled = false
    this.failure = undefined
    this.signingIn = true
    this.challenge = undefined
    let operation: SignInOperation
    const done = this.run(controller.signal).then(
      () => { this.finishSignIn() },
      (error: unknown) => { this.failSignIn(error) },
    ).finally(() => {
      if (this.operation === operation) this.operation = undefined
    })
    operation = { controller, done }
    this.operation = operation
  }

  private async run(signal: AbortSignal): Promise<void> {
    const device = await this.client.requestDeviceCode()
    if (signal.aborted) throw signal.reason ?? new Error('OpenCode 登录已取消')
    this.challenge = device.challenge
    for (const waiter of this.waiters.splice(0)) waiter.resolve(device.challenge)

    const tokens = await this.client.pollForToken({
      deviceCode: device.deviceCode,
      signal,
      intervalSeconds: device.challenge.intervalSeconds,
      expiresInSeconds: device.challenge.expiresInSeconds,
    })
    if (signal.aborted) throw signal.reason ?? new Error('OpenCode 登录已取消')

    // 账号/组织是「有更好」的展示信息：失败只记日志，不阻断登录。
    const identity = await this.identify(tokens.access, tokens.orgId)
    if (signal.aborted) throw signal.reason ?? new Error('OpenCode 登录已取消')

    const orgId = identity.orgId ?? tokens.orgId
    const stored = await this.store.write({
      version: 1,
      method: 'oauth',
      access: tokens.access,
      refresh: tokens.refresh,
      expiresAt: tokens.expiresAt,
      server: this.server,
      ...(orgId === undefined ? {} : { orgId }),
      ...(identity.orgName === undefined ? {} : { orgName: identity.orgName }),
      ...(identity.accountId === undefined ? {} : { accountId: identity.accountId }),
      ...(identity.accountEmail === undefined ? {} : { accountEmail: identity.accountEmail }),
    })
    this.challenge = undefined
    this.notify(stored)
  }

  private async identify(access: string, tokenOrgId: string | undefined): Promise<{
    readonly orgId?: string
    readonly orgName?: string
    readonly accountId?: string
    readonly accountEmail?: string
  }> {
    const [user, organizations] = await Promise.all([
      this.client.user(access).catch((error: unknown) => {
        this.warn('读取 OpenCode 账号信息失败', error)
        return undefined
      }),
      this.client.organizations(access).catch((error: unknown) => {
        this.warn('读取 OpenCode 组织列表失败', error)
        return undefined
      }),
    ])
    // token 带 org_id 时以它为准；只有一个组织时才自动选中，多个组织不猜。
    const organization = tokenOrgId !== undefined
      ? organizations?.find(candidate => candidate.id === tokenOrgId)
      : organizations !== undefined && organizations.length === 1
        ? organizations[0]
        : undefined
    const accountEmail = user?.email
    return {
      ...(organization === undefined ? {} : { orgId: organization.id, orgName: organization.name }),
      ...(user === undefined ? {} : { accountId: user.id }),
      ...(accountEmail === undefined ? {} : { accountEmail }),
    }
  }

  private refreshAccessToken(refreshToken: string): Promise<string | undefined> {
    if (this.refreshOperation !== undefined) return this.refreshOperation
    const pending = this.refreshNow(refreshToken).finally(() => {
      if (this.refreshOperation === pending) this.refreshOperation = undefined
    })
    this.refreshOperation = pending
    return pending
  }

  private async refreshNow(refreshToken: string): Promise<string | undefined> {
    let tokens: OpenCodeTokenSet
    try {
      tokens = await this.client.refresh(refreshToken)
    } catch (error: unknown) {
      if (error instanceof OpenCodeConsoleError && error.code === 'invalid_grant') {
        // refresh token 已被上游作废：凭据不可再用，删除并回到未登录态。
        this.warn('OpenCode 凭据已失效，需要重新登录', error)
        await this.store.delete().catch((deleteError: unknown) => {
          this.warn('删除失效的 OpenCode 凭据失败', deleteError)
        })
        this.failure = undefined
        this.challenge = undefined
        this.signingIn = false
        this.notify(undefined)
        return undefined
      }
      throw error
    }

    const current = await this.store.read()
    // 刷新期间被退出登录：不要用旧请求把凭据写回来。
    if (current === undefined) return undefined
    const orgId = tokens.orgId ?? current.orgId
    const stored = await this.store.write({
      version: 1,
      method: 'oauth',
      access: tokens.access,
      refresh: tokens.refresh,
      expiresAt: tokens.expiresAt,
      server: current.server ?? this.server,
      ...(orgId === undefined ? {} : { orgId }),
      ...(current.orgName === undefined ? {} : { orgName: current.orgName }),
      ...(current.accountId === undefined ? {} : { accountId: current.accountId }),
      ...(current.accountEmail === undefined ? {} : { accountEmail: current.accountEmail }),
    })
    this.failure = undefined
    this.notify(stored)
    return stored.access
  }

  private finishSignIn(): void {
    this.signingIn = false
    this.failure = undefined
    this.challenge = undefined
  }

  private failSignIn(error: unknown): void {
    // 取消导致的 rejection 不是错误，由 `cancel()` 收尾。
    if (this.cancelled) return
    this.signingIn = false
    this.challenge = undefined
    const message = redactMessage(safeErrorMessage(error))
    this.failure = message
    for (const waiter of this.waiters.splice(0)) waiter.reject(new Error(message))
  }

  private notify(record: OpenCodeCredentialRecord | undefined): void {
    const callback = this.notifyCredentialChange
    if (callback === undefined) return
    try {
      callback(record)
    } catch (error: unknown) {
      this.warn('通知 OpenCode 凭据变更失败', error)
    }
  }

  private warn(message: string, error?: unknown): void {
    const logger = this.logger
    if (logger === undefined) return
    try {
      if (error === undefined) logger.warn(message)
      else logger.warn(message, error)
    } catch {
      // 日志失败不影响登录主流程。
    }
  }
}
