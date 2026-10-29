import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * 删除链路：确认后必须真的发请求。
 *
 * 实机反馈「点击删除并未真实删除」。根因是 Popconfirm 的 `onConfirm` 触发时，
 * 与它同层的菜单节点可能已卸载，闭包里的 `contextMenu` 变成 undefined，早期
 * 实现据此直接 return——请求从未发出，界面看起来「点了没反应」。
 *
 * 这类 bug 不会报错、不会留日志，只能靠断言「目标来源不依赖随时会消失的 state」
 * 来防。本文件因此只做源码契约断言：真正发请求的行为由
 * `authorized-directory-picker.spec.ts` 之外的集成测试覆盖成本过高。
 */

const PANEL = readFileSync(new URL('../../src/components/FnosAuthorizedPathPicker.tsx', import.meta.url), 'utf8')
const LOCALES = readFileSync(new URL('../../src/client/locales.ts', import.meta.url), 'utf8')
const STYLE = readFileSync(new URL('../../src/styles/index.scss', import.meta.url), 'utf8')

describe('FNOS-034 删除：确认后必须真的发出请求', () => {
  it('删除目标保存在 ref 里，不依赖会卸载的 state', () => {
    expect(PANEL).toContain('deleteTargetRef')
    // 确认处理函数从 ref 读，而不是从 contextMenu state 读。
    expect(PANEL).toMatch(/const target = deleteTargetRef\.current/u)
  })

  it('右键时就把目标写入 ref（而不是只在 state 里）', () => {
    expect(PANEL).toMatch(/deleteTargetRef\.current = \{ path: entry\.path/u)
  })

  it('删除调用真的存在，且早于清理本地状态', () => {
    // 请求必须在「从树里摘掉」之前发出，否则失败时界面已经先一步骗了用户。
    const call = PANEL.indexOf('await deleteAuthorizedEntry(target.path)')
    const cleanup = PANEL.indexOf('setTreeData(current => removeNode(current, target.path))')
    expect(call).toBeGreaterThan(0)
    expect(cleanup).toBeGreaterThan(call)
  })

  it('失败时用 toast 告知，不静默吞掉', () => {
    expect(PANEL).toMatch(/catch \(error: unknown\) \{[\s\S]{0,220}Toast\.error/u)
  })
})

describe('FNOS-034 删除提示：使用 Popconfirm 默认尺寸', () => {
  it('不给 Popconfirm 传宽度或尺寸类', () => {
    const block = /<Popconfirm[\s\S]*?>/u.exec(PANEL)?.[0] ?? ''
    expect(block.length).toBeGreaterThan(0)
    expect(block).not.toMatch(/width=/u)
    expect(block).not.toMatch(/style=/u)
    expect(block).not.toMatch(/className=/u)
  })

  it('样式表不覆盖 popconfirm 尺寸', () => {
    // 自定义尺寸会和 Semi 自带的 max-width 打架，把提示框撑得比正文还大。
    expect(STYLE.toLowerCase()).not.toContain('semi-popconfirm')
  })

  it('确认文案保持短句，避免撑宽默认气泡', () => {
    const zh = LOCALES.slice(LOCALES.indexOf('export const zh'))
    const match = /deleteDialogBody: '((?:[^'\\]|\\.)*)'/u.exec(zh)
    expect(match?.[1]).toBeDefined()
    // Popconfirm 的默认宽度按短句设计；超过约 30 个字符会明显变宽。
    expect([...(match?.[1] ?? '')].length).toBeLessThanOrEqual(30)
  })
})
