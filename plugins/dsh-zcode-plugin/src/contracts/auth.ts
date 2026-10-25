/**
 * 账号登录状态与凭据记录。
 *
 * 登录走 ZCode 的 OAuth **授权码流程**（浏览器授权 + 同源回调换取），不提供
 * API Key 登录：Start Plan 的模型请求只认账号身份，Key 形态在本插件里没有
 * 可用路径，给出入口只会让用户走进死胡同。
 *
 * 凭据记录只存在于宿主侧文件（属主可读 0600）；浏览器拿到的 `status` 不含
 * 任何 token，也不含其哈希。
 *
 * @module dsh-zcode/auth-contract
 */

import type { ZCodeFamily } from './identity.ts'

/** 授权页信息，交给浏览器打开。 */
export interface ZCodeLoginChallenge {
  /** 本次授权的家族。 */
  readonly family: ZCodeFamily
  /** 需要在浏览器打开的授权地址。 */
  readonly authorizeUrl: string
  /** 授权链接有效期（秒）。 */
  readonly expiresInSeconds: number
}

/** 账号信息；全部来自 ZCode，缺字段时保持缺省。 */
export interface ZCodeAccountInfo {
  readonly userId?: string
  readonly email?: string
  readonly name?: string
  /** 头像地址（若上游返回）。 */
  readonly avatar?: string
  /** 本次登录使用的家族。 */
  readonly family?: ZCodeFamily
}

/** 浏览器可见的登录状态。 */
export type ZCodeAuthStatus =
  | { status: 'signed-out' }
  | { status: 'signing-in'; challenge?: ZCodeLoginChallenge }
  | ({ status: 'signed-in' } & ZCodeAccountInfo)
  | { status: 'error'; message: string }

/**
 * 落盘的凭据文档。
 *
 * 三份材料各有用途，缺一不可：
 * - `zcodeJwt`：ZCode 域凭证，额度/权益/客户端配置都用它；
 * - `accessToken`：家族侧的 MaaS 凭证，换取项目令牌时使用；
 * - `refreshToken`：可选，上游给了就保存，便于后续刷新。
 */
export interface ZCodeCredentialRecord {
  readonly version: 1
  /** 登录使用的家族。 */
  readonly family: ZCodeFamily
  /** ZCode 域 JWT（额度与权益的鉴权材料）。 */
  readonly zcodeJwt: string
  /** 家族侧 MaaS access token。 */
  readonly accessToken?: string
  /** 家族侧 refresh token。 */
  readonly refreshToken?: string
  /** JWT 过期时间（epoch ms）；上游未给出时缺省。 */
  readonly expiresAt?: number
  readonly userId?: string
  readonly email?: string
  readonly name?: string
  readonly avatar?: string
}

/**
 * 判断凭据是否已过期。
 *
 * ZCode 的账号 JWT 目前不带 `exp`，因此只有上游明确给出时间时才判定；
 * 留 30 秒提前量，避免在临界点发出必然失败的请求。
 */
export function isCredentialExpired(record: ZCodeCredentialRecord, now = Date.now()): boolean {
  if (record.expiresAt === undefined) return false
  return record.expiresAt - 30_000 <= now
}
