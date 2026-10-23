/** 模型目录的同源路由调用。 */

import { OPENCODE_ROUTES } from '../../contracts/routes.ts'
import type { OpenCodeCatalog } from '../../contracts/catalog.ts'
import { requestJson } from './http.ts'

/**
 * 目录端点响应。
 *
 * `catalog` 为 `null` 表示宿主连上一次快照都没有；`error` 可能是「本次刷新
 * 失败但仍有旧快照」，因此有 `catalog` 时仍然要把 `error` 作为提示展示。
 */
export interface OpenCodeCatalogResponse {
  readonly catalog: OpenCodeCatalog | null
  readonly consoleError?: string
  readonly error?: string
}

/** 读取当前目录快照（宿主按需判断是否过期）。 */
export function readCatalog(): Promise<OpenCodeCatalogResponse> {
  return requestJson<OpenCodeCatalogResponse>(OPENCODE_ROUTES.catalog)
}

/** 强制刷新目录（会真实打到 OpenCode 上游）。 */
export function refreshCatalog(): Promise<OpenCodeCatalogResponse> {
  return requestJson<OpenCodeCatalogResponse>(OPENCODE_ROUTES.catalogRefresh, 'POST')
}
