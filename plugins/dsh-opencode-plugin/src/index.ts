/**
 * OpenCode Go 账号、模型目录与套餐用量插件（宿主入口）。
 *
 * 装配关系：
 * - `OpenCodeAuthService` 管理 Console 设备码登录与 token 刷新；
 * - `OpenCodeCatalogService` 用 Auth token 读取工作空间模型，合并公开目录；
 * - `OpenCodeProviderRuntime` 把目录投影成 `dsh-opencode`（Zen 按量）与
 *   `dsh-opencode-go`（Go 套餐）两组路由（动态 provider）；
 * - `OpenCodeUsageService` 读取 Go 套餐额度；
 * - `registerOpenCodeRoutes` 暴露同源 Web 路由给插件详情页与用量胶囊。
 *
 * 刷新是「登录变化 / 偏好变化 / 定时」三条触发路径的共同动作：重读目录、重建
 * provider、失效用量缓存。任何一路失败都保留上一份快照，只把原因暴露给界面。
 *
 * @module dsh-opencode
 */

import { opencodeProvider } from '@earendil-works/pi-ai/providers/opencode'
import { opencodeGoProvider } from '@earendil-works/pi-ai/providers/opencode-go'
import type { Context } from '@deepseek-ai/cordis'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-llm'
import { buildCatalog, OpenCodeCatalogService } from './host/catalog.ts'
import { OpenCodeAuthService } from './host/auth.ts'
import type { OpenCodeCatalog } from './contracts/catalog.ts'
import { OpenCodeConsoleClient } from './host/console-client.ts'
import { OpenCodeCredentialStore } from './host/credentials.ts'
import { OpenCodePreferencesStore } from './host/preferences.ts'
import { OpenCodeProviderRuntime } from './host/provider.ts'
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
  // 真实目录随后台刷新替换它。
  runtime.update(buildCatalog({ builtin: builtinModels }).models)
  runtime.register(ctx)

  const catalog = new OpenCodeCatalogService({
    resolveAccount: async () => {
      // 用 accessToken() 而不是原始记录：OAuth 过期时它会先单飞刷新，
      // 否则 Console 配置接口只会得到一个 401。
      const access = await auth.accessToken()
      if (access === undefined) return undefined
      const record = await auth.credential()
      return {
        access,
        ...(record?.orgId === undefined ? {} : { orgId: record.orgId }),
        ...(record?.server === undefined ? {} : { server: record.server }),
      }
    },
    builtin: () => builtinModels,
  })

  const usage = new OpenCodeUsageService({ resolveToken: () => auth.accessToken() })

  /** 把目录快照投影成两组 provider 模型，并应用「隐藏模型」偏好。 */
  const applyCatalog = async (snapshot: OpenCodeCatalog | undefined): Promise<void> => {
    if (snapshot === undefined) return
    const prefs = await preferences.read()
    const hidden = new Set(prefs.hiddenModels)
    runtime.update(
      snapshot.models.filter(model => model.disabled !== true && !hidden.has(model.id)),
      {
        zen: catalog.requestHeaders('zen') ?? {},
        go: catalog.requestHeaders('go') ?? {},
      },
    )
  }

  refresh = async (force: boolean): Promise<void> => {
    usage.invalidate()
    const snapshot = force ? await catalog.refresh() : await catalog.refreshIfStale()
    await applyCatalog(snapshot)
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
    })
  })
}

export { OpenCodeAuthService } from './host/auth.ts'
export type { OpenCodeAuthServiceOptions } from './host/auth.ts'
export { OpenCodeCatalogService, buildCatalog, fetchOpenCodeCatalog } from './host/catalog.ts'
export type { BuildCatalogInput, FetchCatalogInput, FetchCatalogResult } from './host/catalog.ts'
export { OpenCodeConsoleClient } from './host/console-client.ts'
export { OPENCODE_AUTH_FILENAME, OpenCodeCredentialStore } from './host/credentials.ts'
export { OPENCODE_PREFERENCES_FILENAME, OpenCodePreferencesStore } from './host/preferences.ts'
export { createOpenCodeProvider, OpenCodeProviderRuntime, toPiModel } from './host/provider.ts'
export { registerOpenCodeRoutes } from './host/routes.ts'
export type { OpenCodeRoutesOptions } from './host/routes.ts'
export { OpenCodeUsageService, parseOpenCodeUsage } from './host/usage.ts'
export { OPENCODE_ROUTES } from './contracts/routes.ts'
export { OPENCODE_PROVIDER, OPENCODE_PROVIDER_NAME } from './contracts/identity.ts'
export type { OpenCodeCatalog, OpenCodeModel } from './contracts/catalog.ts'
export type { OpenCodeAuthStatus, OpenCodeLoginChallenge } from './contracts/auth.ts'
export type { OpenCodeUsage, OpenCodeUsageWindow } from './contracts/usage.ts'
export type { OpenCodePreferences } from './contracts/preferences.ts'
