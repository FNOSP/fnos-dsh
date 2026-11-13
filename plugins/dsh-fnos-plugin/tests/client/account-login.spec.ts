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

  it('账号服务实例由注入回调登记，不从根 ctx 读', () => {
    /*
      根上下文的 `ctx` 上没有 `deepseekAccount`——那个属性只存在于
      `ctx.inject(['deepseekAccount'], …)` 的子上下文。从根 ctx 读会永远拿到
      undefined，路由一律回 400（空 body，没有任何错误信息）。
    */
    expect(HOST).toContain('let accountService')
    expect(HOST).toContain('accountService = service')
    expect(HOST).not.toContain('(ctx as unknown as { deepseekAccount')
  })

  it('所有路由都过同源校验', () => {
    const handlers = HOST.match(/handler: async \(req, res\)/gu) ?? []
    const guards = HOST.match(/if \(!trusted\(req\)\)/gu) ?? []
    expect(handlers.length).toBeGreaterThanOrEqual(4)
    expect(guards.length).toBe(handlers.length)
  })
})

describe('账号登录：官方框拦截', () => {
  it('认 #root 之后 role="presentation" 的节点', () => {
    /*
      官方 `ui-primitives/src/Modal.tsx` 最外层容器固定是
      `<div className={css.root} role="presentation">`，内部才是 `role="dialog"`。

      `#root` 之后是弹层专属区域（官方与我们都用 portal 挂到这里），
      应用自身内容都在 `#root` 里面。
    */
    expect(CLIENT).toContain("getElementById('root')")
    expect(CLIENT).toContain('nextElementSibling')
    expect(CLIENT).toContain("getAttribute('role') !== 'presentation'")
    expect(CLIENT).toContain('querySelector(\'[role="dialog"]\')')
  })

  it('不把自己收掉', () => {
    /*
      自己的对话框同样挂在 `#root` 之后、同样 `role="presentation"`（都走官方
      Modal），必须靠**专用属性**排除。

      之前用内容类名 `.dsh-fnos-account-login`——改用官方 Modal 后那个容器被删掉，
      自我保护静默失效，结果自己的弹框被自己收走了一次。测试钉住专用属性。
    */
    expect(CLIENT).toContain("querySelector('[data-dsh-fnos-account-login]')")
    // 标记打在弹框内容上（Semi 的 modalContentClass 只到 content 容器，够用）。
    expect(CLIENT).toContain("dsh-fnos-account-login-modal")
    // 不许退回到内容类名判断。
    expect(CLIENT).not.toContain("querySelector('.dsh-fnos-account-login')")
  })

  it('关闭我方框时，同时关掉官方框', () => {
    /*
      分工：拦截那一刻**隐藏**（官方节点必须活着，否则「添加 API Key」的代点会断），
      用户关掉我方框时**真正关闭**（此时已放弃登录，官方框不该继续留在 DOM 里）。
    */
    expect(CLIENT).toContain('dismissOfficialDialog')
    expect(CLIENT).toMatch(/const official = officialDialogRef\.current\s*\n\s*if \(official !== undefined\) dismissOfficialDialog\(official\)/u)
  })

  it('真正关闭前先解除隐藏，否则按钮点不动', () => {
    // `display: none` 的元素派发 click 不会触发 React 的处理函数。
    const idx = CLIENT.indexOf('export function dismissOfficialDialog')
    const block = CLIENT.slice(idx, idx + 900)
    expect(block).toContain("host.style.removeProperty('display')")
    expect(block).toContain("querySelector('button[aria-label]')")
  })

  it('官方框隐藏而非卸载，保住「添加 API Key」这条出口', () => {
    /*
      最初是点官方关闭按钮让 React 卸载（DOM 干净）。但那样会断掉「添加 API Key」：
      官方业务是 `useApiKey()` → `setApiKey(true)`，按钮随组件消失后就点不到了。

      改为把宿主节点设成 `display: none`：只剩我们的框可见，官方节点仍存活，
      用户选「添加 API Key」时能点它真正的按钮，业务由官方执行。
    */
    expect(CLIENT).toContain('hideOfficialDialog')
    expect(CLIENT).toContain("host.style.display = 'none'")
    // 隐藏阶段不许卸载节点（那会断掉代点），也不许 remove。
    const hideFn = CLIENT.slice(CLIENT.indexOf('function hideOfficialDialog'), CLIENT.indexOf('export function dismissOfficialDialog'))
    expect(hideFn).not.toContain('dismissOfficialDialog')
    expect(hideFn).not.toContain('.remove()')
  })

  it('隐藏后要打标记，否则每轮 scan 重复处理', () => {
    expect(CLIENT).toContain("host.setAttribute('data-dsh-fnos-hidden', '1')")
    expect(CLIENT).toContain("getAttribute('data-dsh-fnos-hidden') === '1'")
  })

  it('代点官方按钮前先把官方框放出来', () => {
    // `display: none` 的元素点不动。
    expect(CLIENT).toContain('host.style.removeProperty(\'display\')')
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

describe('账号登录：三个按钮的语义', () => {
  it('「添加 API Key」走官方业务，不自己实现', () => {
    /*
      官方那条路是 `AccountOnboarding` 的 `useApiKey()` → `setApiKey(true)`，
      属于组件内部状态，插件复刻不了。所以代点官方框里的同名按钮。
    */
    expect(CLIENT).toContain('openOfficialApiKeyEditor')
    expect(CLIENT).toContain('OFFICIAL_API_KEY_LABELS')
    // 不能只是「关掉对话框」了事。
    expect(CLIENT).not.toContain("onClick={onClose}>{t('accountLoginApiKey')}")
  })

  it('官方框引用在收起之前保存', () => {
    /*
      收起之后 React 会卸载节点，`querySelector` 就找不到按钮了。
      所以回调里先存、再 dismiss。
    */
    expect(CLIENT).toMatch(/onCaptured\(dialog\)\s*\n\s*hideOfficialDialog\(dialog\)/u)
    // 引用由浮层持有并传入，两边各存一份会导致「组件里的 ref 永远 undefined」。
    expect(CLIENT).toContain('officialDialogRef: { current: Element | undefined }')
    const overlay = readFileSync(new URL('../../src/components/FnosAccountLoginOverlay.tsx', import.meta.url), 'utf8')
    expect(overlay).toContain('officialDialogRef')
    expect(overlay).toContain('watchOfficialSignInDialogs((dialog)')
  })

  it('「授权」是提交回调地址的按钮文案', () => {
    expect(CLIENT).toContain("t('accountLoginAuthorize')")
    const locales = readFileSync(new URL('../../src/client/locales.ts', import.meta.url), 'utf8')
    expect(locales).toContain("accountLoginAuthorize: '授权'")
  })

  it('不改官方账号菜单', () => {
    // 用户明确要求菜单保持官方原样，只在 DOM 层收起登录框。
    expect(CLIENT).not.toContain('settings.launcher')
    expect(CLIENT).not.toContain('priority: -1')
  })
})

describe('账号登录：弹框几何交给官方', () => {
  const SCSS = readFileSync(new URL('../../src/styles/index.scss', import.meta.url), 'utf8')

  it('用 Semi Modal 并显式挂到 body', () => {
    /*
      用 Semi 而不是官方 `ui-primitives` Modal：需要 Semi 的受控可见性与动画，
      且官方包在客户端模块表里不保证能拿到。

      `getPopupContainer={() => document.body}` 是必须的：宿主若把弹框渲染进带
      `transform` / `backdrop-filter` 的容器，`position: fixed` 的包含块会变成
      那个容器，弹框位置与遮罩范围都会错。显式声明把这件事钉死。
    */
    expect(CLIENT).toContain('DshModal')
    expect(CLIENT).toContain('getPopupContainer={() => document.body}')
    expect(CLIENT).toContain('modalContentClass="dsh-fnos-account-login-modal"')
  })

  it('样式把 Semi Modal 对齐到官方数值', () => {
    /*
      几何必须与官方一致，否则两个弹框放在一起一眼能看出不是一个体系。
      数值出处见 `styles/index.scss` 里这段的注释表（全部取自官方
      `ui-primitives/src/Modal.module.css`）。
    */
    expect(SCSS).toContain('.semi-modal-content.dsh-fnos-account-login-modal')
    // 官方卡片宽度、圆角、底色、阴影。
    expect(SCSS).toContain('width: min(380px, 100%)')
    expect(SCSS).toContain('border-radius: var(--dsw-radius-panel)')
    expect(SCSS).toContain('background: var(--dsw-alias-bg-layer-2)')
    expect(SCSS).toContain('box-shadow: var(--dsw-elevation-prominent)')
    // 官方 header 内边距与标题字号。
    expect(SCSS).toContain('padding: 22px 14px 12px 24px')
    expect(SCSS).toContain('font-size: 16px')
    // 描述与正文的 24px 内容列。
    expect(SCSS).toContain('padding: 0 24px')
  })

  it('描述文案与官方一致', () => {
    // 官方 `ui-settings-account/src/client/locales.ts` 的 loginDescription。
    const locales = readFileSync(new URL('../../src/client/locales.ts', import.meta.url), 'utf8')
    expect(locales).toContain('你的项目和文件保存在本地。')
  })
})
