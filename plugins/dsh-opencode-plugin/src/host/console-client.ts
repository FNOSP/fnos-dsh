/**
 * OpenCode Console 的 HTTP 客户端：设备码登录、token 刷新与身份查询。
 *
 * 契约与 opencode CLI 完全一致：设备码请求 → 按 RFC 8628 轮询 token →
 * （可选）读取账号与组织。所有请求都带超时、禁止重定向、限制响应体积，
 * 错误文案里只保留状态码与上游错误码，绝不出现 token 原文。
 *
 * @module dsh-opencode/console-client
 */

import type { OpenCodeLoginChallenge } from '../contracts/auth.ts'
import {
  OPENCODE_CONSOLE_ORIGIN,
  OPENCODE_DEVICE_CLIENT_ID,
  OPENCODE_GO_USAGE_URL,
} from '../contracts/identity.ts'

/** 单次请求的默认超时（毫秒）。 */
export const OPENCODE_CONSOLE_TIMEOUT_MS = 15_000

/** 响应体上限：Console 只返回小体积 JSON，超过即视为异常。 */
export const OPENCODE_CONSOLE_MAX_RESPONSE_BYTES = 1024 * 1024

/** 设备授权接口的相对路径。 */
const DEVICE_CODE_PATH = '/auth/device/code'
const DEVICE_TOKEN_PATH = '/auth/device/token'
const USER_PATH = '/api/user'
const ORGS_PATH = '/api/orgs'

/** RFC 8628 的设备码授权类型。 */
const DEVICE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code'
const REFRESH_GRANT_TYPE = 'refresh_token'

/** 上游缺省值：设备码 10 分钟、轮询 5 秒（与 opencode CLI 的默认一致）。 */
const DEFAULT_DEVICE_CODE_TTL_SECONDS = 600
const DEFAULT_POLL_INTERVAL_SECONDS = 5
/** `slow_down` 时每个周期增加的秒数（RFC 8628 规定 5 秒）。 */
const SLOW_DOWN_STEP_SECONDS = 5

/** 设备码请求的返回：一次性设备码 + 交给浏览器展示的挑战。 */
export interface OpenCodeDeviceCode {
  readonly deviceCode: string
  readonly challenge: OpenCodeLoginChallenge
}

/** token 端点返回的凭据集合（`expiresAt` 已换算成 epoch 毫秒）。 */
export interface OpenCodeTokenSet {
  readonly access: string
  readonly refresh: string
  readonly expiresAt: number
  readonly orgId?: string
}

/** Console 账号信息。 */
export interface OpenCodeConsoleUser {
  readonly id: string
  readonly email?: string
}

/** Console 组织信息。 */
export interface OpenCodeConsoleOrganization {
  readonly id: string
  readonly name: string
}

/** 客户端依赖注入与覆盖项。 */
export interface OpenCodeConsoleClientOptions {
  readonly fetchImpl?: typeof fetch
  /** Console 根地址；默认 {@link OPENCODE_CONSOLE_ORIGIN}。 */
  readonly server?: string
  /** 单次请求超时（毫秒）；默认 {@link OPENCODE_CONSOLE_TIMEOUT_MS}。 */
  readonly timeoutMs?: number
}

/**
 * 带上游错误码的 Console 错误。
 *
 * 轮询与刷新都需要按 `error` 字段分支（`authorization_pending`、`slow_down`、
 * `invalid_grant`），所以错误码必须结构化保留，而不是塞进文案再解析。
 */
export class OpenCodeConsoleError extends Error {
  readonly code: string | undefined
  readonly status: number | undefined

  constructor(message: string, details: { readonly code?: string; readonly status?: number } = {}) {
    super(message)
    this.name = 'OpenCodeConsoleError'
    this.code = details.code
    this.status = details.status
  }
}

/** 去掉尾部斜杠并校验 Console 地址；只接受 http(s) 且不允许带凭据。 */
export function normalizeConsoleServer(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new TypeError('OpenCode Console 地址不是合法 URL')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new TypeError('OpenCode Console 地址必须使用 http 或 https')
  }
  if (url.username !== '' || url.password !== '') {
    throw new TypeError('OpenCode Console 地址不得包含凭据')
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/u, '')
}

