/**
 * 标签页策略：先查后复用、收尾保留目标页。
 *
 * 这套策略是用实测代价换来的（见 `docs/tests/FNOS-013-midscene-browser-automation-bridge.md`
 * 的 BUG-03/BUG-05 与测试规范的「有头浏览器的标签页纪律」）。集中放在共享包里，
 * 避免每个包各写一遍、各踩一遍。
 *
 * @module dsh-e2e-kit/tab-policy
 */

/** 标签页信息（Midscene 扩展侧 `getBrowserTabList` 的返回项）。 */
export interface BrowserTab {
  /** 标签页 id（字符串形式）。 */
  readonly id: string
  /** 当前标题。 */
  readonly title?: string
  /** 当前 URL。 */
  readonly url?: string
  /** 是否为当前窗口的活动页。 */
  readonly currentActiveTab?: boolean
}

/**
 * 判断两个 URL 是否指向同一个页面。
 *
 * **忽略查询串**：DSH Web 的地址带 `?token=…`，而 token 会随实例重启变化。若按完整
 * URL 比较，复用判定会在 token 变化后失效，导致每次测试都新开一个页（实测确认过这个
 * 失效路径）。
 * @param candidate - 标签页 URL。
 * @param wanted - 目标 URL。
 * @returns 是否视为同一页面（同源 + 同路径）。
 */
export function samePage(candidate: string, wanted: string): boolean {
  try {
    const a = new URL(candidate)
    const b = new URL(wanted)
    return a.origin === b.origin && a.pathname === b.pathname
  } catch {
    // URL 解析失败（如 about:blank）时退化为字面比较，避免把可复用的页判成不可复用。
    return candidate === wanted
  }
}

/** 复用判定的结果。 */
export interface TabSelection {
  /** 要绑定的标签页 id；`undefined` 表示需要新开页。 */
  readonly reuseTabId: string | undefined
  /**
   * 判定依据：
   * - `existing`：目标页已打开（直接绑它）；
   * - `active`：当前活动页就是目标页；
   * - `new`：都没有，需要新开。
   */
  readonly reason: 'existing' | 'active' | 'new'
}

/**
 * 从标签页列表里选出要复用的页。
 *
 * 纯函数：只做决策，不触碰浏览器，便于测试。调用方需按「先查后绑定」的顺序使用它
 * ——Midscene 的 `setActiveTabId` 只能绑定一次（内部 `if (this.activeTabId) throw …`），
 * 因此必须在绑定之前选定目标页。
 * @param tabs - 当前标签页列表。
 * @param wanted - 目标 URL。
 * @returns 选择结果。
 */
export function selectTab(tabs: readonly BrowserTab[], wanted: string): TabSelection {
  const existing = tabs.find(tab => tab.url !== undefined && samePage(tab.url, wanted))
  if (existing === undefined) return { reuseTabId: undefined, reason: 'new' }
  // 区分「目标页恰是当前活动页」与「目标是别的已开页」：前者无需切换（`setActiveTabId`
  // 在已绑定后会抛错，因此这个区分对调用方的日志与诊断有意义）。
  return existing.currentActiveTab === true
    ? { reuseTabId: existing.id, reason: 'active' }
    : { reuseTabId: existing.id, reason: 'existing' }
}
