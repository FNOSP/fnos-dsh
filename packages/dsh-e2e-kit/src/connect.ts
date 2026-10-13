/**
 * 连接目标页：**已打开就复用，不重复开页**。
 *
 * 这是把 `defineBridgeSetup` 里的复用流程抽出来的独立入口，给**探测脚本与一次性脚本**用。
 * 动机是实测教训：复用逻辑原先只存在于 Midscene Test 的项目 setup 里，结果写了 29 个
 * 「图省事直接 `connectNewTabWithUrl`」的探测脚本，每个都新开一页又不关闭——浏览器里
 * 累积了一堆重复标签页。规矩写在文档里而临时脚本不遵守，是治理漏洞；让「新开页」变成
 * 需要显式选择的行为（而复用是默认入口）才是解法。
 *
 * 顺序很关键（依据扩展侧实现 `ChromeExtensionProxyPage`）：`setActiveTabId` 内部是
 * `if (this.activeTabId) throw …`，即**活动页只能绑定一次**；而 `connectCurrentTab()`
 * 会立刻绑定当前活动页。因此必须在**绑定之前**查列表并选定目标页，否则一旦绑定就再也
 * 切不过去。
 *
 * @module dsh-e2e-kit/connect
 */

import type { AgentOverChromeBridge } from '@midscene/web/bridge-mode'
import type { BrowserTab } from './tab-policy.ts'
import { selectTab } from './tab-policy.ts'

/** {@link connectTarget} 的结果。 */
export interface ConnectResult {
  /** 是否复用了已打开的页（`false` 表示新开了一页）。 */
  readonly reused: boolean
  /** 绑定到的标签页 id（新开时是新建页的 id）。 */
  readonly tabId: string | undefined
  /** 判定依据：`existing`/`active` 为复用，`new` 为新开。 */
  readonly reason: 'existing' | 'active' | 'new'
}

/** `getBrowserTabList` 的返回形态（不同版本可能直接返回数组或套一层）。 */
interface TabListEnvelope {
  readonly result?: { readonly value?: readonly BrowserTab[] }
}

/**
 * 读取标签页列表。
 *
 * Midscene 在 Bridge 模式下把返回值包在 `{ result: { value } }` 里；不同版本可能直接
 * 返回数组，因此两种形态都要兼容（否则复用判定会永远拿到空列表而总是新开页）。
 * @param agent - 桥接 Agent（**未绑定**状态也能读）。
 * @returns 标签页列表；读取失败时为空数组。
 */
export async function listTabs(agent: AgentOverChromeBridge): Promise<readonly BrowserTab[]> {
  const raw = await agent.getBrowserTabList() as unknown
  if (Array.isArray(raw)) return raw as readonly BrowserTab[]
  const value = (raw as TabListEnvelope).result?.value
  return Array.isArray(value) ? value : []
}

/** {@link connectTarget} 的可选项。 */
export interface ConnectTargetOptions {
  /** 日志函数；默认不输出。 */
  readonly log?: (message: string) => void
  /**
   * 是否允许新开页（默认 `true`）。
   *
   * 置 `false` 时目标页不存在则抛出——用于「只允许复用」的场景，避免无意中堆积标签页。
   */
  readonly allowNewTab?: boolean
}

/**
 * 连接到目标页，**优先复用已打开的那一个**。
 *
 * 三步，顺序不可换：
 * 1. 列标签页（未绑定也能读——这正是「先查后绑定」能成立的原因）；
 * 2. 目标页已打开 → `setActiveTabId` 直接绑它；当前活动页就是目标页 → `connectCurrentTab()`；
 * 3. 都没有 → 才新开一页。
 *
 * 注意 `setActiveTabId` 只能调用一次，因此本函数**每个 Agent 只能用一次**。
 * @param agent - 新建的、尚未绑定的桥接 Agent。
 * @param targetUrl - 目标页 URL。比较时**忽略查询串**（DSH Web 的 `?token=` 会随实例重启
 *   变化，按完整 URL 比较会让复用失效）。
 * @param options - 日志与是否允许新开页。
 * @returns 连接结果，含是否复用与绑定到的标签页 id。
 * @throws 目标页不存在且 `allowNewTab` 为 `false` 时抛出。
 */
export async function connectTarget(
  agent: AgentOverChromeBridge,
  targetUrl: string,
  options: ConnectTargetOptions = {},
): Promise<ConnectResult> {
  const log = options.log ?? (() => {})
  const tabs = await listTabs(agent)
  const selection = selectTab(tabs, targetUrl)

  if (selection.reuseTabId !== undefined) {
    await agent.setActiveTabId(selection.reuseTabId)
    const which = selection.reason === 'active' ? '当前活动页' : '已打开的页'
    log(`复用${which}（id=${selection.reuseTabId}）`)
    return { reused: true, tabId: selection.reuseTabId, reason: selection.reason }
  }

  if (options.allowNewTab === false) {
    throw new Error(
      `目标页未打开，且本次不允许新开标签页：${targetUrl}`,
    )
  }
  await agent.connectNewTabWithUrl(targetUrl)
  log('目标页未打开，已新开一页')
  // 新开时 Midscene 内部绑定的是新建页；其 id 需再查一次列表才能取得。
  const after = await listTabs(agent)
  const created = after.find(tab => tab.currentActiveTab === true)
  return { reused: false, tabId: created?.id, reason: 'new' }
}
