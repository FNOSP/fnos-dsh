/** Shared contract for the fnOS theme snapshot persisted by the plugin. */

import type { Volatile } from '@deepseek-ai/cordis'

export type FnosTheme = 'light' | 'dark'

/** Host-backed settings owned by the fnOS integration plugin. */
export interface FnosSettings {
  /** Last resolved fnOS theme while DSH is configured to follow the system. */
  systemTheme?: FnosTheme
  /** User-managed third-party plugin API URL path prefixes. */
  gatewayProxyPaths?: string[]
  /**
   * 用户授权过的目录（内部 fnOS 路径），持久保存以在接口失败或插件重启后仍能展示。
   *
   * 只保存用户通过选择器主动添加的目录；fnOS 实时接口返回的共享路径是只读展示项，
   * 不写入这里，避免把应用声明路径误当成用户授权。
   */
  authorizedDirectories?: string[]
}

export const FNOS_SYSTEM_THEME_FIELD = 'systemTheme'
export const FNOS_GATEWAY_PROXY_PATHS_FIELD = 'gatewayProxyPaths'
export const FNOS_AUTHORIZED_DIRECTORIES_FIELD = 'authorizedDirectories'

/**
 * Resolved plugin config: volatile fields arrive as stable references.
 *
 * Declared here, not in the host schema module, because the client half also
 * reads these field names and must stay free of host-only dependencies.
 */
export interface FnosConfig {
  [FNOS_SYSTEM_THEME_FIELD]?: Volatile<FnosTheme | undefined>
  [FNOS_GATEWAY_PROXY_PATHS_FIELD]: Volatile<string[]>
  [FNOS_AUTHORIZED_DIRECTORIES_FIELD]: Volatile<string[]>
}

export function isFnosTheme(value: unknown): value is FnosTheme {
  return value === 'light' || value === 'dark'
}

/**
 * Read one volatile config field as a plain value.
 *
 * Accepts both shapes because `apply` is also invoked directly by tests and by
 * compositions that supply raw config: a reference is unwrapped, a plain value
 * is returned as-is, and anything else counts as absent.
 *
 * Lives in the shared contract on purpose: it is dependency-free (the
 * `Volatile` import is type-only and erases), so the browser half can use it
 * without pulling a host dependency into the client bundle.
 */
export function volatileValue<T>(value: Volatile<T> | T | undefined): T | undefined {
  if (typeof value !== 'object' || value === null) return value as T | undefined
  const read = (value as { get?: unknown }).get
  return typeof read === 'function' ? (read as () => T).call(value) : value as T
}
