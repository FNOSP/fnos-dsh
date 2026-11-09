import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { ICON_BODIES } from '../../src/generated/icons.ts'

/**
 * 离线 Iconify 图标（菜单项用）。
 *
 * 两条硬约束值得钉住：
 *
 * 1. **不依赖外网**：fnOS iframe 里的图标若走 api.iconify.design，NAS 无外网时
 *    会静默不显示，而界面不报错。因此必须是构建期内联。
 * 2. **只内联用到的**：整套 lucide 有 1600+ 图标，全打进去让客户端产物从 2.46MB
 *    涨到 3.12MB。为两个图标背 660KB 不可接受。
 */
const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8')
const COMPONENT = read('../../src/components/IconifyIcon.tsx')
const HEADER = read('../../src/components/FnosSessionLogHeaderAction.tsx')
const BUILD = read('../../tsdown.config.ts')

describe('Iconify 图标：离线内联与按需抽取', () => {
  it('图标 body 在构建期生成，运行时不发请求', () => {
    // 去掉注释后再断言：文档里提到 api.iconify.design / fetch 是在解释「为什么不用」，
    // 不该被当成实现。
    const code = COMPONENT.replace(/\/\*[\s\S]*?\*\//gu, '')
    expect(code).not.toContain('fetch(')
    expect(code).not.toContain('api.iconify.design')
    expect(COMPONENT).toContain("from '../generated/icons.ts'")
    // 不再直接导入整套 icons.json。
    expect(COMPONENT).not.toContain('@iconify-json/lucide/icons.json')
  })

  it('构建配置里登记的就是实际用到的图标', () => {
    // 构建清单与组件里的名字必须一致，否则打包的 body 与调用处对不上。
    expect(BUILD).toContain("'lucide:power'")
    expect(BUILD).toContain("'lucide:refresh-cw'")
    // 生成物里确实只有这两个。
    expect(Object.keys(ICON_BODIES).sort()).toEqual(['lucide:power', 'lucide:refresh-cw'])
  })

  it('两个图标 body 都是有效 SVG 片段', () => {
    for (const [name, body] of Object.entries(ICON_BODIES)) {
      expect(body, name).toMatch(/<(path|g|circle)\b/u)
      expect(body, name).toContain('currentColor')
    }
  })

  it('刷新与重启用不同图标（这是本次改动的目的）', () => {
    // 改之前两者都是 IconRefreshOutlineRegular，用户无法凭图标分辨。
    expect(HEADER).toContain('lucide:refresh-cw')
    expect(HEADER).toContain('lucide:power')
    // 旧的共用图标已不再出现在菜单项里。
    expect(HEADER).not.toContain('IconRefreshOutlineRegular')
  })

  it('图标是纯装饰，不干扰读屏', () => {
    expect(COMPONENT).toContain('aria-hidden="true"')
    expect(COMPONENT).toContain('focusable="false"')
  })

  it('缺图标时渲染 null 而不是空盒子', () => {
    expect(COMPONENT).toContain('if (body === undefined) return null')
  })
})
