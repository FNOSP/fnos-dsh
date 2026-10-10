/**
 * 会话级「智能搜索」开关的视图模型（FNOS-010-12-AC-01）。
 *
 * 控件位于消息框左下角（`conversation.input.left`）。把文案键与可访问名称的推导
 * 抽成纯函数，是为了让「状态可辨」这条验收条件有可单测的落点——纯渲染代码在没有
 * DOM 测试环境时无法断言，而这些推导是它的全部内容。
 */

/**
 * 开关的文案键。
 *
 * 与 `refreshHint` 一类不同，这里需要**两个**键：控件的文字本身要随状态变化，
 * 用户才能在不点开的情况下看出当前是开还是关。
 *
 * @param enabled - 当前状态。
 * @returns 对应的本地化文案键。
 */
export function toggleLabelKey(enabled: boolean): 'toggleOn' | 'toggleOff' {
  return enabled ? 'toggleOn' : 'toggleOff'
}

/**
 * 控件的可访问名称（A11y）。
 *
 * 读屏软件读按钮时只会念 accessible name，因此名称必须同时包含**功能**（智能搜索）
 * 与**当前状态**，否则用户无法判断点了会发生什么。这也是它不能简单等于可见文字的
 * 原因：可见文字只有状态词。
 *
 * @param enabled - 当前状态。
 * @returns 可访问名称。
 */
export function toggleAccessibleName(enabled: boolean): string {
  return enabled ? '智能搜索：已开启，点击关闭' : '智能搜索：已关闭，点击开启'
}
