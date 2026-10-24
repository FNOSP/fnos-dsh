/**
 * 用量胶囊的显隐判定。
 *
 * 单独成模块是为了可测：组件文件一旦 import 就会拉起 Semi 组件与图标，在
 * node 环境下无法加载；纯判定放在这里可以直接断言。
 *
 * @module dsh-zcode/client/capsule-visibility
 */

import { ZCODE_PROVIDER } from '../../contracts/identity.ts'
import type { ZCodeUsageVisibility } from '../../contracts/preferences.ts'

/** 投影里的一条模型选择。字段名与 `ModelSelection` 一致。 */
export interface ModelSelectionLike {
  readonly provider?: string | null | undefined
  readonly model?: string | null | undefined
}

/**
 * 会话 `modelSelection` 投影里本插件用到的字段。
 *
 * 形状取自 `ModelSelectionProjection`：`next` 是下一次请求要用的选择，
 * `lastUsed` 是上一次请求实际用过的选择。
 *
 * 两个坑都踩过：
 * 1. 直接读座位道具上的 `modelSelection`——那个字段不存在，`auto` 永远判定为
 *    「没选中」，胶囊从不出现；
 * 2. 把字段名写成 `pending`（那是**目录状态**的字段，不在投影上）。读不到
 *    `pending` 就退回了 `lastUsed`，而 `lastUsed` 是上一次**真正用过**的模型，
 *    于是用户切到本插件模型后仍显示别的供应商的判定结果。
 */
export interface ModelSelectionProjectionLike {
  readonly next?: ModelSelectionLike | null | undefined
  readonly lastUsed?: ModelSelectionLike | null | undefined
}

/**
 * 取当前生效的选择：优先 `next`（用户刚选的），否则 `lastUsed`。
 *
 * `next` 为 `null` 时表示"没有更新的选择"，此时 `lastUsed` 才是事实；
 * 不能只看 `next` 是否存在来判断，两者都是可空字段。
 */
function currentSelection(projection: ModelSelectionProjectionLike | undefined): ModelSelectionLike | undefined {
  return projection?.next ?? projection?.lastUsed ?? undefined
}

/** 读出当前选中的供应商路由 id。 */
export function readSelectedProvider(
  projection: ModelSelectionProjectionLike | undefined,
): string | undefined {
  const provider = currentSelection(projection)?.provider
  return typeof provider === 'string' && provider.length > 0 ? provider : undefined
}

/** 读出当前选中的模型 id。 */
export function readSelectedModel(
  projection: ModelSelectionProjectionLike | undefined,
): string | undefined {
  const model = currentSelection(projection)?.model
  return typeof model === 'string' && model.length > 0 ? model : undefined
}

/**
 * 当前是否该显示胶囊。
 *
 * `auto` 需要会话确实选中了本插件路由；投影尚未送达时按「不显示」处理，
 * 避免胶囊在所有对话上乱挂。
 *
 * @param visibility - 偏好里的显隐策略。
 * @param provider - 当前选中会话的供应商路由 id。
 * @param signedIn - 账号是否已登录；未登录时没有可展示的额度。
 * @returns 应显示时为 true。
 */
export function shouldShowCapsule(
  visibility: ZCodeUsageVisibility,
  provider: string | undefined,
  signedIn = true,
): boolean {
  if (visibility === 'off') return false
  if (!signedIn) return false
  if (visibility === 'always') return true
  return provider === ZCODE_PROVIDER
}
