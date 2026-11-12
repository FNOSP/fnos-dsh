import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseCallbackInput } from '../../src/client/account-login-callback.ts'

const HOST = readFileSync(new URL('../../src/host/account-login-relay.ts', import.meta.url), 'utf8')
const CLIENT = readFileSync(new URL('../../src/components/FnosAccountLoginDialog.tsx', import.meta.url), 'utf8')
const CONTRACT = readFileSync(new URL('../../src/contracts/account-login-contract.ts', import.meta.url), 'utf8')

describe('账号登录：回调改道', () => {
  it('只改写非 loopback，本机访问原样透传', () => {
    /*
      DSH 官方只接受 http + loopback 回调。经 fnOS 网关访问时 origin 是网关地址，
      官方校验在发出请求前就抛错——用户看到「点了没反应」。
    */
    expect(HOST).toContain('LOOPBACK_ORIGIN')
    expect(HOST).toMatch(/LOOPBACK_ORIGIN\.test\(origin\) \? origin : loopback/u)
  })

  it('端口取运行时真实值，不写死', () => {
    // 写死 3080 会在 --port 改过之后让回调落到没人监听的地址上。
    expect(HOST).toContain('ctx.webServer.port')
    expect(HOST).not.toMatch(/127\.0\.0\.1:3080/u)
  })

  it('中继只收 code/state，目标 URL 固定在服务端', () => {
    /*
      **不接受调用方给 URL**：那会变成 SSRF 入口（让 NAS 去请求任意内网地址）。
    */
    expect(HOST).toContain("target.searchParams.set('code', code)")
    expect(HOST).toContain("target.searchParams.set('state', state)")
    // 目标 host 必须来自服务端，不能来自请求体。
    expect(HOST).toMatch(/new URL\(`http:\/\/127\.0\.0\.1:\$\{relayPort\}\/oauth\/callback`\)/u)
  })

  it('startSignIn 返回时 authorizeUrl 还没生成，要等状态推进', () => {
    // 官方返回到 waiting-browser 才有地址；直接读会是 undefined。
    expect(HOST).toContain('waitForAuthorizeUrl')
    expect(HOST).toContain("attempt?.phase === 'waiting-browser'")
  })

  it('所有路由都过同源校验', () => {
    const handlers = HOST.match(/handler: async \(req, res\)/gu) ?? []
    const guards = HOST.match(/if \(!trusted\(req\)\)/gu) ?? []
    expect(handlers.length).toBeGreaterThanOrEqual(4)
    expect(guards.length).toBe(handlers.length)
  })
})

describe('账号登录：官方框拦截', () => {
  it('认 #root 之后的 presentation 节点', () => {
    // 官方弹层用 portal 挂到 body、排在 #root 后面；应用内容都在 #root 里。
    expect(CLIENT).toContain("getElementById('root')")
    expect(CLIENT).toContain('nextElementSibling')
    expect(CLIENT).toContain("getAttribute('role') !== 'presentation'")
  })

  it('点官方自己的关闭按钮，而不是 remove 节点', () => {
    // remove 会让 React 的挂载状态与 DOM 脱节，后续更新可能报错或重复插入。
    expect(CLIENT).toContain('button[aria-label]')
    expect(CLIENT).toContain('.click()')
  })

  it('插件加载时就扫一次，并补微任务与属性观察', () => {
    /*
      插件加载与官方框挂载的顺序不固定：可能先有框后有插件。只靠 MutationObserver
      会漏掉「加载时框已存在」这一种。
    */
    expect(CLIENT).toContain('scan()')
    expect(CLIENT).toContain('queueMicrotask(scan)')
    expect(CLIENT).toContain("attributeFilter: ['role', 'class', 'aria-label']")
  })

  it('官方框标题覆盖多语言', () => {
    // 只在中文下能认出来会导致英文界面完全失效。
    for (const title of ['开始使用', '等待登录', 'Get started', 'Bei DeepSeek anmelden']) {
      expect(CLIENT).toContain(title)
    }
  })
})

describe('账号登录：粘贴解析', () => {
  it('接受整条地址', () => {
    expect(parseCallbackInput('http://127.0.0.1:3080/oauth/callback?code=abc&state=xyz'))
      .toEqual({ code: 'abc', state: 'xyz' })
  })

  it('接受裸查询串', () => {
    expect(parseCallbackInput('?code=abc&state=xyz')).toEqual({ code: 'abc', state: 'xyz' })
    expect(parseCallbackInput('code=abc&state=xyz')).toEqual({ code: 'abc', state: 'xyz' })
  })

  it('缺 code 或 state 时判为无效', () => {
    expect(parseCallbackInput('http://127.0.0.1:3080/oauth/callback?code=abc')).toBeUndefined()
    expect(parseCallbackInput('http://127.0.0.1:3080/oauth/callback?state=xyz')).toBeUndefined()
    expect(parseCallbackInput('')).toBeUndefined()
    expect(parseCallbackInput('这不是地址')).toBeUndefined()
  })
})

describe('账号登录：交互细节', () => {
  it('先同步开空白页再导航，避免被弹窗拦截', () => {
    // window.open 只在用户手势的同步栈里放行；等 fetch 回来再开会被拦。
    expect(CLIENT).toContain("window.open('about:blank', '_blank')")
    expect(CLIENT).toContain('tab.location.href')
  })

  it('关闭时取消宿主那次尝试，不留 waiting-browser 脏状态', () => {
    expect(CLIENT).toContain('FNOS_ACCOUNT_LOGIN_CANCEL_ROUTE')
    expect(CLIENT).toContain('closedRef')
  })

  it('契约里的路由前缀与其他插件路由一致', () => {
    expect(CONTRACT).toContain("'/plugins/dsh-fnos/account/login-relay'")
    expect(CONTRACT).toContain("'/plugins/dsh-fnos/account/login-start'")
  })
})
