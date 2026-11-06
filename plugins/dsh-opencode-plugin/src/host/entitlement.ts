/**
 * OpenCode 账号套餐识别：先读 Console 套餐接口，再用 Go 用量接口兜底。
 *
 * 只有 `GET /console/api/go/status` 能区分 Go / Go Plus / Go Teams 三档，但它是
 * 未公开的 Console 会话接口：服务账号 API Key 可能拿到 401 或 404。因此「404 就
 * 是按量账号」是错的——真正的 Go 订阅会被误判成按量、整侧模型被过滤掉。判定顺序：
 *
 * 1. 未登录 → `unknown`，不设错误（这不是失败）；
 * 2. 套餐接口 2xx 且 `product` 可识别 → 直接采信，`payg` 同样来自这里；
 * 3. 其余情况先打用量接口：能读到 Go 用量就是 Go 订阅（`source: 'usage'`）；
 * 4. 用量也读不到时，只有「套餐接口干净 404」才判 `payg`，其它（401/403/5xx/
 *    网络/超时/JSON 非法/套餐名不可识别）一律 `unknown`。
 *
 * `unknown` 的语义是「读不出来」：绝不猜成 `payg`，也不因为读不出就把两侧模型
 * 混列出来。上层按 OpenCode Go 口径处理（见 `scopeToAccountPlan`）——OpenCode
 * 的主力付费形态是 Go 订阅，按 Go 展示比混列更接近用户真实可用的集合。错误文案
 * 只描述失败位置，绝不包含 token。
 *
 * @module dsh-opencode/entitlement
 */

import {
  OPENCODE_CONSOLE_ORIGIN,
  OPENCODE_GO_USAGE_URL,
  OPENCODE_USER_AGENT,
} from '../contracts/identity.ts'
import type { OpenCodeAccountEntitlement, OpenCodeAccountPlan } from '../contracts/catalog.ts'
import {
  normalizeConsoleServer,
  readBoundedBody,
  redactMessage,
  safeErrorMessage,
} from './console-client.ts'

/** 单次套餐请求的超时（毫秒）。 */
export const OPENCODE_ENTITLEMENT_TIMEOUT_MS = 15_000

/** 套餐与用量探测的响应体积上限。 */
export const OPENCODE_ENTITLEMENT_MAX_RESPONSE_BYTES = 1024 * 1024

/** 默认缓存时长：套餐一天才变一次，1 分钟内重复读取没有意义。 */
export const OPENCODE_ENTITLEMENT_CACHE_MS = 60_000

/** Console 套餐接口的相对路径（拼在 Console 根地址后面）。 */
export const OPENCODE_GO_STATUS_PATH = '/api/go/status'

/** 一个额度窗口的金额口径（上游用「微分」字符串表示）。 */
export interface OpenCodeEntitlementWindowMeters {
  readonly limitMicroCents?: number
  readonly usedMicroCents?: number
  /** 窗口重置时间（ISO 8601）；上游对该窗口没有重置时间时缺省。 */
  readonly resetsAt?: string
}

/** 三个额度窗口的金额；只有套餐接口读得到时才有值，供界面展示用。 */
export interface OpenCodeEntitlementMeters {
  readonly fiveHour?: OpenCodeEntitlementWindowMeters
  readonly week?: OpenCodeEntitlementWindowMeters
  readonly month?: OpenCodeEntitlementWindowMeters
}

/**
 * 账号套餐快照。
 *
 * 契约字段（`plan` / `source` / `fetchedAt` / `error`）语义与
 * {@link OpenCodeAccountEntitlement} 完全一致；这里只追加两个可选的展示字段，
 * 供账号卡使用，不参与过滤判定。
 */
export interface OpenCodeEntitlement extends OpenCodeAccountEntitlement {
  /** 续费档位；与 `product` 不同说明用户已降级或退订。 */
  readonly renewalProduct?: OpenCodeAccountPlan
  /** 套餐额度金额（微分）；只有套餐接口可读时出现。 */
  readonly meters?: OpenCodeEntitlementMeters
}

/** 解析 token 拿到的凭据；`access` 只用于请求头，不落盘、不进日志。 */
export interface OpenCodeEntitlementCredential {
  readonly access: string
  readonly orgId?: string
  readonly server?: string
}

