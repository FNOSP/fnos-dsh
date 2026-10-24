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

/**
 * 当前是否该显示胶囊。
 *
 * `auto` 需要会话确实选中了本插件路由；没有模型上下文（某些座位不提供
 * `modelSelection`）时按「不显示」处理，避免胶囊在所有对话上乱挂。
 *
 * @param visibility - 偏好里的显隐策略。
 * @param modelSelection - 当前会话的模型选择；未选中时为 undefined。
 * @returns 应显示时为 true。
 */
export function shouldShowCapsule(
  visibility: ZCodeUsageVisibility,
  modelSelection: { readonly providerId?: string | undefined } | undefined,
): boolean {
  if (visibility === 'off') return false
  if (visibility === 'always') return true
  return modelSelection?.providerId === ZCODE_PROVIDER
}
