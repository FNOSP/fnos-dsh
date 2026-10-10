/**
 * FNOS-010 复合搜索接管插件的 host 半侧。
 *
 * 注册两个复合提供方（id 均为 `dsh-failover-search`）：
 *
 * - 搜索（FNOS-010-01/07）：按 TinyFish → Tavily → 官方顺序尝试，先成功者胜出。
 *   组合包 patch 把 `web` 行的 `searchProvider` 指到这里，官方搜索降级为链尾兜底。
 * - 抓取（FNOS-010-11）：第一跳复用官方 `HttpFetchProvider`（本地语义零变化），
 *   本地失败且平台账号可用时按 TinyFish Fetch → Tavily Extract 转取。组合行
 *   `fetchProvider` 同样指到这里。
 *
 * 两个能力面互相独立：抓取失败不影响搜索，反之亦然。
 *
 * 官方搜索提供方通过导入官方包 `DeepSeekSearchProvider` 复用（导出面已核实），
 * 凭据沿用用户既有的 `DEEPSEEK_API_KEY` 解析路径，行为与现版本一致。
 *
 * 这个文件是 host 侧唯一的组装点：配置读取、来源适配器、官方兜底级、用量快照与
 * 后台刷新都在这里接线，业务语义留在各自的模块里。
 */
import type { Context } from '@deepseek-ai/cordis'
import { DeepSeekSearchProvider } from '@deepseek-ai/dsh-web-search-deepseek'
import { DEFAULT_USER_AGENT, HttpFetchProvider } from '@deepseek-ai/dsh-web-fetch-http'
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-web'
import { Config, readSettings } from './contracts/config.ts'
import type { FailoverSearchConfig } from './contracts/config.ts'
import { FAILOVER_PROVIDER_ID, OFFICIAL_SOURCE_ID, TAVILY_PLATFORM_ID, TINYFISH_PLATFORM_ID } from './contracts/constants.ts'
import { FAILOVER_ACCOUNTS_ENDPOINT, FAILOVER_REFRESH_ENDPOINT, FAILOVER_REVEAL_ENDPOINT, FAILOVER_USAGE_CHANNEL, FAILOVER_USAGE_ENDPOINT } from './contracts/usage-rpc.ts'
import type { AccountsSnapshot, RevealKeyRequest, RevealKeySnapshot, UsageSnapshot } from './contracts/usage-rpc.ts'
import type { AccountConfig } from './contracts/config.ts'
import type { AccountSummary } from './contracts/usage-rpc.ts'
import { buildPool } from './host/account-pool.ts'
import { CompositeFetchProvider } from './host/fetch-failover-provider.ts'
import { TavilyExtractAdapter, TinyfishFetchAdapter } from './host/fetch-platforms.ts'
import { FailoverSearchProvider } from './host/failover-provider.ts'
import { maskApiKey } from './host/mask.ts'
import { TavilyAdapter, TavilyUsageAdapter } from './host/tavily-provider.ts'
import { TinyFishAdapter, TinyFishUsageAdapter } from './host/tinyfish-provider.ts'
import { resolveOfficialOptions } from './host/official-fallback.ts'
import { usageFingerprint } from './host/usage-fingerprint.ts'
import { UsageStore } from './host/usage-store.ts'

export { Config } from './contracts/config.ts'
export type { FailoverSearchConfig, FailoverSearchSettings, AccountConfig } from './contracts/config.ts'
export { FAILOVER_PROVIDER_ID, FAILOVER_ROW_ID, FAILOVER_SETTINGS_NAMESPACE } from './contracts/constants.ts'
export { FAILOVER_ACCOUNTS_ENDPOINT, FAILOVER_REFRESH_ENDPOINT, FAILOVER_REVEAL_ENDPOINT, FAILOVER_USAGE_CHANNEL, FAILOVER_USAGE_ENDPOINT } from './contracts/usage-rpc.ts'
export type { UsageSnapshot } from './contracts/usage-rpc.ts'
export { FailoverSearchProvider } from './host/failover-provider.ts'
export { UsageStore } from './host/usage-store.ts'
export { usageFingerprint } from './host/usage-fingerprint.ts'
export { buildPool } from './host/account-pool.ts'
export { maskApiKey } from './host/mask.ts'
export { parsePublishedAt } from './host/date.ts'

