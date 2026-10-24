/**
 * ZCode Start Plan 账号、模型目录与额度插件（宿主入口）。
 *
 * 装配关系：
 * - `ZCodeAuthService` 管理 OAuth 设备授权登录与凭据生命周期；
 * - `ZCodeCatalogService` 用账号 JWT 读额度，把 `capabilities` 投影成模型清单；
 * - `ZCodeProviderRuntime` 把清单投影成唯一的 `dsh-zcode` 路由；执行通道按端点
 *   策略分流：Start Plan 走托管的官方 app-server（可用），Ultra 走 HTTP 直连；
 * - `ZCodeUsageService` 读取 Start Plan 额度；
 * - `registerZCodeRoutes` 暴露同源 Web 路由给插件详情页与用量胶囊。
 *
 * 刷新是「登录变化 / 偏好变化 / 定时」三条触发路径的共同动作：重读目录、重建
 * provider、失效额度缓存。任何一路失败都保留上一份快照，只把原因暴露给界面。
 *
 * @module dsh-zcode
 */

import type { Context } from '@deepseek-ai/cordis'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-llm'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { defaultBridgeDataDir } from './host/bridge/runtime-paths.ts'
import { ZCodeAuthService } from './host/auth.ts'
import {
  toModel,
  ZCODE_BUILTIN_MODEL_IDS,
  ZCodeCatalogService,
} from './host/catalog.ts'
import { ZCodeConsoleClient } from './host/console-client.ts'
import { ZCodeCredentialStore } from './host/credentials.ts'
import { ZCodePreferencesStore } from './host/preferences.ts'
import { ZCodeProviderRuntime } from './host/provider.ts'
import { registerZCodeRoutes } from './host/routes.ts'
import { ZCodeUsageService } from './host/usage.ts'

/** 稳定的宿主插件名。 */
export const name = 'dsh-zcode-plugin'
/**
 * 模型层是硬依赖；Web 路由是可选增强。
 *
 * headless / tui 一类的 profile 没有 `webServer`，插件仍应提供服务；
 * 详情页与同源路由通过 `ctx.inject(['webServer'], …)` 只在 Web 装配下注册。
 * 否则插件会停在 pending，模型路由也不会注册（表现为 `NO_ADAPTER`）。
 */
export const inject = ['llm']

/** 定时刷新的最短间隔（毫秒）；偏好里的 0 表示关闭。 */
const MIN_REFRESH_INTERVAL_MS = 60_000

