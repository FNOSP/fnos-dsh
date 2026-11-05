/**
 * OpenCode Go 账号、模型目录与套餐用量插件（宿主入口）。
 *
 * 装配关系：
 * - `OpenCodeAuthService` 管理 Console 设备码登录与 token 刷新；
 * - `OpenCodeEntitlementService` 判定账号套餐（Go / Go Plus / Go Teams / 按量）；
 * - `OpenCodeCatalogService` 用 Auth token 读取工作空间模型，合并公开目录；
 * - `OpenCodeProviderRuntime` 把目录投影成唯一的 `dsh-opencode` 路由，
 *   同名模型用 `zen:` / `go:` 前缀与 `· zen` / `· go` 后缀区分；
 * - `OpenCodeUsageService` 读取 Go 套餐额度；
 * - `registerOpenCodeRoutes` 暴露同源 Web 路由给插件详情页与用量胶囊。
 *
 * 刷新是「登录变化 / 偏好变化 / 定时」三条触发路径的共同动作：重读套餐与目录、
 * 按套餐整侧过滤、按该档位的预计请求数排序、重建 provider、失效用量缓存。
 * 任何一路失败都保留上一份快照，只把原因暴露给界面；套餐读不出来时保持合并
 * 列表与原生端点，绝不把选择器清空。
 *
 * @module dsh-opencode
 */

import { opencodeProvider } from '@earendil-works/pi-ai/providers/opencode'
import { opencodeGoProvider } from '@earendil-works/pi-ai/providers/opencode-go'
import type { Context } from '@deepseek-ai/cordis'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-llm'
import { applyCatalogView, buildCatalog, OpenCodeCatalogService } from './host/catalog.ts'
import { OpenCodeAuthService } from './host/auth.ts'
import type {
  OpenCodeAccountEntitlement,
  OpenCodeAccountPlan,
  OpenCodeCatalog,
} from './contracts/catalog.ts'
import { estimatesForPlan, type OpenCodeEstimateTable } from './contracts/estimates.ts'
import { OpenCodeConsoleClient } from './host/console-client.ts'
import { OpenCodeCredentialStore } from './host/credentials.ts'
import { OpenCodeEntitlementService } from './host/entitlement.ts'
import type { OpenCodeEndpointPlan } from './contracts/preferences.ts'
import { OpenCodePreferencesStore } from './host/preferences.ts'
import { OpenCodeProviderRuntime } from './host/provider.ts'
import { modelKey, type OpenCodePlan } from './contracts/identity.ts'
import { registerOpenCodeRoutes } from './host/routes.ts'
import { OpenCodeUsageService } from './host/usage.ts'

/** 稳定的宿主插件名。 */
export const name = 'dsh-opencode-plugin'
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

/**
 * 当前生效的推理端点策略。
 *
 * 手选 `zen` / `go` 原样生效；`auto` 跟随账号套餐——有 Go 订阅（含 Plus / Teams）
 * 就把共用模型统一打到 Go 端点，只有按量余额就打按量端点。套餐读不出来
 * （`unknown`）时保持 `auto`，让各模型留在原生端点：把本来能用的模型改到
 * 不可用的端点上，比不做优化更糟。
 *
 * @param prefs - 偏好里保存的端点策略。
 * @param accountPlan - 账号套餐档位。
 * @returns 实际生效的端点来源；`auto` 表示不改写 `baseURL`。
 */
export function effectiveEndpointPlan(
  prefs: OpenCodeEndpointPlan,
  accountPlan: OpenCodeAccountPlan,
): OpenCodePlan | 'auto' {
  if (prefs === 'zen' || prefs === 'go') return prefs
  switch (accountPlan) {
    case 'go':
    case 'go-plus':
    case 'go-teams':
      return 'go'
    case 'payg':
      return 'zen'
    default:
      return 'auto'
  }
}