/**
 * 账号配置巡检周期（毫秒）。
 *
 * 只做指纹比较（纯内存，无请求），因此可以取短周期换取「配置后立刻可见」；真正的
 * 端点查询仍按用户配置的刷新周期执行。
 */
const CONFIG_WATCH_INTERVAL_MS = 5 * 1000

/** Cordis 插件名，用于 Loader 诊断。 */
export const name = FAILOVER_PROVIDER_ID

/** 需要的宿主服务：`web` 是搜索接缝，`credentials` 解析官方兜底凭据。 */
export const inject = ['web']

/**
 * 注册复合搜索提供方，并挂上详情页用量区块的只读 RPC。
 *
 * @param ctx - 插件上下文。
 * @param config - 当前配置面（每个字段一个 volatile 引用，保存后读取面即更新）。
 */
export function apply(ctx: Context, config: FailoverSearchConfig = Config({}) as FailoverSearchConfig): void {
  const usage = new UsageStore({
    adapters: {
      tinyfish: new TinyFishUsageAdapter(),
      tavily: new TavilyUsageAdapter(),
    },
  })

  // 兜底级：读用户既有的官方搜索设置（端点/模型/凭据引用），与「设置 → 插件 →
  // 网络搜索」保持一致，而不是只用包内默认值。
  /** 上一次刷新时的账号配置指纹；用于识别「配置变了、快照过期」。 */
  let lastFingerprint = ''

  const official = new DeepSeekSearchProvider(() => resolveOfficialOptions({
    settings: ctx.get('settings') as { describe: () => readonly { ns: string, value: unknown }[] } | undefined,
    credentials: ctx.get('credentials') as Parameters<typeof resolveOfficialOptions>[0]['credentials'],
    launch: launchEnvironmentOf(ctx),
    logger: ctx.logger,
  }))
  let refreshedAt: string | undefined

  const provider = new FailoverSearchProvider({
    readSettings: () => readSettings(config),
    adapters: {
      tinyfish: [new TinyFishAdapter()],
      tavily: [new TavilyAdapter()],
    },
    official: {
      id: OFFICIAL_SOURCE_ID,
      // 官方提供方自己判断凭据与端点是否就绪；这里透传它的判定。
      available: () => official.available(),
      search: (request, signal) => official.search(request, signal),
    },
    usage: {
      snapshot: () => usage.snapshot(),
      isFresh: () => usage.isFresh(),
      locallyLimited: label => usage.locallyLimited('tinyfish', label),
    },
    onAttempt: event => ctx.logger.debug('[failover-search] %s/%s %s (%dms)', event.platform, event.account, event.outcome, event.durationMs),
  })

  ctx.effect(() => ctx.web.registerSearchProvider(provider), 'dsh-failover-search: search provider')

  /**
   * 复合抓取提供方（FNOS-010-11）。
   *
   * 第一跳复用官方 `HttpFetchProvider`：limits 取官方默认档（与 `dsh-web-fetch-http`
   * 未配置时的默认一致），本地语义零变化。平台跳按 TinyFish → Tavily 排序——
   * TinyFish Fetch 免费且服务端渲染，Tavily Extract 消耗套餐配额，作次选。
   *
   * 账号复用 010-04 账号池：同一组 key，取每平台的**轮转头**账号（单次抓取没有
   * 均摊意义，但轮转推进让长期配额消耗仍均摊）。无账号的平台自然跳过。
   */
  const fetchProvider = new CompositeFetchProvider({
    id: FAILOVER_PROVIDER_ID,
    // 与搜索侧 onAttempt 对称：抓取也记逐跳事件，供诊断「这次取回走了哪一跳」。
    onHop: event => ctx.logger.debug('[failover-search:fetch] %s %s %s (%dms)', event.platform, event.outcome, event.url, event.durationMs),
    // limits 照抄官方 `Config` 的默认值（5e6 / 1e5 / 3e4 / 5 + 官方 UA）：
    // 本地跳要与「未接管 fetch 时的官方行为」逐项一致，否则兜底层一接管就
    // 悄悄改变了大小/超时/重定向语义。
    local: new HttpFetchProvider({
      maxResponseBytes: 5e6,
      maxBodyChars: 1e5,
      timeoutMs: 3e4,
      maxRedirects: 5,
      userAgent: DEFAULT_USER_AGENT,
    }),
    platforms: [
      {
        platform: TINYFISH_PLATFORM_ID,
        backend: {
          available: () => readSettings(config).tinyfishAccounts.length > 0,
          fetch: (request, signal) => {
            const accounts = readSettings(config).tinyfishAccounts
            const apiKey = accounts[0]?.key ?? ''
            return new TinyfishFetchAdapter({ apiKey, endpoint: 'https://api.fetch.tinyfish.ai' }).fetch(request, signal)
          },
        },
      },
      {
        platform: TAVILY_PLATFORM_ID,
        backend: {
          available: () => readSettings(config).tavilyAccounts.length > 0,
          fetch: (request, signal) => {
            const accounts = readSettings(config).tavilyAccounts
            const apiKey = accounts[0]?.key ?? ''
            return new TavilyExtractAdapter({ apiKey, endpoint: 'https://api.tavily.com/extract' }).fetch(request, signal)
          },
        },
      },
    ],
  })
  ctx.effect(() => ctx.web.registerFetchProvider(fetchProvider), 'dsh-failover-search: fetch provider')

  /** 刷新一次用量快照；失败只记日志，不影响搜索链路。 */
  const refreshUsage = async (signal?: AbortSignal): Promise<void> => {
    try {
      const current = readSettings(config)
      await usage.refresh(current, signal)
      refreshedAt = new Date().toISOString()
      lastFingerprint = usageFingerprint(current)
    } catch (error) {
      ctx.logger.warn('[failover-search] 用量快照刷新失败：%s', error instanceof Error ? error.message : String(error))
    }
  }

  // 后台按配置周期刷新（免费查询，不产生平台计费调用）；配置里的周期变化在下一轮
  // 生效，无需重启插件。
  //
  // 另有一个短周期巡检：账号配置变化（新增/删除/改名/换 key）后缓存快照立刻过期，
  // 下一次巡检立即重取。否则用户刚配好平台却看到「未配置账号」，要等满一个刷新周期
  // （默认 5 分钟）才会变，表现为「配置没生效」。巡检只比较指纹，不产生任何请求。
  ctx.effect(() => {
    let timer: ReturnType<typeof setInterval> | undefined
    const schedule = (): void => {
      if (timer !== undefined) clearInterval(timer)
      const minutes = Math.max(1, readSettings(config).usageRefreshMinutes)
      timer = setInterval(() => { void refreshUsage() }, minutes * 60 * 1000)
      // 常驻定时器不应阻止进程退出。
      timer.unref?.()
    }
    // 首次刷新在后台进行：进程刚启动时探测按「无用量信息」退化，不阻塞首次搜索。
    void refreshUsage()
    schedule()
    const watch = setInterval(() => {
      if (usageFingerprint(readSettings(config)) === lastFingerprint) return
      void refreshUsage()
    }, CONFIG_WATCH_INTERVAL_MS)
    watch.unref?.()
    return () => {
      if (timer !== undefined) clearInterval(timer)
      clearInterval(watch)
    }
  }, 'dsh-failover-search: usage refresh')

  // 详情页的只读读取面：用量快照与账号 key 掩码。`rpc.handle` 的路由归属解析需要
  // Connection 与 Web server 两个服务，用一个显式注入的子 Context 拿到它们。
  //
  // 处理函数返回 Connection 的结果信封（`{ ok: true, value }`）而不是裸值：传输层
  // 会原样转发这个信封，客户端按 `result.ok` 分支。抛出的异常由 Connection 折成
  // `{ ok: false, error }`，所以这里不需要自己构造失败分支。
  ctx.inject(['connection', 'webServer'], connectionCtx => {
    const injected = connectionCtx as unknown as { connection?: { rpc: { handle: (channel: string, handler: ConnectionRpcHandler) => () => Promise<void> } } }
    if (injected.connection === undefined) return
    injected.connection.rpc.handle(FAILOVER_USAGE_CHANNEL, async (endpoint, payload) => {
      if (endpoint === FAILOVER_USAGE_ENDPOINT) {
        const snapshot: UsageSnapshot = {
          accounts: usage.snapshot(),
          fresh: usage.isFresh(),
          ...(refreshedAt === undefined ? {} : { fetchedAt: refreshedAt }),
        }
        return { ok: true, value: snapshot }
      }
      if (endpoint === FAILOVER_REFRESH_ENDPOINT) {
        // 手动刷新（FNOS-010-08-AC-04）：强制重查两个平台的用量端点，然后回送新快照。
        // 复用后台刷新用的同一个 refreshUsage——它已把失败折成日志（单个账号查询失败
        // 不影响其它账号），因此刷新端点不会因平台侧错误而整体失败。
        await refreshUsage()
        const snapshot: UsageSnapshot = {
          accounts: usage.snapshot(),
          fresh: usage.isFresh(),
          ...(refreshedAt === undefined ? {} : { fetchedAt: refreshedAt }),
        }
        return { ok: true, value: snapshot }
      }
      if (endpoint === FAILOVER_REVEAL_ENDPOINT) {
        // 只在用户点击「复制」时按单个账号取明文：取回后由客户端直接写剪贴板，
        // 服务端不留存、不记录。账号不存在（并发删除、代号变更）时明确报错，
        // 不回落成「随便返回一个 key」。
        const request = (payload ?? {}) as Partial<RevealKeyRequest>
        const current = readSettings(config)
        const accounts = request.platform === TAVILY_PLATFORM_ID
          ? current.tavilyAccounts
          : request.platform === TINYFISH_PLATFORM_ID ? current.tinyfishAccounts : []
        const pool = buildPool(request.platform === TAVILY_PLATFORM_ID ? 'tavily' : 'tinyfish', accounts)
        const match = pool.find(account => account.label === request.label)
        if (match === undefined) throw new Error(`unknown account: ${String(request.platform)}/${String(request.label)}`)
        const revealed: RevealKeySnapshot = { key: match.key }
        return { ok: true, value: revealed }
      }
      if (endpoint === FAILOVER_ACCOUNTS_ENDPOINT) {
        // key 明文不跨线：这里只送出不可还原的掩码，让用户能辨认「这一行是哪个 key」。
        const current = readSettings(config)
        const summary: AccountsSnapshot = {
          accounts: [
            ...collectAccounts(TINYFISH_PLATFORM_ID, current.tinyfishAccounts),
            ...collectAccounts(TAVILY_PLATFORM_ID, current.tavilyAccounts),
          ],
        }
        return { ok: true, value: summary }
      }
      throw new Error(`unknown endpoint: ${endpoint}`)
    })
  })
}

/** 把一个平台的账号收敛成「代号 + key 掩码」的展示列表。 */
function collectAccounts(platform: string, accounts: readonly AccountConfig[]): readonly AccountSummary[] {
  return buildPool(platform as 'tinyfish' | 'tavily', accounts).map(account => ({
    platform,
    label: account.label,
    maskedKey: maskApiKey(account.key),
  }))
}
