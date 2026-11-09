/**
 * 复制会话为 Markdown：向官方同源路由取整段转录，再写进剪贴板。
 *
 * ## 为什么走 `/api/session.markdown`
 *
 * DSH 自带的「复制会话为 Markdown」由官方 `session-log-export` 实现，它向
 * `GET /api/session.markdown?sessionId=…` 要整段转录（纯文本 Markdown）。本插件
 * 在会话头部遮蔽了那个包的同一条目（为了加 NAS 导出），所以必须自己把这项能力
 * 补齐——路由本身属宿主，不随插件遮蔽而消失。
 *
 * ## 为什么先试延迟写
 *
 * 浏览器只在**用户手势的同步栈**内允许写剪贴板。取转录是一次网络往返，等它回来
 * 手势已经过期，直接 `writeText` 在部分浏览器会被拒。官方做法是在点击瞬间用
 * `ClipboardItem` 发起一次「内容稍后到位」的写入，把用户激活保住；不支持该 API 的
 * 宿主再退回准备完成后的 `writeClipboard`。这里沿用同一策略。
 *
 * @module dsh-fnos/client/session-markdown-copy
 */

import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'

/** 官方提供的会话 Markdown 导出路由（浏览器相对形式）。 */
const SESSION_MARKDOWN_ROUTE = '/api/session.markdown'

/** 复制结果。 */
export type SessionMarkdownCopyOutcome = 'copied' | 'copy-failed' | 'prepare-failed'

/** 取一段会话的 Markdown 转录。 */
async function fetchSessionMarkdown(sessionId: string, signal?: AbortSignal): Promise<string> {
  const query = new URLSearchParams({ sessionId }).toString()
  const response = await fetch(`${SESSION_MARKDOWN_ROUTE}?${query}`, {
    ...(signal === undefined ? {} : { signal }),
    credentials: 'same-origin',
  })
  if (!response.ok) {
    throw new Error(`session markdown request failed: HTTP ${String(response.status)}`)
  }
  return response.text()
}

/** 宿主是否支持「先占住剪贴板、内容稍后填充」的延迟写入。 */
function supportsDeferredWrite(): boolean {
  if (typeof navigator !== 'object') return false
  const clipboard: unknown = Reflect.get(navigator, 'clipboard')
  return typeof globalThis.ClipboardItem === 'function'
    && typeof clipboard === 'object'
    && clipboard !== null
    && typeof Reflect.get(clipboard, 'write') === 'function'
}

/**
 * 把整段会话转录复制到剪贴板。
 *
 * 不抛错：结果是三态枚举，调用方据此显示提示。剪贴板是系统级目标，一旦写入
 * 成功就无法回滚，因此失败只影响提示，不会留下半截状态。
 * @param sessionId - 目标会话。
 * @returns 复制结果。
 */
export async function copySessionMarkdown(sessionId: string): Promise<SessionMarkdownCopyOutcome> {
  // 延迟写：必须**同步**发起，才能保住点击带来的用户激活。
  if (supportsDeferredWrite()) {
    let resolveText: (text: string) => void
    let rejectText: (error: unknown) => void
    const text = new Promise<string>((resolve, reject) => {
      resolveText = resolve
      rejectText = reject
    })
    let write: Promise<void>
    try {
      write = (Reflect.get(navigator, 'clipboard') as Clipboard)
        .write([new ClipboardItem({ 'text/plain': text })])
    } catch {
      // 连写都没能开始：退回普通路径，不要留一个永不 settle 的 Promise。
      return copyAfterPrepare(sessionId)
    }
    try {
      resolveText!(await fetchSessionMarkdown(sessionId))
    } catch (error) {
      rejectText!(error)
      // 内容没取到：写入会失败，但 AbortError 之外的拒绝只需返回状态。
      await write.catch(() => undefined)
      return 'prepare-failed'
    }
    try {
      await write
      return 'copied'
    } catch {
      return 'copy-failed'
    }
  }
  return copyAfterPrepare(sessionId)
}

/** 不支持延迟写时的路径：先取内容，再写剪贴板。 */
async function copyAfterPrepare(sessionId: string): Promise<SessionMarkdownCopyOutcome> {
  let markdown: string
  try {
    markdown = await fetchSessionMarkdown(sessionId)
  } catch {
    return 'prepare-failed'
  }
  try {
    const accepted = await writeClipboard(markdown)
    return accepted ? 'copied' : 'copy-failed'
  } catch {
    return 'copy-failed'
  }
}
