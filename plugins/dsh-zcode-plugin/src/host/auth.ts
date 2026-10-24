/**
 * ZCode 账号登录（OAuth 设备授权）与凭据生命周期。
 *
 * 流程与官方 CLI 一致：客户端生成 pollToken → 发起 flow → 浏览器授权 → 轮询
 * 拿 token。轮询是单飞的：设备授权期间浏览器可能多次刷新详情页，每次刷新
 * 都新建一个轮询会把上游打成重复请求，并且可能在拿到结果后互相覆盖。
 *
 * 只提供 OAuth，不提供 API Key 登录：Start Plan 的模型请求只认账号身份。
 *
 * @module dsh-zcode/auth
 */

import { randomBytes } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import {
  isCredentialExpired,
  type ZCodeAuthStatus,
  type ZCodeCredentialRecord,
  type ZCodeLoginChallenge,
} from '../contracts/auth.ts'
import { ZCODE_FAMILY_LABELS, type ZCodeFamily } from '../contracts/identity.ts'
import type { ZCodeConsoleClient } from './console-client.ts'
import type { ZCodeCredentialStore } from './credentials.ts'

/** 单次设备授权的有效期上限（毫秒）；上游 expiration 更大时以本值为准。 */
const MAX_FLOW_TTL_MS = 15 * 60_000

/** 授权服务依赖。 */
export interface ZCodeAuthServiceOptions {
  readonly store: ZCodeCredentialStore
  readonly client: ZCodeConsoleClient
  /** 凭据变化回调：登录成功或退出时触发目录/额度刷新。 */
  readonly onCredentialChange?: () => void
  readonly logger?: Pick<Context['logger'], 'warn' | 'info'>
  /** 便于测试注入稳定的 pollToken 与时钟。 */
  readonly generatePollToken?: () => string
  readonly now?: () => number
}

interface ActiveFlow {
  readonly family: ZCodeFamily
  readonly flowId: string
  readonly pollToken: string
  readonly authorizeUrl: string
  readonly expiresAt: number
  readonly intervalSeconds: number
  timer?: ReturnType<typeof setInterval>
}

/** 登录服务。 */
export class ZCodeAuthService {
  private readonly options: ZCodeAuthServiceOptions
  private cached: ZCodeCredentialRecord | undefined
  private loaded = false
  private flow: ActiveFlow | undefined
  private lastError: string | undefined
  private readonly listeners = new Set<() => void>()

  constructor(options: ZCodeAuthServiceOptions) {
    this.options = options
  }

  private get now(): number {
    return this.options.now?.() ?? Date.now()
  }

