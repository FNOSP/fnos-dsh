import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { formatRecord, levelOf } from '../src/server/proxy-request-log.js'


describe('网关请求日志', () => {
  it('状态码映射到日志级别', () => {
    // 4xx 多是调用方写错路径，值得看一眼但不是系统故障；5xx 才是真错误。
    expect(levelOf(200)).toBe('info')
    expect(levelOf(302)).toBe('info')
    expect(levelOf(404)).toBe('warn')
    expect(levelOf(403)).toBe('warn')
    expect(levelOf(500)).toBe('error')
    expect(levelOf(503)).toBe('error')
  })

  it('只记方法、路径、状态、耗时', () => {
    /*
      日志中心是 200 条环形缓冲。记全套请求头或请求体，几次批量加载就能把它冲
      干净，真正的错误反而留不住。
    */
    const line = formatRecord({ method: 'POST', path: '/plugins/x/y', status: 200, durationMs: 42 })
    expect(line).toBe('[proxy] POST /plugins/x/y → 200 (42ms)')
  })

  it('上报带上网关会话，否则会被 webServer 挡在路由外', () => {
    // 这是网关自己发往 DSH 的请求，不是浏览器发起的，没有会话就不算认证。
    const REPORT = readFileSync(new URL('../src/server/proxy-request-log.ts', import.meta.url), 'utf8')
    expect(REPORT).toContain('session?: string')
    expect(REPORT).toContain('headers: { cookie: session }')

    const MW = readFileSync(new URL('../src/server/proxy-request-log-middleware.ts', import.meta.url), 'utf8')
    expect(MW).toContain('session: UpstreamSession')
    expect(MW).toContain('session.current()')
  })

  it('丢掉查询串，且 finish / close 只记一条', () => {
    /*
      插件请求的查询串里可能带 token 或很长的参数，日志中心是给人扫读的地方。
      `finish` 与 `close` 可能都来，用 once + 标志位保证只记一条。
    */
    const MW = readFileSync(new URL('../src/server/proxy-request-log-middleware.ts', import.meta.url), 'utf8')
    expect(MW).toContain(".split('?')[0]")
    expect(MW).toContain("res.once('finish', record)")
    expect(MW).toContain("res.once('close', record)")
    expect(MW).toContain('if (recorded) return')
  })
})
