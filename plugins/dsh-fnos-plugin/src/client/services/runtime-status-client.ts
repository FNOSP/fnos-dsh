/**
 * 「运行」状态的同源调用。
 *
 * @module dsh-fnos/client/runtime-status-client
 */

import { FNOS_RUNTIME_STATUS_ROUTE } from '../../contracts/runtime-status-contract.ts'
import type { RuntimeStatus } from '../../contracts/runtime-status-contract.ts'

/**
 * 取一次运行状态快照。
 * @returns 运行状态；网络或 HTTP 失败时抛可读错误。
 */
export async function fetchRuntimeStatus(): Promise<RuntimeStatus> {
  const response = await fetch(FNOS_RUNTIME_STATUS_ROUTE, {
    method: 'GET',
    headers: { accept: 'application/json' },
    credentials: 'same-origin',
    // 轮询必须绕开 HTTP 缓存，否则每秒拿到的都是第一份快照。
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
  return await response.json() as RuntimeStatus
}
