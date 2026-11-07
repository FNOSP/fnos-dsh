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