/** 错误对象的安全文案（不含 token）。 */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 脱敏错误文案：Bearer token、JWT、API Key 与表单式 token 参数都替换掉。
 *
 * 主防线仍是「不把 token 拼进文案」；这里兜住上游异常对象、URL 与第三方库
 * 自带信息里夹带的凭据，风格与 Codex Auth 插件一致。
 */
export function redactMessage(message: string): string {
  return message
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, '[redacted token]')
    .replace(/\bBearer\s+[a-z0-9._~+/=-]+/giu, 'Bearer [redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gu, '[redacted token]')
    .replace(/(\b(?:access_token|refresh_token|device_code|api[_-]?key|token|code)=)[^&\s]+/giu, '$1[redacted]')
    .slice(0, 1000)
}

/** 错误对象的安全文案（先取 message 再脱敏）。 */
export function safeErrorMessage(error: unknown): string {
  return redactMessage(describeError(error))
}

function wireRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

/** 接受数字或数字字符串的正有限数；其余一律 undefined。 */
function positiveNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim().length > 0
      ? Number(value)
      : undefined
  return parsed !== undefined && Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

/** 上游 error 字段可能是字符串或 `{ code }` 对象。 */
function wireErrorCode(value: unknown): string | undefined {
  const body = wireRecord(value)
  if (body === undefined) return undefined
  const error = body.error
  if (typeof error === 'string' && error.length > 0) return error
  const nested = wireRecord(error)
  const nestedCode = nonEmptyString(nested?.code)
  if (nestedCode !== undefined) return nestedCode
  return nonEmptyString(body.code)
}

/**
 * 读取响应体并限制体积。
 *
 * 先看 `content-length` 快速拒绝，再按流累计；超限时取消读取，避免一个异常
 * 响应把宿主内存拖垮。
 */
export async function readBoundedBody(response: Response, maxBytes: number): Promise<string> {
  const declared = response.headers.get('content-length')
  if (declared !== null) {
    const size = Number(declared)
    if (Number.isFinite(size) && size > maxBytes) {
      throw new OpenCodeConsoleError(`OpenCode Console 响应超过 ${maxBytes} 字节上限`)
    }
  }
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw new OpenCodeConsoleError(`OpenCode Console 响应超过 ${maxBytes} 字节上限`)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  if (chunks.length === 0) return ''
  return new TextDecoder().decode(Buffer.concat(chunks.map(chunk => Buffer.from(chunk))))
}

/** 把上游的相对验证地址解析成基于 server origin 的绝对地址。 */
function absoluteVerificationUri(raw: string, server: string): string {
  let url: URL
  try {
    url = new URL(raw, `${server}/`)
  } catch {
    throw new OpenCodeConsoleError('OpenCode Console 返回的验证地址无效')
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username !== '' || url.password !== '') {
    throw new OpenCodeConsoleError('OpenCode Console 返回的验证地址不安全')
  }
  return url.href
}

/** 解析 token 响应；刷新响应缺省 refresh_token 时沿用旧值。 */
function parseTokenSet(value: unknown, now: number, fallbackRefresh?: string): OpenCodeTokenSet {
  const body = wireRecord(value)
  if (body === undefined) throw new OpenCodeConsoleError('OpenCode Console token 响应不是对象')
  const access = nonEmptyString(body.access_token)
  if (access === undefined) throw new OpenCodeConsoleError('OpenCode Console token 响应缺少 access_token')
  const refresh = nonEmptyString(body.refresh_token) ?? fallbackRefresh
  if (refresh === undefined) throw new OpenCodeConsoleError('OpenCode Console token 响应缺少 refresh_token')
  const expiresIn = positiveNumber(body.expires_in)
  if (expiresIn === undefined) throw new OpenCodeConsoleError('OpenCode Console token 响应缺少有效的 expires_in')
  const orgId = nonEmptyString(body.org_id)
  return {
    access,
    refresh,
    expiresAt: now + Math.round(expiresIn * 1000),
    ...(orgId === undefined ? {} : { orgId }),
  }
}

