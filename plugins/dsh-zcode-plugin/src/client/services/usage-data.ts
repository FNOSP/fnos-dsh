/**
 * Start Plan 额度的同源路由调用。
 *
 * 额度端点永远返回 200：未登录是 `{ signedIn: false }`，失败是
 * `{ signedIn: true, error }`。这样胶囊与卡片都能用同一条路径降级展示，
 * 不必为「没登录」和「读失败」写两套渲染分支。
 *
 * @module dsh-zcode/client/usage-data
 */

import { ZCODE_ROUTES } from '../../contracts/routes.ts'
import type { ZCodeUsage } from '../../contracts/usage.ts'
import { requestJson } from './http.ts'

/** 额度端点响应。 */
export type ZCodeUsageResponse =
  | { readonly signedIn: false }
  | { readonly signedIn: true; readonly usage: ZCodeUsage }
  | { readonly signedIn: true; readonly error: string; readonly reason?: string }

/** 读取额度。 */
export function readUsage(): Promise<ZCodeUsageResponse> {
  return requestJson<ZCodeUsageResponse>(ZCODE_ROUTES.usage)
}

/** 响应里是否带可用额度。 */
export function usageOf(response: ZCodeUsageResponse | undefined): ZCodeUsage | undefined {
  if (response === undefined || response.signedIn !== true) return undefined
  return 'usage' in response ? response.usage : undefined
}
