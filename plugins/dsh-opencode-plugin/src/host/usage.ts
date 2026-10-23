/**
 * OpenCode Go 套餐用量：归一化与宿主侧缓存。
 *
 * 上游返回的是「已用百分比 + 重置时间」。接口字段在 Console 的不同部署间
 * 有过漂移（顶层 `windows`、`used_percent`、秒/毫秒时间戳），因此解析是
 * 防御性的；但**缺字段就是缺字段**——不会把没读到的百分比补成 0，也不把
 * 非法响应伪装成合法快照。读取失败抛可读错误，未登录返回 `undefined`。
 *
 * @module dsh-opencode/usage
 */

import { OPENCODE_GO_USAGE_URL } from '../contracts/identity.ts'
import type { OpenCodeUsage, OpenCodeUsageWindow } from '../contracts/usage.ts'
import {
  readBoundedBody,
  redactMessage,
  safeErrorMessage,
} from './console-client.ts'

/** 用量请求超时（毫秒）。 */
export const OPENCODE_USAGE_TIMEOUT_MS = 15_000

/** 用量响应体积上限。 */
export const OPENCODE_USAGE_MAX_RESPONSE_BYTES = 1024 * 1024

/** 默认缓存时长：额度窗口以小时计，1 分钟内重复读取没有意义。 */
export const OPENCODE_USAGE_CACHE_MS = 60_000

/** 三个额度窗口在响应里的键名。 */
type WindowKey = 'rolling' | 'weekly' | 'monthly'

/** 中文标签，用于错误文案。 */
const WINDOW_LABELS: Readonly<Record<WindowKey, string>> = {
  rolling: '5 小时滚动',
  weekly: '每周',
  monthly: '每月',
}

function wireRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

/** 接受数字或数字字符串的有限数；其余一律 undefined。 */
function finiteNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim().length > 0
      ? Number(value)
      : undefined
  return parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined
}

/**
 * 归一化窗口状态。
 *
 * 上游通常返回 `ok`/`rate-limited`；缺失时按已用百分比推断（100% 即受限），
 * 但出现无法识别的状态字符串就报错——这通常意味着契约变了。
 */
function parseStatus(value: unknown, percent: number, label: string): OpenCodeUsageWindow['status'] {
  if (value !== undefined && value !== null) {
    if (typeof value !== 'string') throw new TypeError(`OpenCode 用量响应的 ${label} 窗口状态不是字符串`)
    const normalized = value.trim().toLowerCase().replace(/_/gu, '-')
    if (normalized === 'ok') return 'ok'
    if (normalized === 'rate-limited' || normalized === 'ratelimited' || normalized === 'limited' || normalized === 'exceeded') {
      return 'rate-limited'
    }
    throw new Error(`OpenCode 用量响应的 ${label} 窗口状态无法识别：${value}`)
  }
  return percent >= 100 ? 'rate-limited' : 'ok'
}

/**
 * 归一化重置时间。
 *
 * 接受 ISO 8601 字符串、epoch 毫秒与 epoch 秒（数字或数字字符串）。小于
 * 1e12 的数值按秒解释：当前 epoch 毫秒已在 1e12 量级，秒级时间戳只有 1e9。
 */
function parseResetTime(value: unknown, label: string): string {
  let milliseconds: number | undefined
  if (typeof value === 'number') {
    milliseconds = value
  } else if (typeof value === 'string' && value.trim().length > 0) {
    const text = value.trim()
    const numeric = Number(text)
    milliseconds = Number.isFinite(numeric) ? numeric : Date.parse(text)
  }
  if (milliseconds === undefined || !Number.isFinite(milliseconds) || milliseconds <= 0) {
    throw new Error(`OpenCode 用量响应的 ${label} 窗口缺少有效的重置时间`)
  }
  if (milliseconds < 1_000_000_000_000) milliseconds *= 1000
  const date = new Date(milliseconds)
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError(`OpenCode 用量响应的 ${label} 窗口重置时间超出可表示范围`)
  }
  return date.toISOString()
}

/** 归一化一个额度窗口；字段缺失或越界都抛错。 */
function parseWindow(value: unknown, key: WindowKey): OpenCodeUsageWindow {
  const label = WINDOW_LABELS[key]
  const source = wireRecord(value)
  if (source === undefined) throw new Error(`OpenCode 用量响应缺少 ${key} 窗口（${label}）`)
  const percent = finiteNumber(source.percent ?? source.used_percent ?? source.usedPercent)
  if (percent === undefined) throw new Error(`OpenCode 用量响应的 ${key} 窗口缺少已用百分比`)
  if (percent < 0 || percent > 100) {
    throw new Error(`OpenCode 用量响应的 ${key} 窗口百分比 ${percent} 超出 0..100`)
  }
  const resetsAt = parseResetTime(source.resetsAt ?? source.resets_at ?? source.resetAt ?? source.reset_at, key)
  return { status: parseStatus(source.status, percent, key), percent, resetsAt }
}

