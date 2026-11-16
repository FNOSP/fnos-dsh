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
    /*
      判据必须传 SDK 的两个运行时标志，不能只看 DOM：
      `isWeb === false` 时 SDK 走了 mobile / 原生宿主分支，宿主 API 可用，
      换成授权页反而是错的。
    */
    expect(picker).toContain('usesAppAuthFlow({ isWeb: sdk.isWeb, isStandaloneWeb: sdk.isStandaloneWeb })')
    expect(picker).toContain('openFnosAppAuth(')
    // 新增的中间态必须有对应返回，否则调用方会把它当成功。
    expect(picker).toContain("status: 'authorization-pending'")
    // 走授权页的那一支要排在直调之前。
    expect(picker.indexOf('usesAppAuthFlow(')).toBeLessThan(picker.indexOf('await sdk.pickSharedFile'))
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

  it('会话头部的文件入口按宿主桥能力渲染', () => {
    // 这个入口的动作全是 openFileManager/openFile，独立页面里没有宿主桥，
    // 调用必然失败；给一个必然失败的入口比不渲染更差。
    const action = read('../../src/components/FnosOpenInHeaderAction.tsx')
    const actionCode = action.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '')
    // 判据现在是 `SHOWS_FILE_MANAGER_ENTRY`（只在内嵌 web 为 true），与右键菜单
    // 那一处共用同一个常量——早前各写各的式子，App 端出现一处显示一处隐藏。
    expect(actionCode).toContain('SHOWS_FILE_MANAGER_ENTRY')
    expect(actionCode).not.toContain('isFnosHosted()')
  })
})

