/**
 * 会话级「智能搜索」控件的视图模型（FNOS-010-12-AC-01 / FNOS-012-06）。
 *
 * 控件位于消息框左下角（`conversation.input.left`）。把可访问名称的推导抽成
 * 纯函数，是为了让「状态可辨」这条验收条件有可单测的落点——纯渲染代码在没有
 * DOM 测试环境时无法断言，而这些推导是它的全部内容。
 *
 * FNOS-012-06 起，控件的**可见文案固定为「智能搜索」**，状态只靠激活态/普通态
 * 样式区分（`aria-pressed` + `.dsh-failover-pill--active`）；可访问名称是例外：
 * 读屏用户无法感知样式，名称必须同时包含功能与当前状态。
 */

/**
 * 可访问名称（A11y）。
 *
 * 读屏软件读按钮时只会念 accessible name；药丸按钮的状态只靠样式呈现，读屏
 * 用户无法感知，因此名称必须同时包含**功能**（智能搜索）与**当前状态**。
 *
 * @param enabled - 当前状态。
 * @returns 可访问名称。
 */
export function toggleAccessibleName(enabled: boolean): string {
  return enabled ? '智能搜索：已开启，点击关闭' : '智能搜索：已关闭，点击开启'
}
