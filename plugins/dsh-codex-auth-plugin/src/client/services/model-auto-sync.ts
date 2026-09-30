/**
 * 登录成功后 / 打开已登录页面时的模型目录自动同步（FNOS-007-31-AC-02）。
 *
 * 为什么需要它：DSH 的 settings 数组是**整体替换**语义，一旦某次把账号列表写进
 * 用户层，插件补丁里的静态条目就永久失效，只能靠下一次同步覆盖。此前
 * `refresh-models` 路由只在 Host 注册、**没有任何调用方**，于是模型列表一直停在
 * 上一次写入的快照上——用户看到的就是「重装后还是旧的模型列表」。
 *
 * 触发点有两个，语义不同：
 *
 *  - `after-sign-in`：换账号了，必须覆盖旧账号的列表，所以**无视**本次会话是否已
 *    同步过；
 *  - `page-open`：只是打开页面，同步一次让列表与账号对齐即可。状态查询是轮询的
 *    （5 分钟一次），若每次都同步就变成周期性打上游，既浪费也可能触发限流，因此
 *    用 `alreadySynced` 去重。
 *
 * @module dsh-codex-auth/model-auto-sync
 */

import { CODEX_MODEL_REFRESH_PATH } from '../../contracts/auth-paths.ts'

export type AutoSyncTrigger = 'after-sign-in' | 'page-open'

export interface AutoSyncInput {
  /** Host 的登录状态查询结果。 */
  signedIn: boolean
  trigger: AutoSyncTrigger
  /** 本次会话是否已经同步过（仅对 `page-open` 生效）。 */
  alreadySynced?: boolean
}

/**
 * 是否需要发起一次模型目录同步。
 *
 * 未登录时一律不同步：没有凭据可查，请求只会以 502 收场，白跑一趟。
 * @param input - 登录状态与触发点。
 * @returns 需要同步时为 true。
 */
export function shouldAutoSyncModels(input: AutoSyncInput): boolean {
  if (!input.signedIn) return false
  if (input.trigger === 'after-sign-in') return true
  return input.alreadySynced !== true
}

/** 触发点的可读描述，用于日志与断言。 */
export function describeAutoSyncTrigger(input: AutoSyncInput): string {
  if (!input.signedIn) return `skip model auto-sync (${input.trigger}): signed out`
  if (input.trigger === 'page-open' && input.alreadySynced === true) return 'skip model auto-sync (page-open): already synced this session'
  return `model auto-sync (${input.trigger})`
}

export interface AutoSyncResult {
  /** 同步是否被实际发起。 */
  attempted: boolean
  /** 写入的模型数量；未发起或读取失败时为 undefined。 */
  modelCount?: number
}

/**
 * 发起一次模型目录同步。
 *
 * 失败**不抛**：调用点在页面初始化与登录回调里，同步失败不该让登录状态或页面
 * 渲染失败。同步失败时保留上一次有效目录（AC-03 的要求），调用方可从返回值看出
 * 未成功。
 * @param input - 触发条件。
 * @returns 是否发起以及写入的模型数量。
 */
export async function autoSyncModels(input: AutoSyncInput): Promise<AutoSyncResult> {
  if (!shouldAutoSyncModels(input)) return { attempted: false }
  try {
    const response = await fetch(CODEX_MODEL_REFRESH_PATH, {
      method: 'POST',
      headers: { accept: 'application/json' },
      credentials: 'same-origin',
    })
    if (!response.ok) return { attempted: true }
    const body = await response.json() as { models?: unknown[] }
    const count = Array.isArray(body.models) ? body.models.length : undefined
    return count === undefined ? { attempted: true } : { attempted: true, modelCount: count }
  } catch {
    // 网络异常与解析失败都按「本次同步未成功」处理，保留既有目录。
    return { attempted: true }
  }
}
