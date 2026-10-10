/**
 * 复合网页抓取提供方（FNOS-010-11）。
 *
 * 接缝语义（`ctx.web.registerFetchProvider`）与 search 相同：`fetchProviderId`
 * 配置了就**固定选择**那个 provider，注册其它不会被走到。因此抓取兜底必须以
 * 本插件的复合 provider 替换组合行里的 `fetchProvider`，内部完成分级：
 *
 * 1. 第一跳：官方 `HttpFetchProvider`（本地 HTTP 抓取，行为与现版本零变化）；
 * 2. 本地失败（网络、拦截、DNS、超时等无法取得内容）且平台账号可用时，
 *    按 TinyFish Fetch → Tavily Extract 转取——抓取发生在平台服务端，
 *    不受用户本机 DNS/代理/反爬影响；
 * 3. 用户中止（`WEB_ABORTED`）**直抛**，不转平台：中止语义属于用户，
 *    不属于「这条路不通换下一条」。
 *
 * 与搜索侧的差异：抓取没有「账号池均摊」语义——同一 URL 的取回不因账号而异，
 * 每平台取一个可用账号（轮转起点继续推进，长期仍均摊配额消耗）。
 */
import type { WebFetchProvider, WebFetchRequest, WebFetchResult } from '@deepseek-ai/dsh-web'
import { WebError } from '@deepseek-ai/dsh-web'
import { errorCode, isAborted } from './web-error.ts'

/**
 * 一跳抓取后端：本地 provider 与平台适配器的公共形状（`available` 可省略）。
 *
 * `fetch` 以**方法签名**声明而非裸函数类型：复合 provider 内部始终以
 * `backend.fetch(...)` 形式调用（见 {@link CompositeFetchProvider.hops}），
 * 因此实现方可以是普通原型方法（官方 `HttpFetchProvider` 即如此），
 * 不会因方法被取出而丢失 `this`。
 */
export interface FetchBackend {
  /** 本地可用性（缺省视为可用；平台的可用性由账号池判断）。 */
  readonly available?: () => boolean
  /** 取回一个 URL；失败抛 `WebError`。 */
  fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult>
}

/** 一个平台的抓取跳：平台 id + 该平台的取回后端。 */
export interface PlatformFetchHop {
  /** 平台 id（`tinyfish` / `tavily`），用于错误信息。 */
  readonly platform: string
  /** 该平台的取回后端。 */
  readonly backend: FetchBackend
}

/** 一次抓取跳的结果事件（与搜索侧的 attempt 事件对称）。 */
export interface FetchHopEvent {
  /** 跳名：`local` 或平台 id。 */
  readonly platform: string
  /** 该跳的结局。 */
  readonly outcome: 'succeeded' | 'failed' | 'skipped'
  /** 本次请求的 URL（不含凭据）。 */
  readonly url: string
  /** 该跳耗时（毫秒）。 */
  readonly durationMs: number
}

/** 复合提供方的组装参数。 */
export interface CompositeFetchProviderOptions {
  /** 组合行 `fetchProvider` 指向的稳定 id（必须与 patch 声明一致）。 */
  readonly id: string
  /** 第一跳：本地抓取（官方语义）。 */
  readonly local: FetchBackend
  /** 平台兜底跳，按尝试顺序排列。 */
  readonly platforms: readonly PlatformFetchHop[]
  /**
   * 门控：本次取回是否绕过平台跳（FNOS-010-12-AC-03）。
   *
   * 由会话级「智能搜索」开关驱动：关闭时该会话不接入本插件，因此只用本地跳
   * （等同未安装插件时的官方行为），平台零调用。缺省时不绕过。
   */
  readonly shouldBypass?: () => boolean
  /** 逐跳事件回调（可选）：诊断「这次取回走了哪一跳」。 */
  readonly onHop?: (event: FetchHopEvent) => void
}

/** 复合抓取提供方：接缝形状与单个 provider 完全一致。 */
export class CompositeFetchProvider implements WebFetchProvider {
  readonly id: string
  private readonly local: FetchBackend
  private readonly platforms: readonly PlatformFetchHop[]

