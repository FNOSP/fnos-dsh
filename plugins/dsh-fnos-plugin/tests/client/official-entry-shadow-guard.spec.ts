import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { globSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 遮蔽官方条目的守卫：**上游新增的菜单项不能静默消失**。
 *
 * ## 这条守卫为什么必须有
 *
 * 本插件在 `conversation.session.header.utilities` 里用同 id + `priority: -1`
 * 遮蔽了官方 `session-log-download` 条目（为了加 NAS 导出）。遮蔽是**整条替换**：
 * 官方在这个组件里新加的任何功能都会随之消失，而界面不会报错——用户只看到一项
 * 没了。
 *
 * 这不是假想：DSH 上游后来加了「复制会话为 Markdown」，正是被这条遮挡挡掉的，
 * 直到用户截图才被发现（见 FNOS-042 的这次修复）。
 *
 * ## 守卫怎么做
 *
 * 直接从**已安装的上游产物**里抽出官方菜单项 id，与本地实现逐项比对。上游再加
 * 一项时，这里立刻报红并点名缺哪一个——改代码的成本远低于等用户报告。
 *
 * 上游产物缺失时**跳过而不是失败**：干净环境没装依赖时不该报一个假红。
 */
const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8')
const HEADER = read('../../src/components/FnosSessionLogHeaderAction.tsx')

/**
 * 上游包的 client 产物路径；找不到时为 undefined。
 *
 * 用 glob 而不是拼版本路径：上游版本号会随基线推进，写死必然腐化。
 * 返回**绝对**路径——glob 给的是相对 cwd 的串，直接用会被按进程 cwd 再解析一次。
 */
function findUpstreamBundle(): string | undefined {
  const here = fileURLToPath(new URL('.', import.meta.url))
  const matches = globSync('../../../../node_modules/.pnpm/@deepseek-ai+dsh-session-log-export@*/node_modules/@deepseek-ai/dsh-session-log-export/lib/client.js', { cwd: here })
  return matches[0] === undefined ? undefined : resolve(here, matches[0])
}

/**
 * 从上游产物里抽出「会话头部菜单」那一组菜单项 id。
 *
 * 只取 `SessionLogDownloadHeaderAction` 函数体：整个 client.js 里还有别的
 * `id:` 字段（路由、toast 等），全局抽取会把无关项算进来，让守卫报假红。
 */
function upstreamMenuItemIds(source: string): string[] {
  const start = source.indexOf('function SessionLogDownloadHeaderAction')
  if (start < 0) return []
  // 函数体到下一个顶层函数声明为止；取足够长的一段以覆盖 items 数组。
  const end = source.indexOf('function ', start + 10)
  const body = source.slice(start, end < 0 ? start + 4000 : Math.min(end, start + 4000))
  const items = body.slice(body.indexOf('items: ['))
  return [...new Set(Array.from(items.matchAll(/id:\s*"([a-zA-Z]+)"/gu), m => m[1] ?? '').filter(id => id !== ''))]
}

/** 本地实现里的菜单项 id（同样只看 menuItems 数组，避免抓到别处）。 */
function localMenuItemIds(): string[] {
  const start = HEADER.indexOf('const menuItems: MenuItem[] = [')
  const end = HEADER.indexOf('const copyMarkdown')
  const block = HEADER.slice(start, end < 0 ? undefined : end)
  // restart 用变量持有，单独计入。
  const ids = Array.from(block.matchAll(/id: '([a-zA-Z]+)'/gu)).map(m => m[1] ?? '')
  if (block.includes('restartItem')) ids.push('restart')
  return [...new Set(ids)]
}

describe('遮蔽官方条目的守卫：上游菜单项不得静默消失', () => {
  const bundle = findUpstreamBundle()

  it.skipIf(bundle === undefined)('上游新增的菜单项都已在本地实现', () => {
    const upstream = upstreamMenuItemIds(readFileSync(bundle!, 'utf8'))
    expect(upstream.length, '上游菜单项解析为空，守卫自身失效').toBeGreaterThan(0)

    const local = localMenuItemIds()
    // 上游有的，本地必须有；本地额外的（refresh / restart）不受此约束。
    const missing = upstream.filter(id => !local.includes(id))
    expect(missing, `上游菜单新增了本地未实现的项：${missing.join(', ')}——遮蔽会把它们挡掉`).toEqual([])
  })

  it.skipIf(bundle === undefined)('上游菜单项解析到的就是已知这三项', () => {
    // 这条不是重复上一条：它固定住「上游解析逻辑仍然有效」。若上游改了结构导致
    // 解析不到，上一条会因为 upstream 为空而误报为通过——这条会先报红。
    const upstream = upstreamMenuItemIds(readFileSync(bundle!, 'utf8'))
    expect(upstream).toEqual(['copy', 'download', 'feedback'])
  })

  it('遮蔽关系本身仍然成立（同 id + 更低 priority）', () => {
    // 守卫的前提：确实还遮蔽着官方条目。若哪天改成不遮蔽，这条守卫就该重写。
    const seats = read('../../src/client/header-utility-seats.ts')
    expect(seats).toContain("id: 'session-log-download'")
    expect(seats).toContain('priority: -1')
  })

  it('本地菜单项数量与顺序符合预期', () => {
    const local = localMenuItemIds()
    expect(local).toContain('copy')
    expect(local).toContain('download')
    expect(local).toContain('feedback')
  })
})