export function apply(ctx: Context): void {
  const credentials = new OpenCodeCredentialStore()
  const preferences = new OpenCodePreferencesStore()
  const client = new OpenCodeConsoleClient()

  let refresh: (force: boolean) => Promise<void> = async () => {}
  const auth = new OpenCodeAuthService({
    store: credentials,
    client,
    onCredentialChange: () => { void refresh(true) },
    logger: ctx.logger,
  })

  /**
   * 当前可用凭据，目录与套餐两个服务共用。
   *
   * 用 `accessToken()` 而不是原始记录：OAuth 过期时它会先单飞刷新，否则
   * Console 配置接口只会得到一个 401。未登录时为 undefined。
   */
  const resolveAccount = async (): Promise<{
    readonly access: string
    readonly orgId?: string
    readonly server?: string
  } | undefined> => {
    const access = await auth.accessToken()
    if (access === undefined) return undefined
    const record = await auth.credential()
    return {
      access,
      ...(record?.orgId === undefined ? {} : { orgId: record.orgId }),
      ...(record?.server === undefined ? {} : { server: record.server }),
    }
  }

  const builtinModels = {
    zen: opencodeProvider().getModels(),
    go: opencodeGoProvider().getModels(),
  }
  const runtime = new OpenCodeProviderRuntime({
    resolveAccessToken: () => auth.accessToken(),
    resolveAttachments: () => ctx.get('attachments') as AttachmentStore | undefined,
    logger: ctx.logger,
  })
  // 先用 pi-ai 内置目录建立一份同步可用的快照：headless/tui 在插件挂载后
  // 立即开始第一轮对话，等网络目录会让首轮直接落到一个空 provider 上。
  // 真实目录随后台刷新替换它。此刻还没有套餐，只排序（`unknown` 不过滤）。
  runtime.update(applyCatalogView(buildCatalog({ builtin: builtinModels }).models, { accountPlan: 'unknown' }))
  runtime.register(ctx)

  /**
   * 构建目录时注入的估算表（按最近一次读到的套餐档位）。
   *
   * 目录服务在 `buildCatalog` 时读它，`applyCatalog` 用同一个档位计算排序口径，
   * 保证 `estimatedRequestsPerMonth` 与排序来自同一张表。档位变化时刷新流程会
   * 重建快照，不会留下上一档的额度。
   */
  let estimatesTable: OpenCodeEstimateTable | undefined

  const catalog = new OpenCodeCatalogService({
    resolveAccount,
    builtin: () => builtinModels,
    estimates: () => estimatesTable,
  })

  const usage = new OpenCodeUsageService({ resolveToken: () => auth.accessToken() })
  const entitlements = new OpenCodeEntitlementService({ resolveToken: resolveAccount })

  /**
   * 把目录快照投影成 provider 模型：按账号套餐整侧过滤、按该档位的预计请求数
   * 排序，再套端点策略与「隐藏模型」偏好。
   *
   * `accountPlan` 由刷新流程传入，保证与本次目录构建用的是同一次套餐读取；
   * 偏好变化等旁路调用不传，退回读缓存里的套餐快照。
   */
  const applyCatalog = async (
    snapshot: OpenCodeCatalog | undefined,
    accountPlan?: OpenCodeAccountPlan,
  ): Promise<void> => {
    if (snapshot === undefined) return
    const prefs = await preferences.read()
    const hidden = new Set(prefs.hiddenModels)
    const plan = accountPlan ?? (await entitlements.read()).plan
    const endpoint = effectiveEndpointPlan(prefs.endpointPlan, plan)
    // `clientOnly` 的免费模型只保留在目录卡片里做禁用展示，不进入模型选择器。
    const visible = snapshot.models.filter(model =>
      model.disabled !== true
      && model.clientOnly !== true
      && !hidden.has(modelKey(model.plan, model.id)))
    // 套餐未知时不做整侧过滤：回落到按 zen 去重的合并列表，等于未登录时的样子。
    const models = plan === 'unknown'
      ? applyCatalogView(visible, { ownedPlan: 'zen', endpointPlan: endpoint })
      : applyCatalogView(visible, {
          accountPlan: plan,
          estimates: estimatesForPlan(plan),
          endpointPlan: endpoint,
        })
    runtime.update(models, {
      ...(catalog.requestHeaders('zen') ?? {}),
      ...(catalog.requestHeaders('go') ?? {}),
    })
  }

  refresh = async (force: boolean): Promise<void> => {
    usage.invalidate()
    // 强制刷新来自登录变化或用户点击：顺手丢弃套餐快照，续费/退订能立刻生效。
    // 定时刷新走套餐服务自己的 60 秒缓存，不再额外探测。
    if (force) entitlements.invalidate()
    const entitlement: OpenCodeAccountEntitlement = await entitlements.read()
    const table = estimatesForPlan(entitlement.plan)
    // 档位变了：上一份快照里带的是旧档位的额度，必须重建而不是复用旧快照。
    const planChanged = table !== estimatesTable
    estimatesTable = table
    const snapshot = force || planChanged
      ? await catalog.refresh()
      : await catalog.refreshIfStale()
    await applyCatalog(snapshot, entitlement.plan)
  }

  let timer: ReturnType<typeof setInterval> | undefined
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
        await refresh(false)
        await schedule()
      } catch (error) {
        ctx.logger.warn('dsh-opencode: 初始化模型目录失败', error)
      }
    })()
    return () => {
      if (timer !== undefined) clearInterval(timer)
      timer = undefined
    }
  }, 'dsh-opencode: 目录与用量刷新')

  ctx.inject(['webServer'], (scoped) => {
    registerOpenCodeRoutes(scoped, {
      auth,
      usage,
      catalog,
      preferences,
      refresh,
      preferencesChanged: async () => {
        await applyCatalog(catalog.current())
        await schedule()
      },
      routes: () => runtime.routeStatus(),
      entitlement: () => entitlements.read(),
      endpointPlan: async () => effectiveEndpointPlan(
        (await preferences.read()).endpointPlan,
        (await entitlements.read()).plan,
      ),
    })
  })
}