export function apply(ctx: Context): void {
  const credentials = new ZCodeCredentialStore()
  const preferences = new ZCodePreferencesStore()
  const client = new ZCodeConsoleClient()

  let refresh: (force: boolean) => Promise<void> = async () => {}
  const auth = new ZCodeAuthService({
    store: credentials,
    client,
    onCredentialChange: () => { void refresh(true) },
    logger: ctx.logger,
  })

  const catalog = new ZCodeCatalogService({
    client,
    resolveToken: () => auth.zcodeJwt(),
    resolveFamily: async () => (await auth.credential())?.family,
    logger: ctx.logger,
  })

  /** Start Plan 桥接通道的数据目录：DSH home 下、插件专属且可写。 */
  const bridgeDataDir = (): string => {
    const configured = process.env.DSH_ZCODE_DATA_DIR?.trim() ?? ''
    return configured !== '' ? configured : defaultBridgeDataDir(resolveDshHome())
  }
  /** Start Plan 桥接通道的客户端 CLI：允许用环境变量显式指定。 */
  const bridgeCliPath = (): string | undefined => {
    const configured = process.env.DSH_ZCODE_CLI?.trim() ?? ''
    return configured === '' ? undefined : configured
  }

  const runtime = new ZCodeProviderRuntime({
    // 端点策略决定用哪份凭据：Start Plan 认账号 JWT，Ultra 认家族 MaaS 令牌。
    resolveToken: async plan => (plan === 'ultra' ? auth.accessToken() : auth.zcodeJwt()),
    deviceMid: () => client.deviceMid(),
    resolveAttachments: () => ctx.get('attachments') as AttachmentStore | undefined,
    logger: ctx.logger,
    // 模型真正跑起来靠这条通道：托管官方 app-server，由它自己发签名请求。
    bridge: {
      dataDir: bridgeDataDir,
      family: async () => (await auth.credential())?.family ?? 'bigmodel',
      accountJwt: () => auth.zcodeJwt(),
      cliPath: bridgeCliPath,
    },
  })
  runtime.register(ctx)

  const usage = new ZCodeUsageService({
    client,
    resolveToken: () => auth.zcodeJwt(),
    resolveFamily: async () => (await auth.credential())?.family,
    logger: ctx.logger,
  })

  /** 把目录快照投影成 provider 模型，按「隐藏模型」过滤并按端点策略重建。 */
  const applyCatalog = async (): Promise<void> => {
    const snapshot = catalog.snapshot()
    if (snapshot === undefined) return
    const prefs = await preferences.read()
    const hidden = new Set(prefs.hiddenModels)
    runtime.update(
      snapshot.models.filter(model => !hidden.has(model.id)),
      prefs.endpointPlan,
    )
  }

  refresh = async (force: boolean): Promise<void> => {
    usage.invalidate()
    await (force ? catalog.refresh() : catalog.refreshIfStale())
    await applyCatalog()
  }

  let timer: ReturnType<typeof setInterval> | undefined
  /** 按偏好重建定时器；偏好变化或首次启动时调用。 */
  const schedule = async (): Promise<void> => {
    if (timer !== undefined) {
      clearInterval(timer)
      timer = undefined
    }
    const prefs = await preferences.read()
    if (prefs.refreshMinutes <= 0) return
    const interval = Math.max(MIN_REFRESH_INTERVAL_MS, prefs.refreshMinutes * 60_000)
    timer = setInterval(() => { void refresh(false).catch(() => undefined) }, interval)
    // 定时器不应单独撑住宿主进程退出。
    timer.unref?.()
  }

  ctx.effect(() => {
    void (async () => {
      try {
        // 先用内置兜底建立一份同步可用的快照：headless/tui 在插件挂载后立即
        // 开始第一轮对话，等网络目录会让首轮直接落到空 provider 上。
        // 真实目录随后台刷新替换它。
        runtime.update(
          ZCODE_BUILTIN_MODEL_IDS.map(id => toModel({ id, family: 'bigmodel' })),
          (await preferences.read()).endpointPlan,
        )
        await refresh(false)
        await applyCatalog()
        await schedule()
      } catch (error) {
        ctx.logger.warn('dsh-zcode: 初始化模型目录失败', error)
      }
    })()
    return () => {
      if (timer !== undefined) clearInterval(timer)
      timer = undefined
    }
  }, 'dsh-zcode: 目录与额度刷新')

  ctx.inject(['webServer'], (scoped) => {
    registerZCodeRoutes(scoped, {
      auth,
      usage,
      catalog,
      preferences,
      refresh,
      preferencesChanged: async () => {
        await applyCatalog()
        await schedule()
      },
      routes: () => runtime.routeStatus(),
    })
  })
}

export {
  bridgeProviderId,
  ZCODE_BRIDGE_REQUEST_TIMEOUT_MS,
  ZCODE_BRIDGE_TURN_TIMEOUT_MS,
  ZCodeBridgeAdapter,
} from './host/bridge/adapter.ts'
export type {
  ZCodeBridgeAdapterOptions,
  ZCodeBridgeFamily,
  ZCodeImageLocator,
} from './host/bridge/adapter.ts'
export { ZCodeCompositeAdapter } from './host/bridge/composite.ts'
export type { ZCodeCompositeAdapterOptions } from './host/bridge/composite.ts'
export {
  buildAppServerEnv,
  ZCODE_RUNTIME_PREFERENCES,
  ZCodeProtocolClient,
} from './host/bridge/protocol.ts'
export type {
  ZCodeBridgeLogger,
  ZCodeNotification,
  ZCodeProtocolClientOptions,
  ZCodeReverseRequestHandlers,
} from './host/bridge/protocol.ts'
export {
  credentialSecret,
  defaultBridgeDataDir,
  deriveCredentialKey,
  encryptCredential,
  isWritableDirectory,
  prepareBridgeDataDir,
  readBuiltinRevision,
  resolveBuiltinConfigPath,
  resolveZCodeCliPath,
  ZCODE_BRIDGE_DIRNAME,
  ZCODE_CLI_CANDIDATES,
  ZCODE_FALLBACK_APP_VERSION,
  zcodeDataDir,
} from './host/bridge/runtime-paths.ts'
export {
  agentModelId,
  BRIDGE_TOOL_NOTE,
  BRIDGE_TOOL_RULE,
  extractMessage,
  flattenConversation,
  lastUserText,
  looksLikeLeakedCall,
  normalizeModelKey,
  sanitizeLeakedCalls,
  ZCODE_AGENT_MODEL_IDS,
} from './host/bridge/transcript.ts'