/** 套餐服务的依赖。 */
export interface OpenCodeEntitlementServiceOptions {
  /** 解析当前可用凭据；未登录返回 undefined。 */
  readonly resolveToken: () => Promise<OpenCodeEntitlementCredential | undefined>
  readonly fetchImpl?: typeof fetch
  readonly now?: () => number
  /** 快照缓存时长（毫秒）；0 表示每次都重新读取。 */
  readonly cacheMs?: number
  /** 单次请求超时（毫秒）；默认 {@link OPENCODE_ENTITLEMENT_TIMEOUT_MS}。 */
  readonly timeoutMs?: number
}

/** 一次 HTTP 请求的结果：读到了响应，或者根本没读到。 */
type HttpOutcome =
  | { readonly kind: 'response'; readonly status: number; readonly text: string }
  | { readonly kind: 'failure'; readonly reason: string }

/** 套餐接口的判定结果。 */
type StatusOutcome =
  | { readonly kind: 'product'; readonly product: unknown; readonly meters: OpenCodeEntitlementMeters | undefined; readonly renewalProduct: OpenCodeAccountPlan | undefined }
  | { readonly kind: 'notFound' }
  | { readonly kind: 'unavailable'; readonly reason: string }

function wireRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

/** 接受数字或数字字符串的非负有限数；其余一律 undefined。 */
function nonNegativeNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim().length > 0
      ? Number(value)
      : undefined
  return parsed !== undefined && Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

/**
 * 归一化上游套餐名。
 *
 * 大小写、前后空白、下划线都容忍（`Go_Plus` → `go-plus`）；按量口径有
 * `payg`、`pay-as-you-go` 与 `console` 三种历史写法。无法识别时返回
 * undefined，由调用方走兜底而不是硬猜。
 *
 * @param value - 上游 `product` 字段。
 * @returns 归一的套餐档位；无法识别时为 undefined。
 */
export function normalizeAccountPlan(value: unknown): OpenCodeAccountPlan | undefined {
  const raw = nonEmptyString(value)
  if (raw === undefined) return undefined
  const normalized = raw.trim().toLowerCase().replace(/_/gu, '-')
  switch (normalized) {
    case 'go':
      return 'go'
    case 'go-plus':
      return 'go-plus'
    case 'go-teams':
      return 'go-teams'
    case 'payg':
    case 'pay-as-you-go':
    case 'console':
      return 'payg'
    default:
      return undefined
  }
}

/** 是否是 Go 订阅档位（决定要不要用到额度估算表）。 */
function isGoProduct(plan: OpenCodeAccountPlan | undefined): boolean {
  return plan === 'go' || plan === 'go-plus' || plan === 'go-teams'
}

/** 解析一个额度窗口；三个字段都读不到时返回 undefined，不造 0。 */
function parseMeterWindow(value: unknown): OpenCodeEntitlementWindowMeters | undefined {
  const source = wireRecord(value)
  if (source === undefined) return undefined
  const limitMicroCents = nonNegativeNumber(source.limitMicroCents)
  const usedMicroCents = nonNegativeNumber(source.usedMicroCents)
  const resetsAt = nonEmptyString(source.resetsAt)
  if (limitMicroCents === undefined && usedMicroCents === undefined && resetsAt === undefined) return undefined
  return {
    ...(limitMicroCents === undefined ? {} : { limitMicroCents }),
    ...(usedMicroCents === undefined ? {} : { usedMicroCents }),
    ...(resetsAt === undefined ? {} : { resetsAt }),
  }
}

/** 解析三个额度窗口；一个都读不到时返回 undefined。 */
function parseMeters(value: unknown): OpenCodeEntitlementMeters | undefined {
  const root = wireRecord(value)
  if (root === undefined) return undefined
  const fiveHour = parseMeterWindow(root.fiveHour)
  const week = parseMeterWindow(root.week)
  const month = parseMeterWindow(root.month)
  if (fiveHour === undefined && week === undefined && month === undefined) return undefined
  return {
    ...(fiveHour === undefined ? {} : { fiveHour }),
    ...(week === undefined ? {} : { week }),
    ...(month === undefined ? {} : { month }),
  }
}

