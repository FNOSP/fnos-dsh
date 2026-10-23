/**
 * 账号登录状态与凭据记录。
 *
 * 凭据记录只存在于宿主侧文件（属主可读 0600）；浏览器拿到的 `status` 不含
 * access/refresh token，也不含其哈希——凭证内容永远不进入客户端。
 *
 * @module dsh-opencode/auth-contract
 */

/** 登录方式：Console 设备码（OAuth）或 Console 服务账号 API Key。 */
export type OpenCodeAuthMethod = 'oauth' | 'key'

/** 设备码登录的一次性挑战，交给浏览器展示。 */
export interface OpenCodeLoginChallenge {
  /** 用户在验证页输入的一次性代码。 */
  userCode: string
  /** 已解析为绝对地址的验证链接。 */
  verificationUri: string
  /** 挑战有效期（秒）。 */
  expiresInSeconds: number
  /** 建议轮询间隔（秒）。 */
  intervalSeconds: number
}

/** 账号与组织信息；全部来自 Console，缺字段时保持缺省。 */
export interface OpenCodeAccountInfo {
  readonly accountId?: string
  readonly email?: string
  readonly organizationId?: string
  readonly organizationName?: string
}

/** 浏览器可见的登录状态。 */
export type OpenCodeAuthStatus =
  | { status: 'signed-out' }
  | { status: 'signing-in'; challenge?: OpenCodeLoginChallenge }
  | ({ status: 'signed-in'; method: OpenCodeAuthMethod; expiresAt?: number } & OpenCodeAccountInfo)
  | { status: 'error'; message: string }

/** 落盘的凭据文档；`version` 用于拒绝不兼容格式。 */
export interface OpenCodeCredentialRecord {
  readonly version: 1
  readonly method: OpenCodeAuthMethod
  /** OAuth access token 或 API Key。 */
  readonly access: string
  /** OAuth refresh token；Key 登录时缺省。 */
  readonly refresh?: string
  /** access token 过期时间（epoch ms）；Key 登录时缺省。 */
  readonly expiresAt?: number
  /** Console 服务地址，便于私有部署或区域网关。 */
  readonly server?: string
  readonly orgId?: string
  readonly orgName?: string
  readonly accountId?: string
  readonly accountEmail?: string
}

/** 常量时间之外的最小判定：token 是否已过期（含 30 秒提前量）。 */
export function isCredentialExpired(record: OpenCodeCredentialRecord, now = Date.now()): boolean {
  if (record.method !== 'oauth' || record.expiresAt === undefined) return false
  return record.expiresAt - 30_000 <= now
}
