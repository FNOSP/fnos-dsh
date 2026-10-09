/**
 * 复合搜索提供方：TinyFish → Tavily → 官方 的转移链。
 *
 * 接缝只看到这一个提供方，因此不会触发 `WEB_PROVIDER_AMBIGUOUS`；官方搜索提供方
 * 仍在注册表里，但被链条在最后一级使用（作为兜底）。接缝本身没有多级兜底语义
 * （已核实），所以兜底必须在接管插件内部实现——这是本模块存在的理由。
 *
 * 转移语义：
 * - 平台顺序按配置（默认 TinyFish → Tavily → 官方），未配置 key 的平台直接跳过；
 * - 平台内先做请求前探测（缓存用量快照 + 本地限流记账），再按轮转均摊选账号；
 * - 账号失败先在同平台其它账号间转移（可关），平台内耗尽才落到下一平台；
 * - 用户中止（`WEB_ABORTED`）直接上抛，不触发转移；
 * - 一次搜索最多把已配置来源各尝试一遍，不做跨来源无限重试；
 * - 全部失败时抛带错误码的错误，而不是返回空结果。
 */
import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchProvider, WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web'
import type { FailoverSearchSettings } from '../contracts/config.ts'
import type { SourceId } from '../contracts/config.ts'
import {
  FAILOVER_PROVIDER_ID,
  OFFICIAL_SOURCE_ID,
  TAVILY_PLATFORM_ID,
  TINYFISH_PLATFORM_ID,
} from '../contracts/constants.ts'
import type { AccountUsage, PlatformId, SourceAdapter } from '../contracts/types.ts'
import { buildPool, RoundRobinCursor } from './account-pool.ts'
import type { PoolAccount } from './account-pool.ts'
import type { ProviderAttemptEvent } from './events.ts'
import { errorCode, isAborted, WEB_ABORTED, WEB_PROVIDER_CREDENTIAL_MISSING, WEB_PROVIDER_ERROR } from './web-error.ts'

/** 官方兜底级的最小面：一个可用的 `WebSearchProvider`。 */
export interface OfficialFallback {
  readonly id: string
  available(): boolean
  search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult>
}

/** 请求前探测的数据面。 */
export interface ProbeSource {
  /** 读取当前用量快照（只读，不发起网络请求）。 */
  snapshot(): readonly AccountUsage[]
  /** 快照是否新鲜；过期或缺失时探测不排除任何账号。 */
  isFresh(): boolean
  /** 本地限流记账：该账号是否已触限（TinyFish 无服务端配额可查）。 */
  locallyLimited?(accountLabel: string): boolean
}

/** 构造复合提供方的依赖。 */
export interface FailoverProviderOptions {
  /** 读取当前配置取值；每次搜索开始时调用一次，保证一次搜索内配置一致。 */
  readonly readSettings: () => FailoverSearchSettings
  /** 各平台的来源适配器（顺序不重要，按平台 id 索引后再按配置顺序遍历）。 */
  readonly adapters: Readonly<Record<PlatformId, readonly SourceAdapter[]>>
  /** 官方兜底级。 */
  readonly official: OfficialFallback
  /** 请求前探测的数据面；省略表示不做探测（退化为纯响应式转移）。 */
  readonly usage?: ProbeSource | undefined
  /** 每级尝试的脱敏事件回调。 */
  readonly onAttempt: (event: ProviderAttemptEvent) => void
}

/** 复合搜索提供方。 */
export class FailoverSearchProvider implements WebSearchProvider {
  readonly id = FAILOVER_PROVIDER_ID

  /** 每平台一个轮转游标，进程内持久（内存态）。 */
  private readonly cursors: Record<PlatformId, RoundRobinCursor> = {
    [TINYFISH_PLATFORM_ID]: new RoundRobinCursor(),
    [TAVILY_PLATFORM_ID]: new RoundRobinCursor(),
  }

  /** 本次搜索中兜底级的凭据缺失错误（若有）：用于把可执行的修复线索带出链尾。 */
  private credentialFailure: WebError | undefined

  /**
   * @param options - 配置读取面、来源适配器、官方兜底级与探测数据面。
   */
  constructor(private readonly options: FailoverProviderOptions) {}

