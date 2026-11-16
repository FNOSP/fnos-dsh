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
 * 这里在模块加载时读一次 SDK 标志，按语义给出三个互斥的环境判断，业务代码直接读
 * 常量即可：
 *
 * | 环境 | 判据 | 宿主桥 | 独立页面 |
 * | --- | --- | --- | --- |
 * | `isFnosAppEnv` | `isWeb === false`（mobile / 原生宿主） | 有 | 否 |
 * | `isFnosEmbeddedWebEnv` | `isWeb && !isStandaloneWeb`（NAS web 内嵌 iframe） | 有 | 否 |
 * | `isFnosStandaloneWebEnv` | `isWeb && isStandaloneWeb`（独立浏览器页面） | 无 | 是 |
 *
 * 前两种合起来就是「宿主桥可用」（{@link HAS_FNOS_HOST_BRIDGE}），第三种不可用。
 *
 * ## 为什么允许「读一次」
 *
 * 这四个标志由 `@trimjs/web-app` 在 `init` 时写入，页面生命周期内不会变；入口
 * 渲染发生在 SDK 就绪之后。若某处确实在 SDK 就绪前求值，用
 * {@link readEnvironmentFlags} 重新读一次即可。
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

/** 当 SDK 标志读不到时的兜底：按 DOM 推断。 */
function fallbackFlags(): RuntimeFlags {
  /*
    DOM 只能区分「是不是 iframe」：
    - 不是 fnOS 网关托管 → 当作独立 web（没有宿主桥，也不属于 fnOS 应用）
    - 在 iframe 里 → 内嵌 web
    - 网关托管但不在 iframe → 独立 web

    没有任何 DOM 线索能识别 mobile / 原生宿主，因此读不到 SDK 时**不会**推断成
    App 环境；宁可少渲染一个入口，也不要给出必然失败的操作。
  */
  const env = detectFnosEnvironment()
  return { isWeb: true, isStandaloneWeb: env !== 'embedded' }
}

const FLAGS: RuntimeFlags = readEnvironmentFlags() ?? fallbackFlags()

/**
 * 当前是否 **fnOS App 环境**（mobile / 原生宿主，`isWeb === false`）。
 *
 * 宿主桥可用；不是独立浏览器页面。
 */
export const IS_FNOS_APP_ENV: boolean = FLAGS.isWeb === false

/**
 * 当前是否 **fnOS NAS web 内嵌环境**（`isWeb && !isStandaloneWeb`）。
 *
 * 应用中心以 iframe 打开，宿主桥可用。
 */
export const IS_FNOS_EMBEDDED_WEB_ENV: boolean = FLAGS.isWeb && !FLAGS.isStandaloneWeb

/**
 * 当前是否 **fnOS 独立 web 环境**（`isWeb && isStandaloneWeb`）。
 *
 * 在浏览器里直接打开 `…/app/<应用>/`：没有宿主桥，文件选择等能力改用授权页路径。
 */
export const IS_FNOS_STANDALONE_WEB_ENV: boolean = FLAGS.isWeb && FLAGS.isStandaloneWeb

/**
 * 宿主桥是否可用（App 环境或内嵌 web 环境）。
 *
 * 等价于 `!IS_FNOS_STANDALONE_WEB_ENV`。
 */
export const HAS_FNOS_HOST_BRIDGE: boolean = !IS_FNOS_STANDALONE_WEB_ENV

/**
 * 当前是否由 fnOS 网关托管（三种 fnOS 环境之一）。
 *
 * 只由 DOM 判断（网关会注入 `<base href="/app/...">`），不依赖 SDK 是否就绪。
 */
export const IS_FNOS_GATEWAY_HOSTED: boolean = detectFnosEnvironment() !== 'none'

/**
 * 是否**不是**移动端 / 原生宿主（`isWeb === true`）。
 *
 * App 端与 web 端的交互范式不同：web 端有右键、精确指针，App 端只有长按，
 * 且「打开文件管理器」这类跳转在 App 内会离开当前页面。需要区分时用这个常量，
 * 不要再去组合 `isWeb` 判断。
 */
export const IS_FNOS_WEB_RUNTIME: boolean = FLAGS.isWeb

/**
 * 「在文件管理器打开某个条目」这类**跨应用跳转**能力是否该出现。
 *
 * App 端隐藏：长按菜单里给一个「跳出去打开文件管理器」会把用户带离 DSH，
 * 回来时会话状态不一定还在；且 App 内没有文件管理器窗口的概念。
 *
 * web 端（内嵌 iframe）保留：宿主桥可用，文件管理器就在同一个 NAS 桌面里。
 */
export const SHOWS_FILE_MANAGER_ENTRY: boolean = HAS_FNOS_HOST_BRIDGE && IS_FNOS_WEB_RUNTIME