describe('独立页面：浏览入口一律不渲染', () => {
  it('三处「打开」入口全部按宿主桥能力门控', () => {
    /*
      独立浏览器页面没有宿主桥，`openFileManager` / `openFile` 全都不可用。
      曾退而用 `openURL` 打开 fnOS 桌面首页，但那是「打开了个网页」而不是
      「定位到这个目录」——用户点了被丢回桌面，还得自己再找一遍，
      比没有这个按钮更差。三处入口统一按能力隐藏。
    */
    const sources = [
      '../../src/components/AuthorizedDirectoriesCard.tsx',   // 设置卡片每行的「打开」
      '../../src/components/FnosAuthorizedPathPicker.tsx',    // 输入区右键菜单的「打开」
      '../../src/components/FnosOpenInHeaderAction.tsx',      // 会话头部的「文件管理」
    ]
    for (const file of sources) {
      const code = read(file).replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '')
      /*
        「打开」类入口的判据统一收在 `SHOWS_FILE_MANAGER_ENTRY` 里（宿主桥可用
        且不是 App 端）。会话头部那个用的是更基础的 `HAS_FNOS_HOST_BRIDGE`。
      */
      /*
        三处入口现在**共用同一个常量** `SHOWS_FILE_MANAGER_ENTRY`（只在内嵌 web
        为 true）。早前各写各的式子，导致 App 端一个显示一个隐藏。
      */
      expect(code, file).toContain('SHOWS_FILE_MANAGER_ENTRY')
    }
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

describe('独立页面的浏览入口：直接不渲染', () => {
  it('两个调用方都按宿主桥能力隐藏「打开」', () => {
    /*
      独立浏览器页面没有宿主桥，`openFileManager` / `openFile` 都不可用。
      曾退而用 `openURL` 打开 fnOS 桌面首页，但那是「打开了个网页」而不是
      「定位到这个目录」——用户点「打开」被丢回桌面，还得自己再找一遍，
      比没有这个按钮更差。因此不渲染。
    */
    /*
      判据现在是 `SHOWS_FILE_MANAGER_ENTRY`（宿主桥可用 **且** 不是 App 端）：
      App 端长按菜单里给「跳出去打开文件管理器」会把用户带离当前会话，所以也隐藏。
    */
    const card = read('../../src/components/AuthorizedDirectoriesCard.tsx')
    expect(card).toContain('SHOWS_FILE_MANAGER_ENTRY')

    const panel = read('../../src/components/FnosAuthorizedPathPicker.tsx')
    expect(panel).toContain('SHOWS_FILE_MANAGER_ENTRY')
  })

  it('服务层在 standalone 下明确失败，不再跳转到桌面', () => {
    const service = read('../../src/client/services/file-manager.ts')
    expect(service).toContain('fnos-open-unavailable')
    // 去掉只打开桌面的退路。
    expect(service).not.toContain("window.open('about:blank'")
    expect(service).not.toContain('fnosDesktopUrl')
  })
})

describe('SDK 标志语义：isWeb=false 时宿主 API 优先', () => {
  it('只有 isWeb && isStandaloneWeb 才走授权页', () => {
    /*
      | isWeb | isStandaloneWeb | 含义 | 该走哪条路 |
      | true  | false           | iframe / 应用运行时 | 宿主直调 |
      | true  | true            | 独立浏览器页面      | openAppAuth |
      | false | 任意            | mobile / 原生宿主    | 宿主直调 |

      第三行是关键：`isWeb === false` 说明 `@trimjs/web-app` 没走 web carrier
      （init 里检测到 flutter_inappwebview 或 osConnector），此时即便
      `window.parent === window` 让 isStandaloneWeb 为 true，真正的能力也在
      内嵌宿主那边。早前只看 DOM，在移动端容器里会误判成独立页面。
    */
    const auth = read('../../src/client/services/app-auth.ts')
    expect(auth).toContain('sdk.isWeb && sdk.isStandaloneWeb')
    // 不许退回纯 DOM 判据做主要判断。
    expect(auth).toMatch(/if \(sdk !== undefined\) return sdk\.isWeb && sdk\.isStandaloneWeb/u)
  })

  it('两个调用方都把 SDK 标志传进去', () => {
    const picker = read('../../src/client/services/authorized-directory-picker.ts')
    const card = read('../../src/components/AuthorizedDirectoriesCard.tsx')
    for (const source of [picker, card]) {
      expect(source).toContain('usesAppAuthFlow({ isWeb: sdk.isWeb, isStandaloneWeb: sdk.isStandaloneWeb })')
    }
    // 判据要在 sdk.ready() 之后——标志是 init 完成的产物。
    expect(picker.indexOf('await sdk.ready()')).toBeLessThan(picker.indexOf('usesAppAuthFlow({'))
  })
})

describe('SDK 标志语义：其余能力判据同步', () => {
  it('文件和语言类能力不能再把 isWeb=false 当成「无宿主」', () => {
    /*
      这几处原先写 `isStandaloneWeb` 或 `!isWeb || isStandaloneWeb`：
      `isWeb === false` 被当成「没有宿主」，可那是 mobile / 原生宿主分支，
      能力恰恰在那边。统一改成「独立页面 = isWeb && isStandaloneWeb」。
    */
    const fileManager = read('../../src/client/services/file-manager.ts')
    expect(fileManager).toContain('sdk.isWeb && sdk.isStandaloneWeb')

    const fileOpener = read('../../src/client/services/file-opener.ts')
    expect(fileOpener).toContain('sdk.isWeb && sdk.isStandaloneWeb')

    for (const name of ['language-sync', 'sdk-title', 'theme-bridge']) {
      // 剥掉注释再看：说明文字里会提到旧写法（解释为什么改），不算声明。
      const source = read(`../../src/client/services/${name}.ts`)
        .replace(/\/\*[\s\S]*?\*\//gu, '')
        .replace(/\/\/.*$/gmu, '')
      // 不许再把 isWeb 与 isStandaloneWeb 或成一个短路条件。
      expect(source, name).not.toContain('!sdk.isWeb || sdk.isStandaloneWeb')
    }
  })
})

describe('宿主桥判据：isWeb=false 时能力在内嵌侧', () => {
  it('三个标志组合的结论', () => {
    /*
      | isWeb | isStandaloneWeb | 含义 | 宿主桥 |
      | true  | false           | iframe / 应用运行时 | 可用 |
      | true  | true            | 独立浏览器页面      | 不可用 |
      | false | 任意            | mobile / 原生宿主    | 可用 |

      第三行是关键：`isWeb === false` 时即便不是 iframe，能力也在内嵌宿主那边。
      早前只看 DOM，把这类环境误判成「没有宿主桥」，右上角入口整个消失。

      这里断言实现的三元表达式本身：`sdk.ts` 依赖 `@trimjs/web-app`，后者在
      node 环境没有 `window`，直接 import 会抛。
    */
    const source = read('../../src/client/services/host-bridge.ts')
    expect(source).toContain('return flags.isWeb ? !flags.isStandaloneWeb : true')
    // 调用方不再用无参形式（那会退回 DOM 判据，丢掉 isWeb=false 这一支）。
    const action = read('../../src/components/FnosOpenInHeaderAction.tsx')
    expect(action).toMatch(/HAS_FNOS_HOST_BRIDGE|hasFnosHostBridge\(readSdkCapabilityFlags\(\)\)/u)
    expect(action).not.toContain('hasFnosHostBridge()')
  })

  it('判断拆到独立模块，不形成循环依赖', () => {
    // 早前把它写在 environment.ts 里并 import sdk.ts，与 sdk.ts → environment.ts
    // 构成循环，整个模块加载失败（测试一条都跑不起来）。
    const env = read('../../src/client/services/environment.ts')
    // 环境识别模块不依赖 SDK：import 了就会与 sdk.ts 形成循环。
    expect(env).not.toContain('createTrimApp')
    expect(env).not.toContain("from './sdk.ts'")
    // 那里只有一个纯 DOM 的保守判据（仅供无法拿到 SDK 标志的场景）。
    expect(env).toContain("return detectFnosEnvironment() === 'embedded'")
    // 判断住在独立模块里，且**延迟**取 SDK：静态 import 会让 node 环境下
    // import 本模块的代码直接抛 `window is not defined`。
    const bridge = read('../../src/client/services/host-bridge.ts')
    expect(bridge).toContain("from './environment.ts'")
    expect(bridge).toContain("require('./sdk.ts')")
    expect(bridge).not.toMatch(/^import[\s\S]{0,200}from '\.\/sdk\.ts'/mu)
  })
})
