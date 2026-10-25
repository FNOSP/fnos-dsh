/**
 * ZCode 控制面客户端：OAuth 设备授权、额度、客户端配置。
 *
 * 三个接口共享一套「ZCode 客户端身份头」（{@link zcodeSourceHeaders}）。
 * 这不是可选装饰：额度接口在没有 `X-Device-Mid` 时直接返回
 * `{"code":3001,"msg":"parameter error"}`，而 `X-Device-Mid` 必须是稳定值，
 * 否则同一个账号每次请求都会被当成新设备——额度接口会要求重新授权。
 *
 * 失败一律抛 {@link ZCodeConsoleError}，带上游业务码，让上层能区分
 * 「未登录」「无权益」「被限流」并给出可读提示。
 *
 * @module dsh-zcode/console-client
 */

import {
  ZCODE_AGENT_CONFIGS_URL,
  ZCODE_ANTHROPIC_BASE_URL,
  ZCODE_ANTHROPIC_BETA,
  ZCODE_ANTHROPIC_VERSION,
  ZCODE_BALANCE_URL,
  ZCODE_CLIENT_CONFIGS_URL,
  ZCODE_CLIENT_VERSION,
  ZCODE_FAMILY_LABELS,
  ZCODE_OAUTH_INIT_URL,
  ZCODE_OAUTH_TOKEN_URL,
  ZCODE_USER_AGENT,
  zcodeOAuthPollUrl,
  type ZCodeFamily,
} from '../contracts/identity.ts'

/** 上游业务错误。 */
export class ZCodeConsoleError extends Error {
  constructor(
    message: string,
    /** 上游业务码（`code` 字段），HTTP 层失败时为 undefined。 */
    readonly code: number | undefined,
    /** HTTP 状态码。 */
    readonly status: number,
    /** 上游原始响应片段，便于排查。 */
    readonly detail?: string,
  ) {
    super(message)
    this.name = 'ZCodeConsoleError'
  }
}

/** 设备授权发起结果。 */
export interface ZCodeOAuthInit {
  readonly flowId: string
  readonly authorizeUrl: string
  /** 过期时间（epoch ms）。 */
  readonly expiresAt: number
  readonly intervalSeconds: number
}

/** 设备授权轮询结果。 */
export type ZCodeOAuthPoll =
  | { readonly status: 'pending' }
  | {
      readonly status: 'ready'
      readonly zcodeJwt: string
      readonly accessToken?: string
      readonly refreshToken?: string
      readonly expiresAt?: number
      readonly user?: {
        readonly userId?: string | undefined
        readonly email?: string | undefined
        readonly name?: string | undefined
        readonly avatar?: string | undefined
      }
    }
  | { readonly status: 'failed'; readonly message: string }

/** 额度接口的原始条目。 */
export interface ZCodeRawBalance {
  readonly capability?: string | undefined
  readonly showName: string
  readonly totalUnits: number
  readonly usedUnits: number
  readonly remainingUnits: number
  /** 上游没有 period 字段；周期由窗口时长推导（见宽松度推导）。 */
  readonly periodStartSeconds?: number | undefined
  readonly periodEndSeconds?: number | undefined
  readonly expiresAtSeconds?: number | undefined
  /** 已用尽额度里也可能是 0，用它区分「未发放」与「已用完」。 */
  readonly availableUnits?: number | undefined
  /** 该额度条目所属套餐 id。 */
  readonly planId?: string | undefined
}

/** 额度接口的原始套餐条目。 */
export interface ZCodeRawPlan {
  readonly planId: string
  readonly name?: string | undefined
  readonly status?: string | undefined
  readonly endsAt?: string | undefined
}

/** 额度快照（业务层聚合结果）。 */
export interface ZCodeBalanceSnapshot {
  readonly plans: readonly ZCodeRawPlan[]
  readonly balances: readonly ZCodeRawBalance[]
}

/** 客户端配置里的模型能力。 */
export interface ZCodeClientModel {
  readonly modelId: string
  readonly name: string
  readonly contextWindow?: number | undefined
  readonly maxCompletionTokens?: number | undefined
  readonly reasoningLevels?: readonly string[] | undefined
  readonly defaultReasoningLevel?: string | undefined
  readonly supportsImage?: boolean | undefined
  readonly description?: string | undefined
}

