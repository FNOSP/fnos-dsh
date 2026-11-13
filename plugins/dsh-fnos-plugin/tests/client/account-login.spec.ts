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

describe('账号登录：只补官方缺的那一屏', () => {
  it('组件只在「等待粘贴」时渲染，不画官方的初始态', () => {
    /*
      官方 `SignInDialog` 自带初始态（「登录 DeepSeek 账号」+ 两个按钮）与
      「等待登录」态，界面本来就是对的。多画一个会跟官方抢屏幕，用户看到两个
      一样的框。这里补的是官方**没有**的那一步：授权后浏览器跳到 127.0.0.1
      打不开，需要把地址粘回来。
    */
    // 显隐只看 open：早前这里还有一道按内部阶段的门控，阶段推进被删后永远不渲染。
    expect(CLIENT).toContain('visible={open}')
    expect(CLIENT).not.toContain('if (!waiting) return null')
    // 不许再渲染初始态的标题/按钮。
    expect(CLIENT).not.toContain("t('accountLoginTitle')")
    expect(CLIENT).not.toContain("t('accountLoginSignIn')")
    expect(CLIENT).not.toContain("t('accountLoginApiKey')")
  })

  it('官方框要压下去，关闭时再放出来', () => {
    /*
      官方的初始态与「等待登录」态都跟我们的对话框讲同一件事，两个框叠在一起
      只会让用户不知道该点哪个。压制只改宿主的可见性（结构不动），关掉我们的
      框时放出来；否则官方框会一直停在 `display: none`。
    */
    const overlay = readFileSync(new URL('../../src/components/FnosAccountLoginOverlay.tsx', import.meta.url), 'utf8')
    expect(overlay).toContain('hideOfficial(found.host)')
    /*
      关闭我方弹框时要**真正关掉**官方框（点它自己的关闭按钮），不是恢复显示：
      用户已经放弃这次登录，官方框不该继续留在 DOM 里。
    */
    expect(overlay).toContain('dismissOfficial(found)')
    expect(overlay).toContain("querySelector('button[aria-label]')")
    // 关闭前必须先解除隐藏，否则 click 不触发 React 处理函数。
    expect(overlay.indexOf("found.host")).toBeGreaterThan(-1)
    expect(overlay).toContain('showOfficial(found.host)')
    // 压的是宿主，不是 dialog 本身——只藏内容会留下一层拦截点击的透明遮罩。
    expect(overlay).toContain("host.style.display = 'none'")
    expect(overlay).toContain('HIDDEN_ATTR')
    // 早年代点「添加 API Key」那套不需要了。
    expect(CLIENT).not.toContain('OFFICIAL_API_KEY_LABELS')
  })

  it('用 DOM 监听触发，不轮询', () => {
    /*
      触发信号是**官方弹框自己**：它进入「等待登录」态就说明授权页已开、正等
      用户粘贴。轮询只能靠固定间隔猜状态，既多打请求，又会在「用户刚关掉、
      下一轮又弹回来」这种时序上出错。DOM 变化是事件，什么时候发生就什么时候响应。
    */
    const overlay = readFileSync(new URL('../../src/components/FnosAccountLoginOverlay.tsx', import.meta.url), 'utf8')
    expect(overlay).toContain('MutationObserver')
    expect(overlay).toContain('findSignInDialog')
    // 不许再出现定时轮询。
    expect(overlay).not.toContain('POLL_MS')
    expect(overlay).not.toContain('setTimeout(() => { void poll')
    /*
      宿主状态只读一次，用来填「复制链接」的地址，不参与显隐判断。

      读取函数放在 `client/services/account-login-state.ts`：早前它和浮层组件
      互相 import 形成循环依赖，现在依赖方向是单向的
      `overlay → dialog → account-login-state`。
    */
    const state = readFileSync(new URL('../../src/client/services/account-login-state.ts', import.meta.url), 'utf8')
    expect(state).toContain('readAuthorizeUrlOnce')
    expect(CLIENT).toContain("from '../client/services/account-login-state.ts'")
    // 浮层不许再反向依赖对话组件之外的实现细节（循环依赖的入口）。
    expect(overlay).not.toContain('export async function readAuthorizeUrlOnce')
  })

  it('监听只做 body 一层，不开 subtree', () => {
    /*
      官方弹层挂在 `body` 直下，「出现 / 消失」就是一次子节点增删。开 `subtree`
      会把弹框内部每次重渲染都算成变化，回调高频触发而判断结果不变。
    */
    const overlay = readFileSync(new URL('../../src/components/FnosAccountLoginOverlay.tsx', import.meta.url), 'utf8')
    expect(overlay).toContain('observer.observe(document.body, { childList: true })')
    expect(overlay).not.toContain('subtree: true')
  })

  it('在 body 直接子节点里找，不用链表遍历', () => {
    /*
      官方弹层由 portal 挂到 `body` 直下，看这一层就够。用数组语义遍历，
      不写 `while (node !== null)` —— 那种循环条件改起来容易漏，越界也不好兜。
    */
    const overlay = readFileSync(new URL('../../src/components/FnosAccountLoginOverlay.tsx', import.meta.url), 'utf8')
    expect(overlay).toContain('[...document.body.children]')
    expect(overlay).not.toContain('nextElementSibling')
    expect(overlay).not.toContain('while (node !== null)')
  })

  it('退出登录的确认框优先级最高，绝不拦截', () => {
    /*
      退出登录确认框里「登录」出现不止一次：标题「退出登录」、按钮「退出登录」、
      正文「你仍可以登录此账号」。通用判据会命中它，而那是危险操作的二次确认，
      被压掉、换成授权弹框属于严重错误。

      所以排除名单要先短路，再看登录判据——顺序写反就等于没排除。
    */
    const overlay = readFileSync(new URL('../../src/components/FnosAccountLoginOverlay.tsx', import.meta.url), 'utf8')
    expect(overlay).toContain('EXCLUDE_MARKERS')
    expect(overlay).toContain("'退出登录'")
    expect(overlay).toContain('Sign out')
    // 排除必须在登录判据之前。
    const excludeAt = overlay.indexOf('EXCLUDE_MARKERS.some')
    const matchAt = overlay.indexOf('SIGN_IN_MARKERS.some')
    expect(excludeAt).toBeGreaterThan(-1)
    expect(excludeAt).toBeLessThan(matchAt)
  })

  it('认「登录 DeepSeek 账号」「登录」，不认「开始使用」', () => {
    /*
      官方两处文案撞车：
        - `ui-settings-account` 登录框**标题**：开始使用
        - `ui-settings-models` 引导弹框**描述结尾**：配置 DeepSeek 官方模型，即可开始使用。

      用「开始使用」当判据会把**引导弹框**一起认成登录框——用户第一次打开应用
      就被塞一个粘贴回调地址的框。所以只认登录框独有的文案。
    */
    const overlay = readFileSync(new URL('../../src/components/FnosAccountLoginOverlay.tsx', import.meta.url), 'utf8')
    expect(overlay).toContain("'登录 DeepSeek 账号'")
    expect(overlay).toContain("'登录'")
    expect(overlay).toContain("'等待登录'")
    // 引导弹框的文案不能出现在判据里。
    expect(overlay).not.toContain("'开始使用'")
    expect(overlay).not.toContain("'Get started'")
  })

  it('自己的弹框不能被自己的判据认出', () => {
    /*
      判据里有裸「登录」这类宽条件，所以排除自己必须可靠。
      类名挂在 Semi 的 `.semi-modal-content` 上，而 body 直下是外层 wrap——
      只比本节点 class 永远不命中，必须查后代。
    */
    const overlay = readFileSync(new URL('../../src/components/FnosAccountLoginOverlay.tsx', import.meta.url), 'utf8')
    expect(overlay).toContain("node.querySelector('.dsh-fnos-account-login-modal') !== null) return false")
  })

  it('关闭后不再被同一屏弹回来', () => {
    // 记住「关闭时那一屏」的节点；同一节点还在就不再显示，节点消失则标记失效。
    const overlay = readFileSync(new URL('../../src/components/FnosAccountLoginOverlay.tsx', import.meta.url), 'utf8')
    expect(overlay).toContain('dismissedNodeRef')
    // 命中的对话框与「关过的那一屏」相同就保持收起。
    expect(overlay).toContain('found.dialog === dismissedNodeRef.current')
  })
})

