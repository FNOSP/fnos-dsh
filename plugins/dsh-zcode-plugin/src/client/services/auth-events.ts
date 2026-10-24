/**
 * 登录代际：登录状态翻转时让目录与胶囊重新拉取。
 *
 * 账号卡片自己会更新，但额度卡片与目录卡片是另外的组件；它们需要一个信号
 * 知道「账号刚变了」。一个自增计数就够了——组件把它当依赖，变化即重取。
 *
 * @module dsh-zcode/client/auth-events
 */

let epoch = 0
const listeners = new Set<() => void>()

/** 当前代际。 */
export function authEpoch(): number {
  return epoch
}

/** 订阅代际变化。 */
export function subscribeAuthEpoch(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** 推进代际；登录/退出成功时调用。 */
export function bumpAuthEpoch(): void {
  epoch += 1
  for (const listener of [...listeners]) {
    try {
      listener()
    } catch {
      // 单个订阅者失败不应影响其它组件。
    }
  }
}
