/**
 * 运行时环境：把 `@trimjs/web-app` 的两个标志固定成**可直接读的静态常量**。
 *
 * ## 为什么要有这一层
 *
 * 业务代码里反复出现 `hasFnosHostBridge(readSdkCapabilityFlags())`、
 * `fnosHostBridgeAvailable()`、`usesAppAuthFlow(sdk)` 这类调用，读者需要先知道
 * 「这两个标志怎么组合出四种环境」才能判断分支含义。同一个判断散在多处，还容易
 * 各自漂移（本仓库历史上就出现过「只看 DOM」导致入口消失、移动端误判成独立页面
 * 两次问题）。
 *
 * 这里在模块加载时定一次判断，业务代码直接读常量：
 *
 * | 环境 | 判据 | 宿主桥 | 独立页面 |
 * | --- | --- | --- | --- |
 * | `isFnosAppEnv` | `isWeb === false`（mobile / 原生宿主） | 有 | 否 |
 * | `isFnosEmbeddedWebEnv` | `isWeb && !isStandaloneWeb`（NAS web 内嵌 iframe） | 有 | 否 |
 * | `isFnosStandaloneWebEnv` | `isWeb && isStandaloneWeb`（独立浏览器页面） | 无 | 是 |
 *
 * 前两种合起来就是「宿主桥可用」（{@link HAS_FNOS_HOST_BRIDGE}），第三种不可用。
 *
 * ## 判据只用 DOM，不读 SDK 标志
 *
 * `@trimjs/web-app` 的 `isStandaloneWeb` 在 `init()`（异步）里才被赋值，初始值是
 * `false`。模块加载时读它必然拿到 `false`，于是独立 web 会被误判成内嵌 web——两个
 * 文件管理器入口照常渲染，正是真机上看到的问题。
 *
 * `window.parent !== window` 能精确区分「在 iframe 里」与「独立页面」，且同步可得。
 * SDK 标志另由 {@link readEnvironmentFlags} 提供，给等得到初始化完毕的调用方用。
 *
 * ## 循环依赖
 *
 * 本模块依赖 `sdk.ts`（静态 import 会拖入 `@trimjs/web-app`，后者在模块顶层读
 * `window`，node 里会直接抛），所以这里**延迟 require**，与 `host-bridge.ts` 同一
 * 套做法。
 *
 * @module dsh-fnos/client/services/runtime-env
 */

import { detectFnosEnvironment } from './environment.ts'

/** `@trimjs/web-app` 的两个标志。 */
export interface RuntimeFlags {
  /** web carrier 是否就绪；`false` 表示走了 mobile / 原生宿主分支。 */
  readonly isWeb: boolean
  /** 是否不在宿主容器内（`window.parent === window`）。 */
  readonly isStandaloneWeb: boolean
}

/**
 * 读一次 SDK 标志；读不到（SDK 未初始化、node 环境）时退回 DOM 判据。
 *
 * @returns 两个标志；无法读取时为 `undefined`。
 */
export function readEnvironmentFlags(): RuntimeFlags | undefined {
  try {
    // eslint-disable-next-line ts/no-require-imports
    const { createTrimApp } = require('./sdk.ts') as typeof import('./sdk.ts')
    const app = createTrimApp()
    return { isWeb: app.isWeb, isStandaloneWeb: app.isStandaloneWeb }
  } catch {
    return undefined
  }
}

/*
  **两种判据，各有各的用途，不能混。**

  | 用途 | 判据 | 时机 |
  | --- | --- | --- |
  | 「在不在 iframe 里」（渲染分支） | DOM `window.parent !== window` | 同步可得 |
  | 「是不是 App」（能力判断） | SDK `isWeb === false` | 要等 `init()` |

  SDK 的 `isStandaloneWeb` 初始值是 `false`，真正赋值在 `init()`（异步）里。模块
  加载时读它必然拿到 `false`，于是**独立 web 会被判成内嵌 web**——两个文件管理器
  入口照常渲染，正是真机看到的问题。

  反过来，纯 DOM 也认不出 App（App 里 `window.parent === window`，与独立页面无法
  区分）。所以渲染分支用 DOM（{@link IS_FNOS_FRAME} 一类），App 判断用 SDK 标志。

  最终常量按下表组合：`IS_FNOS_EMBEDDED_WEB_ENV` 只由 DOM 决定（iframe 即内嵌），
  `IS_FNOS_APP_ENV` 只由 SDK 决定；两者都不依赖对方。
*/
const DOM_ENV = detectFnosEnvironment()

