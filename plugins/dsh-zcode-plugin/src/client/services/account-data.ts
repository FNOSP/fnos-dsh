/**
 * 账号状态与登录流程的同源路由调用。
 *
 * 登录只走 OAuth 授权码流程：宿主没有「API Key 登录」路由，因此客户端也不提供
 * 该入口。家族（BigModel / Z.ai）由调用方选择，默认 BigModel。
 *
 * @module dsh-zcode/client/account-data
 */

import { ZCODE_ROUTES } from '../../contracts/routes.ts'
import type { ZCodeAuthStatus, ZCodeLoginChallenge } from '../../contracts/auth.ts'
import type { ZCodeFamily } from '../../contracts/identity.ts'
import { requestJson } from './http.ts'

/** 读取账号状态；进行中的登录挑战也随状态返回。 */
export function readAuthStatus(): Promise<ZCodeAuthStatus> {
  return requestJson<ZCodeAuthStatus>(ZCODE_ROUTES.status)
}

/** 开始授权；返回授权地址与有效期。 */
export function startDeviceLogin(family: ZCodeFamily): Promise<{
  readonly status: 'signing-in'
  readonly challenge: ZCodeLoginChallenge
}> {
  return requestJson(ZCODE_ROUTES.login, 'POST', { family })
}

/** 取消进行中的授权（不删除已保存凭据）。 */
export function cancelDeviceLogin(): Promise<ZCodeAuthStatus> {
  return requestJson<ZCodeAuthStatus>(ZCODE_ROUTES.cancel, 'POST')
}

/** 退出登录并删除凭据。 */
export function signOutAccount(): Promise<ZCodeAuthStatus> {
  return requestJson<ZCodeAuthStatus>(ZCODE_ROUTES.logout, 'POST')
}
