import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { toggleLabelKey, toggleAccessibleName } from '../../src/client/toggle-view.ts'

/** 读取客户端入口源码（运行时解析路径，不写死本机绝对路径）。 */
async function readClientEntry(): Promise<string> {
  return await readFile(new URL('../../src/client/index.tsx', import.meta.url), 'utf8')
}

describe('FNOS-010-12-AC-01 开关控件契约', () => {
  it('控件注册在 conversation.input.left（消息框左下角）', async () => {
    const source = await readClientEntry()

    // 截图要求的位置：消息框左下角、与「深度思考」同一行区域。
    expect(source).toContain("inject('conversation.input.left'")
    expect(source).toContain('name: \'conversation.input.left\'')
  })

  it('座位带 id 与 locale（list 座位要求 id；文案来自本插件命名空间）', async () => {
    const source = await readClientEntry()

    expect(source).toMatch(/name: 'conversation\.input\.left',\s*\n\s*id: '[a-z0-9-]+'/u)
  })

  it('控件按会话读写开关（不是全局配置）', async () => {
    const source = await readClientEntry()

    // 会话级语义：请求带 sessionId，走 toggle / toggle-set 端点。
    expect(source).toContain('FAILOVER_TOGGLE_ENDPOINT')
    expect(source).toContain('FAILOVER_TOGGLE_SET_ENDPOINT')
  })

  it('控件带可访问名称（A11y，TC-080）', async () => {
    // 可访问名称在控件组件里（index.tsx 只负责注册座位）。
    const source = await readFile(new URL('../../src/client/smart-search-toggle.tsx', import.meta.url), 'utf8')

    expect(source).toMatch(/aria-label=\{toggleAccessibleName/u)
    // 键盘可达：Enter/Space 与点击等价，不能只能鼠标点。
    expect(source).toMatch(/onKeyDown/u)
    expect(source).toMatch(/'Enter'/u)
  })
})

describe('FNOS-010-12-AC-01 开关文案与可访问名称', () => {
  it('开启与关闭给出可分辨的文案键', () => {
    expect(toggleLabelKey(true)).toBe('toggleOn')
    expect(toggleLabelKey(false)).toBe('toggleOff')
  })

  it('可访问名称包含「智能搜索」语义且区分状态', () => {
    const on = toggleAccessibleName(true)
    const off = toggleAccessibleName(false)

    expect(on).toContain('智能搜索')
    expect(off).toContain('智能搜索')
    expect(on).not.toBe(off) // 屏幕阅读器能分辨当前状态
  })
})
