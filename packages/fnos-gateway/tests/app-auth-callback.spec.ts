import { describe, expect, it } from 'vitest'
import { APP_AUTH_CALLBACK_PATH, appAuthCallback } from '../src/middleware/app-auth-callback.js'

/** 走一遍中间件，返回它是否接管了请求。 */
function dispatch(url: string): { handled: boolean, body?: string, headers: Record<string, string> } {
  let handled = false
  const headers: Record<string, string> = {}
  const res = {
    setHeader(name: string, value: string) { headers[name.toLowerCase()] = value },
    end(body?: string) { handled = true; return body },
  }
  const req = { url }
  let passed = false
  appAuthCallback()(req as never, res as never, () => { passed = true })
  return { handled: handled && !passed, headers }
}

/**
 * fnOS 授权回调页。
 *
 * 独立浏览器页面只能走 `openAppAuth`：系统授权页完成后 redirect 到这里，
 * 这一页负责解析结果、通知原页面并自行关闭。没有它，授权在最后一步断掉——
 * 用户确认了，原页面永远等不到结果。
 */
describe('fnOS 授权回调页', () => {
  it('只响应自己的路径', () => {
    expect(dispatch(APP_AUTH_CALLBACK_PATH).handled).toBe(true)
    expect(dispatch('/some/other/path').handled).toBe(false)
    expect(dispatch('/').handled).toBe(false)
  })

  it('查询串不影响匹配', () => {
    // 授权结果正是挂在查询串上带回来的，匹配时不能把它算进路径。
    expect(dispatch(`${APP_AUTH_CALLBACK_PATH}?status=success&state=abc`).handled).toBe(true)
  })

  it('返回 HTML 且禁止缓存', () => {
    const { headers } = dispatch(APP_AUTH_CALLBACK_PATH)
    expect(headers['content-type']).toBe('text/html; charset=utf-8')
    // 页面每次都要重新执行脚本，缓存会把上一次的授权结果带回给下一次授权。
    expect(headers['cache-control']).toBe('no-store')
  })
})