  private readonly onHop: ((event: FetchHopEvent) => void) | undefined
  private readonly shouldBypass: (() => boolean) | undefined

  constructor(options: CompositeFetchProviderOptions) {
    this.id = options.id
    this.local = options.local
    this.platforms = options.platforms
    this.onHop = options.onHop
    this.shouldBypass = options.shouldBypass
  }

  /** 本地跳可用即可用：平台的缺位只影响兜底深度，不影响基本能力。 */
  available(): boolean {
    return this.local.available?.() ?? true
  }

  /** 按本地 → 各平台的顺序取回；中止直抛，其余失败转下一跳。 */
  async fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> {
    const failures: { platform: string, error: unknown }[] = []

    for (const hop of this.hops()) {
      if (signal?.aborted) throw new WebError('web fetch aborted', 'WEB_ABORTED')
      if (hop.available === undefined || hop.available()) {
        const startedAt = Date.now()
        try {
          const result = await hop.call(request, signal)
          this.onHop?.({ platform: hop.platform, outcome: 'succeeded', url: request.url, durationMs: Date.now() - startedAt })
          return result
        } catch (error) {
          // 用户中止是终止信号，不是「这条路不通」：直抛，不再尝试任何跳。
          if (isAborted(error)) throw error
          this.onHop?.({ platform: hop.platform, outcome: 'failed', url: request.url, durationMs: Date.now() - startedAt })
          failures.push({ platform: hop.platform, error })
        }
      } else {
        this.onHop?.({ platform: hop.platform, outcome: 'skipped', url: request.url, durationMs: 0 })
        failures.push({ platform: hop.platform, error: new WebError(`fetch hop "${hop.platform}" is unavailable`, 'WEB_PROVIDER_UNAVAILABLE') })
      }
    }

    // 全跳失败：聚合各跳原因抛出。错误码取**本地跳**的码（与纯本地部署一致，AC-02）；
    // 本地跳缺位时用兜底码。消息带上各跳原因，诊断时不丢平台侧细节。
    const local = failures.find(f => f.platform === 'local')
    const code = (local !== undefined ? errorCode(local.error) : undefined) ?? 'WEB_PROVIDER_ERROR'
    const detail = failures.map(f => `${f.platform}: ${f.error instanceof Error ? f.error.message : String(f.error)}`).join('; ')
    throw new WebError(`all fetch hops failed (${detail})`, code)
  }

  /**
   * 展开成有序跳列表（本地在前）。
   *
   * 每跳保存的是**以属主为接收者的调用闭包**，而不是裸方法引用：官方
   * `HttpFetchProvider` 的 `fetch` 是原型方法，`const f = p.fetch` 之后再调用
   * 会丢 `this`（`this.limits` 变成 undefined）。闭包把接收者固定下来，
   * 让任何实现的形状差异都不外溢到复合逻辑里。
   */
  private hops(): readonly { platform: string, call: (request: WebFetchRequest, signal?: AbortSignal) => Promise<WebFetchResult>, available: (() => boolean) | undefined }[] {
    const wrap = (backend: FetchBackend) => ({
      call: (request: WebFetchRequest, signal?: AbortSignal) => backend.fetch(request, signal),
      available: backend.available === undefined ? undefined : () => backend.available?.() === true,
    })
    // 会话级门控（FNOS-010-12-AC-03）：该会话关掉「智能搜索」时不接入本插件——
    // 只保留本地跳（等同未安装插件时的官方行为），平台跳整体不参与，因此平台
    // 零调用。判定在**每次调用**时求值，切换开关对下一次取回立即生效（AC-04）。
    const platformHops = this.shouldBypass?.() === true
      ? []
      : this.platforms.map(hop => ({ platform: hop.platform, ...wrap(hop.backend) }))
    return [
      { platform: 'local', ...wrap(this.local) },
      ...platformHops,
    ]
  }
}

