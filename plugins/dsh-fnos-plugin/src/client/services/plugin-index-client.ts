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
}

/** localStorage 键：用户**显式关掉**推荐索引的偏好。 */
const DISABLED_KEY = 'dsh-fnos.plugin-index-disabled'

/**
 * 读用户偏好：是否显式关掉了推荐索引。
 *
 * **只记录「关掉」**，不记录「开启」。因为默认值应当来自真实状态（市场是否启用），
 * 而不是一个本地的初值——早前用 `=== '1'` 判断开启，结果市场明明是启用状态，
 * 开关却因为本地没存过值而显示「未开启」，与事实相反。
 * @returns 是否被用户显式关掉。
 */
export function getIndexDisabled(): boolean {
  try {
    return globalThis.localStorage?.getItem(DISABLED_KEY) === '1'
  } catch {
    // 隐私模式下 localStorage 可能抛错：按「未关掉」处理，如实反映市场状态。
    return false
  }
}

/**
 * 写用户偏好。
 * @param enabled - 是否开启；`true` 表示清掉「关掉」标记、回到跟随真实状态。
 */
export function setIndexEnabled(enabled: boolean): void {
  try {
    if (enabled) globalThis.localStorage?.removeItem(DISABLED_KEY)
    else globalThis.localStorage?.setItem(DISABLED_KEY, '1')
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
