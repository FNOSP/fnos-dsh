/**
 * 页面内脚本的回传约定：包装、解封套、解析判定。
 *
 * 两个 Node（`dsh.assertInPage` 与 `dsh.actUntil`）共用同一套约定，避免各写一份而漂移。
 *
 * ## 为什么需要「包装」
 *
 * CDP 的 `Runtime.evaluate` 默认**不传 `returnByValue`**，对象只会回一个 `objectId` 句柄
 * （实测收到 `{ className: 'Object', objectId: '…' }`），取不到值。因此由 Node 侧把用户
 * 脚本包一层，强制 `JSON.stringify` 再把字符串带回来。
 *
 * ## 为什么不能靠 `throw` 表达失败
 *
 * `Runtime.evaluate` 把页面异常放在 `result.exceptionDetails` 里返回，而 Midscene 不检查
 * 该字段——**`javascript` 步骤里的 `throw` 被静默吞掉**，步骤照常显示 `✓`。这是本仓库
 * 实测踩到的假阳性来源。因此本模块把异常显式编码进回传 JSON，并由 Node 侧（抛错会正常
 * 传播）判定。
 *
 * @module dsh-e2e-kit/page-script
 */

/** 页面脚本的判定结果。 */
export interface PageVerdict {
  /** 判定是否成立。 */
  readonly pass: boolean
  /** 供人阅读的补充说明（会进日志与失败信息）。 */
  readonly detail?: string
}

/** 把用户脚本包成「一定回传 JSON 字符串」的形态。 */
export function wrapPageScript(script: string): string {
  return `(async () => {
    try {
      const verdict = await (${script});
      return JSON.stringify({ ok: true, verdict });
    } catch (error) {
      return JSON.stringify({ ok: false, message: String(error && error.message || error) });
    }
  })()`
}

/**
 * 解开 Bridge 求值结果的封套，取出页面回传的字符串。
 *
 * 同时检查 CDP 的 `exceptionDetails`：外层包装已捕获用户脚本的异常，但包装本身仍可能
 * 因（例如）脚本语法错误而在页面上抛错——那种情况必须在这里报出来，不能当成通过。
 * @param raw - `evaluateJavaScript` 的返回值。
 * @param label - 用于失败信息的标签。
 * @returns 页面回传的字符串。
 */
function unwrap(raw: unknown, label: string): unknown {
  const envelope = raw as { result?: { value?: unknown }, exceptionDetails?: unknown } | undefined
  if (envelope?.exceptionDetails !== undefined) {
    const description = (envelope.exceptionDetails as { exception?: { description?: string } })
      .exception?.description
    throw new Error(`[${label}] 页面脚本抛出异常：${description ?? '未知异常'}`)
  }
  return envelope?.result?.value ?? raw
}

/**
 * 从 Bridge 求值结果解析出判定，形态不符即抛错（不静默放过）。
 * @param raw - `evaluateJavaScript` 的返回值。
 * @param label - 用于失败信息的标签。
 * @returns 页面脚本给出的判定。
 */
export function readPageVerdict(raw: unknown, label: string): PageVerdict {
  const value = unwrap(raw, label)
  if (typeof value !== 'string') {
    throw new TypeError(`[${label}] 页面未回传字符串结果，实际收到：${JSON.stringify(value)?.slice(0, 200)}`)
  }
  let parsed: { ok?: unknown, verdict?: unknown, message?: unknown }
  try {
    parsed = JSON.parse(value) as typeof parsed
  } catch {
    throw new Error(`[${label}] 页面回传的不是合法 JSON：${value.slice(0, 200)}`)
  }
  if (parsed.ok !== true) {
    throw new Error(`[${label}] 页面脚本抛出异常：${String(parsed.message ?? '未知异常')}`)
  }
  const verdict = parsed.verdict
  if (verdict === true || verdict === false) return { pass: verdict }
  if (typeof verdict === 'object' && verdict !== null && typeof (verdict as PageVerdict).pass === 'boolean') {
    return verdict as PageVerdict
  }
  throw new Error(
    `[${label}] 页面脚本必须返回 { pass: boolean, detail?: string }（或布尔值），`
    + `实际收到：${JSON.stringify(verdict)?.slice(0, 200)}`,
  )
}