describe('账号登录：弹框用 Semi 并挂 body', () => {
  const SCSS = readFileSync(new URL('../../src/styles/index.scss', import.meta.url), 'utf8')

  it('用 Semi Modal，显式挂到 body', () => {
    /*
      需要 Semi 的受控可见性与动画。`getPopupContainer` 是必须的：宿主若把弹框
      渲染进带 `transform` / `backdrop-filter` 的容器，`position: fixed` 的包含块
      会变成那个容器，弹框位置与遮罩范围都会错。
    */
    expect(CLIENT).toContain('DshModal')
    expect(CLIENT).toContain('getPopupContainer={() => document.body}')
    expect(CLIENT).toContain('modalContentClass="dsh-fnos-account-login-modal"')
  })

  it('窄屏时弹框收进视口，尺寸由最外层控制', () => {
    /*
      Semi 把组件的 `width={480}` 写进 `.semi-modal` 的**内联样式**，内容层的
      `width: 100%` 取的就是它。所以窄屏要收必须收在最外层。

      关键是 `max-width` 天然约束 `width`——**包括内联写死的那个**，不需要
      `!important`。真机实测：视口 500 时外层 max-width 476，实际宽度 476、
      左边界 12，不溢出；视口 1200 时仍是产品要求的 480。
    */
    expect(SCSS).toContain('.semi-modal:has(> .semi-modal-content.dsh-fnos-account-login-modal)')
    expect(SCSS).toContain('max-width: calc(100vw - 24px)')
    /*
      内容层跟随外层：`width: 100%` 取外层（已被 max-width 收住）的宽度，
      自己不再写死 480。`max-width` 保留一条 480 的保底，只在视口足够宽时起作用。
    */
    const block = SCSS.slice(SCSS.indexOf('body[data-dsh-semi-theme] .semi-modal-content.dsh-fnos-account-login-modal {'))
    expect(block.slice(0, 400)).toContain('width: 100%')
  })

  it('样式把 Semi Modal 对齐到官方数值', () => {
    // 数值出处见 `styles/index.scss` 里这段的注释表（取自官方 Modal.module.css）。
    expect(SCSS).toContain('body[data-dsh-semi-theme] .semi-modal-content.dsh-fnos-account-login-modal')
    // 宽度是产品要求（480，比官方 380 宽）；组件上的 width 属性会被这条覆盖。
    expect(SCSS).toContain('width: min(480px, 100%)')
    expect(SCSS).toContain('border-radius: var(--dsw-radius-panel)')
    expect(SCSS).toContain('background: var(--dsw-alias-bg-layer-2)')
    expect(SCSS).toContain('padding: 22px 14px 12px 24px')
    expect(SCSS).toContain('font-size: 16px')
  })

  it('粘贴框标题是「填写授权地址」', () => {
    // 只描述用户要做的事，不再复述「完成授权后」——授权是否完成由官方那屏交代。
    const locales = readFileSync(new URL('../../src/client/locales.ts', import.meta.url), 'utf8')
    expect(locales).toContain("accountLoginPasteTitle: '填写授权地址'")
    expect(locales).not.toContain('完成授权后，把地址粘回来')
  })

  it('授权页地址还没生成时有界重试', () => {
    /*
      地址由宿主在创建登录尝试的过程中才产生，而我们的弹框在官方弹框出现时就
      打开了——第一读经常还是空的（真机实测就是空，「复制重新打开」压根不渲染）。

      只在拿不到时重试，拿到即停，最多 12 次（约 10 秒）。这是等一份数据，不是
      用轮询判断状态：显隐仍由 DOM 监听决定。
    */
    expect(CLIENT).toContain('readAuthorizeUrlOnce')
    /*
      上限按**时间**而不是次数：真机实测地址在授权流程推进后约 30-40 秒才出现，
      按次数的短间隔会在十几秒就放弃、之后再也不补。
    */
    expect(CLIENT).toContain('Date.now() - startedAt > 90_000')
    expect(CLIENT).not.toContain('attempts += 1')
  })

  it('「复制重新打开」用 Toast 反馈，文案本身不变', () => {
    /*
      复制是个短动作，旁边弹一条提示就够；早前用 `copied` 把那段文字临时改成
      「已复制」，看着像按钮在变形，文字应当保持稳定。
    */
    expect(CLIENT).toContain('DshTypography')
    expect(CLIENT).toContain('copyable={{')
    expect(CLIENT).toContain('DshToast.success')
    expect(CLIENT).toContain('DshToast.error')
    // render 里不再按 copied 切换文案。
    expect(CLIENT).toContain('render: (_copied: boolean')
    expect(CLIENT).toContain("t('accountLoginReopenAction')")
    expect(CLIENT).not.toContain("copied ? t('accountLoginCopiedTip')")
    // 自己写剪贴板那套不需要了。
    expect(CLIENT).not.toContain('navigator.clipboard')
    // 可点文字要有聚焦态，键盘用户也能按到。
    expect(SCSS).toContain('.dsh-fnos-account-login-copy:focus-visible')
  })

  it('表头与正文的间距按「总间距减去表头已占的部分」算', () => {
    /*
      视觉间距 = header 的 padding-bottom（12）+ body 的 margin-top。
      原先 margin 给 20，合计 32px，标题与正文之间空出一大块。
      改成 8 之后合计 20px，与官方 dialog 的 `gap: 20px` 一致——**减去 header
      已经贡献的那部分**，而不是把 20 直接写在这里。
    */
    // 取该规则块本身（选择器到第一个 }），避免 indexOf 命中文件别处的同名片段。
    const block = SCSS.match(/[^{}]*dsh-fnos-account-login-modal \.semi-modal-body \{[^}]*\}/u)?.[0] ?? ''
    expect(block).toContain('margin-top: 8px')
    expect(block).not.toContain('margin-top: 20px')
  })

  it('点击复制不关闭弹框', () => {
    /*
      用户复制完还要回来粘地址，复制这种短动作不该把正在填写的弹框收掉。
      两个事件都 `stopPropagation`：Semi 的 Modal 会监听外层容器的点击来决定关闭。
    */
    expect(CLIENT).toContain('event.preventDefault()')
    expect(CLIENT).toContain('event.stopPropagation()')
    expect(CLIENT).toContain('doCopy(event)')
  })

  it('正文精简到两行内', () => {
    // 真机实测：两行 = 44px（2 × 22px line-height）。文案再长会撑到三行。
    const locales = readFileSync(new URL('../../src/client/locales.ts', import.meta.url), 'utf8')
    // 取中文那条（文件里中英两份，按是否含中文字符挑）。
    const all = [...locales.matchAll(/accountLoginPasteHint: '([^']+)'/gu)].map(m => m[1])
    const hint = all.find(v => /[\u4E00-\u9FFF]/u.test(v)) ?? ''
    expect(hint.length).toBeGreaterThan(20)
    // 中文按字数粗估：两行约 40 字（弹框内容列约 432px / 每字 14px）。
    expect(hint.length).toBeLessThanOrEqual(42)
    expect(locales).toContain("accountLoginReopenPrefix: 'Auth 页关掉了可'")
  })

  it('描述文案与官方一致', () => {
    const locales = readFileSync(new URL('../../src/client/locales.ts', import.meta.url), 'utf8')
    // 官方 `ui-settings-account/src/client/locales.ts` 的 loginDescription。
    expect(locales).toContain('你的项目和文件保存在本地。')
  })
})

describe('账号登录：粘贴解析', () => {
  it('接受整条地址与裸查询串', () => {
    expect(parseCallbackInput('http://127.0.0.1:3080/oauth/callback?code=abc&state=xyz'))
      .toEqual({ code: 'abc', state: 'xyz' })
    expect(parseCallbackInput('code=abc&state=xyz')).toEqual({ code: 'abc', state: 'xyz' })
  })

  it('缺 code 或 state 时判为无效', () => {
    expect(parseCallbackInput('http://x/oauth/callback?code=abc')).toBeUndefined()
    expect(parseCallbackInput('')).toBeUndefined()
  })
})

describe('账号登录：契约', () => {
  it('路由前缀与其他插件路由一致', () => {
    expect(CONTRACT).toContain("'/plugins/dsh-fnos/account/login-relay'")
    expect(CONTRACT).toContain("'/plugins/dsh-fnos/account/login-start'")
  })
})
