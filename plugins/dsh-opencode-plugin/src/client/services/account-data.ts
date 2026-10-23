/** 账号状态与登录流程的同源路由调用。 */

import { OPENCODE_ROUTES } from '../../contracts/routes.ts'
import type { OpenCodeAuthStatus, OpenCodeLoginChallenge } from '../../contracts/auth.ts'
import { requestJson } from './http.ts'

/** 读取账号状态；进行中的登录挑战也随状态返回。 */
export function readAuthStatus(): Promise<OpenCodeAuthStatus> {
  return requestJson<OpenCodeAuthStatus>(OPENCODE_ROUTES.status)
}

/** 开始设备码登录；返回一次性代码与验证地址。 */
export function startDeviceLogin(): Promise<OpenCodeLoginChallenge> {
  return requestJson<OpenCodeLoginChallenge>(OPENCODE_ROUTES.login, 'POST')
}

/** 取消进行中的设备码登录（不删除已保存凭据）。 */
export function cancelDeviceLogin(): Promise<OpenCodeAuthStatus> {
  return requestJson<OpenCodeAuthStatus>(OPENCODE_ROUTES.cancel, 'POST')
}

/** 退出登录并删除凭据。 */
export function signOutAccount(): Promise<OpenCodeAuthStatus> {
  return requestJson<OpenCodeAuthStatus>(OPENCODE_ROUTES.logout, 'POST')
}

/** 用 Console API Key 直接登录；失败时由宿主返回可读原因。 */
export function signInWithApiKey(apiKey: string): Promise<OpenCodeAuthStatus> {
  return requestJson<OpenCodeAuthStatus>(OPENCODE_ROUTES.keyLogin, 'POST', { apiKey })
}
