import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { APP_AUTH_CALLBACK_PATH, APP_AUTH_MESSAGE_TYPE, appAuthRedirectUri } from '../../src/client/services/app-auth.ts'

/**
 * 授权回调页与 `openAppAuth` 链路。
 *
 * 独立浏览器页面没有宿主桥，文件选择与授权只能走 `openAppAuth`：系统授权页
 * 完成后 redirect 到 `redirectUri`，回调页解析结果并通知原页面。
 *
 * 这里守住三件容易静默失效的事：
 *  1. 回调页真的存在（否则授权在最后一步断掉，用户确认了却永远等不到结果）；
 *  2. 两侧的消息类型一字不差（拼错一个字，`postMessage` 就被当成陌生消息丢掉）；
 *  3. `redirectUri` 是**同源相对路径**（跨源的话 `postMessage` 过不了同源校验）。
 */

const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8')
const CALLBACK = read('../../../../packages/fnos-gateway/src/middleware/app-auth-callback.ts')
const GATEWAY = read('../../../../packages/fnos-gateway/src/server/gateway-server.ts')

describe('fnOS 授权回调', () => {
  it('回调页由网关提供，且真的挂进了中间件链', () => {
    expect(CALLBACK).toContain('export function appAuthCallback')
    expect(CALLBACK).toContain('text/html; charset=utf-8')
    // 网关确实使用了它，并且排在转发之前（否则会被转到上游 DSH）。
    expect(GATEWAY).toContain('appAuthCallback()')
    // 以中间件挂载点为序：`app.use(appAuthCallback())` 必须在 `createProxyHandler` 之前。
    expect(GATEWAY.indexOf('app.use(appAuthCallback())'))
      .toBeLessThan(GATEWAY.indexOf('createProxyHandler(options, session)'))
  })

  it('回调页路径不带扩展名，落在网关前缀下', () => {
    // 由网关内联返回，不需要在应用资源目录里放文件。
    expect(APP_AUTH_CALLBACK_PATH).toBe('fnos-auth-callback')
    expect(APP_AUTH_CALLBACK_PATH).not.toContain('.html')
    expect(CALLBACK).toContain("'/fnos-auth-callback'")
  })

  it('两侧的消息类型一致', () => {
    /*
      回调页把常量以 `${JSON.stringify(...)}` 的形式插进内联脚本，所以源码里出现
      的是占位表达式而不是字面量。断言两件事：占位确实引用了同一个常量、且常量的
      值就是约定的握手串。
    */
    expect(CALLBACK).toContain('JSON.stringify(APP_AUTH_MESSAGE_TYPE)')
    expect(APP_AUTH_MESSAGE_TYPE).toBe('dsh-fnos:auth-result')
  })

  it('回调页校验同源后才通知原页面', () => {
    expect(CALLBACK).toContain('location.origin')
    expect(CALLBACK).toContain('window.opener')
    // 关闭失败时不能把结果吞掉，页面要留着让用户自己回去。
    expect(CALLBACK).toContain('window.close()')
  })

  it('redirectUri 是同源相对路径', () => {
    // 不带协议与主机：由 <base> 解析，保证与授权页、原页面同源。
    const uri = appAuthRedirectUri()
    expect(uri.startsWith('/')).toBe(true)
    expect(uri).not.toContain('://')
    expect(uri.endsWith(APP_AUTH_CALLBACK_PATH)).toBe(true)
  })

  it('解析结果时容忍缺失与畸形 path', () => {
    // 各家 fnOS 版本的返回形状不完全一致，畸形输入必须降级而不是抛错。
    expect(CALLBACK).toContain('JSON.parse(raw)')
    expect(CALLBACK).toContain('catch (error)')
    expect(CALLBACK).toContain('Array.isArray(parsed)')
  })
})

describe('standalone 授权链路', () => {
  it('授权目录选择器在 standalone 下走 openAppAuth，不直调 pickSharedFile', async () => {
    /*
      这是本次修复的核心链路：独立浏览器页面没有宿主桥，`pickSharedFile` 只会抛
      `Host bridge is not available`。必须改走 `openAppAuth` 打开系统授权页。
    */
    const picker = read('../../src/client/services/authorized-directory-picker.ts')
    expect(picker).toContain('usesAppAuthFlow()')
    expect(picker).toContain('openFnosAppAuth(')
    // 新增的中间态必须有对应返回，否则调用方会把它当成功。
    expect(picker).toContain("status: 'authorization-pending'")
    // 走授权页的那一支要排在直调之前。
    expect(picker.indexOf('usesAppAuthFlow()')).toBeLessThan(picker.indexOf('await sdk.pickSharedFile'))
  })

  it('两个调用方都处理了 authorization-pending，不会谎报成功', () => {
    /*
      早前选择器面板没有这一支：授权页刚打开就往下走「刷新列表 + Toast 成功」，
      用户什么都没确认却看到「已授权」。卡片与面板都必须显式返回。
    */
    const card = read('../../src/components/AuthorizedDirectoriesCard.tsx')
    expect(card).toContain('usesAppAuthFlow()')
    expect(card).toContain('listenFnosAppAuthResult')

    const picker = read('../../src/components/FnosAuthorizedPathPicker.tsx')
    expect(picker).toContain("outcome.status === 'authorization-pending'")
  })

  it('回调监听校验 state，且保留手动刷新', () => {
    // 浏览器可能不给 opener（移动端分屏），用户要能自己补一次刷新。
    const service = read('../../src/client/services/app-auth.ts')
    expect(service).toContain('event.origin !== window.location.origin')
    expect(service).toContain('data.result.state !== state')
  })
})
