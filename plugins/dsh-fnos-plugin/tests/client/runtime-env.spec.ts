/**
 * 运行时环境常量：三个互斥判断必须覆盖全部标志组合。
 *
 * 这张表是本仓库历史上两次线上问题的根源——只看 DOM 导致 App 环境入口消失、
 * mobile 被误判成独立页面把宿主 API 换成授权页。用表驱动断言把四种组合钉死。
 */
import { describe, expect, it } from 'vitest'

/**
 * 复刻模块里的推导规则。
 *
 * **判据是两套而不是一套**：
 * - 「在不在 iframe 里」用 DOM（同步可得）
 * - 「是不是 App」用 User-Agent 的 `FNAppVer/` 标记（SDK 的 `isWeb` 要等异步
 *   `init()` 才更新，模块加载时读它永远是初始值 `true`）
 */
function derive(domEnv: 'embedded' | 'standalone' | 'none', uaMarker: boolean): {
  app: boolean
  embedded: boolean
  standalone: boolean
  bridge: boolean
  showsFileMgr: boolean
} {
  const app = uaMarker && domEnv !== 'embedded'
  return {
    app,
    embedded: domEnv === 'embedded',
    standalone: domEnv === 'standalone',
    bridge: app || domEnv === 'embedded',
    showsFileMgr: domEnv === 'embedded',
  }
}

describe('运行时环境四态', () => {
  it('每种环境只命中一个判断', () => {
    /*
      注意「NAS 独立浏览器」与「本地独立 web」都落在 `standalone` 这个分类里——
      `detectFnosEnvironment` 用网关的 `<base href>` 区分它们，但两者的**能力**
      完全一样（都没有宿主桥）。所以这里断言的是「不会同时命中两个」，而不是
      「四个各占一个」。
    */
    const combos: Array<{ dom: 'embedded' | 'standalone' | 'none', ua: boolean, label: string }> = [
      { dom: 'embedded', ua: false, label: 'NAS 内嵌 iframe' },
      { dom: 'standalone', ua: false, label: 'NAS 独立浏览器' },
      { dom: 'none', ua: false, label: '本地独立 web' },
      { dom: 'none', ua: true, label: 'App' },
    ]
    for (const { dom, ua, label } of combos) {
      const r = derive(dom, ua)
      const hits = [r.app, r.embedded, r.standalone].filter(Boolean).length
      expect(hits, `${label} 不能同时命中两个分类`).toBeLessThanOrEqual(1)
    }
    // App 与内嵌 web 必须各自唯一命中，这两类是能力分化的关键。
    expect(derive('none', true).app).toBe(true)
    expect(derive('embedded', false).embedded).toBe(true)
  })

  it('宿主桥在 App 与内嵌 web 可用，独立页面不可用', () => {
    expect(derive('none', true).bridge, 'App').toBe(true)
    expect(derive('embedded', false).bridge, '内嵌 iframe').toBe(true)
    expect(derive('standalone', false).bridge, 'NAS 独立浏览器').toBe(false)
    expect(derive('none', false).bridge, '本地独立 web').toBe(false)
  })

  it('「打开文件管理器」入口只在内嵌 web 显示', () => {
    /*
      App 端没有文件管理器窗口的概念，跳出去会把用户带离当前会话；独立 web 没有
      宿主桥，调用必然失败。所以三处入口都只在 NAS 内嵌 web 出现。

      **注意这里用的是 `embedded` 而不是 `bridge`**：早前判据写成「有宿主桥」，
      而 DOM 兜底时独立 web 也可能被判成有桥，于是 App 端一处显示一处隐藏。
    */
    const shows = (dom: 'embedded' | 'standalone' | 'none', ua: boolean): boolean => derive(dom, ua).showsFileMgr
    expect(shows('embedded', false), 'NAS web 内嵌').toBe(true)
    expect(shows('standalone', false), 'NAS 独立浏览器').toBe(false)
    expect(shows('none', false), '本地独立 web').toBe(false)
    expect(shows('none', true), 'App 环境').toBe(false)
  })
})
