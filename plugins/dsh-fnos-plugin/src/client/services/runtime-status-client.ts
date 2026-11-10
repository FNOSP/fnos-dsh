/**
 * 「运行」状态的同源调用。
 *
 * @module dsh-fnos/client/runtime-status-client
 */

import { FNOS_RUNTIME_KILL_ROUTE, FNOS_RUNTIME_STATUS_ROUTE } from '../../contracts/runtime-status-contract.ts'
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

/**
 * 结束一个进程。
 *
 * 只发 POST：这条路由会杀进程，GET 有被预取或缓存意外触发的风险。
 * @param pid - 目标进程号。
 * @param signal - `SIGTERM`（请它退出）或 `SIGKILL`（强制）。
 * @returns 路由结果；被拒绝时抛错并带原因。
 */
export async function killRuntimeProcess(pid: number, signal: 'SIGTERM' | 'SIGKILL'): Promise<void> {
  const response = await fetch(FNOS_RUNTIME_KILL_ROUTE, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ pid, signal }),
  })
  if (!response.ok) {
    const value: unknown = await response.json().catch(() => undefined)
    const reason = typeof value === 'object' && value !== null && 'error' in value && typeof value.error === 'string'
      ? value.error
      : `HTTP ${String(response.status)}`
    throw new Error(reason)
  }
}