function requireAccessToken(access: string): string {
  const token = access.trim()
  if (token.length === 0) throw new TypeError('OpenCode access token 不能为空')
  return token
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw signal.reason ?? new OpenCodeConsoleError('OpenCode 登录已取消')
}

/** 可被 AbortSignal 打断的等待；句柄不阻止宿主退出。 */
function wait(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted === true) {
    return Promise.reject(signal.reason ?? new OpenCodeConsoleError('OpenCode 登录已取消'))
  }
  return new Promise<void>((resolve, reject) => {
    let settled = false
    const settle = (error?: unknown): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      if (error === undefined) resolve()
      else reject(error)
    }
    const onAbort = (): void => {
      settle(signal?.reason ?? new OpenCodeConsoleError('OpenCode 登录已取消'))
    }
    const timer = setTimeout(() => { settle() }, ms)
    timer.unref()
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * OpenCode Console 客户端。
 *
 * 不持有任何状态：设备码、token 与身份都由调用方（`OpenCodeAuthService`）
 * 决定何时读取与落盘。
 */
export class OpenCodeConsoleClient {
  /** 实际使用的 Console 根地址（已去掉尾部斜杠）。 */
  readonly server: string
  /** 单次请求超时（毫秒）。 */
  readonly timeoutMs: number
  private readonly fetchImpl: typeof fetch

  constructor(options: OpenCodeConsoleClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.server = normalizeConsoleServer(options.server ?? OPENCODE_CONSOLE_ORIGIN)
    const timeoutMs = options.timeoutMs ?? OPENCODE_CONSOLE_TIMEOUT_MS
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new TypeError('OpenCode Console 超时必须是正数')
    }
    this.timeoutMs = timeoutMs
  }

  /** 申请设备码，并把相对验证地址解析成绝对地址。 */
  async requestDeviceCode(): Promise<OpenCodeDeviceCode> {
    const { status, value } = await this.requestJson(DEVICE_CODE_PATH, {
      method: 'POST',
      body: { client_id: OPENCODE_DEVICE_CLIENT_ID, supports_org_scope: true },
    })
    if (status < 200 || status >= 300) throw this.failureError('设备码请求', status, value)
    const body = wireRecord(value)
    if (body === undefined) throw new OpenCodeConsoleError('OpenCode Console 设备码响应不是对象')
    const deviceCode = nonEmptyString(body.device_code)
    const userCode = nonEmptyString(body.user_code)
    const verification = nonEmptyString(body.verification_uri_complete)
      ?? nonEmptyString(body.verification_uri)
    if (deviceCode === undefined) throw new OpenCodeConsoleError('OpenCode Console 设备码响应缺少 device_code')
    if (userCode === undefined) throw new OpenCodeConsoleError('OpenCode Console 设备码响应缺少 user_code')
    if (verification === undefined) throw new OpenCodeConsoleError('OpenCode Console 设备码响应缺少验证地址')
    return {
      deviceCode,
      challenge: {
        userCode,
        verificationUri: absoluteVerificationUri(verification, this.server),
        expiresInSeconds: positiveNumber(body.expires_in) ?? DEFAULT_DEVICE_CODE_TTL_SECONDS,
        intervalSeconds: positiveNumber(body.interval) ?? DEFAULT_POLL_INTERVAL_SECONDS,
      },
    }
  }

  /**
   * 轮询 token 端点直到授权完成。
   *
   * `authorization_pending` 继续等待，`slow_down` 按 RFC 8628 增加 5 秒；
   * 其余错误（含 `invalid_grant`、`expired_token`）立即上抛。设备码过期或
   * 外部取消都会结束轮询。
   */
  async pollForToken(input: {
    deviceCode: string
    signal?: AbortSignal
    intervalSeconds?: number
    expiresInSeconds?: number
  }): Promise<OpenCodeTokenSet> {
    const deviceCode = input.deviceCode.trim()
    if (deviceCode.length === 0) throw new TypeError('OpenCode 设备码不能为空')
    const expiresInSeconds = input.expiresInSeconds ?? DEFAULT_DEVICE_CODE_TTL_SECONDS
    if (!Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0) {
      throw new TypeError('OpenCode 设备码有效期必须是正数')
    }
    let intervalSeconds = input.intervalSeconds ?? DEFAULT_POLL_INTERVAL_SECONDS
    if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) {
      throw new TypeError('OpenCode 轮询间隔必须是正数')
    }
    // 下限 1 秒：上游异常返回 0 时不能变成忙等。
    intervalSeconds = Math.max(1, intervalSeconds)
    const deadline = Date.now() + expiresInSeconds * 1000

    for (;;) {
      throwIfAborted(input.signal)
      if (Date.now() >= deadline) throw new OpenCodeConsoleError('OpenCode 设备码已过期，请重新发起登录')
      try {
        return await this.requestToken({
          grant_type: DEVICE_GRANT_TYPE,
          device_code: deviceCode,
          client_id: OPENCODE_DEVICE_CLIENT_ID,
        }, input.signal)
      } catch (error: unknown) {
        if (!(error instanceof OpenCodeConsoleError)) throw error
        if (error.code === 'slow_down') {
          intervalSeconds += SLOW_DOWN_STEP_SECONDS
        } else if (error.code !== 'authorization_pending') {
          throw error
        }
      }
      const remaining = deadline - Date.now()
      if (remaining <= 0) throw new OpenCodeConsoleError('OpenCode 设备码已过期，请重新发起登录')
      await wait(Math.min(intervalSeconds * 1000, remaining), input.signal)
    }
  }

  /**
   * 用 refresh token 换新凭据。
   *
   * 400 + `invalid_grant` 由调用方识别为「需要重新登录」；这里只保证错误码
   * 结构化可读。
   */
  async refresh(refreshToken: string): Promise<OpenCodeTokenSet> {
    const token = refreshToken.trim()
    if (token.length === 0) throw new TypeError('OpenCode refresh token 不能为空')
    const { status, value } = await this.requestJson(DEVICE_TOKEN_PATH, {
      method: 'POST',
      body: {
        grant_type: REFRESH_GRANT_TYPE,
        refresh_token: token,
        client_id: OPENCODE_DEVICE_CLIENT_ID,
      },
    })
    if (status < 200 || status >= 300) throw this.failureError('token 刷新请求', status, value)
    return parseTokenSet(value, Date.now(), token)
  }

  /** 读取 Console 账号；`id` 缺失视为上游格式漂移。 */
  async user(access: string): Promise<OpenCodeConsoleUser> {
    const { status, value } = await this.requestJson(USER_PATH, {
      method: 'GET',
      access: requireAccessToken(access),
    })
    if (status < 200 || status >= 300) throw this.failureError('账号信息请求', status, value)
    const body = wireRecord(value)
    if (body === undefined) throw new OpenCodeConsoleError('OpenCode Console 账号响应不是对象')
    const id = nonEmptyString(body.id)
    if (id === undefined) throw new OpenCodeConsoleError('OpenCode Console 账号响应缺少 id')
    const email = nonEmptyString(body.email)
    return email === undefined ? { id } : { id, email }
  }

  /** 读取 Console 组织列表；无法识别的条目跳过，不伪造组织名。 */
  async organizations(access: string): Promise<OpenCodeConsoleOrganization[]> {
    const { status, value } = await this.requestJson(ORGS_PATH, {
      method: 'GET',
      access: requireAccessToken(access),
    })
    if (status < 200 || status >= 300) throw this.failureError('组织列表请求', status, value)
    if (!Array.isArray(value)) throw new OpenCodeConsoleError('OpenCode Console 组织响应不是数组')
    const organizations: OpenCodeConsoleOrganization[] = []
    for (const entry of value) {
      const item = wireRecord(entry)
      const id = nonEmptyString(item?.id)
      const name = nonEmptyString(item?.name)
      if (id === undefined || name === undefined) continue
      if (organizations.some(organization => organization.id === id)) continue
      organizations.push({ id, name })
    }
    return organizations
  }

  /**
   * 用用量接口探测凭据是否可用于 OpenCode Go。
   *
   * 服务账号 API Key 不一定被 Console 会话接口（`/api/user`）接受，因此不能
   * 用后者判断 Key 有效性——这会把「有效但无 Console 会话」的 Key 误判为无效。
   * 这里与真实用量请求走同一条凭据路径，只看 HTTP 状态，不要求响应体是 JSON；
   * 网络错误照常抛出，由调用方决定是否可以容忍。
   */
  async usageProbe(access: string): Promise<{ ok: boolean; status: number }> {
    const { status } = await this.requestUrl(OPENCODE_GO_USAGE_URL, {
      method: 'GET',
      access: requireAccessToken(access),
      parseJson: false,
    })
    return { ok: status >= 200 && status < 300, status }
  }

  /** 构造带状态码与上游错误码的错误。 */
  private failureError(label: string, status: number, value: unknown): OpenCodeConsoleError {
    const code = wireErrorCode(value)
    return new OpenCodeConsoleError(
      code === undefined
        ? `OpenCode Console ${label}失败（HTTP ${status}）`
        : `OpenCode Console ${label}失败（HTTP ${status}，${code}）`,
      { status, ...(code === undefined ? {} : { code }) },
    )
  }

  /** token 端点：成功返回凭据，待授权/降速以结构化错误码上抛。 */
  private async requestToken(body: Record<string, unknown>, signal?: AbortSignal): Promise<OpenCodeTokenSet> {
    const { status, value } = await this.requestJson(DEVICE_TOKEN_PATH, {
      method: 'POST',
      body,
      ...(signal === undefined ? {} : { signal }),
    })
    if (status >= 200 && status < 300) return parseTokenSet(value, Date.now())
    throw this.failureError('token 请求', status, value)
  }

  /** 发起一次 Console 相对路径请求。 */
  private requestJson(
    path: string,
    init: {
      readonly method: 'GET' | 'POST'
      readonly body?: unknown
      readonly access?: string
      readonly signal?: AbortSignal
    },
  ): Promise<{ readonly status: number; readonly value: unknown }> {
    return this.requestUrl(`${this.server}${path}`, init)
  }

  /** 发起一次 JSON 请求：超时、禁止重定向、限制响应体。 */
  private async requestUrl(
    url: string,
    init: {
      readonly method: 'GET' | 'POST'
      readonly body?: unknown
      readonly access?: string
      readonly signal?: AbortSignal
      /** false 时跳过 JSON 解析，只返回状态码（探测用）。 */
      readonly parseJson?: boolean
    },
  ): Promise<{ readonly status: number; readonly value: unknown }> {
    const headers: Record<string, string> = { accept: 'application/json' }
    if (init.body !== undefined) headers['content-type'] = 'application/json'
    if (init.access !== undefined) headers.authorization = `Bearer ${init.access}`
    const timeout = AbortSignal.timeout(this.timeoutMs)
    const signal = init.signal === undefined ? timeout : AbortSignal.any([init.signal, timeout])
    let response: Response
    try {
      response = await this.fetchImpl(url, {
        method: init.method,
        redirect: 'error',
        headers,
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        signal,
      })
    } catch (error: unknown) {
      if (timeout.aborted) throw new OpenCodeConsoleError(`OpenCode Console 请求超时（${this.timeoutMs}ms）`)
      throw new OpenCodeConsoleError(`OpenCode Console 请求失败：${safeErrorMessage(error)}`)
    }
    let text: string
    try {
      text = await readBoundedBody(response, OPENCODE_CONSOLE_MAX_RESPONSE_BYTES)
    } catch (error: unknown) {
      if (timeout.aborted) throw new OpenCodeConsoleError(`OpenCode Console 响应读取超时（${this.timeoutMs}ms）`)
      throw error instanceof OpenCodeConsoleError
        ? error
        : new OpenCodeConsoleError(`OpenCode Console 响应读取失败：${safeErrorMessage(error)}`)
    }
    let value: unknown
    if (text.trim().length > 0 && init.parseJson !== false) {
      try {
        value = JSON.parse(text)
      } catch {
        throw new OpenCodeConsoleError(`OpenCode Console 响应不是合法 JSON（HTTP ${response.status}）`)
      }
    }
    return { status: response.status, value }
  }
}
