import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { toggleAccessibleName, togglePresentation } from '../../src/client/toggle-view.ts'

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
  it('激活态用独立的 active 类，普通态无该类', () => {
    // 类名推导集中在纯视图模型里（FNOS-060 起文案可见性也在这里决定）。
    const on = togglePresentation({ enabled: true, mobile: false })
    const off = togglePresentation({ enabled: false, mobile: false })

    expect(on.className).toContain('dsh-failover-pill--active')
    expect(off.className).not.toContain('dsh-failover-pill--active')
    expect(on.className.split(' ')).toContain('dsh-failover-pill')
    expect(off.className.split(' ')).toContain('dsh-failover-pill')
    // 状态不改变文案可见性。
    expect(on.showLabel).toBe(true)
    expect(off.showLabel).toBe(true)
  })

  it('几何与配色对齐官方「深度思考」chip（business 语义色，非自造描边）', async () => {
    const styles = await readToggleStyles()

    expect(styles).toContain('.dsh-failover-pill')
    expect(styles).toContain('.dsh-failover-pill--active')
    // 与官方 chip 同款：28px 高、--dsw-radius-sm、business 语义色激活态。
    expect(styles).toMatch(/height: 28px/u)
    expect(styles).toMatch(/var\(--dsw-radius-sm\)/u)
    expect(styles).toMatch(/var\(--dsw-alias-state-business-tertiary\)/u)
    expect(styles).toMatch(/var\(--dsw-alias-state-business-primary\)/u)
    // 不再使用自造的品牌色描边粉彩底。
    expect(styles).not.toMatch(/--dsw-alias-brand-primary/u)
    expect(styles).not.toMatch(/border-radius: 999px/u)
  })

  it('带 14px 地球图标位（glyph 槽随文字取色）', async () => {
    const source = await readToggleComponent()

    expect(source).toContain('dsh-failover-pill__glyph')
    expect(source).toMatch(/IconGlobeOutlineRegular/u)
    const styles = await readToggleStyles()
    expect(styles).toMatch(/\.dsh-failover-pill__glyph[\s\S]*?width: 14px/u)
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

describe('FNOS-060-01 移动端只显示图标', () => {
  it('移动设备上不渲染可见文案，只留图标与可访问名称', () => {
    const mobile = togglePresentation({ enabled: true, mobile: true })
    const desktop = togglePresentation({ enabled: true, mobile: false })

    // 文案可见性是设备决定的：移动端收起、桌面端保留。
    expect(mobile.showLabel).toBe(false)
    expect(desktop.showLabel).toBe(true)
    // 图标态是独立修饰类，两态下都存在（配色由 active 类决定）。
    expect(mobile.className).toContain('dsh-failover-pill--iconOnly')
    expect(desktop.className).not.toContain('dsh-failover-pill--iconOnly')
    // 关闭态同样收起文案：判据不是开关状态。
    expect(togglePresentation({ enabled: false, mobile: true }).showLabel).toBe(false)
  })

  it('文案收起不丢语义：名称仍由 aria-label 提供', async () => {
    const source = await readToggleComponent()

    // 名称来自纯函数，不依赖可见文案（移动端 DOM 里根本没有这段文字）。
    expect(source).toMatch(/aria-label=\{toggleAccessibleName\(enabled\)\}/u)
    expect(toggleAccessibleName(true)).toContain('智能搜索')
    expect(toggleAccessibleName(false)).toContain('智能搜索')
  })

  it('设备判定取自宿主的移动设备检测，而不是视口宽度', async () => {
    const source = await readToggleComponent()

    // 与官方控件同一口径：宿主 primitives 的 `isMobileDevice`。
    expect(source).toMatch(/isMobileDevice/u)
    expect(source).toContain('@deepseek-ai/dsh-client-ui-primitives')
    expect(source).toMatch(/togglePresentation\(\{\s*enabled,\s*mobile: isMobileDevice\(\)\s*\}\)/u)
    // 图标态不靠媒体查询/容器查询翻转：桌面窄窗口保持文案。
    const styles = await readToggleStyles()
    expect(styles).not.toMatch(/@media[^{]*max-width[^{]*\{\s*\.dsh-failover-pill/u)
    expect(styles).not.toMatch(/@container[^{]*\{\s*\.dsh-failover-pill/u)
  })

  it('图标态收成 28×28 方形、图标居中，命中区不缩小', async () => {
    const styles = await readToggleStyles()
    const block = /\.dsh-failover-pill--iconOnly\s*\{([\s\S]*?)\}/u.exec(styles)?.[1] ?? ''

    expect(block).toMatch(/width: 28px/u)
    expect(block).toMatch(/padding: 0;/u)
    expect(block).toMatch(/justify-content: center/u)
    // 高度仍由基础类提供 28px（图标态不覆盖）。
    expect(block).not.toMatch(/height:/u)
    expect(styles).toMatch(/\.dsh-failover-pill\s*\{[\s\S]*?height: 28px/u)
  })
})
