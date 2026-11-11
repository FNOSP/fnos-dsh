/**
 * 操作结果的通知（Toast）。
 *
 * ## 为什么不再用「就地插一行文案」
 *
 * 早前每个操作失败都在原位插一句 `<p role="alert">`，带来三个问题：
 *
 * 1. **撑动布局**：提示出现/消失时下方内容整体位移，用户刚想点的地方跑掉了；
 * 2. **容易被忽略**：提示混在正文里，与周围文字同色同字号时几乎看不见；
 * 3. **不会消失**：一次失败之后那句红字一直挂着，直到下次成功才被覆盖。
 *
 * Toast 悬浮在角落、自动消失、样式统一，是这类「操作结果」的常规承载方式。
 * 需要用户**持续看到**的信息（例如「需重启 Web 才生效」）仍留在页面上——
 * 那种提示消失得太快反而有害。
 *
 * @module dsh-fnos/client/notify
 */

import { DshToast } from '@tnnevol/dsh-semi-ui'

/**
 * 提示操作成功。
 * @param content - 文案（已翻译）。
 */
export function notifySuccess(content: string): void {
  DshToast.success({ content })
}

/**
 * 提示操作失败。
 * @param content - 文案（已翻译）。
 */
export function notifyFailure(content: string): void {
  DshToast.error({ content })
}