export { OpenCodeAuthService } from './host/auth.ts'
export type { OpenCodeAuthServiceOptions } from './host/auth.ts'
export { OpenCodeCatalogService, buildCatalog, fetchOpenCodeCatalog } from './host/catalog.ts'
export type { BuildCatalogInput, FetchCatalogInput, FetchCatalogResult } from './host/catalog.ts'
export { OpenCodeConsoleClient } from './host/console-client.ts'
export { OPENCODE_AUTH_FILENAME, OpenCodeCredentialStore } from './host/credentials.ts'
export { OpenCodeEntitlementService } from './host/entitlement.ts'
export type { OpenCodeEntitlement } from './host/entitlement.ts'
export { OPENCODE_PREFERENCES_FILENAME, OpenCodePreferencesStore } from './host/preferences.ts'
export { createOpenCodeProvider, OpenCodeProviderRuntime, toPiModel } from './host/provider.ts'
export { registerOpenCodeRoutes } from './host/routes.ts'
export type { OpenCodeRoutesOptions } from './host/routes.ts'
export { OpenCodeUsageService, parseOpenCodeUsage } from './host/usage.ts'
export { OPENCODE_ROUTES } from './contracts/routes.ts'
export { OPENCODE_PROVIDER, OPENCODE_PROVIDER_NAME } from './contracts/identity.ts'
export type { OpenCodeAccountEntitlement, OpenCodeAccountPlan, OpenCodeCatalog, OpenCodeModel } from './contracts/catalog.ts'
export type { OpenCodeAuthStatus, OpenCodeLoginChallenge } from './contracts/auth.ts'
export type { OpenCodeUsage, OpenCodeUsageWindow } from './contracts/usage.ts'
export type { OpenCodePreferences } from './contracts/preferences.ts'
