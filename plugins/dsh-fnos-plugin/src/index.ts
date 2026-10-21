/** fnOS-specific integrations for DeepSeek Harness. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-settings'
import { registerAuthorizedDirectoryRoutes } from './host/authorized-directories.ts'
import { FNOS_AUTHORIZED_DIRECTORIES_SETTINGS_NAMESPACE } from './contracts/authorized-directories-contract.ts'
import { cachedFnosThemeFromConfig, injectCachedFnosTheme, type DshThemePreference } from './host/theme-bootstrap.ts'
import { FNOS_SYSTEM_THEME_FIELD, volatileValue, type FnosConfig, type FnosTheme } from './contracts/theme-contract.ts'
import { FnosSettingsSchema } from './contracts/theme-schema.ts'
import { registerGatewayProxyRoutes } from './host/gateway-proxy-routes.ts'
import { registerStaticAssetRoute } from './host/static-assets.ts'
import { registerPresentedPathRoute } from './host/presented-open.ts'

/** Stable Host bundle name. */
export const name = '@tnnevol/dsh-fnos'

/**
 * Runtime Config schema for the `dsh-fnos` settings entry.
 *
 * The **value** must be exported under the name `Config`: DSH resolves a
 * settings namespace through `entry.fiber.runtime.Config`, so without it every
 * `settings.update('dsh-fnos', …)` fails with `No configurable plugin entry
 * "dsh-fnos"`, and the DSH webserver turns the rejected route handler into an
 * empty-body `400`.
 *
 * The type is declared here too, so `Config` names both the schema value and
 * the {@link FnosConfig} shape it validates. Every field is `.volatile()`, which
 * is why Cordis hands `apply` a stable reference per field instead of a plain
 * value and a live edit reaches the running plugin without remounting it. The
 * schema itself lives in `contracts/theme-schema.ts` so the browser half never
 * inherits this host dependency.
 */
export const Config: FnosConfig & typeof FnosSettingsSchema = FnosSettingsSchema as FnosConfig & typeof FnosSettingsSchema

export type { FnosSettings } from './contracts/theme-contract.ts'

export const FNOS_AUTHORIZED_DIRECTORIES_SETTINGS_NS = FNOS_AUTHORIZED_DIRECTORIES_SETTINGS_NAMESPACE
const DSH_THEME_SETTINGS_NS = 'ui-theme'
const DSH_SETTINGS_ENTRY_ID = 'dsh-fnos'

/** Host services required to register the fnOS settings namespace and Web routes. */
export const inject = ['webServer', 'settings']

export function apply(ctx: Context, config?: FnosConfig): void {
  ctx.inject(['settings'], child => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })
  registerAuthorizedDirectoryRoutes(ctx, { settingsNamespace: DSH_SETTINGS_ENTRY_ID })
  registerGatewayProxyRoutes(ctx, DSH_SETTINGS_ENTRY_ID)
  registerStaticAssetRoute(ctx)
  registerPresentedPathRoute(ctx)
  ctx.inject(['webServer'], httpCtx => {
    httpCtx.effect(
      () => httpCtx.webServer.tapIndex(html => injectCachedFnosTheme(
        html,
        readDshThemePreference(ctx),
        cachedFnosThemeFromConfig(readCachedFnosTheme(config)),
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

/**
 * Read the cached fnOS theme from the live volatile config reference.
 *
 * Read per call, not captured once: a settings write updates the reference in
 * place, and the index transform must observe the newest value.
 */
function readCachedFnosTheme(config: FnosConfig | undefined): { systemTheme?: unknown } | undefined {
  const theme = volatileValue<FnosTheme | undefined>(config?.[FNOS_SYSTEM_THEME_FIELD])
  return theme === undefined ? undefined : { systemTheme: theme }
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
