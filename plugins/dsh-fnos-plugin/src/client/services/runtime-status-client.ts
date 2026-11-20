/**
 * 「运行」状态的同源调用。
 *
 * @module dsh-fnos/client/runtime-status-client
 */

import { FNOS_RUNTIME_KILL_ROUTE, FNOS_RUNTIME_LOGS_ROUTE, FNOS_RUNTIME_STATUS_ROUTE, FNOS_RUNTIME_TASK_LOG_ROUTE } from '../../contracts/runtime-status-contract.ts'
import type { RuntimeLogSnapshot, RuntimeStatus } from '../../contracts/runtime-status-contract.ts'

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

/**
 * 取最近的日志。
 * @param options - 查询条件。
 * @param options.limit - 最多返回条数。
 * @param options.level - 只要该级别，`all` 表示全部。
 * @param options.query - 搜索词。
 * @returns 日志快照。
 */
export async function fetchRuntimeLogs(options: {
  limit?: number
  level?: string
  query?: string
} = {}): Promise<RuntimeLogSnapshot> {
  const params = new URLSearchParams()
  if (options.limit !== undefined) params.set('limit', String(options.limit))
  if (options.level !== undefined && options.level !== 'all') params.set('level', options.level)
  if (options.query !== undefined && options.query.length > 0) params.set('q', options.query)
  const suffix = params.toString()
  const response = await fetch(`${FNOS_RUNTIME_LOGS_ROUTE}${suffix.length > 0 ? `?${suffix}` : ''}`, {
    method: 'GET',
    headers: { accept: 'application/json' },
    credentials: 'same-origin',
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
  return await response.json() as RuntimeLogSnapshot
}

/**
 * 把一行任务日志转交宿主，由宿主写进运行日志中心。
 *
 * ## 为什么需要这一跳
 *
 * `ctx.logger` 是**宿主**服务（Node 进程内），浏览器侧没有它。任务执行链跑在
 * 浏览器里，日志要出现在「日志」页只能经 HTTP 交给宿主。
 *
 * ## 失败为什么静默
 *
 * 日志是旁路：写不进去只意味着少一份记录，不能让安装或修复因此中断。因此这里
 * 不抛错、不重试——重试会在宿主不可用时堆起一串失败请求，反而更糟。
 * @param level - 级别，与宿主日志服务的三个方法对应。
 * @param text - 正文。
 */
export async function postTaskLog(level: 'info' | 'warn' | 'error', text: string): Promise<void> {
  try {
    /* GET + 查询串：宿主 webServer 对非 GET/HEAD 统一回 405，见路由侧注释。 */
    const url = `${FNOS_RUNTIME_TASK_LOG_ROUTE}?level=${level}&text=${encodeURIComponent(text)}`
    await fetch(url, { credentials: 'same-origin', cache: 'no-store' })
  } catch {
    // 旁路失败不影响业务，见上方说明。
  }
}
