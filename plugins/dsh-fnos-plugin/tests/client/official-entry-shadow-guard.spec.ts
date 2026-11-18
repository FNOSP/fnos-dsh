import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { globSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FNOS_OPEN_IN_APP_SEAT, FNOS_SESSION_LOG_SEAT } from '../../src/client/header-utility-seats.ts'

/**
 * 头部导出入口与官方形态的对齐守卫。
 *
 * ## 这条守卫为什么必须有
 *
 * 本插件曾在 `conversation.session.header.utilities` 里用同 id + `priority: -1`
 * 遮蔽官方 `session-log-download`（为了加 NAS 导出）。遮蔽是**整条替换**：官方
 * 在该组件里新加的任何功能都会随之消失，界面不报错——用户只看到一项没了。
 * 这不是假想：官方后来加「复制会话为 Markdown」正是被这条遮挡挡掉的。
 *
 * ## 上游已经改了形态（DSH 0.2.2-rc.4）
 *
 * `session-log-export` 不再注册本插槽，改为
 * `ctx.contextMenus.register({ target: 'sessionHeader' })`；`client-ui-open-in-app`
 * 同样迁出，只留 `contextMenu.icon` 与 `deliverables.*`。两个插槽 occupancy 里
 * 都不再有我们曾经遮蔽的 id，因此本插件改回普通优先级（不再声称遮蔽）。
 *
 * 守卫因此分成两类断言：
 *
 * 1. **上游形态**：从已安装产物里确认这两个官方入口**确实已经不在**本插槽注册，
 *    若哪天上游把它们搬回来，这里立刻报红——那意味着要重新决定遮蔽与否。
 * 2. **本地契约**：我们的两个入口仍是独立条目、优先级不再是遮蔽值、菜单项齐全。
 *
 * 上游产物缺失时**跳过而不是失败**：干净环境没装依赖时不该报一个假红。
 */
const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8')
const HEADER = read('../../src/components/FnosSessionLogHeaderAction.tsx')

/** 按包名找已安装的上游 client 产物；找不到返回 undefined。 */
function findUpstreamBundle(packageName: string): string | undefined {
  const here = fileURLToPath(new URL('.', import.meta.url))
  const matches = globSync(
    `../../../../node_modules/.pnpm/@deepseek-ai+${packageName}@*/node_modules/@deepseek-ai/${packageName}/lib/client.js`,
    { cwd: here },
  )
  return matches[0] === undefined ? undefined : resolve(here, matches[0])
}

/** 该产物是否向指定插槽注册了某条目 id。 */
function registersIntoSlot(source: string, slot: string, id: string): boolean {
  const slotIndex = source.indexOf(slot)
  if (slotIndex < 0) return false
  // 插槽名的出现位置之后紧邻的 register 调用里是否带该 id。
  const window = source.slice(slotIndex, slotIndex + 2000)
  return window.includes(id)
}

/** 本地实现里的菜单项 id（只看 menuItems 数组，避免抓到别处）。 */
function localMenuItemIds(): string[] {
  const start = HEADER.indexOf('const menuItems: MenuItem[] = [')
  const end = HEADER.indexOf('const copyMarkdown')
  const block = HEADER.slice(start, end < 0 ? undefined : end)
  const ids = Array.from(block.matchAll(/id: '([a-zA-Z]+)'/gu)).map(m => m[1] ?? '')
  return [...new Set(ids)]
}

describe('头部导出入口：官方形态与本地契约', () => {
  const sessionLogBundle = findUpstreamBundle('dsh-session-log-export')
  const openInAppBundle = findUpstreamBundle('dsh-client-ui-open-in-app')

  it.skipIf(sessionLogBundle === undefined)('官方 session-log-export 已不向头部插槽注册（DSH 0.2.2-rc.4 起）', () => {
    const source = readFileSync(sessionLogBundle!, 'utf8')
    expect(
      registersIntoSlot(source, 'conversation.session.header.utilities', 'session-log-download'),
      '官方把导出入口搬回了头部插槽：需要重新决定是否遮蔽',
    ).toBe(false)
  })

  it.skipIf(sessionLogBundle === undefined)('官方改为在会话头部右键菜单里注册导出项', () => {
    const source = readFileSync(sessionLogBundle!, 'utf8')
    // 官方用 contextMenus.register + target: sessionHeader 承载导出与反馈。
    expect(source).toContain('contextMenus')
    expect(source).toMatch(/target:\s*`sessionHeader`|target:\s*'sessionHeader'|target:\s*"sessionHeader"/u)
  })

  it.skipIf(openInAppBundle === undefined)('官方 open-in-app 已不向头部插槽注册', () => {
    const source = readFileSync(openInAppBundle!, 'utf8')
    expect(
      registersIntoSlot(source, 'conversation.session.header.utilities', 'open-in-app'),
      '官方把 open-in-app 搬回了头部插槽：需要重新决定是否遮蔽',
    ).toBe(false)
  })

  it('本地两个头部入口不再声称遮蔽（priority 不为负）', () => {
    // 只断言导出常量的实际取值，不做全文匹配——注释里会引用历史写法
    // （`priority: -1`）解释为什么撤销，全文匹配会把说明文字当成违规。
    expect(FNOS_SESSION_LOG_SEAT.priority).toBe(0)
    expect(FNOS_OPEN_IN_APP_SEAT.priority).toBe(0)
    // id 与 order 仍保留：它们决定入口自身的次序，与是否遮蔽无关。
    expect(FNOS_SESSION_LOG_SEAT.id).toBe('session-log-download')
    expect(FNOS_OPEN_IN_APP_SEAT.id).toBe('open-in-app')
    expect(FNOS_SESSION_LOG_SEAT.order).toBe(0)
    expect(FNOS_OPEN_IN_APP_SEAT.order).toBeLessThan(0)
  })

  it('本地菜单项数量与顺序符合预期', () => {
    const local = localMenuItemIds()
    expect(local).toContain('copy')
    expect(local).toContain('download')
    expect(local).toContain('feedback')
  })
})
