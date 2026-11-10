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
  FNOS_PLUGIN_INDEX_STATUS_ROUTE,
} from '../../contracts/gateway-proxy-contract.ts'

/** 索引状态（与宿主 `PluginIndexStatus` 同形）。 */
export interface PluginIndexStatus {
  readonly marketAvailable: boolean
  readonly reason?: string
  readonly configured: readonly string[]
  readonly missing: readonly string[]
  readonly recommended: readonly string[]
}

/** localStorage 键：本页的「推荐索引已开启」偏好。 */
const ENABLED_KEY = 'dsh-fnos.plugin-index-enabled'

/**
 * 读「开启」偏好。
 * @returns 是否开启；缺省为 false（未开启状态要如实展示）。
 */
export function getIndexEnabled(): boolean {
  try {
    return globalThis.localStorage?.getItem(ENABLED_KEY) === '1'
  } catch {
    // 隐私模式下 localStorage 可能抛错：当作未开启，不影响功能。
    return false
  }
}

/**
 * 写「开启」偏好。
 * @param enabled - 是否开启。
 */
export function setIndexEnabled(enabled: boolean): void {
  try {
    globalThis.localStorage?.setItem(ENABLED_KEY, enabled ? '1' : '0')
  } catch {
    // 同上：存不下就只影响下次打开时的默认值。
  }
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
