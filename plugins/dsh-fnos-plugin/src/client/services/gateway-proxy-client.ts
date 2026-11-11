/**
 * 「三方插件代理」的同源调用：读取与保存前缀。
 *
 * 保存只提交手动项；自动项由宿主读路由表得到，客户端不参与。
 *
 * @module dsh-fnos/client/gateway-proxy-client
 */

import {
  FNOS_GATEWAY_BUILTIN_PREFIXES,
  FNOS_GATEWAY_PROXY_PATHS_ROUTE,
  FNOS_INSTALLED_PLUGINS_ROUTE,
  FNOS_PLUGIN_INSTALL_ROUTE,
  FNOS_PLUGIN_INSTALL_STATE_ROUTE,
  FNOS_PLUGIN_INSTALL_LOG_ROUTE,
  FNOS_PLUGIN_TOGGLE_ROUTE,
  FNOS_PLUGIN_REMOVE_ROUTE,
} from '../../contracts/gateway-proxy-contract.ts'
import type { GatewayAutoPathsStatus, InstalledPluginsSnapshot } from '../../contracts/gateway-proxy-contract.ts'

/** 读取结果。 */
export interface GatewayProxySnapshot {
  /** 手动前缀。 */
  readonly paths: readonly string[]
  /** 自动识别状态（含分组明细）。 */
  readonly auto: GatewayAutoPathsStatus
  /** 网关内置前缀（只读区展示用）。 */
  readonly builtin: readonly { path: string, description: string }[]
}

/** 归一化路由返回的 auto 结构；缺字段时按「不可用」处理。 */
function toAuto(value: unknown): GatewayAutoPathsStatus {
  if (typeof value !== 'object' || value === null) {
    return { available: false, reason: 'auto-paths-missing', groups: [], prefixes: [] }
  }
  const record = value as Partial<GatewayAutoPathsStatus>
  const groups = Array.isArray(record.groups)
    ? record.groups.map(group => ({
      prefix: String(group.prefix),
      routes: Array.isArray(group.routes) ? group.routes.map(String) : [],
      kinds: Array.isArray(group.kinds) ? group.kinds : [],
    }))
    : []
  return {
    available: record.available === true,
    ...(typeof record.reason === 'string' ? { reason: record.reason } : {}),
    groups,
    prefixes: Array.isArray(record.prefixes) ? record.prefixes.map(String) : groups.map(group => group.prefix),
  }
}

/**
 * 取当前前缀配置与自动识别状态。
 * @returns 快照。
 */
export async function fetchGatewayProxyPaths(): Promise<GatewayProxySnapshot> {
  const response = await fetch(FNOS_GATEWAY_PROXY_PATHS_ROUTE, {
    method: 'GET',
    headers: { accept: 'application/json' },
    credentials: 'same-origin',
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
  const value = await response.json() as { paths?: unknown, auto?: unknown }
  return {
    paths: Array.isArray(value.paths) ? value.paths.map(String) : [],
    auto: toAuto(value.auto),
    builtin: FNOS_GATEWAY_BUILTIN_PREFIXES,
  }
}

/**
 * 保存手动前缀。
 *
 * 用 `{ version, paths }` 文档形态提交：契约里的 `submittedPaths` 对文档与裸数组
 * 都接受，但文档形态能与网关侧的解析口径对齐（两侧都按文档校验）。
 * @param paths - 手动前缀。
 * @returns 保存后的快照。
 */
export async function saveGatewayProxyPaths(paths: readonly string[]): Promise<GatewayProxySnapshot> {
  const response = await fetch(FNOS_GATEWAY_PROXY_PATHS_ROUTE, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ version: 1, paths }),
  })
  if (!response.ok) {
    const value: unknown = await response.json().catch(() => undefined)
    const code = typeof value === 'object' && value !== null && 'error' in value && typeof value.error === 'string'
      ? value.error
      : `HTTP ${String(response.status)}`
    throw new Error(code)
  }
  const saved = await response.json() as { paths?: unknown, auto?: unknown }
  return {
    paths: Array.isArray(saved.paths) ? saved.paths.map(String) : [],
    auto: toAuto(saved.auto),
    builtin: FNOS_GATEWAY_BUILTIN_PREFIXES,
  }
}

