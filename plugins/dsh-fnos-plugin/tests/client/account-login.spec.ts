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

  it('用单个选择器定位，父元素由 parentElement 取', () => {
    /*
      官方弹层由 portal 挂到 `body` 直下，用一条选择器就能表达完整结构：
      `body > [role="presentation"] > [role="dialog"]`。命中后父元素直接取
      `parentElement`，不必再遍历或二次查询。
    */
    const overlay = readFileSync(new URL('../../src/components/FnosAccountLoginOverlay.tsx', import.meta.url), 'utf8')
    expect(overlay).toContain('body > [role="presentation"] > [role="dialog"]')
    expect(overlay).toContain('dialog.parentElement')
    // 不再手写遍历。
    expect(overlay).not.toContain('nextElementSibling')
    expect(overlay).not.toContain('while (node !== null)')
  })

  it('精确匹配使「退出登录」无需排除', () => {
    /*
      旧实现匹配正文，退出确认框正文里也出现「登录」，所以才需要排除名单。

      现在按 `aria-label` 全等比对：名单只含官方 `loginTitle` / `browserTitle`
      的取值，`signOut` 的取值一个都不在其中，因此排除条件是冗余的，已删除。

      这条用例守护的是「不要再把它加回来」——它会在判据演进时诱使人以为
      仍需要排除。
    */
    const overlay = readFileSync(new URL('../../src/components/FnosAccountLoginOverlay.tsx', import.meta.url), 'utf8')
    expect(overlay).not.toContain('EXCLUDE_ARIA_LABELS')
    // 判据仍是全等比较，不是子串包含（后者会让 Выйти / Войти 互相误伤）。
    expect(overlay).toContain('SIGN_IN_ARIA_LABELS.includes(label)')
    expect(overlay).not.toContain('SIGN_IN_ARIA_LABELS.some')
    // 「退出登录」不该出现在名单里。
    expect(overlay).not.toContain("'退出登录'")
  })

  it('判据是 dialog 的 aria-label，不是正文文案', () => {
    /*
      官方 `ui-primitives` 的 Modal 把 title 写到 `role="dialog"` 的
      `aria-label`；登录弹框的 title 随阶段变（loginTitle / browserTitle /
      failureTitle / timeoutTitle）。所以**同一个弹框换阶段只换标题**，用
      aria-label 当判据比匹配正文稳：正文改一句不影响身份。

      正文匹配的旧坑：`'登录 DeepSeek 账号'` 也出现在引导框描述里，导致引导框
      被误接管。改用标题后，引导框标题「开始使用」是**明确要接管**的（用户正是
      从这里点登录），而只出现在正文里的词组不再参与判定。
    */
    const overlay = readFileSync(new URL('../../src/components/FnosAccountLoginOverlay.tsx', import.meta.url), 'utf8')
    // 从 aria-label 取值，而不是 textContent。
    expect(overlay).toContain("dialog.getAttribute('aria-label')")
    expect(overlay).not.toContain('dialog.textContent')
    // 只有 DSH 实际提供的 8 个语言的 loginTitle / browserTitle。
    expect(overlay).toContain("'开始使用'")
    expect(overlay).toContain("'等待登录'")
    expect(overlay).toContain("'Get started'")
    // 这两条只在正文里出现过，从来不是标题——不该出现在名单里。
    expect(overlay).not.toContain("'登录 DeepSeek 账号'")
    expect(overlay).not.toContain("'Sign in to DeepSeek account'")
    // 结构用单个选择器，父元素由 parentElement 取得。
    expect(overlay).toContain('body > [role="presentation"] > [role="dialog"]')
    expect(overlay).toContain('dialog.parentElement')
  })

  it('判据靠结构隔离自己的弹框，不靠类名比对', () => {
    /*
      判据里有裸「登录」，所以「不会认错自己」必须成立。

      它由**结构**保证而不是类名：我们用的是 Semi `Modal`，它不渲染
      `role="presentation"` 与 `role="dialog"`（只有内部按钮带 aria-label）。
      因此那两条结构判据已把我们的框排除在外，类名比对属重复防御。
    */
    const overlay = readFileSync(new URL('../../src/components/FnosAccountLoginOverlay.tsx', import.meta.url), 'utf8')
    expect(overlay).not.toContain('dsh-fnos-account-login-modal')
    expect(overlay).toContain('body > [role="presentation"] > [role="dialog"]')
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
    expect(locales).toContain("accountLoginPasteTitle: '填写重定向地址'")
    expect(locales).not.toContain('完成授权后，把地址粘回来')
  })

  it('轮询兼顾「取地址」与「登录是否完成」', () => {
    /*
      地址由宿主在创建登录尝试的过程中才产生，第一读经常还是空的，所以要重试；
      但轮询还承担第二件事：**发现登录已完成**。

      授权页在新标签页完成时，回调先到宿主的中转端口，宿主推进阶段到 `succeeded`。
      主窗口读不到那个跨域标签页的地址（实测 SecurityError），官方还主动
      `popup.opener = null` 切断引用——问宿主是唯一可行路径。
    */
    expect(CLIENT).toContain('readLoginStateOnce')
    expect(CLIENT).toContain("state?.phase === 'succeeded'")
    /* 地址到手后不再因超时停表，否则自动收尾永远不会触发。 */
    expect(CLIENT).toContain('authorizeUrlRef.current === undefined && Date.now() - startedAt > 90_000')
  })

  it('「重新打开授权页」是真链接，点开即新标签页打开', () => {
    /*
      授权的下一步是「在授权页里点同意」，用户要的是那个页面，不是一段地址。
      早前做成「复制链接」，还得自己找地方粘——多一步且容易粘错。
      现在直接是 <a target="_blank">，右键新标签页 / 中键 / Cmd+点击都有原生行为。
    */
    expect(CLIENT).toContain('href={authorizeUrl}')
    expect(CLIENT).toContain('target="_blank"')
    expect(CLIENT).toContain('rel="noopener noreferrer"')
    expect(CLIENT).toContain("t('accountLoginReopenAction')")
    // 复制那套已移除。
    expect(CLIENT).not.toContain('copyable={{')
    expect(CLIENT).not.toContain('DshToast')
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

  it('点击链接不关闭弹框', () => {
    // 用户点开授权页后还要回来粘地址，这一次点击不该把弹框收掉。
    expect(CLIENT).toContain('event.stopPropagation()')
  })

  it('正文精简到两行内', () => {
    // 真机实测：两行 = 44px（2 × 22px line-height）。文案再长会撑到三行。
    const locales = readFileSync(new URL('../../src/client/locales.ts', import.meta.url), 'utf8')
    // 取中文那条（文件里中英两份，按是否含中文字符挑）。
    const all = [...locales.matchAll(/accountLoginPasteHint: '([^']+)'/gu)].map(m => m[1] ?? '')
    const hint = all.find(v => /[\u4E00-\u9FFF]/u.test(v)) ?? ''
    expect(hint.length).toBeGreaterThan(20)
    // 中文按字数粗估：两行约 40 字（弹框内容列约 432px / 每字 14px）。
    expect(hint.length).toBeLessThanOrEqual(42)
    expect(locales).toContain("accountLoginReopenAction: '重新打开授权页'")
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