/**
 * 套餐读取服务。
 *
 * 快照按 `cacheMs` 缓存，同一凭据的并发读取只发一轮请求；换账号（token 变了）
 * 立刻丢弃旧快照。只有判定成功（非 `unknown`）的结果才进缓存——`unknown` 往往
 * 是网络抖动，缓存它会让恢复慢一个周期。
 */
export class OpenCodeEntitlementService {
  private readonly resolveToken: () => Promise<OpenCodeEntitlementCredential | undefined>
  private readonly fetchImpl: typeof fetch
  private readonly now: () => number
  private readonly cacheMs: number
  private readonly timeoutMs: number
  private snapshot: OpenCodeEntitlement | undefined
  private snapshotAt = 0
  /** 快照对应的 token；换账号或退出登录时用于丢弃缓存。只在内存里，不落盘。 */
  private snapshotToken: string | undefined
  private inflight: Promise<OpenCodeEntitlement> | undefined
  private inflightToken: string | undefined

  constructor(options: OpenCodeEntitlementServiceOptions) {
    this.resolveToken = options.resolveToken
    this.fetchImpl = options.fetchImpl ?? fetch
    this.now = options.now ?? Date.now
    const cacheMs = options.cacheMs ?? OPENCODE_ENTITLEMENT_CACHE_MS
    if (!Number.isFinite(cacheMs) || cacheMs < 0) throw new TypeError('OpenCode 套餐缓存时长必须是非负数')
    this.cacheMs = cacheMs
    const timeoutMs = options.timeoutMs ?? OPENCODE_ENTITLEMENT_TIMEOUT_MS
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('OpenCode 套餐超时必须是正数')
    this.timeoutMs = timeoutMs
  }

  /**
   * 读取账号套餐。
   *
   * 任何失败都折算成 `plan: 'unknown'` 加可读 `error`，不抛异常：调用方（路由、
   * 目录视图）拿到的永远是可直接用的快照。
   */
  async read(): Promise<OpenCodeEntitlement> {
    let credential: OpenCodeEntitlementCredential | undefined
    try {
      credential = await this.resolveToken()
    } catch (error: unknown) {
      this.invalidate()
      return this.unknown(`OpenCode 套餐读取失败：${safeErrorMessage(error)}`)
    }
    if (credential === undefined) {
      this.invalidate()
      return { plan: 'unknown', source: 'none', fetchedAt: this.now() }
    }
    const token = credential.access
    // 换账号就丢弃旧快照，避免把上一账号的套餐展示给下一个人。
    if (this.snapshotToken !== token) this.invalidate()
    if (this.snapshot !== undefined && this.now() - this.snapshotAt < this.cacheMs) return this.snapshot
    if (this.inflight !== undefined && this.inflightToken === token) return this.inflight
    const pending = this.load(credential).finally(() => {
      if (this.inflight === pending) {
        this.inflight = undefined
        this.inflightToken = undefined
      }
    })
    this.inflight = pending
    this.inflightToken = token
    return pending
  }

  /** 丢弃快照，下一次读取会重新请求。 */
  invalidate(): void {
    this.snapshot = undefined
    this.snapshotAt = 0
    this.snapshotToken = undefined
  }

  private async load(credential: OpenCodeEntitlementCredential): Promise<OpenCodeEntitlement> {
    const fetchedAt = this.now()
    let status: StatusOutcome
    try {
      const server = normalizeConsoleServer(credential.server ?? OPENCODE_CONSOLE_ORIGIN)
      status = await this.readStatus(`${server}${OPENCODE_GO_STATUS_PATH}`, credential)
    } catch (error: unknown) {
      status = { kind: 'unavailable', reason: `Console 地址无效：${safeErrorMessage(error)}` }
    }

    if (status.kind === 'product') {
      const plan = normalizeAccountPlan(status.product)
      // 缺失或空白都按「接口没有给出套餐名」处理，等同于按量账号。
      const missing = typeof status.product !== 'string' || status.product.trim().length === 0
      if (isGoProduct(plan) || plan === 'payg' || missing) {
        return this.remember(credential, {
          plan: plan ?? 'payg',
          source: 'console',
          fetchedAt,
          ...(status.renewalProduct === undefined ? {} : { renewalProduct: status.renewalProduct }),
          ...(status.meters === undefined ? {} : { meters: status.meters }),
        })
      }
      // 读到了但套餐名无法识别：按「读不出来」处理，继续走用量兜底。
      status = { kind: 'unavailable', reason: `套餐接口返回了无法识别的套餐 ${describeProduct(status.product)}` }
    }

    // 兜底：能读到 Go 用量就说明是 Go 订阅，与 Console 接口为何不可用无关。
    const usage = await this.request(OPENCODE_GO_USAGE_URL, credential)
    if (usage.kind === 'response' && usage.status >= 200 && usage.status < 300) {
      return this.remember(credential, { plan: 'go', source: 'usage', fetchedAt })
    }
    // 只有「套餐接口干净 404」才明确表示该账号没有 Go 订阅。
    if (status.kind === 'notFound') {
      return this.remember(credential, { plan: 'payg', source: 'console', fetchedAt })
    }
    const usageReason = usage.kind === 'failure'
      ? `用量接口${usage.reason}`
      : `用量接口返回 HTTP ${usage.status}`
    return this.unknown(`无法确认 OpenCode 套餐：${status.reason}；${usageReason}`, fetchedAt)
  }