/**
 * 是否 **fnOS App 内嵌页**（Flutter WebView）。
 *
 * 判据是 User-Agent 里的 `FNAppVer/` 标记——这与 `@trimjs/web-app` 的 `init()`
 * 用的是同一套正则，只是我们同步读，不必等它初始化。
 *
 * **为什么不读 SDK 的 `isWeb`**：那个属性在构造时初始化为 `true`，要等 `init()`
 * （异步）里才可能改成 `false`。模块加载时读它永远拿到 `true`，App 会被误判成 web。
 *
 * **为什么要排除 iframe**：fnOS 网关会给普通浏览器的 iframe 也加上这个标记
 * （见 `sdk-carrier.ts` 的说明），那种情况属于内嵌 web，不是 App。
 */
const IS_APP_BY_USER_AGENT: boolean = typeof navigator !== 'undefined'
  && /FNAppVer\//iu.test(navigator.userAgent)
  && DOM_ENV !== 'embedded'

/**
 * 当前是否 **fnOS App 环境**（mobile / 原生宿主，`isWeb === false`）。
 *
 * 宿主桥可用；不是独立浏览器页面。
 */
export const IS_FNOS_APP_ENV: boolean = IS_APP_BY_USER_AGENT

/**
 * 当前是否 **fnOS NAS web 内嵌环境**（`isWeb && !isStandaloneWeb`）。
 *
 * 应用中心以 iframe 打开，宿主桥可用。
 */
export const IS_FNOS_EMBEDDED_WEB_ENV: boolean = DOM_ENV === 'embedded'

/**
 * 当前是否 **fnOS 独立 web 环境**（`isWeb && isStandaloneWeb`）。
 *
 * 在浏览器里直接打开 `…/app/<应用>/`：没有宿主桥，文件选择等能力改用授权页路径。
 */
export const IS_FNOS_STANDALONE_WEB_ENV: boolean = DOM_ENV === 'standalone'

/**
 * 宿主桥是否可用（App 环境或内嵌 web 环境）。
 *
 * 等价于 `!IS_FNOS_STANDALONE_WEB_ENV`。
 */
export const HAS_FNOS_HOST_BRIDGE: boolean = IS_FNOS_APP_ENV || IS_FNOS_EMBEDDED_WEB_ENV

/**
 * 当前是否由 fnOS 网关托管（三种 fnOS 环境之一）。
 *
 * 只由 DOM 判断（网关会注入 `<base href="/app/...">`），不依赖 SDK 是否就绪。
 */
export const IS_FNOS_GATEWAY_HOSTED: boolean = DOM_ENV !== 'none'

/**
 * 是否**不是**移动端 / 原生宿主（`isWeb === true`）。
 *
 * App 端与 web 端的交互范式不同：web 端有右键、精确指针，App 端只有长按，
 * 且「打开文件管理器」这类跳转在 App 内会离开当前页面。需要区分时用这个常量，
 * 不要再去组合 `isWeb` 判断。
 */
export const IS_FNOS_WEB_RUNTIME: boolean = !IS_FNOS_APP_ENV

/**
 * 「打开文件管理器」这类**跨应用跳转**入口是否该出现。
 *
 * **只有 NAS 内嵌 web（应用中心 iframe）才显示。**
 *
 * | 环境 | 判据 | 显示 | 理由 |
 * | --- | --- | --- | --- |
 * | NAS 内嵌 web | `isWeb && !isStandaloneWeb` | **是** | 文件管理器就在同一个 NAS 桌面里，宿主桥可用 |
 * | 独立 web | `isWeb && isStandaloneWeb` | 否 | 没有宿主桥，调用必然失败 |
 * | App | `isWeb === false` | 否 | 没有文件管理器窗口的概念，跳出去会把用户带离当前会话 |
 *
 * 早前这个常量写成 `HAS_FNOS_HOST_BRIDGE && IS_FNOS_WEB_RUNTIME`，而
 * `HAS_FNOS_HOST_BRIDGE` 在 DOM 兜底判据下对独立 web 也可能为 true——于是独立
 * web 里两处入口的行为会随 SDK 是否就绪而漂移。直接锚定「内嵌 web」这一个条件，
 * 不依赖桥的推导。
 */
export const SHOWS_FILE_MANAGER_ENTRY: boolean = IS_FNOS_EMBEDDED_WEB_ENV