  /**
   * 廉价本地可用性检查（不产生网络调用）。
   *
   * 判定口径与真实请求一致：任一平台存在**未被请求前探测排除**的账号，或兜底级
   * 可用，即认为搜索能力可用。只数「配置了几个 key」会让一个全部账号都已触限的
   * 组合对外表现为可用，而实际每次搜索都注定失败；全部不可用时由接缝统一报
   * `WEB_PROVIDER_UNAVAILABLE`。
   *
   * @returns 是否存在可用来源。
   */
  available(): boolean {
    const settings = this.options.readSettings()
    const platforms: readonly { platform: PlatformId, accounts: FailoverSearchSettings['tinyfishAccounts'] }[] = [
      { platform: TINYFISH_PLATFORM_ID, accounts: settings.tinyfishAccounts },
      { platform: TAVILY_PLATFORM_ID, accounts: settings.tavilyAccounts },
    ]

    for (const { platform, accounts } of platforms) {
      const pool = buildPool(platform, accounts)
      if (pool.length > 0 && this.probe(platform, pool, settings).length > 0) return true
    }

    return this.options.official.available()
  }

  /**
   * 按配置顺序遍历来源，返回首个成功的结果。
   *
   * @param request - 接缝搜索请求（query 与可选 maxResults）。
   * @param signal - 上层取消信号。
   * @returns 首个成功来源的接缝结果（不跨来源合并）。
   * @throws {WebError} 中止时为 `WEB_ABORTED`；全部来源失败时为
   *   `WEB_PROVIDER_CREDENTIAL_MISSING`（兜底级缺凭据，提示可执行）或
   *   `WEB_PROVIDER_ERROR`（其余失败）。
   */
  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    // 一次搜索开始时快照配置：一次搜索内配置一致，保存后下一次搜索即生效。
    const settings = this.options.readSettings()
    const failures: string[] = []
    this.credentialFailure = undefined

    for (const sourceId of this.normalizedOrder(settings)) {
      if (sourceId === OFFICIAL_SOURCE_ID) {
        const result = await this.tryOfficial(request, signal, failures)
        if (result !== undefined) return result
        continue
      }

      const platform = sourceId as PlatformId
      const result = await this.tryPlatform(platform, request, settings, signal, failures)
      if (result !== undefined) return result
    }