/**
 * 取已安装插件清单。
 * @returns 快照；读不到 profile 时 `available: false`。
 */
export async function fetchInstalledPlugins(checkUpdates = false): Promise<InstalledPluginsSnapshot> {
  // 默认不联网查更新：每个插件一次 registry 请求会让首屏很慢。
  const query = checkUpdates ? '?updates=1' : ''
  const response = await fetch(`${FNOS_INSTALLED_PLUGINS_ROUTE}${query}`, {
    method: 'GET',
    headers: { accept: 'application/json' },
    credentials: 'same-origin',
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
  const value = await response.json() as Partial<InstalledPluginsSnapshot>
  return {
    available: value.available === true,
    ...(typeof value.reason === 'string' ? { reason: value.reason } : {}),
    plugins: Array.isArray(value.plugins) ? value.plugins : [],
  }
}

/** 安装进度（与宿主 `PluginInstallState` 同形）。 */
export interface PluginInstallStateSnapshot {
  readonly running: boolean
  readonly name?: string
  readonly version?: string
  readonly status?: 'succeeded' | 'failed'
  readonly error?: string
}

/**
 * 启动安装。
 * @param name - 包名。
 * @returns 结束状态。
 */
export async function startPluginInstall(name: string): Promise<PluginInstallStateSnapshot> {
  const response = await fetch(FNOS_PLUGIN_INSTALL_ROUTE, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ name }),
  })
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
  return await response.json() as PluginInstallStateSnapshot
}

/**
 * 读安装状态。
 * @returns 状态。
 */
export async function fetchInstallState(): Promise<PluginInstallStateSnapshot> {
  const response = await fetch(FNOS_PLUGIN_INSTALL_STATE_ROUTE, {
    headers: { accept: 'application/json' },
    credentials: 'same-origin',
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
  return await response.json() as PluginInstallStateSnapshot
}

/**
 * 增量读安装日志。
 * @param offset - 起始字节。
 * @returns 新增文本与新偏移。
 */
export async function fetchInstallLog(offset: number): Promise<{ text: string, offset: number }> {
  const response = await fetch(`${FNOS_PLUGIN_INSTALL_LOG_ROUTE}?offset=${String(offset)}`, {
    headers: { accept: 'application/json' },
    credentials: 'same-origin',
    cache: 'no-store',
  })
  if (!response.ok) return { text: '', offset }
  const value = await response.json() as { text?: unknown, offset?: unknown }
  return {
    text: typeof value.text === 'string' ? value.text : '',
    offset: typeof value.offset === 'number' ? value.offset : offset,
  }
}

/**
 * 启用/禁用插件。
 * @param name - 包名。
 * @param enabled - 目标状态。
 */
export async function togglePlugin(name: string, enabled: boolean): Promise<void> {
  const response = await fetch(FNOS_PLUGIN_TOGGLE_ROUTE, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ name, enabled }),
  })
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
}

/**
 * 卸载插件。
 * @param name - 包名。
 * @returns 是否需要重启 Web 才完全生效。
 */
export async function removePluginByName(name: string): Promise<{ needRestart: boolean }> {
  const response = await fetch(FNOS_PLUGIN_REMOVE_ROUTE, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ name }),
  })
  if (!response.ok) {
    const value = await response.json().catch(() => undefined) as { message?: unknown } | undefined
    throw new Error(typeof value?.message === 'string' ? value.message : `HTTP ${String(response.status)}`)
  }
  const value = await response.json() as { needRestart?: unknown }
  return { needRestart: value.needRestart === true }
}
