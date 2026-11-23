/**
 * 「自定义插件索引」的客户端：状态查询、一键设置、以及本地的「开启」记忆。
 *
 * 「开启」是**本插件的 UI 偏好**，不是官方配置——它决定本页把推荐源视为启用，
 * 不修改市场的 `indexes`。这样「关掉」不会删掉用户已配的源。
 *
 * @module dsh-fnos/client/plugin-index-client
 */

import {
  FNOS_PLUGIN_INDEX_APPLY_ROUTE,
  FNOS_PLUGIN_INDEX_REMOVE_ROUTE,
  FNOS_PLUGIN_INDEX_STATUS_ROUTE,
  FNOS_PLUGIN_INDEX_TOGGLE_ROUTE,
  type PluginIndexSourceInfo,
} from '../../contracts/gateway-proxy-contract.ts'

/** 索引状态（与宿主 `PluginIndexStatus` 同形）。 */
export interface PluginIndexStatus {
  readonly marketAvailable: boolean
  readonly reason?: string
  readonly configured: readonly string[]
  readonly missing: readonly string[]
  readonly recommended: readonly string[]
  /** 推荐源的展示信息（含从索引里读到的标题）。 */
  readonly sources: readonly PluginIndexSourceInfo[]
  /** 插件市场 bundle 是否已启用（开关的真实状态）。 */
  readonly marketEnabled: boolean
}

/** 归一化路由返回。 */
function toStatus(value: unknown): PluginIndexStatus {
  const record = (typeof value === 'object' && value !== null ? value : {}) as Partial<PluginIndexStatus>
  const list = (input: unknown): string[] => Array.isArray(input) ? input.filter((item): item is string => typeof item === 'string') : []
  return {
    marketAvailable: record.marketAvailable === true,
    ...(typeof record.reason === 'string' ? { reason: record.reason } : {}),
    configured: list(record.configured),
    missing: list(record.missing),
    recommended: list(record.recommended),
    marketEnabled: record.marketEnabled === true,
    sources: Array.isArray(record.sources)
      ? record.sources.filter((item): item is PluginIndexSourceInfo => typeof item === 'object' && item !== null && typeof (item as PluginIndexSourceInfo).url === 'string')
      : [],
  }
}

/**
 * 取索引状态。
 * @returns 状态。
 */
export async function fetchPluginIndexStatus(): Promise<PluginIndexStatus> {
  const response = await fetch(FNOS_PLUGIN_INDEX_STATUS_ROUTE, {
    headers: { accept: 'application/json' },
    credentials: 'same-origin',
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
  return toStatus(await response.json())
}

/**
 * 一键设置：写入缺失的推荐源。
 * @returns 写入后的状态。
 */
export async function applyPluginIndexes(): Promise<PluginIndexStatus> {
  const response = await fetch(FNOS_PLUGIN_INDEX_APPLY_ROUTE, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: '{}',
  })
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
  return toStatus(await response.json())
}

/**
 * 启用/禁用「自定义插件索引」能力。
 *
 * 背后是真正增删 `dsh.profile.bundles` 里的市场 bundle，不是本地偏好。
 * @param enabled - 目标状态。
 * @returns 是否需要重启 Web 才生效。
 */
export async function setIndexEnabledRemote(enabled: boolean): Promise<{ needRestart: boolean }> {
  const response = await fetch(FNOS_PLUGIN_INDEX_TOGGLE_ROUTE, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ enabled }),
  })
  if (!response.ok) {
    const value = await response.json().catch(() => undefined) as { message?: unknown } | undefined
    throw new Error(typeof value?.message === 'string' ? value.message : `HTTP ${String(response.status)}`)
  }
  const value = await response.json() as { needRestart?: unknown }
  return { needRestart: value.needRestart === true }
}


/**
 * 移除一个索引源。
 * @param url - 要移除的索引地址。
 * @returns 移除后的状态。
 */
export async function removeIndexSourceRemote(url: string): Promise<PluginIndexStatus> {
  const response = await fetch(FNOS_PLUGIN_INDEX_REMOVE_ROUTE, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ url }),
  })
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
  return toStatus(await response.json())
}