/** 从根节点或 `usage`/`windows` 子节点读取套餐名。 */
function parsePlan(raw: unknown): string | undefined {
  const source = wireRecord(raw)
  if (source === undefined) return undefined
  return nonEmptyString(source.plan)
    ?? nonEmptyString(source.planName)
    ?? nonEmptyString(source.plan_name)
    ?? nonEmptyString(wireRecord(source.subscription)?.plan)
}

/**
 * 把上游用量响应归一化成契约快照。
 *
 * @param payload - 上游 JSON（`{usage:{...}}`、`{windows:{...}}` 或顶层窗口）。
 * @param now - 读取时间；测试可注入。
 * @throws 当响应不是对象、缺少任一窗口、百分比越界或时间戳非法时。
 */
export function parseOpenCodeUsage(payload: unknown, now = Date.now()): OpenCodeUsage {
  const root = wireRecord(payload)
  if (root === undefined) throw new Error('OpenCode 用量响应不是对象')
  // 上游两种常见包装：`usage` 与 `windows`；都没有时按顶层窗口读取。
  const usage = wireRecord(root.usage)
  const windows = usage ?? wireRecord(root.windows) ?? root
  const rolling = parseWindow(windows.rolling, 'rolling')
  const weekly = parseWindow(windows.weekly, 'weekly')
  const monthly = parseWindow(windows.monthly, 'monthly')
  const plan = parsePlan(usage) ?? parsePlan(root)
  return {
    rolling,
    weekly,
    monthly,
    fetchedAt: now,
    ...(plan === undefined ? {} : { plan }),
  }
}

/** 从错误响应里提取短错误码；非法或过长的文本一律忽略。 */
function wireErrorCode(text: string): string | undefined {
  if (text.trim().length === 0) return undefined
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return undefined
  }
  const source = wireRecord(value)
  if (source === undefined) return undefined
  for (const candidate of [source.error, source.code]) {
    if (typeof candidate === 'string' && /^[a-z0-9_.-]{1,64}$/iu.test(candidate)) return candidate
  }
  return undefined
}

/** 用量服务依赖。 */
export interface OpenCodeUsageServiceOptions {
  /** 解析当前可用 token；未登录返回 undefined。 */
  readonly resolveToken: () => Promise<string | undefined>
  readonly fetchImpl?: typeof fetch
  readonly url?: string
  readonly now?: () => number
  /** 快照缓存时长（毫秒）；0 表示每次都重新读取。 */
  readonly cacheMs?: number
  /** 单次请求超时（毫秒）；默认 {@link OPENCODE_USAGE_TIMEOUT_MS}。 */
  readonly timeoutMs?: number
}

/**
 * 用量读取服务。
 *
 * 快照按 `cacheMs` 缓存，同一 token 的并发读取只发一个请求；失败时抛可读
 * 错误并记录到 `error()`，不会把旧快照当成新结果返回。
 */
export class OpenCodeUsageService {
  private readonly resolveToken: () => Promise<string | undefined>
  private readonly fetchImpl: typeof fetch
  private readonly url: string
  private readonly now: () => number
  private readonly cacheMs: number
  private readonly timeoutMs: number
  private snapshot: OpenCodeUsage | undefined
  private snapshotAt = 0
  private lastError: string | undefined
  private inflight: Promise<OpenCodeUsage | undefined> | undefined
  /** 快照对应的 token；换账号或退出登录时用于丢弃缓存。只在内存里，不落盘。 */
  private snapshotToken: string | undefined
  /** 进行中请求对应的 token；不同账号的请求不能互相复用。 */
  private inflightToken: string | undefined

  constructor(options: OpenCodeUsageServiceOptions) {
    this.resolveToken = options.resolveToken
    this.fetchImpl = options.fetchImpl ?? fetch
    this.url = options.url ?? OPENCODE_GO_USAGE_URL
    this.now = options.now ?? Date.now
    const cacheMs = options.cacheMs ?? OPENCODE_USAGE_CACHE_MS
    if (!Number.isFinite(cacheMs) || cacheMs < 0) throw new TypeError('OpenCode 用量缓存时长必须是非负数')
    this.cacheMs = cacheMs
    const timeoutMs = options.timeoutMs ?? OPENCODE_USAGE_TIMEOUT_MS
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('OpenCode 用量超时必须是正数')
    this.timeoutMs = timeoutMs
  }

