import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { toggleAccessibleName } from '../../src/client/toggle-view.ts'

/** 读取客户端入口源码（运行时解析路径，不写死本机绝对路径）。 */
async function readClientEntry(): Promise<string> {
  return await readFile(new URL('../../src/client/index.tsx', import.meta.url), 'utf8')
}

/** 读取控件组件源码。 */
async function readToggleComponent(): Promise<string> {
  return await readFile(new URL('../../src/client/smart-search-toggle.tsx', import.meta.url), 'utf8')
}

/** 读取控件样式源码。 */
async function readToggleStyles(): Promise<string> {
  return await readFile(new URL('../../src/client/styles.scss', import.meta.url), 'utf8')
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
})

describe('FNOS-012-06-AC-01 药丸按钮形态', () => {
  it('控件是单个 button，不再有 Switch 与双元素布局', async () => {
    const source = await readToggleComponent()

    // 药丸按钮本体。
    expect(source).toMatch(/<button\b/u)
    expect(source).toContain('dsh-failover-pill')
    // Switch 与旧的双元素布局不再出现。
    expect(source).not.toContain('DshSwitch')
    expect(source).not.toContain('dsh-failover-toggle')
  })

  it('可见文案固定为「智能搜索」，状态不进文案', async () => {
    const source = await readToggleComponent()
    const locales = await readFile(new URL('../../src/client/locales.ts', import.meta.url), 'utf8')

    // 渲染只取 toggleOn（「智能搜索」）。
    expect(source).toContain("t('toggleOn')")
    expect(source).not.toContain('toggleLabelKey')
    // 「智能搜索已关」类状态文案已删除。
    expect(locales).not.toContain('智能搜索已关')
    expect(locales).not.toContain('Smart search off')
  })
})

describe('FNOS-012-06-AC-02 两态仅样式区分', () => {
  it('激活态用独立的 active 类，普通态无该类', async () => {
    const source = await readToggleComponent()

    expect(source).toContain("'dsh-failover-pill dsh-failover-pill--active'")
    expect(source).toContain(": 'dsh-failover-pill'")
  })

  it('样式定义激活态与普通态，均使用 DSH 语义变量', async () => {
    const styles = await readToggleStyles()

    expect(styles).toContain('.dsh-failover-pill')
    expect(styles).toContain('.dsh-failover-pill--active')
    // 只用语义变量，不硬编码色值（color-mix 的 12% 是比例不是色值）。
    expect(styles).toMatch(/--dsw-alias-brand-primary/u)
    expect(styles).toMatch(/--dsw-alias-text-secondary/u)
  })

  it('切换行为与状态所有权沿用（乐观更新 + 失败回滚）', async () => {
    const source = await readToggleComponent()

    expect(source).toContain('setEnabled(next) // 乐观更新')
    expect(source).toMatch(/setEnabled\(!next\)/u)
  })
})

describe('FNOS-012-06-AC-03 可访问名称与键盘可达', () => {
  it('可访问名称包含「智能搜索」语义且区分状态（读屏依赖名称而非样式）', () => {
    const on = toggleAccessibleName(true)
    const off = toggleAccessibleName(false)

    expect(on).toContain('智能搜索')
    expect(off).toContain('智能搜索')
    expect(on).not.toBe(off)
  })

  it('button 原生键盘可达，aria-pressed 表达状态', async () => {
    const source = await readToggleComponent()

    expect(source).toContain('type="button"')
    expect(source).toMatch(/aria-pressed=\{enabled\}/u)
    expect(source).toMatch(/aria-label=\{toggleAccessibleName\(enabled\)\}/u)
  })
})
