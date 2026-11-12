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

describe('独立浏览器页面：授权后列表必须刷新', () => {
  it('输入区面板订阅了授权回调（早前漏了这一步）', () => {
    /*
      这是「授权完成后列表不更新」的根因：设置弹框里的卡片有监听，而输入区的
      授权面板没有——它只把状态置成 `authorization-pending` 就 return，回调到达
      时无人处理，列表于是停留在旧数据。
    */
    const panel = read('../../src/components/FnosAuthorizedPathPicker.tsx')
    expect(panel).toContain('listenFnosAppAuthResult')
    expect(panel).toContain('authListenerRef')
    // 收到结果后要真的重新拉一次根列表。
    expect(panel).toContain('requestAuthorizedEntries')
    // 订阅必须在打开授权页的那一支里建立，晚了会漏掉已经到达的结果。
    expect(panel).toMatch(/authorization-pending[\s\S]{0,800}listenFnosAppAuthResult/u)
  })

  it('面板卸载时解绑订阅', () => {
    const panel = read('../../src/components/FnosAuthorizedPathPicker.tsx')
    expect(panel).toContain('authListenerRef.current?.()')
  })
})

describe('独立浏览器页面：文件入口用 openURL', () => {
  it('文件管理器服务在 standalone 下改走 openURL，不再直接抛错', () => {
    const service = read('../../src/client/services/file-manager.ts')
    expect(service).toContain('openURL')
    expect(service).toContain('isStandaloneWeb')
    // 不再用「该环境不提供」这种一拒了之的写法。
    expect(service).not.toContain('fnOS file manager is unavailable in a standalone browser page')
  })

  it('会话头部的文件入口两种形态都渲染', () => {
    const action = read('../../src/components/FnosOpenInHeaderAction.tsx')
    // 早前按 hasFnosHostBridge 自我隐藏，独立页面里整个入口消失；现在改为
    // 「属于 fnOS 就渲染」，能力差异放进动作内部消化。
    expect(action).toContain('isFnosHosted')
    // 注释里可以提到旧判据（解释为什么改），但**代码**不能再用它做渲染门控。
    const actionCode = action.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '')
    expect(actionCode).not.toContain('hasFnosHostBridge')
  })
})

describe('授权回调的订阅时机', () => {
  it('两个调用方都在「发起授权」的同一处建立订阅', () => {
    /*
      踩过的坑：把 `state` 存进 `useRef` 再指望一个 effect 去装监听。ref 变化
      不触发重渲染，那个 effect 永远不重跑——监听自始至终没装上，用户授权完成
      后列表一直是旧的。订阅必须和「打开授权页」写在一起。
    */
    const card = read('../../src/components/AuthorizedDirectoriesCard.tsx')
    expect(card).toMatch(/usesAppAuthFlow\(\)[\s\S]{0,1600}listenFnosAppAuthResult/u)
    // 不许再出现「存 ref 等 effect」的写法。
    expect(card).not.toContain('pendingAuthState')

    const panel = read('../../src/components/FnosAuthorizedPathPicker.tsx')
    expect(panel).toMatch(/authorization-pending[\s\S]{0,900}listenFnosAppAuthResult/u)
  })
})

describe('独立页面打开新标签页', () => {
  it('必须在第一个 await 之前同步开窗', () => {
    /*
      `window.open` 只在用户点击的同步调用栈里放行；`await` 之后就脱离手势，
      浏览器按弹窗拦截处理（实测返回 null，且没有任何报错）。
    */
    const raw = read('../../src/client/services/file-manager.ts')
    // 先剥注释：说明文字里也会出现 `await sdk.ready()`，不剥会匹配到注释。
    const service = raw.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '')
    const openIndex = service.indexOf('window.open(')
    const firstAwait = service.indexOf('await sdk.ready()')
    expect(openIndex).toBeGreaterThan(-1)
    expect(firstAwait).toBeGreaterThan(-1)
    // 开窗必须早于第一个 await，否则已脱离用户手势。
    expect(openIndex).toBeLessThan(firstAwait)
  })

  it('被拦截时给出可指导用户的错误码', () => {
    const service = read('../../src/client/services/file-manager.ts')
    expect(service).toContain('fnos-open-blocked')
  })
})

describe('独立浏览器页面授权：结果反馈', () => {
  it('成功后有回执，与宿主动调那条路一致', () => {
    /*
      从授权页切回来时，如果列表只是「悄悄多了一行」，用户无法确认操作是否生效。
      两条成功路径都要给同样的回执。
    */
    const panel = read('../../src/components/FnosAuthorizedPathPicker.tsx')
    expect(panel).toContain("Toast.success({ content: t('authorizeSucceeded') })")

    const card = read('../../src/components/AuthorizedDirectoriesCard.tsx')
    expect(card).toContain("notifySuccess(t('authorizeSucceeded'))")
  })

  it('取消与失败要分流，不能都当成功', () => {
    // 早前只判「不是 error/cancel 就刷新」，取消也走成功分支，容易误导。
    const panel = read('../../src/components/FnosAuthorizedPathPicker.tsx')
    expect(panel).toContain("if (result.status === 'cancel') return")
    expect(panel).toContain("if (result.status === 'error')")

    const card = read('../../src/components/AuthorizedDirectoriesCard.tsx')
    expect(card).toContain("if (result.status === 'cancel') return")
  })

  it('持久化失败只警告，不掩盖授权已生效', () => {
    // 授权本身已在 fnOS 侧生效，写记录失败不该让用户以为整个操作失败。
    const panel = read('../../src/components/FnosAuthorizedPathPicker.tsx')
    expect(panel).toContain("Toast.warning({ content: t('authorizePersistFailed') })")
  })
})

describe('授权列表缓存：解除授权后必须消失', () => {
  it('根列表按整表替换，不累加', () => {
    /*
      `entries` 是累加 Map，早前 `applyEntries` 只做 `set`。宿主已解除授权的目录
      会永远留在里面——表现为「设置里取消了授权，输入区面板还能看到、还能勾选」。
      根列表（无 parent）必须先 clear 再写入；带 parent 的是加载子目录，有意增量。
    */
    const panel = read('../../src/components/FnosAuthorizedPathPicker.tsx')
    expect(panel).toContain('if (parent === undefined) entries.current.clear()')
  })

  it('面板每次打开都重新拉取，而不是只在挂载时拉一次', () => {
    // 面板是「开关」式复用，关闭再打开不会重新挂载；只在挂载时拉会一直用旧缓存。
    const panel = read('../../src/components/FnosAuthorizedPathPicker.tsx')
    expect(panel).toContain('reloadRoots')
    expect(panel).toMatch(/useEffect\(\(\) => \{\s*if \(!open\) return[\s\S]{0,200}reloadRoots/u)
  })

  it('拉取失败时清空树与缓存，不留半截旧数据', () => {
    const panel = read('../../src/components/FnosAuthorizedPathPicker.tsx')
    expect(panel).toMatch(/catch \{[\s\S]{0,120}setTreeData\(\[\]\)[\s\S]{0,80}entries\.current\.clear\(\)/u)
  })
})