  /**
   * 读取套餐用量。
   *
   * `resolveToken` 返回 OAuth access token 或 API Key 时行为一致：都以 Bearer
   * 发送，走同一套解析与错误分类。未登录（返回 undefined）时返回 undefined；
   * 请求、解析或刷新失败时抛出带可读消息的 Error，并记录到 {@link error}。
   *
   * 先解析 token 再决定是否命中缓存：token 变了（退出登录或换账号）就丢弃旧
   * 快照，避免把上一账号的额度展示给下一个人。
   */
  async read(): Promise<OpenCodeUsage | undefined> {
    let token: string | undefined
    try {
      token = await this.resolveToken()
    } catch (error: unknown) {
      throw this.fail(`OpenCode 用量读取失败：${safeErrorMessage(error)}`)
    }
    if (token === undefined) {
      this.invalidate()
      return undefined
    }
    // token 变了（退出登录或换账号）就丢弃旧快照与错误。
    if (this.snapshotToken !== token) this.invalidate()
    if (this.snapshot !== undefined && this.now() - this.snapshotAt < this.cacheMs) {
      return this.snapshot
    }
    if (this.inflight !== undefined && this.inflightToken === token) return this.inflight
    const pending = this.load(token).finally(() => {
      if (this.inflight === pending) {
        this.inflight = undefined
        this.inflightToken = undefined
      }
    })
    this.inflight = pending
    this.inflightToken = token
    return pending
  }

  /** 丢弃快照与错误，下一次读取会重新请求。 */
  invalidate(): void {
    this.snapshot = undefined
    this.snapshotAt = 0
    this.snapshotToken = undefined
    this.lastError = undefined
  }

  /** 最近一次读取失败的脱敏文案；成功后清空。 */
  error(): string | undefined {
    return this.lastError
  }

  private async load(token: string): Promise<OpenCodeUsage | undefined> {
    const fetchedAt = this.now()

    const timeout = AbortSignal.timeout(this.timeoutMs)
    let response: Response
    try {
      response = await this.fetchImpl(this.url, {
        method: 'GET',
        redirect: 'error',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${token}`,
        },
        signal: timeout,
      })
    } catch (error: unknown) {
      if (timeout.aborted) throw this.fail(`OpenCode 用量网络请求超时（${this.timeoutMs}ms）`)
      throw this.fail(`OpenCode 用量网络请求失败：${safeErrorMessage(error)}`)
    }

    let text: string
    try {
      text = await readBoundedBody(response, OPENCODE_USAGE_MAX_RESPONSE_BYTES)
    } catch (error: unknown) {
      throw this.fail(`OpenCode 用量响应读取失败：${safeErrorMessage(error)}`)
    }
    if (!response.ok) throw this.httpFailure(response.status, text)
    if (text.trim().length === 0) throw this.fail('OpenCode 用量响应为空')
    let payload: unknown
    try {
      payload = JSON.parse(text)
    } catch {
      throw this.fail('OpenCode 用量响应不是合法 JSON')
    }
    let usage: OpenCodeUsage
    try {
      usage = parseOpenCodeUsage(payload, fetchedAt)
    } catch (error: unknown) {
      throw this.fail(safeErrorMessage(error))
    }
    this.snapshot = usage
    this.snapshotAt = this.now()
    this.snapshotToken = token
    this.lastError = undefined
    return usage
  }

  /**
   * 非 2xx 的可读分类。
   *
   * `/go/v1/usage` 对「凭据有效但没订阅 Go」通常返回 402/403，对凭据失效返回
   * 401。把它与网络失败分开，界面才能给出可行动的提示；API Key 与 OAuth
   * token 共用这套分类。
   */
  private httpFailure(status: number, text: string): Error {
    const code = wireErrorCode(text)
    const suffix = code === undefined ? '' : `，${code}`
    if (status === 401) {
      return this.fail(`OpenCode 用量请求未授权：凭据无效或已过期（HTTP 401${suffix}）`)
    }
    if (status === 402 || status === 403) {
      return this.fail(`当前账号没有 OpenCode Go 套餐订阅（HTTP ${status}${suffix}）`)
    }
    if (status === 404) return this.fail(`OpenCode Go 用量接口不可用（HTTP 404${suffix}）`)
    return this.fail(`OpenCode 用量请求失败（HTTP ${status}${suffix}）`)
  }

  /** 记录并返回脱敏后的可读错误。 */
  private fail(message: string): Error {
    const safe = redactMessage(message)
    this.lastError = safe
    return new Error(safe)
  }
}