/** 客户端配置快照。 */
export interface ZCodeClientConfigSnapshot {
  readonly models: readonly ZCodeClientModel[]
  /** 验证码配置；`skipModelRequest` 为 true 表示模型请求不做人机校验。 */
  readonly captcha?: {
    readonly enabled: boolean
    readonly skipModelRequest: boolean
    readonly region?: string | undefined
  }
  /** Start Plan 预览权益（未订阅时的展示口径）。 */
  readonly startPlanEntitlements?: readonly { readonly showName: string; readonly grantUnits: number }[]
}

/** 代理端点映射（官方客户端把家族端点改写到 ZCode 域）。 */
export interface ZCodeAgentConfigSnapshot {
  readonly proxyMapping: readonly {
    readonly from: string
    readonly to: string
    readonly zcodeAuthorizationHeader?: string
  }[]
  readonly codingPlanSignatureEnabled?: boolean
}

/** 请求选项。 */
export interface ZCodeClientOptions {
  /** 网络实现；默认 `globalThis.fetch`，便于测试注入。 */
  readonly fetch?: typeof globalThis.fetch
  /** 每请求超时（毫秒）。 */
  readonly timeoutMs?: number
  /** 生成稳定的设备标识；默认随机 UUID。 */
  readonly deviceMid?: () => string
}

