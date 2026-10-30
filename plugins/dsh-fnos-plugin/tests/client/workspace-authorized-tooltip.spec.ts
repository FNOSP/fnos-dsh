import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * FNOS-001-10：工作区快捷入口的目录名气泡。
 *
 * 与输入卡片选择器（FNOS-034）保持同一套约定：省略号和气泡都交给 Semi
 * `Typography.Text` 的 `ellipsis`，由它内部的 `isOverflowed` 判断文本是否真的
 * 被截断（`noExpandText && overflowed && showTooltip`）。要防的回归是：
 *
 *  1. 有人再手写 `scrollWidth` 或自建 `trigger: 'custom'` 的 Tooltip——
 *     那样放得下的目录名也会弹气泡；
 *  2. 有人把原生 `title` 挂回菜单项——系统提示同样不区分是否省略；
 *  3. 气泡层级掉到下拉菜单（zIndex 10000）下面，被菜单挡住。
 */

const SHORTCUT = readFileSync(
  new URL('../../src/client/shortcuts/workspace-authorized-shortcut.ts', import.meta.url),
  'utf8',
)

/**
 * 去掉注释后再做反向断言：源码注释里会解释「为什么不再自己量 scrollWidth」，
 * 直接匹配全文会把这些说明误判成还在用旧写法。
 */
const SHORTCUT_CODE = SHORTCUT
  .replaceAll(/\/\*[\s\S]*?\*\//gu, '')
  .replaceAll(/^\s*\/\/.*$/gmu, '')

describe('工作区快捷入口的目录名只在省略时提示', () => {
  it('省略与气泡由 Semi Typography 承载', () => {
    expect(SHORTCUT).toContain('DshTypography as Typography')
    expect(SHORTCUT).toContain('Typography.Text as unknown as ElementType')
    expect(SHORTCUT).toContain('showTooltip:')
    expect(SHORTCUT).toContain('rows: 1')
  })

  it('不再自己量宽度，也不自建受控 Tooltip', () => {
    expect(SHORTCUT_CODE).not.toContain('scrollWidth')
    expect(SHORTCUT_CODE).not.toContain('setVisible')
    expect(SHORTCUT_CODE).not.toContain("trigger: 'custom'")
    expect(SHORTCUT_CODE).not.toContain('textOverflow')
  })

  it('菜单项不挂原生 title，避免未省略的目录名也弹提示', () => {
    expect(SHORTCUT_CODE).not.toMatch(/title:\s*directory\.semanticPath/u)
  })

  it('气泡层级压住下拉菜单', () => {
    // Dropdown 用 zIndex 10000，气泡必须在它之上。
    expect(SHORTCUT_CODE).toContain('zIndex: 10000')
    expect(SHORTCUT_CODE).toContain('zIndex: 10001')
  })

  it('ellipsis 只接受纯文本 children（Semi 明确限制）', () => {
    // 目录名统一经 menuText 字符串入口，不直接把 ReactNode 交给 ellipsis。
    expect(SHORTCUT_CODE).toContain('function menuText(text: string')
  })
})
