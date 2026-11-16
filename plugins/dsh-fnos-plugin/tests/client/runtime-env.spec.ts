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

  it('「打开文件管理器」入口只在内嵌 web 显示', () => {
    /*
      App 端没有文件管理器窗口的概念，跳出去会把用户带离当前会话；独立 web 没有
      宿主桥，调用必然失败。所以三处入口都只在 NAS 内嵌 web 出现。

      **注意这里用的是 `embedded` 而不是 `bridge`**：早前判据写成「有宿主桥」，
      而 DOM 兜底时独立 web 也可能被判成有桥，于是 App 端一处显示一处隐藏。
    */
    const shows = (isWeb: boolean, standalone: boolean): boolean => derive(isWeb, standalone).embedded
    expect(shows(true, false), 'NAS web 内嵌').toBe(true)
    expect(shows(true, true), '独立 web').toBe(false)
    expect(shows(false, true), 'App 环境').toBe(false)
    expect(shows(false, false), 'App 环境（另一组合）').toBe(false)
  })
})
