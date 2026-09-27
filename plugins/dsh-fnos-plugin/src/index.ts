/** fnOS-specific integrations for DeepSeek Harness. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { registerAuthorizedDirectoryRoutes } from './host/authorized-directories.ts'
import { FNOS_AUTHORIZED_DIRECTORIES_SETTINGS_NAMESPACE } from './contracts/authorized-directories-contract.ts'
import { injectCachedFnosTheme, type DshThemePreference } from './host/theme-bootstrap.ts'
import { FNOS_GATEWAY_PROXY_PATHS_FIELD, FNOS_SYSTEM_THEME_FIELD, isFnosTheme, type FnosTheme } from './contracts/theme-contract.ts'
import { registerGatewayProxyRoutes } from './host/gateway-proxy-routes.ts'
import { registerStaticAssetRoute } from './host/static-assets.ts'
import { registerPresentedPathRoute } from './host/presented-open.ts'

/** Stable Host bundle name. */
export const name = '@tnnevol/dsh-fnos'

/** Settings back the fnOS card and the cached pre-plugin theme bootstrap. */
export const FnosSettingsSchema = z.object({
  [FNOS_SYSTEM_THEME_FIELD]: z.union(['light', 'dark']).volatile(),
  [FNOS_GATEWAY_PROXY_PATHS_FIELD]: z.array(z.string()).default([]).volatile(),
})
export interface Config {
  [FNOS_SYSTEM_THEME_FIELD]?: FnosTheme
  [FNOS_GATEWAY_PROXY_PATHS_FIELD]: string[]
}
export const FNOS_AUTHORIZED_DIRECTORIES_SETTINGS_NS = FNOS_AUTHORIZED_DIRECTORIES_SETTINGS_NAMESPACE
const DSH_THEME_SETTINGS_NS = 'ui-theme'
const DSH_SETTINGS_ENTRY_ID = 'dsh-fnos'

/** Host services required to register the fnOS settings namespace and Web routes. */
export const inject = ['webServer', 'settings']

export function apply(ctx: Context, config: Config): void {
  ctx.inject(['settings'], child => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })
  registerAuthorizedDirectoryRoutes(ctx)
  registerGatewayProxyRoutes(ctx, DSH_SETTINGS_ENTRY_ID)
  registerStaticAssetRoute(ctx)
  registerPresentedPathRoute(ctx)
  ctx.inject(['webServer'], httpCtx => {
    httpCtx.effect(
      () => httpCtx.webServer.tapIndex(html => injectCachedFnosTheme(
        html,
        readDshThemePreference(ctx),
        readCachedFnosTheme(config),
      )),
      'dsh-fnos: cached fnOS theme bootstrap',
    )
  })
}

function readDshThemePreference(ctx: Context): DshThemePreference {
  const section = ctx.settings.describe().find(row => row.ns === DSH_THEME_SETTINGS_NS)?.value as { preference?: unknown } | undefined
  return section?.preference === 'light' || section?.preference === 'dark' || section?.preference === 'system'
    ? section.preference
    : 'system'
}

function readCachedFnosTheme(config: Config): FnosTheme | null {
  return isFnosTheme(config[FNOS_SYSTEM_THEME_FIELD]) ? config[FNOS_SYSTEM_THEME_FIELD] : null
}

export {
  FNOS_AUTHORIZED_DIRECTORIES_DELETE_PATH,
  FNOS_AUTHORIZED_ENTRIES_PATH,
  FNOS_AUTHORIZED_DIRECTORIES_PATH,
  FNOS_AUTHORIZED_DIRECTORIES_SETTINGS_NAMESPACE,
  FNOS_PATH_CONVERSION_PATH,
  FNOS_PATH_OPEN_VALIDATION_PATH,
} from './contracts/authorized-directories-contract.ts'
export { FNOS_SETTINGS_DOCUMENT_PATH } from './contracts/settings-document-contract.ts'
export { FNOS_GATEWAY_PROXY_PATHS_ROUTE, normalizeGatewayProxyPaths, validateGatewayProxyPaths } from './contracts/gateway-proxy-contract.ts'
export {
  accessiblePathsFromEnvironment,
  convertPathsForDisplay,
  dataSharePathsFromEnvironment,
  FNOS_ACCESSIBLE_PATHS_ENV,
  FNOS_DATA_SHARE_PATHS_ENV,
  mergeAuthorizedPaths,
  markAuthorizedPathRemoved,
  normalizeAuthorizedPath,
  normalizeAuthorizedPaths,
  normalizePathForAuthorization,
  isPathWithinAuthorizedDirectory,
  isAuthorizedPathForOpen,
  validatePathForOpen,
  gatewayUserId,
  loadAuthorizedEntries,
  splitPathEnvironment,
} from './host/authorized-directories.ts'
