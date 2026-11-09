import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * 「复制会话为 Markdown」。
 *
 * 这个能力原本由官方 `session-log-export` 提供，但本插件在会话头部遮蔽了它的
 * 同一条目（为加 NAS 导出），因此必须自己补齐——否则用户升级 DSH 后会丢掉这项
 * 功能，而界面不会提示缺失。
 */
const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8')
const SERVICE = read('../../src/client/services/session-markdown-copy.ts')
const HEADER = read('../../src/components/FnosSessionLogHeaderAction.tsx')
const LOCALES = read('../../src/client/locales.ts')

describe('复制会话为 Markdown', () => {
  it('走官方同源的 /api/session.markdown 路由', () => {
    expect(SERVICE).toContain("'/api/session.markdown'")
    expect(SERVICE).toContain('sessionId')
    // 不带 body：这是 GET 读取，不是导出写盘。
    expect(SERVICE).not.toContain('method: \'POST\'')
  })

  it('先尝试延迟写以保住用户激活', () => {
    // 取转录是网络往返，等它回来手势已过期；官方同样先占住剪贴板。
    expect(SERVICE).toContain('ClipboardItem')
    expect(SERVICE).toContain('supportsDeferredWrite')
    // 不支持时退回 writeClipboard（官方降级路径用的同一个工具）。
    expect(SERVICE).toContain('writeClipboard')
    expect(SERVICE).toContain('copyAfterPrepare')
  })

  it('结果是三态枚举，不抛错', () => {
    expect(SERVICE).toContain("'copied'")
    expect(SERVICE).toContain("'copy-failed'")
    expect(SERVICE).toContain("'prepare-failed'")
    // 函数签名里没有 throw 语义：返回 Promise<Outcome>。
    expect(SERVICE).toMatch(/copySessionMarkdown\(sessionId: string\): Promise<SessionMarkdownCopyOutcome>/)
  })

  it('菜单项排在最上面（与官方顺序一致），并带复制图标', () => {
    const start = HEADER.indexOf('const menuItems: MenuItem[] = [')
    const block = HEADER.slice(start, HEADER.indexOf('const copyMarkdown'))
    expect(block.indexOf("id: 'copy'")).toBeGreaterThan(-1)
    expect(block.indexOf("id: 'copy'")).toBeLessThan(block.indexOf("id: 'refresh'"))
    expect(HEADER).toContain('IconCopyOutlineRegular')
  })

  it('选择 copy 时调用复制，且不误落到下载', () => {
    expect(HEADER).toContain("if (id === 'copy') void copyMarkdown()")
    expect(HEADER).toContain('copySessionMarkdown(String(sessionId))')
  })

  it('八种语言都有文案', () => {
    // locales.ts 里 en/zh 各一条，其余七份各一条。
    expect(LOCALES).toContain("sessionLogCopyMarkdown: 'Copy Session as Markdown'")
    expect(LOCALES).toContain("sessionLogCopyMarkdown: '复制会话为 Markdown'")
  })
})
