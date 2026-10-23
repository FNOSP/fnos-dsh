/**
 * 登录代际（auth epoch）广播。
 *
 * 账号卡片与用量胶囊是两个独立座位，不共享 React 树；用户可能在详情页完成
 * 登录，而输入区的胶囊仍停留在「未登录」。这里用一个模块级计数器广播登录
 * 变化：账号卡片在登录/退出后推进代际，胶囊与用量卡片订阅后立即重拉用量，
 * 不必等下一次轮询或刷新页面。
 *
 * @module dsh-opencode/client/auth-events
 */

let epoch = 0
const listeners = new Set<() => void>()

/** 读取当前登录代际；作为 `useSyncExternalStore` 的快照。 */
export function authEpoch(): number {
  return epoch
}

/** 订阅登录代际变化；返回取消订阅函数。 */
export function subscribeAuthEpoch(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** 推进登录代际并通知订阅者；登录状态实际变化后调用。 */
export function bumpAuthEpoch(): void {
  epoch += 1
  for (const listener of [...listeners]) listener()
}
