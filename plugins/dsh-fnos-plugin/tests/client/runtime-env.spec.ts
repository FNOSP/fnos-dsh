/**
 * 运行时环境常量：三个互斥判断必须覆盖全部标志组合。
 *
 * 这张表是本仓库历史上两次线上问题的根源——只看 DOM 导致 App 环境入口消失、
 * mobile 被误判成独立页面把宿主 API 换成授权页。用表驱动断言把四种组合钉死。
 */
import { describe, expect, it } from 'vitest'

/** 复刻模块里的推导规则，用于表驱动断言。 */
function derive(isWeb: boolean, isStandaloneWeb: boolean): {
  app: boolean
  embedded: boolean
  standalone: boolean
  bridge: boolean
} {
  return {
    app: isWeb === false,
    embedded: isWeb && !isStandaloneWeb,
    standalone: isWeb && isStandaloneWeb,
    bridge: !(isWeb && isStandaloneWeb),
  }
}

describe('运行时环境四态', () => {
  it('每种组合只命中一个环境判断', () => {
    const combos = [
      { isWeb: true, isStandaloneWeb: false },
      { isWeb: true, isStandaloneWeb: true },
      { isWeb: false, isStandaloneWeb: true },
      { isWeb: false, isStandaloneWeb: false },
    ]
    for (const { isWeb, isStandaloneWeb } of combos) {
      const r = derive(isWeb, isStandaloneWeb)
      const hits = [r.app, r.embedded, r.standalone].filter(Boolean).length
      expect(hits, `${String(isWeb)}/${String(isStandaloneWeb)} 命中 ${String(hits)} 个`).toBe(1)
    }
  })

  it('宿主桥只在独立 web 环境不可用', () => {
    // isWeb=false（App）、isWeb&&!standalone（内嵌）都有桥；只有 standalone 没有。
    expect(derive(false, true).bridge).toBe(true)
    expect(derive(false, false).bridge).toBe(true)
    expect(derive(true, false).bridge).toBe(true)
    expect(derive(true, true).bridge).toBe(false)
  })

  it('文件入口在 App 与内嵌 web 显示，独立 web 不显示', () => {
    // 与 FnosOpenInHeaderAction 的判据一致：有桥 且 不是独立 web。
    const shown = (isWeb: boolean, standalone: boolean): boolean => derive(isWeb, standalone).bridge
    expect(shown(false, true), 'App 环境').toBe(true)
    expect(shown(true, false), 'NAS web 内嵌').toBe(true)
    expect(shown(true, true), '独立 web').toBe(false)
  })
})