  /** 读取并解析 Console 套餐接口。 */
  private async readStatus(url: string, credential: OpenCodeEntitlementCredential): Promise<StatusOutcome> {
    const outcome = await this.request(url, credential)
    if (outcome.kind === 'failure') return { kind: 'unavailable', reason: `套餐接口${outcome.reason}` }
    if (outcome.status === 404) return { kind: 'notFound' }
    if (outcome.status < 200 || outcome.status >= 300) {
      return { kind: 'unavailable', reason: `套餐接口返回 HTTP ${outcome.status}` }
    }
    let payload: unknown
    try {
      payload = JSON.parse(outcome.text)
    } catch {
      return { kind: 'unavailable', reason: `套餐接口响应不是合法 JSON（HTTP ${outcome.status}）` }
    }
    const body = wireRecord(payload)
    if (body === undefined) return { kind: 'unavailable', reason: '套餐接口响应不是对象' }
    return {
      kind: 'product',
      product: body.product,
      renewalProduct: normalizeAccountPlan(body.renewalProduct),
      meters: parseMeters(wireRecord(body.access)?.meters),
    }
  }

  /** 发一次 GET：超时、禁止重定向、限制响应体积。 */
  private async request(url: string, credential: OpenCodeEntitlementCredential): Promise<HttpOutcome> {
    const timeout = AbortSignal.timeout(this.timeoutMs)
    let response: Response
    try {
      response = await this.fetchImpl(url, {
        method: 'GET',
        redirect: 'error',
        headers: {
          accept: 'application/json',
          'user-agent': OPENCODE_USER_AGENT,
          authorization: `Bearer ${credential.access}`,
          ...(credential.orgId === undefined ? {} : { 'x-org-id': credential.orgId }),
        },
        signal: timeout,
      })
    } catch (error: unknown) {
      if (timeout.aborted) return { kind: 'failure', reason: `请求超时（${this.timeoutMs}ms）` }
      return { kind: 'failure', reason: `网络请求失败：${safeErrorMessage(error)}` }
    }
    try {
      const text = await readBoundedBody(response, OPENCODE_ENTITLEMENT_MAX_RESPONSE_BYTES)
      return { kind: 'response', status: response.status, text }
    } catch (error: unknown) {
      return { kind: 'failure', reason: `响应读取失败：${safeErrorMessage(error)}` }
    }
  }

  /** 只缓存判定成功的结果，并记下它属于哪个凭据。 */
  private remember(credential: OpenCodeEntitlementCredential, entitlement: OpenCodeEntitlement): OpenCodeEntitlement {
    this.snapshot = entitlement
    this.snapshotAt = this.now()
    this.snapshotToken = credential.access
    return entitlement
  }

  /** 构造 `unknown` 结果；文案统一脱敏后再落进快照。 */
  private unknown(error: string, fetchedAt = this.now()): OpenCodeEntitlement {
    return { plan: 'unknown', source: 'none', fetchedAt, error: redactMessage(error) }
  }
}

/** 把无法识别的套餐名截断成可读片段（防御上游返回超长字符串）。 */
function describeProduct(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value) ?? String(value)
  return `「${text.slice(0, 64)}」`
}
