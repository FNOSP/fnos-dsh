import { describe, expect, it, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  detectProxyPrefixes,
  RESERVED_PREFIXES,
  toPrefix,
} from '../../src/host/gateway-proxy-detect.ts'

/**
 * FNOS-052：从宿主路由表识别三方插件前缀。
 *
 * 这一组用例守两条最容易出错的边界：**该归并的归并**（`/plugin-api/get/me` →
 * `/plugin-api`）与**该跳过的跳过**（宿主命名空间、文件形态路径）。
 */
const CARD = readFileSync(new URL('../../src/components/GatewayProxyCard.tsx', import.meta.url), 'utf8')
const SCSS = readFileSync(new URL('../../src/styles/index.scss', import.meta.url), 'utf8')

/** 造一个带路由表的假 webServer。 */
function fakeServer(options: { exact?: string[], prefixes?: string[], upgrades?: string[] } = {}): unknown {
  return {
    exact: new Map((options.exact ?? []).map(path => [path, {}])),
    prefixes: new Map((options.prefixes ?? []).map(path => [path, {}])),
    upgrades: new Map((options.upgrades ?? []).map(path => [path, {}])),
  }
}

beforeEach(() => { /* 无共享状态 */ })

describe('FNOS-052 前缀归并', () => {
  it('取首个路径段', () => {
    expect(toPrefix('/plugin-api/get/me')).toBe('/plugin-api')
    expect(toPrefix('/dsh-market/api/v1/capabilities')).toBe('/dsh-market')
    expect(toPrefix('/dsh-taskboard')).toBe('/dsh-taskboard')
  })

  it('跳过宿主与网关保留命名空间', () => {
    for (const prefix of ['/static', '/cgi', '/app', '/api', '/plugins', '/__fnos-gateway']) {
      expect(RESERVED_PREFIXES).toContain(prefix)
      expect(toPrefix(`${prefix}/x`)).toBeUndefined()
    }
  })

  it('跳过文件形态路径（首段含点）', () => {
    expect(toPrefix('/favicon.ico')).toBeUndefined()
    expect(toPrefix('/app.js')).toBeUndefined()
  })

  it('跳过非绝对路径与根', () => {
    expect(toPrefix('plugin-api/x')).toBeUndefined()
    expect(toPrefix('/')).toBeUndefined()
    expect(toPrefix('')).toBeUndefined()
  })
})

describe('FNOS-052 路由表识别', () => {
  it('归并 exact 与 prefix 两类路由，按前缀分组', () => {
    const result = detectProxyPrefixes(fakeServer({
      exact: ['/dsh-market/api/v1/capabilities', '/dsh-market/health'],
      prefixes: ['/dsh-taskboard'],
    }))
    expect(result.available).toBe(true)
    expect(result.prefixes).toEqual(['/dsh-market', '/dsh-taskboard'])
    const market = result.groups.find(g => g.prefix === '/dsh-market')
    expect(market?.routes).toEqual(['/dsh-market/api/v1/capabilities', '/dsh-market/health'])
    expect(market?.kinds).toEqual(['exact'])
  })

  it('覆盖 WebSocket 升级路由（漏掉它们首次就挂）', () => {
    const result = detectProxyPrefixes(fakeServer({ upgrades: ['/dsh-taskboard/events'] }))
    expect(result.prefixes).toContain('/dsh-taskboard')
    expect(result.groups[0]?.kinds).toContain('upgrade')
  })

  it('读不到路由表时降级，而不是抛错', () => {
    // 这是方案的关键前提：DSH 换实现后必须退回手动配置，不能把插件搞挂。
    expect(detectProxyPrefixes(undefined)).toEqual({ available: false, reason: 'webserver-unavailable', groups: [], prefixes: [] })
    expect(detectProxyPrefixes({}).reason).toBe('route-table-unreadable')
  })

  it('没有路由时 available 仍为 true（区别于「读不到」）', () => {
    const result = detectProxyPrefixes(fakeServer())
    expect(result.available).toBe(true)
    expect(result.prefixes).toEqual([])
  })

  it('保留命名空间即使被注册也不接管', () => {
    const result = detectProxyPrefixes(fakeServer({ exact: ['/api/session/list', '/static/x'] }))
    expect(result.prefixes).toEqual([])
  })
})

describe('FNOS-052 GET 返回结构', () => {
  it('返回完整识别结果，而不是只有前缀数组', () => {
    // 只给数组时界面分不清「读不到路由表」与「没有插件用绝对路径」，
    // 而这两种情况的处置完全不同。
    const ROUTES = readFileSync(new URL('../../src/host/gateway-proxy-routes.ts', import.meta.url), 'utf8')
    expect(ROUTES).toContain('auto: detection')
    expect(ROUTES).toContain('detectProxyPrefixes(ctx.webServer)')
  })
})

describe('FNOS-052 自动前缀自更新', () => {
  it('宿主自己巡检路由表并回写（不能等用户点保存）', () => {
    const ROUTES = readFileSync(new URL('../../src/host/gateway-proxy-routes.ts', import.meta.url), 'utf8')
    // 这是「插件装了但接口一直 404」的根因：auto 只在保存设置时写。
    expect(ROUTES).toContain('AUTO_PREFIX_POLL_MS')
    expect(ROUTES).toContain('setInterval')
    // 只在变化时写文件，空转不产生 IO。
    expect(ROUTES).toContain('lastAuto')
    expect(ROUTES).toContain('clearInterval')
  })
})

describe('FNOS-052 界面', () => {
  it('自动区段展示「前缀 + 该前缀下的接口」', () => {
    expect(CARD).toContain('group.prefix')
    expect(CARD).toContain('group.routes.map')
    // 用 ECharts 做索引，按前置缀对比路由条数。
    expect(CARD).toContain("from 'echarts/charts'")
    expect(CARD).not.toContain("from 'echarts'")
  })

  it('明细列表有最大高度，不会把手动配置区顶出可视区', () => {
    const i = SCSS.indexOf('.dsh-fnos-proxy-list {')
    const rule = SCSS.slice(i, SCSS.indexOf('}', i))
    expect(rule).toContain('max-height')
    expect(rule).toContain('overflow-y: auto')
  })

  it('不再展示内置前缀只读区（与自动识别区重复且占位）', () => {
    // 内置前缀是否被接管由后端校验保证，界面上再列一遍只是重复占用画面。
    expect(CARD).not.toContain('FNOS_GATEWAY_BUILTIN_PREFIXES')
    expect(CARD).not.toContain('gatewayProxyBuiltinLabel')
  })

  it('明细列表上限 360px（原 180 只够看两组）', () => {
    const i = SCSS.indexOf('.dsh-fnos-proxy-list {')
    const rule = SCSS.slice(i, SCSS.indexOf('}', i))
    expect(rule).toContain('max-height: 360px')
  })

  it('自动识别不可用时说明原因，而不是静默空白', () => {
    expect(CARD).toContain('gatewayProxyAutoUnavailable')
    expect(CARD).toContain('auto.reason')
  })
})
