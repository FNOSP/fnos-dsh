/**
 * 会话级「智能搜索」开关（FNOS-010-12）。
 *
 * 语义：开启（默认）时该会话按本插件既定行为接入（三方搜索优先、官方兜底；
 * 三方抓取兜底）；关闭时该会话**完全不接入本插件**，搜索与抓取回落到官方来源，
 * 已配置的三方账号在该会话内不被调用（配额零消耗）。
 *
 * 为什么状态放在这里而不是插件配置里：插件配置是**全局**的（同一份
 * `cordis.patch.yml` 服务所有会话），把开关写进去会让 A 会话的切换影响 B 会话。
 * 搜索接缝 `WebSearchRequest` 也不含会话标识、`ctx.web` 是全局单例，因此开关必须
 * 由「按会话分派」的通道读取——见 `index.ts` 的 `tools/pre-execute` 门控。
 *
 * 存储形态：内存 Map 按 `sessionId` 分桶。这是**会话级的临时偏好**而非配置项——
 * 会话结束后状态没有保留价值，DSH 重启后回到默认开启是合理行为（与「默认开启」
 * 的验收条件一致）；因此不落盘、不写配置文档。
 */

import { AsyncLocalStorage } from 'node:async_hooks'

/** 开关的默认状态（AC-01：全新会话首次使用为开启）。 */
export const TOGGLE_DEFAULT_ENABLED = true

/** 开关变化通知的订阅者。 */
export type ToggleListener = (sessionId: string, enabled: boolean) => void

/**
 * 按会话保存开关状态的容器。
 *
 * 只记录**显式设置过**的会话；未设置的会话一律按默认值（开启）读取，因此新会话
 * 天然是开启态，不需要在会话创建时初始化（AC-01、TC-076）。
 */
export class SessionToggleStore {
  /** 显式设置过的会话状态；未出现的会话按默认值处理。 */
  private readonly states = new Map<string, boolean>()
  private readonly listeners = new Set<ToggleListener>()

  /**
   * 读取某会话的开关状态。
   * @param sessionId - 会话 id；`undefined` 表示调用方没有会话身份（如后台任务）。
   * @returns 该会话是否接入本插件。
   */
  isEnabled(sessionId: string | undefined): boolean {
    if (sessionId === undefined) return TOGGLE_DEFAULT_ENABLED
    return this.states.get(sessionId) ?? TOGGLE_DEFAULT_ENABLED
  }

  /**
   * 设置某会话的开关状态。
   *
   * 值未变化时不写 Map、不通知订阅者：避免客户端因无意义的重复通知而重渲染
   * （同一会话的重复点击、以及跨会话的批量读取都会走到这里）。
   *
   * @param sessionId - 会话 id。
   * @param enabled - 目标状态。
   */
  setEnabled(sessionId: string, enabled: boolean): void {
    if (this.isEnabled(sessionId) === enabled) return
    this.states.set(sessionId, enabled)
    for (const listener of this.listeners) listener(sessionId, enabled)
  }

  /**
   * 清除某会话的状态，使其回到默认值。
   *
   * 会话结束或被移除时调用，防止长生命周期进程里按会话累积的 Map 无界增长。
   *
   * @param sessionId - 会话 id。
   */
  clear(sessionId: string): void {
    if (!this.states.has(sessionId)) return
    this.states.delete(sessionId)
    for (const listener of this.listeners) listener(sessionId, TOGGLE_DEFAULT_ENABLED)
  }

  /**
   * 订阅状态变化。
   * @param listener - 变化时调用（仅在值真正变化时触发）。
   * @returns 取消订阅函数。
   */
  subscribe(listener: ToggleListener): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
}

/**
 * 门控判定：该次工具调用是否应绕过本插件（走官方来源）。
 *
 * 单独抽成函数而不是内联在钩子里，是为了让「关闭 = 绕过」这条语义有一个可单测
 * 的落点——它同时是 AC-03 的判定核心。
 *
 * @param enabled - 该会话的开关状态。
 * @returns 是否需要绕过本插件。
 */
export function shouldBypassFailover(enabled: boolean): boolean {
  return !enabled
}

/**
 * 当前正在执行的会话 id。
 *
 * 为什么用 AsyncLocalStorage 而不是给接缝加参数：搜索提供方的契约
 * `search(request, signal)` **没有会话标识**，且 `ctx.web` 是全局单例——provider
 * 无法知道自己正为哪个会话服务。工具分发钩子 `tools/pre-execute` 拿得到
 * `exec.agent.session`，它在调用下游工具前把会话身份放进这个作用域，provider 与
 * 工具层就能在同一异步链路上读到它，而不必改动接缝契约（AC-04 的即时生效也依赖
 * 它：状态从 store 现读，切换后下一次调用立即生效）。
 */
const sessionStorage = new AsyncLocalStorage<string | undefined>()

/**
 * 在指定会话的作用域内执行一段逻辑。
 *
 * @param sessionId - 会话 id；`undefined` 表示无会话身份（后台任务等）。
 * @param store - 开关状态存储（读取用）。
 * @param fn - 作用域内执行的逻辑（可为异步；await 之后作用域仍然有效）。
 * @returns `fn` 的返回值。
 */
export function runWithSession<T>(sessionId: string | undefined, store: SessionToggleStore, fn: () => T): T {
  // store 参与签名是为了让调用点显式表达「作用域内读的是这个 store 的状态」；
  // 实际读取发生在 activeSessionEnabled，避免在这里做无用的快照（快照会让切换
  // 在长调用中失效，违背 AC-04 的即时生效）。
  void store
  return sessionStorage.run(sessionId, fn)
}

/**
 * 读取当前作用域内会话的开关状态。
 *
 * @param store - 开关状态存储。
 * @returns 当前会话是否接入本插件；无会话身份时按默认值（开启）——保守地不绕过，
 *   避免后台任务静默丢失三方能力。
 */
export function activeSessionEnabled(store: SessionToggleStore): boolean {
  return store.isEnabled(sessionStorage.getStore())
}

/**
 * 判断当前调用是否应绕过本插件（走官方来源）。
 *
 * @param store - 开关状态存储。
 * @returns 是否需要绕过。
 */
export function shouldBypassActiveSession(store: SessionToggleStore): boolean {
  return shouldBypassFailover(activeSessionEnabled(store))
}
