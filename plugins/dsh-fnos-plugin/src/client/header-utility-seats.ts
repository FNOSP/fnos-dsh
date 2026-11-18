/**
 * 会话头部两个条目的座位形状。
 *
 * 单独成模块是为了让「谁在左、谁在右」这件事可被真实行为测试覆盖：列表插槽的
 * 显示顺序是 **priority 升序、再 order 升序**（`ui-slots` 的 `SlotCore` 排序），
 * 而座位形状一旦被打平，位置就改由注册顺序决定、与官方相反——这种回归不会报错，
 * 只会静默地把两个按钮调换位置。把形状抽出来，测试才能用真实 `SlotCore` 注册
 * 这两个座位并断言最终顺序。
 *
 * 取值对齐官方：`ui-open-in-app` 用 `order: -10`，`session-log-export` 不设
 * order（默认 0），因此官方布局是「文件入口在左、更多操作在右」。
 */

/** 列表插槽里一个条目的排序形状。 */
export interface HeaderUtilitySeat {
  readonly name: 'conversation.session.header.utilities'
  readonly id: string
  readonly order: number
  readonly priority: number
}

/**
 * fnOS 文件入口：**不再遮蔽**官方 `open-in-app`。
 *
 * 遮蔽在这里已经失效，因为官方条目在 DSH `0.2.2-rc.4` 迁出了本插槽：
 * `client-ui-open-in-app` 改为注册 `contextMenu.icon` 与 `deliverables.*`，
 * 插槽 occupancy 里不再有 `open-in-app`。继续用 `priority: -1` 只是遮一个
 * 不存在的目标，语义上撒谎，因此改回普通优先级 0。
 *
 * 需要遮蔽它的理由（官方按编译期常量表探测本机应用，在 fnOS 上把
 * `/usr/sbin/zed` 误判为 Zed 编辑器）也随官方条目的消失而不再成立。
 *
 * `order: -10` 保留：它决定本插件两个入口之间的左右次序，与官方是否还在无关。
 */
export const FNOS_OPEN_IN_APP_SEAT: HeaderUtilitySeat = {
  name: 'conversation.session.header.utilities',
  id: 'open-in-app',
  order: -10,
  priority: 0,
}

/**
 * Session log：**不再遮蔽**官方 `session-log-download`，保持默认 order 0 排在右侧。
 *
 * :::danger 遮蔽已在上游迁走后失效，别照着旧注释恢复 priority:-1
 *
 * DSH `0.2.2-rc.4` 把官方导出入口从本插槽迁到了会话头部右键菜单：
 * `session-log-export` 改为 `ctx.contextMenus.register({ target: 'sessionHeader' })`
 * 注册 `session-log-download.export` 与 `.feedback`，插槽 occupancy 里不再有
 * `session-log-download`（该包只剩 `contextMenu.icon` 与 `shell.overlay`）。
 *
 * 因此 `priority: -1` 遮的是不存在的目标。本插件在头部继续提供等效入口
 * （复制为 Markdown / 下载 / 反馈），但它是**独立条目**而非替代品：官方入口
 * 现在活在右键菜单里，两者共存。
 *
 * 「遮蔽会吞掉上游新增项」的历史风险因此不再由本行承担；对应守卫改为断言
 * 「官方已迁出本插槽」这一事实本身，见
 * `tests/client/official-entry-shadow-guard.spec.ts`。
 *
 * :::
 */
export const FNOS_SESSION_LOG_SEAT: HeaderUtilitySeat = {
  name: 'conversation.session.header.utilities',
  id: 'session-log-download',
  order: 0,
  priority: 0,
}
