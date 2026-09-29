import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/** 本插件测试统一用相对本文件的 URL 定位源码（该包没有共享的 paths 助手）。 */
const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8')

/**
 * fnOS 详情页配置区的呈现约束。
 *
 * 这一轮的界面调整来自实机截图：配置被一层折叠面板包住，用户要先点一下才能
 * 看到内容；而这一页里**只有这一块内容**，折叠不承担任何信息架构作用，只增加
 * 一次点击。因此折叠被整体移除，内容常驻。
 *
 * 另外三处是可用性问题：
 *
 *  - 授权目录多起来没有上限，会把整页撑得很长，需要固定视口高度；
 *  - 反代的说明文字是长句，平铺在标题下会挤压表单，收进 tip 图标；
 *  - 文本框既不知道快捷键、也不知道「一行一个」，且行数无上限。
 */
const CARD = read('../../src/components/AuthorizedDirectoriesCard.tsx')
const SCSS = read('../../src/styles/index.scss')
const LOCALES = read('../../src/client/locales.ts')

/**
 * 从**中文**块里取一条文案。
 *
 * `locales.ts` 里 `en` 与 `zh` 定义了同名 key，全局正则只会命中先出现的 `en`。
 * 断言中文文案必须先把中文块切出来。
 */
function zhCopy(key: string): string {
  const start = LOCALES.indexOf('export const zh')
  if (start < 0) throw new Error('locales.ts 里找不到中文块')
  const match = new RegExp(`${key}: '((?:[^'\\\\]|\\\\.)*)'`).exec(LOCALES.slice(start))
  if (match === null) throw new Error(`中文块里找不到 ${key}`)
  return match[1] ?? ''
}

