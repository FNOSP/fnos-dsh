/**
 * 会话级「智能搜索」控件的视图模型（FNOS-010-12-AC-01 / FNOS-012-06 / FNOS-060）。
 *
 * 控件位于消息框左下角（`conversation.input.left`）。把可访问名称与呈现结果
 * 的推导抽成纯函数，是为了让「状态可辨」与「移动端只留图标」这两条验收条件
 * 有可单测的落点——纯渲染代码在没有 DOM 测试环境时无法断言，而这些推导是它
 * 的全部内容。
 *
 * FNOS-012-06 起，控件的**可见文案固定为「智能搜索」**，状态只靠激活态/普通态
 * 样式区分（`aria-pressed` + `.dsh-failover-pill--active`）；可访问名称是例外：
 * 读屏用户无法感知样式，名称必须同时包含功能与当前状态。
 *
 * FNOS-060 起，移动设备上**不渲染可见文案**、只留图标：手机的消息框控件行
 * 没有余量承载这四字，而名称仍由 `aria-label` 提供，收起文案不损失语义。
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

/** 药丸按钮的呈现结果。 */
export interface TogglePresentation {
  /** 按钮类名：激活态与图标态都是独立修饰类。 */
  readonly className: string
  /** 是否渲染「智能搜索」可见文案（移动端只留图标）。 */
  readonly showLabel: boolean
}

/** 药丸按钮呈现推导的输入。 */
export interface TogglePresentationInput {
  /** 当前开关状态。 */
  readonly enabled: boolean
  /** 是否移动设备（由宿主的移动设备判定提供）。 */
  readonly mobile: boolean
}

/**
 * 推导药丸按钮的类名与文案可见性。
 *
 * 移动端收起文案的判据是**设备**而不是视口宽度：桌面浏览器把窗口拖窄仍是有
 * 余量的桌面布局，官方控件也不会因此变成图标态；手机横竖屏切换则由同一判定
 * 覆盖，不会抖动。
 *
 * @param input - 开关状态与设备判定。
 * @returns 类名与是否渲染可见文案。
 */
export function togglePresentation(input: TogglePresentationInput): TogglePresentation {
  const className = input.enabled
    ? 'dsh-failover-pill dsh-failover-pill--active'
    : 'dsh-failover-pill'
  if (!input.mobile) return { className, showLabel: true }
  return { className: `${className} dsh-failover-pill--iconOnly`, showLabel: false }
}
