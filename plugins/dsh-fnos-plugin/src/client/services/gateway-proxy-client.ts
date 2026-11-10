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
} from '../../contracts/gateway-proxy-contract.ts'
import type { GatewayAutoPathsStatus } from '../../contracts/gateway-proxy-contract.ts'

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