const DEFAULT_TIMEOUT_MS = 20_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function pickString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function pickNumber(source: Record<string, unknown>, key: string): number | undefined {
  const value = source[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * ZCode 客户端身份头。
 *
 * `x-client-language` / `x-client-timezone` / `x-os-*` 参与网关的来源归因，
 * 固定成稳定值比"跟随运行环境"更可靠：服务端对同一账号看到一致指纹。
 */
export function zcodeSourceHeaders(deviceMid: string): Record<string, string> {
  return {
    'http-referer': 'https://zcode.z.ai',
    'user-agent': ZCODE_USER_AGENT,
    'x-app-id': 'zcode',
    'x-client-language': 'zh-CN',
    'x-client-timezone': 'Asia/Shanghai',
    'x-client-version': ZCODE_CLIENT_VERSION,
    'x-device-mid': deviceMid,
    'x-os-category': process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux',
    'x-os-version': process.version.replace(/^v/, ''),
    'x-platform': `${process.platform}-${process.arch}`,
    'x-release-channel': 'production',
    'x-title': 'Z Code@cli',
    'x-zcode-agent': 'glm',
    'x-zcode-app-version': ZCODE_CLIENT_VERSION,
  }
}

/** 推理请求头：在客户端身份头上补 Anthropic 协议头与凭据。 */
export function zcodeModelHeaders(deviceMid: string, token: string): Record<string, string> {
  return {
    ...zcodeSourceHeaders(deviceMid),
    'content-type': 'application/json',
    'anthropic-version': ZCODE_ANTHROPIC_VERSION,
    'anthropic-beta': ZCODE_ANTHROPIC_BETA,
    // 官方客户端把计划令牌同时写进这两个头；网关对两者任一都能识别，
    // 但多数 Anthropic 兼容实现只读其中一个，因此保持一致。
    authorization: `Bearer ${token}`,
    'x-api-key': token,
  }
}

/** 把上游 JSON 信封解出 `data`；业务码非 0 时抛出带码错误。 */
function unwrapEnvelope(payload: unknown, status: number, url: string): unknown {
  if (!isRecord(payload)) {
    throw new ZCodeConsoleError(`${url} 返回了非对象响应`, undefined, status)
  }
  const code = pickNumber(payload, 'code')
  if (code !== undefined && code !== 0) {
    const message = pickString(payload, 'msg') ?? `上游业务码 ${code}`
    throw new ZCodeConsoleError(message, code, status, JSON.stringify(payload).slice(0, 500))
  }
  return payload.data
}

/** ZCode 控制面客户端。 */
export class ZCodeConsoleClient {
  private readonly fetchImpl: typeof globalThis.fetch
  private readonly timeoutMs: number
  private readonly deviceMidFactory: () => string
  private cachedDeviceMid: string | undefined

  constructor(options: ZCodeClientOptions = {}) {
    // 绑定到 globalThis 上再保存，避免未绑定的 fetch 在部分运行时报 illegal invocation。
    this.fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init))
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.deviceMidFactory = options.deviceMid ?? (() => crypto.randomUUID())
  }

  /** 当前设备标识；首次调用时生成并缓存，保证同一进程内稳定。 */
  deviceMid(): string {
    this.cachedDeviceMid ??= this.deviceMidFactory()
    return this.cachedDeviceMid
  }

  /** 注入固定设备标识（从磁盘恢复时使用）。 */
  setDeviceMid(value: string): void {
    if (value.trim().length > 0) this.cachedDeviceMid = value.trim()
  }

  private async request(
    url: string,
    init: RequestInit,
    what: string,
  ): Promise<{ status: number; json: unknown }> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    timer.unref?.()
    let response: Response
    try {
      response = await this.fetchImpl(url, { ...init, signal: controller.signal })
    } catch (error) {
      const aborted = controller.signal.aborted
      throw new ZCodeConsoleError(
        aborted ? `${what} 超时（${this.timeoutMs}ms）` : `${what} 网络请求失败：${String(error)}`,
        undefined,
        0,
      )
    } finally {
      clearTimeout(timer)
    }
    const text = await response.text()
    let json: unknown
    try {
      json = text.length === 0 ? undefined : JSON.parse(text)
    } catch {
      throw new ZCodeConsoleError(
        `${what} 返回了非 JSON 响应（HTTP ${response.status}）`,
        undefined,
        response.status,
        text.slice(0, 300),
      )
    }
    if (!response.ok) {
      // 上游在 HTTP 层失败时也常带业务信封，优先用它的 msg。
      const message = isRecord(json) ? pickString(json, 'msg') : undefined
      const code = isRecord(json) ? pickNumber(json, 'code') : undefined
      throw new ZCodeConsoleError(
        message ?? `${what} 失败（HTTP ${response.status}）`,
        code,
        response.status,
        text.slice(0, 400),
      )
    }
    return { status: response.status, json }
  }

  /**
   * 发起设备授权。
   *
   * `pollToken` 是客户端自生成的随机值，服务端把它与 flow 绑定：轮询必须带同一
   * 个值，否则拿不到结果。它不落盘也不进日志。
   */
  async initDeviceFlow(family: ZCodeFamily, pollToken: string): Promise<ZCodeOAuthInit> {
    const url = `${ZCODE_OAUTH_INIT_URL}`
    const { status, json } = await this.request(
      url,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${pollToken}` },
        body: JSON.stringify({ provider: family }),
      },
      `${ZCODE_FAMILY_LABELS[family]} 设备授权`,
    )
    const data = unwrapEnvelope(json, status, url)
    if (!isRecord(data)) {
      throw new ZCodeConsoleError('设备授权响应缺少 data', undefined, status)
    }
    const flowId = pickString(data, 'flow_id')
    const authorizeUrl = pickString(data, 'authorize_url')
    if (flowId === undefined || authorizeUrl === undefined) {
      throw new ZCodeConsoleError('设备授权响应缺少 flow_id 或 authorize_url', undefined, status)
    }
    const expiresAtSeconds = pickNumber(data, 'expires_at')
    return {
      flowId,
      authorizeUrl,
      expiresAt: expiresAtSeconds === undefined ? Date.now() + 300_000 : expiresAtSeconds * 1000,
      intervalSeconds: Math.max(1, pickNumber(data, 'poll_interval_sec') ?? 2),
    }
  }

  /** 轮询设备授权。 */
  async pollDeviceFlow(
    family: ZCodeFamily,
    flowId: string,
    pollToken: string,
  ): Promise<ZCodeOAuthPoll> {
    const url = zcodeOAuthPollUrl(flowId)
    const { status, json } = await this.request(
      url,
      { method: 'GET', headers: { authorization: `Bearer ${pollToken}` } },
      `${ZCODE_FAMILY_LABELS[family]} 授权轮询`,
    )
    const data = unwrapEnvelope(json, status, url)
    if (!isRecord(data)) return { status: 'pending' }
    const state = pickString(data, 'status')
    if (state === 'pending') return { status: 'pending' }
    if (state === 'failed') {
      return { status: 'failed', message: pickString(data, 'message') ?? '授权被拒绝' }
    }
    if (state !== 'ready') return { status: 'pending' }
    const zcodeJwt = pickString(data, 'token')
    if (zcodeJwt === undefined) {
      return { status: 'failed', message: '授权成功但响应缺少 token' }
    }
    // 家族凭证嵌在 <family>.access_token 下；上游有时直接给字符串。
    const familyNode = isRecord(data[family]) ? data[family] as Record<string, unknown> : {}
    const accessToken = pickString(familyNode, 'access_token')
    const refreshToken = pickString(familyNode, 'refresh_token')
    const userNode = isRecord(data.user) ? data.user as Record<string, unknown> : {}
    const expiresAtSeconds = pickNumber(data, 'expires_at')
    return {
      status: 'ready',
      zcodeJwt,
      ...(accessToken === undefined ? {} : { accessToken }),
      ...(refreshToken === undefined ? {} : { refreshToken }),
      ...(expiresAtSeconds === undefined ? {} : { expiresAt: expiresAtSeconds * 1000 }),
      user: {
        userId: pickString(userNode, 'user_id'),
        email: pickString(userNode, 'email'),
        name: pickString(userNode, 'name'),
        avatar: pickString(userNode, 'avatar'),
      },
    }
  }

  /**
   * 用桌面端授权码换取凭据。
   *
   * 与设备授权并列存在：桌面端（Electron）通过 `zcode://oauth/callback` 拿授权码，
   * 再由这里换取 `data.token` 与 `data.<family>.access_token`。上游对两条链路签发
   * 的凭据用途不同，因此两条都要支持，由调用方选择用哪条。
   */
  async exchangeDesktopCode(
    family: ZCodeFamily,
    code: string,
    redirectUri: string,
    state: string,
  ): Promise<ZCodeOAuthPoll> {
    const { status, json } = await this.request(
      ZCODE_OAUTH_TOKEN_URL,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: family, code, redirect_uri: redirectUri, state }),
      },
      `${ZCODE_FAMILY_LABELS[family]} 授权码换取`,
    )
    const data = unwrapEnvelope(json, status, ZCODE_OAUTH_TOKEN_URL)
    if (!isRecord(data)) {
      throw new ZCodeConsoleError('授权码换取响应缺少 data', undefined, status)
    }
    const zcodeJwt = pickString(data, 'token')
    if (zcodeJwt === undefined || zcodeJwt.trim().length === 0) {
      throw new ZCodeConsoleError('授权码换取响应缺少 token', undefined, status)
    }
    const familyNode = isRecord(data[family]) ? data[family] as Record<string, unknown> : {}
    const accessToken = pickString(familyNode, 'access_token')
    const refreshToken = pickString(familyNode, 'refresh_token')
    const userNode = isRecord(data.user) ? data.user as Record<string, unknown> : {}
    return {
      status: 'ready',
      zcodeJwt,
      ...(accessToken === undefined ? {} : { accessToken }),
      ...(refreshToken === undefined ? {} : { refreshToken }),
      user: {
        userId: pickString(userNode, 'user_id'),
        email: pickString(userNode, 'email'),
        name: pickString(userNode, 'name'),
        avatar: pickString(userNode, 'avatar'),
      },
    }
  }

  /**
   * 读取 Start Plan 额度。
   *
   * 这里是目录的真源：`balances[].capabilities` 决定账号此刻能用哪些模型。
   */
  async balance(zcodeJwt: string): Promise<ZCodeBalanceSnapshot> {
    const url = `${ZCODE_BALANCE_URL}?app_version=${encodeURIComponent(ZCODE_CLIENT_VERSION)}`
    const { status, json } = await this.request(
      url,
      { method: 'GET', headers: { ...zcodeSourceHeaders(this.deviceMid()), authorization: zcodeJwt } },
      'Start Plan 额度',
    )
    const data = unwrapEnvelope(json, status, url)
    if (!isRecord(data)) throw new ZCodeConsoleError('额度响应缺少 data', undefined, status)
    const rawPlans = Array.isArray(data.plans) ? data.plans : []
    const rawBalances = Array.isArray(data.balances) ? data.balances : []
    const plans: ZCodeRawPlan[] = []
    for (const entry of rawPlans) {
      if (!isRecord(entry)) continue
      const planId = pickString(entry, 'plan_id')
      if (planId === undefined) continue
      plans.push({
        planId,
        ...(pickString(entry, 'name') === undefined ? {} : { name: pickString(entry, 'name') }),
        ...(pickString(entry, 'status') === undefined ? {} : { status: pickString(entry, 'status') }),
        ...(pickString(entry, 'ends_at') === undefined ? {} : { endsAt: pickString(entry, 'ends_at') }),
      })
    }
    const balances: ZCodeRawBalance[] = []
    for (const entry of rawBalances) {
      if (!isRecord(entry)) continue
      const showName = pickString(entry, 'show_name') ?? pickString(entry, 'entitlement_id')
      if (showName === undefined) continue
      const capabilities = Array.isArray(entry.capabilities) ? entry.capabilities : []
      const capability = capabilities.find((value): value is string => typeof value === 'string')
      // 周期与过期时间都是 **Unix 秒**（不是 ISO 字符串）：用 pickNumber 读，
      // 用 pickString 会永远得到 undefined，界面就会显示成"无重置时间"。
      const planId = pickString(entry, 'plan_id')
      balances.push({
        showName,
        totalUnits: pickNumber(entry, 'total_units') ?? 0,
        usedUnits: pickNumber(entry, 'used_units') ?? 0,
        remainingUnits: pickNumber(entry, 'remaining_units') ?? 0,
        ...(capability === undefined ? {} : { capability }),
        ...(planId === undefined ? {} : { planId }),
        ...(pickNumber(entry, 'period_start') === undefined
          ? {}
          : { periodStartSeconds: pickNumber(entry, 'period_start') }),
        ...(pickNumber(entry, 'period_end') === undefined
          ? {}
          : { periodEndSeconds: pickNumber(entry, 'period_end') }),
        ...(pickNumber(entry, 'expires_at') === undefined
          ? {}
          : { expiresAtSeconds: pickNumber(entry, 'expires_at') }),
        ...(pickNumber(entry, 'available_units') === undefined
          ? {}
          : { availableUnits: pickNumber(entry, 'available_units') }),
      })
    }
    return { plans, balances }
  }

  /** 读取客户端配置：模型能力、验证码策略、Start Plan 预览权益。 */
  async clientConfigs(zcodeJwt: string): Promise<ZCodeClientConfigSnapshot> {
    const url = `${ZCODE_CLIENT_CONFIGS_URL}?app_version=${encodeURIComponent(ZCODE_CLIENT_VERSION)}&platform=${encodeURIComponent(`${process.platform === 'darwin' ? 'darwin' : process.platform}-${process.arch === 'arm64' ? 'aarch64' : process.arch}`)}`
    const { status, json } = await this.request(
      url,
      { method: 'GET', headers: { ...zcodeSourceHeaders(this.deviceMid()), authorization: zcodeJwt } },
      '客户端配置',
    )
    const data = unwrapEnvelope(json, status, url)
    if (!isRecord(data)) throw new ZCodeConsoleError('客户端配置缺少 data', undefined, status)
    const configs = isRecord(data.configs) ? data.configs as Record<string, unknown> : {}

    /*
     * 模型能力的真源是 `data.builtinModels`，不是 `data.providers[].models[]`。
     *
     * 这两处字段形态完全不同，早期按 providers 解析的结果是：能力表里只出现
     * GLM-5.2 与 GLM-5-Turbo（providers 里只列这两个），而账号真正拥有的
     * GLM-5.3 / GLM-5.3-Flash 因为查不到描述而退回了保守默认值。能力读错的
     * 后果是上下文与最大输出被显示成猜出来的数字，而不是上游真实值。
     */
    const models: ZCodeClientModel[] = []
    const builtin = Array.isArray(data.builtinModels) ? data.builtinModels : []
    for (const entry of builtin) {
      if (!isRecord(entry)) continue
      const modelId = pickString(entry, 'modelId')
      if (modelId === undefined) continue
      if (models.some(model => model.modelId === modelId)) continue

      // `reasoning.levels` 是**对象映射**（{ low: {...}, high: {...} }），
      // 不是数组；按数组读会得到 undefined，思考等级就会被误判成不支持。
      const reasoning = isRecord(entry.reasoning) ? entry.reasoning : {}
      const levelsNode = isRecord(reasoning.levels) ? reasoning.levels : {}
      const levels = Object.keys(levelsNode)
      // `capabilities.vision` 是图片输入的开关；早期读的是
      // `capabilities.inputFormat.supportsImage`，那个路径并不存在。
      const capabilities = isRecord(entry.capabilities) ? entry.capabilities : {}

      models.push({
        modelId,
        name: pickString(entry, 'name') ?? modelId,
        ...(pickNumber(entry, 'contextWindow') === undefined
          ? {}
          : { contextWindow: pickNumber(entry, 'contextWindow') }),
        ...(pickNumber(entry, 'maxCompletionTokens') === undefined
          ? {}
          : { maxCompletionTokens: pickNumber(entry, 'maxCompletionTokens') }),
        ...(levels.length === 0 ? {} : { reasoningLevels: levels }),
        ...(pickString(reasoning, 'defaultLevel') === undefined
          ? {}
          : { defaultReasoningLevel: pickString(reasoning, 'defaultLevel') }),
        ...(capabilities.vision === true ? { supportsImage: true } : {}),
        ...(pickString(entry, 'description') === undefined
          ? {}
          : { description: pickString(entry, 'description') }),
      })
    }

    const captchaNode = isRecord(configs.captcha) ? configs.captcha as Record<string, unknown> : undefined
    const previewNode = isRecord(configs.startPlanPreview)
      ? configs.startPlanPreview as Record<string, unknown>
      : undefined
    const entitlements = previewNode !== undefined && Array.isArray(previewNode.entitlements)
      ? previewNode.entitlements
          .filter(isRecord)
          .map(entry => ({
            showName: pickString(entry, 'showName') ?? '',
            grantUnits: pickNumber(entry, 'grantUnits') ?? 0,
          }))
          .filter(entry => entry.showName.length > 0)
      : undefined

    return {
      models,
      ...(captchaNode === undefined
        ? {}
        : {
            captcha: {
              enabled: captchaNode.enabled === true,
              skipModelRequest: captchaNode.skip_model_request === true,
              ...(pickString(captchaNode, 'region') === undefined ? {} : { region: pickString(captchaNode, 'region') }),
            },
          }),
      ...(entitlements === undefined ? {} : { startPlanEntitlements: entitlements }),
    }
  }

  /** 读取 agent 运行时配置（官方客户端的端点改写映射）。 */
  async agentConfigs(zcodeJwt: string): Promise<ZCodeAgentConfigSnapshot> {
    const url = `${ZCODE_AGENT_CONFIGS_URL}?app_version=${encodeURIComponent(ZCODE_CLIENT_VERSION)}&platform=darwin-aarch64`
    const { status, json } = await this.request(
      url,
      { method: 'GET', headers: { ...zcodeSourceHeaders(this.deviceMid()), authorization: `Bearer ${zcodeJwt}` } },
      'Agent 配置',
    )
    const data = unwrapEnvelope(json, status, url)
    if (!isRecord(data)) throw new ZCodeConsoleError('Agent 配置缺少 data', undefined, status)
    const proxy = isRecord(data.proxyEndpoint) ? data.proxyEndpoint as Record<string, unknown> : undefined
    const mapping = proxy !== undefined && Array.isArray(proxy.mapping) ? proxy.mapping : []
    const signature = isRecord(data.codingPlanSignature)
      ? data.codingPlanSignature as Record<string, unknown>
      : undefined
    return {
      proxyMapping: mapping.filter(isRecord).flatMap(entry => {
        const from = pickString(entry, 'from')
        const to = pickString(entry, 'to')
        if (from === undefined || to === undefined) return []
        const header = pickString(entry, 'zcodeAuthorizationHeader')
        return [{ from, to, ...(header === undefined ? {} : { zcodeAuthorizationHeader: header }) }]
      }),
      ...(signature === undefined ? {} : { codingPlanSignatureEnabled: signature.enable === true }),
    }
  }
}

/** 推理端点完整地址。 */
export function zcodeMessagesUrl(baseURL: string = ZCODE_ANTHROPIC_BASE_URL): string {
  const trimmed = baseURL.replace(/\/+$/u, '')
  return `${trimmed}/v1/messages`
}