describe('配置区不再折叠，内容常驻', () => {
  it('不再有折叠开关（没有 aria-expanded / 可点击头部）', () => {
    // 折叠头是一个带 aria-expanded 的 <button>。移除折叠后不应再有该**属性**。
    // 只剔掉注释再断言：正文注释里保留「曾经是 <button aria-expanded>」的说明是
    // 有价值的（它记录了为什么不再折叠），不该因此判失败。
    const code = CARD.replace(/\{\/\*[\s\S]*?\*\/\}/gu, '').replace(/\/\*[\s\S]*?\*\//gu, '')
    expect(code).not.toContain('aria-expanded')
    expect(code).not.toContain('dsh-fnos-authorized-chevron')
  })

  it('不再持有开合状态，也不再条件渲染主体', () => {
    expect(CARD).not.toMatch(/const \[open, setOpen\]/)
    // 旧的写法是 `{open ? (<div ...card-body>...) : null}`：条件渲染会把内容
    // 从 DOM 里拿掉，而常驻意味着它始终在。
    expect(CARD).not.toMatch(/\{open \?/)
  })

  it('主体常驻渲染，且保留锚点 id（外部仍可深链）', () => {
    expect(CARD).toContain('id="dsh-fnos-authorized-directories-body"')
    expect(CARD).toContain('dsh-fnos-authorized-card-body')
  })

  it('数据加载不再依赖「被展开」，挂载即拉取', () => {
    // 旧实现是 `useEffect(() => { if (open) {...} }, [open])`：不点开就不发请求。
    expect(CARD).not.toMatch(/if \(open\)/)
    expect(CARD).toMatch(/useEffect\(\(\) => \{[\s\S]{0,120}refresh\(\)/)
  })
})

describe('授权目录列表：固定高度、超出滚动', () => {
  it('列表容器有 500px 上限并允许纵向滚动', () => {
    const block = SCSS.slice(SCSS.indexOf('.dsh-fnos-authorized-path-list'))
    const rule = block.slice(0, block.indexOf('}'))
    expect(rule).toContain('max-height: 500px')
    expect(rule).toContain('overflow-y: auto')
  })

  it('滚动的是列表本身，不是整页', () => {
    // 若把 max-height 放在卡片或 body 上，超长列表会把保存按钮一起顶出视口。
    const listRule = SCSS.slice(SCSS.indexOf('.dsh-fnos-authorized-path-list'))
    expect(listRule.slice(0, listRule.indexOf('}'))).toContain('max-height')
    const cardBody = SCSS.slice(SCSS.indexOf('.dsh-fnos-authorized-card-body'))
    expect(cardBody.slice(0, cardBody.indexOf('}'))).not.toContain('max-height')
  })
})

describe('反代配置：文案、tip、placeholder、行数上限', () => {
  it('标题文案改为「三方插件 proxy」', () => {
    expect(zhCopy('gatewayProxyTitle')).toBe('三方插件 proxy')
    expect(LOCALES).not.toContain('三方插件 API URL 反代配置')
  })

  it('label 后有 tip 图标，说明放进 tooltip 而不是平铺', () => {
    expect(CARD).toContain('DshIconInfoCircle')
    expect(CARD).toContain('DshTooltip')
    expect(CARD).toContain("t('gatewayProxyDescription')")
    // 平铺的那段说明段落被移除（它的 key 仍可保留给 tooltip 复用，但不能作为
    // 独立段落渲染在标题下）。
    expect(CARD).not.toContain('dsh-fnos-authorized-gateway-description')
  })

  it('tip 图标可键盘聚焦并带 aria-label（说明不能只存在于悬浮层）', () => {
    const tip = CARD.slice(CARD.indexOf('dsh-fnos-authorized-gateway-tip'))
    expect(tip.slice(0, 400)).toContain('tabIndex={0}')
    expect(tip.slice(0, 400)).toContain('aria-label=')
  })

  it('描述涵盖「是什么 / 怎么用 / 举例」三要素', () => {
    const tip = zhCopy('gatewayProxyDescription')
    expect(tip.length).toBeGreaterThan(40)
    // 是什么
    expect(tip).toMatch(/反代|代理|转发/)
    // 怎么用：绝对路径前缀 + 每行一个
    expect(tip).toMatch(/每行/)
    // 举例：至少出现一个 / 开头的示例前缀
    expect(tip).toMatch(/\/[a-z-]+/i)
  })

  it('placeholder 提示保存快捷键与「一行一个」', () => {
    const ph = zhCopy('gatewayProxyPlaceholder')
    expect(ph).toMatch(/Ctrl|⌘|Cmd/)
    expect(ph).toMatch(/每行|一行/)
  })

  it('文本框最多 8 行，超出滚动', () => {
    const rule = (() => {
      const i = SCSS.indexOf('.dsh-fnos-authorized-textarea')
      const b = SCSS.slice(i)
      return b.slice(0, b.indexOf('}'))
    })()
    // 行高 20px（见 font 简写）→ 8 行 = 160px
    expect(rule).toContain('max-height')
    expect(rule).toMatch(/overflow-y: auto|overflow: auto/)
    expect(rule).toMatch(/max-height:\s*calc\(8 \* 20px\)|max-height:\s*160px/)
  })

  it('不再允许用户把文本框拖出 8 行上限', () => {
    const rule = (() => {
      const i = SCSS.indexOf('.dsh-fnos-authorized-textarea')
      const b = SCSS.slice(i)
      return b.slice(0, b.indexOf('}'))
    })()
    // resize: vertical 会让用户绕过 max-height 的视觉预期（拖高后内容仍被裁）。
    expect(rule).toMatch(/resize:\s*none/)
  })
})

/**
 * 外层「面板」框：详情页里不再需要它。
 *
 * 宿主给 `plugins.detail.section` 的容器（`.detailSections` / `.detailSection`）只有
 * `flex-column` 与间距，**不画边框也不画底色**。此前插件自己又套了一层带边框和背景
 * 的卡片（`.dsh-fnos-authorized-card`），于是在详情页上出现「框里的框」：外层是插件
 * 画的圆角边框，内层（列表项、文本框）各自还有边框，视觉上多出一层无意义的容器。
 *
 * 详情页本身已经是承载这一块内容的容器，插件不该再画一个。
 */
describe('详情页区块不再自带外层面板', () => {
  const cardRule = (): string => {
    const i = SCSS.indexOf('.dsh-fnos-authorized-card {')
    return SCSS.slice(i, SCSS.indexOf('}', i))
  }

  it('外层容器没有边框与背景', () => {
    const rule = cardRule()
    expect(rule).not.toMatch(/border:\s*1px/)
    expect(rule).not.toMatch(/background:/)
    expect(rule).not.toMatch(/border-radius/)
  })

  it('外层容器保留布局职责（不整块删掉，避免破坏间距与语义）', () => {
    expect(CARD).toContain('dsh-fnos-authorized-card')
    const rule = cardRule()
    // 仍然要能排布内部区块。
    expect(rule).toMatch(/display:\s*flex|flex-direction/)
  })

  it('标题区与主体不再靠边框分隔（分隔线由主体自身提供）', () => {
    // 去掉外层框后，标题下沿若还留着「贴边框」的视觉会显得悬空；
    // 主体自己带的 border-top 才是分隔线。
    const body = (() => {
      const i = SCSS.indexOf('.dsh-fnos-authorized-card-body {')
      return SCSS.slice(i, SCSS.indexOf('}', i))
    })()
    expect(body).toContain('border-top')
  })
})