    throw this.finalError(failures)
  }

  /**
   * 全部来源失败时抛出的错误。
   *
   * 兜底级因缺凭据失败时保留 `WEB_PROVIDER_CREDENTIAL_MISSING` 语义
   * （FNOS-010-03-AC-02）：这条错误是**可执行的**（用户配置官方凭据即可恢复），
   * 把它折成通用 `WEB_PROVIDER_ERROR` 会让用户失去唯一的修复线索。其余失败统一为
   * `WEB_PROVIDER_ERROR`，并带上各级原因用于排障。
   */
  private finalError(failures: readonly string[]): WebError {
    const summary = `全部搜索来源失败（${failures.join('；')}）`
    const credential = this.credentialFailure
    if (credential !== undefined) {
      return new WebError(`${credential.message}\n\n${summary}`, WEB_PROVIDER_CREDENTIAL_MISSING)
    }
    return new WebError(summary, WEB_PROVIDER_ERROR)
  }

  /**
   * 归一来源顺序。
   *
   * 官方搜索固定参与（不可移除）：即使配置里漏写也会补在链尾，避免出现
   * 「没有兜底」的组合；重复项只保留第一次出现的位置。
   */
  private normalizedOrder(settings: FailoverSearchSettings): readonly SourceId[] {
    const order: SourceId[] = []
    for (const entry of settings.sourceOrder) {
      if (entry !== TINYFISH_PLATFORM_ID && entry !== TAVILY_PLATFORM_ID && entry !== OFFICIAL_SOURCE_ID) continue
      if (!order.includes(entry)) order.push(entry)
    }
    if (!order.includes(OFFICIAL_SOURCE_ID)) order.push(OFFICIAL_SOURCE_ID)
    return order
  }

  /** 尝试官方兜底级。 */
  private async tryOfficial(
    request: WebSearchRequest,
    signal: AbortSignal | undefined,
    failures: string[],
  ): Promise<WebSearchResult | undefined> {
    const startedAt = Date.now()
    try {
      const result = await this.options.official.search(request, signal)
      this.options.onAttempt({
        platform: OFFICIAL_SOURCE_ID,
        account: OFFICIAL_SOURCE_ID,
        outcome: 'succeeded',
        durationMs: Date.now() - startedAt,
      })
      return result
    } catch (error) {
      if (isAborted(error)) throw error
      // 兜底级缺凭据是可执行错误：记下来，在链条全部失败后按该语义上抛。
      if (error instanceof WebError && error.code === WEB_PROVIDER_CREDENTIAL_MISSING) {
        this.credentialFailure = error
      }
      failures.push(`${OFFICIAL_SOURCE_ID}：${describeFailure(error)}`)
      this.options.onAttempt({
        platform: OFFICIAL_SOURCE_ID,
        account: OFFICIAL_SOURCE_ID,
        outcome: 'failed',
        durationMs: Date.now() - startedAt,
      })
      return undefined
    }
  }

  /** 尝试一个三方平台（平台内多账号 + 账号级转移）。 */
  private async tryPlatform(
    platform: PlatformId,
    request: WebSearchRequest,
    settings: FailoverSearchSettings,
    signal: AbortSignal | undefined,
    failures: string[],
  ): Promise<WebSearchResult | undefined> {
    const configured = platform === TINYFISH_PLATFORM_ID ? settings.tinyfishAccounts : settings.tavilyAccounts
    const pool = buildPool(platform, configured)
    // 未配置 key 的平台直接跳过：不产生等待，也不写失败原因。
    if (pool.length === 0) return undefined

    const candidates = this.probe(platform, pool, settings)
    if (candidates.length === 0) {
      failures.push(`${platform}：全部账号已被请求前探测排除`)
      return undefined
    }

    const adapter = this.options.adapters[platform][0]
    if (adapter === undefined) {
      failures.push(`${platform}：缺少来源适配器`)
      return undefined
    }

    // 轮转只在本次可用的候选里推进；同一查询内已尝试过的账号不再重试。
    const start = this.cursors[platform].take(candidates)
    const ordered = [...candidates.slice(start), ...candidates.slice(0, start)]

    for (const [offset, account] of ordered.entries()) {
      // 同平台重试关闭时，只尝试轮转选中的第一个账号。
      if (offset > 0 && !settings.samePlatformRetry) break
      if (signal?.aborted === true) throw new WebError('搜索已取消', WEB_ABORTED)

      const startedAt = Date.now()
      try {
        const result = await adapter.search(request, account.key, signal)
        this.options.onAttempt({
          platform,
          account: account.label,
          outcome: 'succeeded',
          durationMs: Date.now() - startedAt,
        })
        return result
      } catch (error) {
        if (isAborted(error)) throw error
        failures.push(`${platform}/${account.label}：${describeFailure(error)}`)
        this.options.onAttempt({
          platform,
          account: account.label,
          outcome: 'failed',
          durationMs: Date.now() - startedAt,
        })
      }
    }

    return undefined
  }

  /**
   * 请求前探测：从池中剔除额度已满或本地限流窗口已满的账号。
   *
   * 快照过期或缺失时按「无用量信息」处理（不排除任何账号），退化为响应式转移；
   * 探测关闭时同样不做排除。探测永不阻塞搜索。
   */
  private probe(
    platform: PlatformId,
    pool: readonly PoolAccount[],
    settings: FailoverSearchSettings,
  ): readonly PoolAccount[] {
    const usage = this.options.usage
    if (settings.requestProbe !== true || usage === undefined) return pool
    if (!usage.isFresh()) return pool

    const exhausted = new Set(
      usage.snapshot()
        .filter(entry => entry.platform === platform && entry.exhausted === true)
        .map(entry => entry.accountLabel),
    )

    return pool.filter(account => {
      if (exhausted.has(account.label)) return false
      return usage.locallyLimited?.(account.label) !== true
    })
  }
}

/** 失败原因的可读摘要：优先报告接缝错误码。 */
function describeFailure(error: unknown): string {
  return errorCode(error) ?? WEB_PROVIDER_ERROR
}