export { ZCodeAuthService } from './host/auth.ts'
export type { ZCodeAuthServiceOptions } from './host/auth.ts'
export {
  modelIdsFromBalances,
  thinkingLevelMapOf,
  toBalanceEntries,
  toModel,
  ZCODE_BUILTIN_MODEL_IDS,
  ZCodeCatalogService,
} from './host/catalog.ts'
export type { ZCodeCatalogServiceOptions } from './host/catalog.ts'
export {
  ZCODE_FALLBACK_CONTEXT_WINDOW,
  ZCODE_FALLBACK_MAX_TOKENS,
} from './host/catalog.ts'
export {
  zcodeMessagesUrl,
  zcodeModelHeaders,
  zcodeSourceHeaders,
  ZCodeConsoleClient,
  ZCodeConsoleError,
} from './host/console-client.ts'
export type {
  ZCodeAgentConfigSnapshot,
  ZCodeBalanceSnapshot,
  ZCodeClientConfigSnapshot,
  ZCodeClientModel,
  ZCodeClientOptions,
  ZCodeOAuthInit,
  ZCodeOAuthPoll,
  ZCodeRawBalance,
  ZCodeRawPlan,
} from './host/console-client.ts'
export { ZCODE_AUTH_FILENAME, ZCodeCredentialStore, zcodeAuthPath } from './host/credentials.ts'
export {
  ZCODE_PREFERENCES_FILENAME,
  ZCodePreferencesStore,
  zcodePreferencesPath,
} from './host/preferences.ts'
export {
  createZCodePiAdapter,
  createZCodeProfile,
  createZCodeProvider,
  toPiModel,
  ZCodeProviderRuntime,
} from './host/provider.ts'
export type { ZCodeProviderRuntimeOptions, ZCodeRouteStatus } from './host/provider.ts'
export {
  registerZCodeRoutes,
  trustedRequest,
  ZCODE_CATALOG_UNAVAILABLE,
  ZCODE_ORIGIN_NOT_TRUSTED,
} from './host/routes.ts'
export type { ZCodeRoutesOptions } from './host/routes.ts'
export { ZCodeUsageService } from './host/usage.ts'
export type {
  ZCodeUsageFailure,
  ZCodeUsageResult,
  ZCodeUsageServiceOptions,
} from './host/usage.ts'
export { ZCODE_ROUTES, ZCODE_ROUTE_PREFIX } from './contracts/routes.ts'
export {
  DEFAULT_ZCODE_ENDPOINT_PLAN,
  ZCODE_ANTHROPIC_BASE_URL,
  ZCODE_ANTHROPIC_BASE_URLS,
  ZCODE_CLIENT_VERSION,
  ZCODE_ENDPOINT_PLAN_LABELS,
  ZCODE_FAMILIES,
  ZCODE_FAMILY_LABELS,
  ZCODE_ORIGIN,
  ZCODE_PROVIDER,
  ZCODE_PROVIDER_NAME,
  ZCODE_USER_AGENT,
} from './contracts/identity.ts'
export type { ZCodeEndpointPlan, ZCodeFamily } from './contracts/identity.ts'
export {
  findModel,
  modelIdOfCapability,
  normalizeModelId,
  selectableModels,
  ZCODE_REASONING_LEVELS,
} from './contracts/catalog.ts'
export type {
  ZCodeApiKind,
  ZCodeBalanceEntry,
  ZCodeCatalog,
  ZCodeModel,
  ZCodePlanEntry,
  ZCodeReasoningLevel,
  ZCodeThinkingLevelMap,
} from './contracts/catalog.ts'
export type {
  ZCodeAccountInfo,
  ZCodeAuthStatus,
  ZCodeCredentialRecord,
  ZCodeLoginChallenge,
} from './contracts/auth.ts'
export {
  normalizePreferences,
  ZCODE_REFRESH_MINUTES,
  DEFAULT_ZCODE_PREFERENCES,
} from './contracts/preferences.ts'
export type {
  ZCodePreferences,
  ZCodeUsageVisibility,
} from './contracts/preferences.ts'
export {
  remainingPercent,
  resetAfterMs,
  usagePercent,
} from './contracts/usage.ts'
export type { ZCodeUsage, ZCodeUsageWindow } from './contracts/usage.ts'
