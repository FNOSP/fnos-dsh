/**
 * 输入区用量胶囊的显隐判断。
 *
 * 三个用量插件都挂在 `conversation.input.right`，各自只看自己的登录态会让
 * 选中一家模型时别家的图标也显示。这里把「偏好 + 当前选中模型供应商」收敛成
 * 一个纯判断，组件只负责把会话投影传进来。
 *
 * 判断依据是会话投影 `modelSelection` 的 `provider`，与选中模型同源；读不到
 * 就当作不显示，不猜供应商。合并后的供应商里 zen 与 go 都是本插件模型，
 * `auto` 下选中任意一个都挂出（额度数据本身仍是账号的 Go 套餐窗口）；
 * 选中别家供应商不挂出。`auto` 在已确认未登录时不显示（没有可展示的额度）；
 * `always` 是用户显式要求常驻，未登录也保留胶囊并显示未登录状态。
 *
 * @module dsh-opencode/client/usage-visibility
 */

import { OPENCODE_PROVIDER } from '../../contracts/identity.ts'
import type { OpenCodeUsageVisibility } from '../../contracts/preferences.ts'

/** 投影里一条模型选择里本模块关心的字段。 */
export interface ModelSelectionLike {
  provider?: string | null
  model?: string | null
}

/**
 * 会话投影 `modelSelection` 的结构子集。
 *
 * 只声明用到的一层，真实投影对象可以直接传进来；不 import session-controller
 * 的具体类型，是为了让这个判断不随上游类型的迁移而失效。
 */
export interface ModelSelectionProjectionLike {
  lastUsed?: ModelSelectionLike | null
  pending?: ModelSelectionLike | null
}

/**
 * 读出当前选中模型的供应商标识。
 * @param projection - 会话投影 `modelSelection`，可能尚未送达。
 * @returns 供应商 id；投影缺失或两侧都为空时返回 undefined。
 */
export function readSelectedProvider(projection: ModelSelectionProjectionLike | undefined): string | undefined {
  const selection = projection?.pending ?? projection?.lastUsed
  const provider = selection?.provider
  return typeof provider === 'string' && provider.length > 0 ? provider : undefined
}

/**
 * 读出当前选中模型的 id（含 `zen:` / `go:` 前缀）。
 * @param projection - 会话投影 `modelSelection`，可能尚未送达。
 * @returns 模型键；投影缺失或没有模型时返回 undefined。
 */
export function readSelectedModel(projection: ModelSelectionProjectionLike | undefined): string | undefined {
  const selection = projection?.pending ?? projection?.lastUsed
  const model = selection?.model
  return typeof model === 'string' && model.length > 0 ? model : undefined
}

/** 胶囊显隐判断的输入。 */
export interface UsageCapsuleVisibilityInput {
  /** 用户偏好：`auto` / `always` / `off`。 */
  readonly visibility: OpenCodeUsageVisibility
  /** 当前会话选中模型的供应商；读不到时省略。 */
  readonly provider?: string | undefined
  /** 用量读取确认的登录状态；`undefined` 表示尚未确认（加载中）。 */
  readonly signedIn?: boolean | undefined
}

/**
 * 胶囊是否挂出。
 * @param input - 偏好、供应商与登录状态。
 * @returns 可见时为 true。
 */
export function usageCapsuleVisible(input: UsageCapsuleVisibilityInput): boolean {
  if (input.visibility === 'off') return false
  if (input.visibility === 'auto') {
    // zen 与 go 都是本插件的模型：只要供应商匹配就挂出，不再按套餐区分。
    if (input.provider !== OPENCODE_PROVIDER) return false
    // 已确认未登录时 auto 不再挂出空胶囊；`always` 由用户显式要求常驻。
    if (input.signedIn === false) return false
  }
  return true
}