  /** 订阅凭据变化；返回退订函数。 */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    for (const listener of this.listeners) {
      try {
        listener()
      } catch (error) {
        this.options.logger?.warn('dsh-zcode: 凭据监听器失败', error)
      }
    }
  }

  /** 读取凭据（首次读磁盘，之后走内存缓存）。 */
  async credential(): Promise<ZCodeCredentialRecord | undefined> {
    if (this.loaded) return this.cached
    this.cached = await this.options.store.read()
    this.loaded = true
    return this.cached
  }

  /** 当前可用于请求的 ZCode JWT；未登录或已过期时返回 undefined。 */
  async zcodeJwt(): Promise<string | undefined> {
    const record = await this.credential()
    if (record === undefined) return undefined
    if (isCredentialExpired(record, this.now)) {
      this.options.logger?.warn('dsh-zcode: 账号凭据已过期，请重新登录')
      return undefined
    }
    return record.zcodeJwt
  }

  /** 浏览器可见的登录状态（不含任何 token）。 */
  async status(): Promise<ZCodeAuthStatus> {
    if (this.flow !== undefined) {
      return {
        status: 'signing-in',
        challenge: this.challengeOf(this.flow),
      }
    }
    if (this.lastError !== undefined) {
      return { status: 'error', message: this.lastError }
    }
    const record = await this.credential()
    if (record === undefined) return { status: 'signed-out' }
    return {
      status: 'signed-in',
      family: record.family,
      ...(record.userId === undefined ? {} : { userId: record.userId }),
      ...(record.email === undefined ? {} : { email: record.email }),
      ...(record.name === undefined ? {} : { name: record.name }),
      ...(record.avatar === undefined ? {} : { avatar: record.avatar }),
    }
  }

  private challengeOf(flow: ActiveFlow): ZCodeLoginChallenge {
    return {
      family: flow.family,
      authorizeUrl: flow.authorizeUrl,
      expiresInSeconds: Math.max(0, Math.round((flow.expiresAt - this.now) / 1000)),
      intervalSeconds: flow.intervalSeconds,
    }
  }

  /**
   * 开始设备授权。
   *
   * 已有进行中的 flow 时直接返回它——浏览器刷新页面不该把用户已打开授权页
   * 的链接换成新的（旧链接会失效）。
   */
  async login(family: ZCodeFamily): Promise<ZCodeLoginChallenge> {
    if (this.flow !== undefined && this.flow.family === family && this.flow.expiresAt > this.now) {
      return this.challengeOf(this.flow)
    }
    if (this.flow !== undefined) this.clearFlow()

    this.lastError = undefined
    const pollToken = this.options.generatePollToken?.() ?? randomBytes(32).toString('hex')
    const init = await this.options.client.initDeviceFlow(family, pollToken)
    const expiresAt = Math.min(init.expiresAt, this.now + MAX_FLOW_TTL_MS)
    const flow: ActiveFlow = {
      family,
      flowId: init.flowId,
      pollToken,
      authorizeUrl: init.authorizeUrl,
      expiresAt,
      intervalSeconds: init.intervalSeconds,
    }
    this.flow = flow
    this.startPolling(flow)
    this.emit()
    return this.challengeOf(flow)
  }

  private startPolling(flow: ActiveFlow): void {
    const intervalMs = Math.max(1, flow.intervalSeconds) * 1000
    flow.timer = setInterval(() => {
      void this.pollOnce(flow).catch(error => {
        this.options.logger?.warn('dsh-zcode: 授权轮询失败', error)
      })
    }, intervalMs)
    // 轮询定时器不应单独撑住宿主进程退出。
    flow.timer.unref?.()
    // 先立即试一次：上游 flow 可能已经被其它标签页完成。
    void this.pollOnce(flow).catch(() => undefined)
  }

  private async pollOnce(flow: ActiveFlow): Promise<void> {
    if (this.flow !== flow) return
    if (flow.expiresAt <= this.now) {
      this.lastError = `${ZCODE_FAMILY_LABELS[flow.family]} 授权已超时，请重新发起`
      this.clearFlow()
      this.emit()
      return
    }
    const result = await this.options.client.pollDeviceFlow(flow.family, flow.flowId, flow.pollToken)
    if (this.flow !== flow) return
    if (result.status === 'pending') return
    if (result.status === 'failed') {
      this.lastError = result.message
      this.clearFlow()
      this.emit()
      return
    }
    // 上游偶尔在 ready 里给出空 token；落盘会写出一份无法使用的凭据，让之后
    // 每次请求都带着空 key 打到网关。宁可报错让用户重试。
    if (result.zcodeJwt.trim().length === 0) {
      this.lastError = `${ZCODE_FAMILY_LABELS[flow.family]} 授权成功但未返回有效凭据，请重试`
      this.clearFlow()
      this.emit()
      return
    }
    const credential: ZCodeCredentialRecord = {
      version: 1,
      family: flow.family,
      zcodeJwt: result.zcodeJwt,
      ...(result.accessToken === undefined ? {} : { accessToken: result.accessToken }),
      ...(result.refreshToken === undefined ? {} : { refreshToken: result.refreshToken }),
      ...(result.expiresAt === undefined ? {} : { expiresAt: result.expiresAt }),
      ...(result.user?.userId === undefined ? {} : { userId: result.user.userId }),
      ...(result.user?.email === undefined ? {} : { email: result.user.email }),
      ...(result.user?.name === undefined ? {} : { name: result.user.name }),
      ...(result.user?.avatar === undefined ? {} : { avatar: result.user.avatar }),
    }
    this.cached = await this.options.store.write(credential)
    this.loaded = true
    this.clearFlow()
    this.options.logger?.info(`dsh-zcode: ${ZCODE_FAMILY_LABELS[flow.family]} 账号登录成功`)
    this.emit()
    this.options.onCredentialChange?.()
  }

  private clearFlow(): void {
    if (this.flow?.timer !== undefined) clearInterval(this.flow.timer)
    this.flow = undefined
  }

  /** 取消进行中的授权；已保存的凭据不受影响。 */
  cancel(): void {
    this.clearFlow()
    this.lastError = undefined
    this.emit()
  }

  /** 退出登录：停止轮询并删除凭据。 */
  async logout(): Promise<void> {
    this.clearFlow()
    this.lastError = undefined
    this.cached = undefined
    this.loaded = true
    await this.options.store.delete()
    this.emit()
    this.options.onCredentialChange?.()
  }

  /** 释放定时器（插件卸载时调用）。 */
  dispose(): void {
    this.clearFlow()
    this.listeners.clear()
  }
}
