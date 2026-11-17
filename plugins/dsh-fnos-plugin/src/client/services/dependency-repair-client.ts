/**
 * 「依赖修复」的同源路由调用。
 *
 * 两个调用都不解析服务端错误码细节：诊断结果本身就是可展示的状态，修复结果
 * 里带有步骤明细。网络或 HTTP 失败时抛可读错误，由卡片渲染成一行提示。
 *
 * @module dsh-fnos/client/dependency-repair-client
 */

import {
  FNOS_DEPENDENCY_REPAIR_DIAGNOSE_ROUTE,
  FNOS_DEPENDENCY_REPAIR_RUN_ROUTE,
} from '../../contracts/dependency-repair-contract.ts'
import type {
  DependencyRepairDiagnosis,
  DependencyRepairResult,
} from '../../contracts/dependency-repair-contract.ts'

/** 路由调用失败；带 HTTP 状态与服务端错误码便于排障。 */
export class DependencyRepairRequestError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, status: number) {
    super(code)
    this.name = 'DependencyRepairRequestError'
    this.code = code
    this.status = status
  }
}

async function request<T>(path: string, method: 'GET' | 'POST'): Promise<T> {
  const headers: HeadersInit = { accept: 'application/json' }
  if (typeof navigator === 'object' && typeof navigator.language === 'string' && navigator.language.length > 0) {
    headers['accept-language'] = navigator.language
  }
  if (method === 'POST') headers['content-type'] = 'application/json'
  const response = await fetch(path, { method, headers, credentials: 'same-origin' })
  const value: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    const code = typeof value === 'object' && value !== null && 'error' in value && typeof value.error === 'string'
      ? value.error
      : `HTTP ${response.status}`
    throw new DependencyRepairRequestError(code, response.status)
  }
  return value as T
}

/**
 * 只读诊断：列出失效的发布龄期豁免条目。
 * @returns 诊断结果。
 */
export function diagnoseDependencyRepair(): Promise<DependencyRepairDiagnosis> {
  return request<DependencyRepairDiagnosis>(FNOS_DEPENDENCY_REPAIR_DIAGNOSE_ROUTE, 'POST')
}

/**
 * 执行修复：清失效条目、重建依赖、装回清单内插件。
 * @returns 修复结果（含每步状态）。
 */
export function runDependencyRepair(): Promise<DependencyRepairResult> {
  return request<DependencyRepairResult>(FNOS_DEPENDENCY_REPAIR_RUN_ROUTE, 'POST')
}


/**
 * 执行修复，**边跑边把日志交给回调**。
 *
 * 路由返回的是 SSE 流：`log` 事件逐行推送宿主日志，最后的 `result` 事件带
 * 结构化结论。不用 `EventSource`——它只能发 GET，而这条路由是 POST（要求同源
 * 且带 content-type），因此手工解析 `ReadableStream`。
 *
 * @param onLog - 每收到一行日志调用一次。
 * @returns 最终修复结果。
 */
export async function runDependencyRepairStreaming(
  onLog: (line: string) => void,
): Promise<DependencyRepairResult> {
  const response = await fetch(FNOS_DEPENDENCY_REPAIR_RUN_ROUTE, {
    method: 'POST',
    headers: {
      accept: 'text/event-stream',
      'content-type': 'application/json',
      ...(typeof navigator === 'object' && typeof navigator.language === 'string' && navigator.language.length > 0
        ? { 'accept-language': navigator.language }
        : {}),
    },
    credentials: 'same-origin',
  })
  if (!response.ok) {
    const value: unknown = await response.json().catch(() => undefined)
    const code = typeof value === 'object' && value !== null && 'error' in value && typeof value.error === 'string'
      ? value.error
      : `HTTP ${response.status}`
    throw new DependencyRepairRequestError(code, response.status)
  }
  const reader = response.body?.getReader()
  if (reader === undefined) throw new DependencyRepairRequestError('no-stream', 200)

  const decoder = new TextDecoder()
  let buffer = ''
  let result: DependencyRepairResult | undefined
  let failure: string | undefined

  /** 解析一个完整的 SSE 帧（以空行分隔）。 */
  const consume = (frame: string): void => {
    let event = 'message'
    const data: string[] = []
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) data.push(line.slice(5).trim())
    }
    if (data.length === 0) return
    const payload: unknown = JSON.parse(data.join('\n'))
    if (event === 'log') {
      const line = typeof payload === 'object' && payload !== null && 'line' in payload && typeof payload.line === 'string'
        ? payload.line
        : ''
      if (line.length > 0) onLog(line)
    } else if (event === 'result') {
      result = payload as DependencyRepairResult
    } else if (event === 'error') {
      failure = typeof payload === 'object' && payload !== null && 'message' in payload && typeof payload.message === 'string'
        ? payload.message
        : 'stream-error'
    }
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    // SSE 帧以空行结束；`\r\n\r\n` 也一并兼容。
    for (;;) {
      const match = /\r?\n\r?\n/u.exec(buffer)
      if (match === null) break
      consume(buffer.slice(0, match.index))
      buffer = buffer.slice(match.index + match[0].length)
    }
  }
  if (buffer.trim().length > 0) consume(buffer)
  if (failure !== undefined) throw new DependencyRepairRequestError(failure, 200)
  if (result === undefined) throw new DependencyRepairRequestError('no-result', 200)
  return result
}
