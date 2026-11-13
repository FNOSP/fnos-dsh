/**
 * 宿主桥可用性判断。
 *
 * ## 为什么单独成模块
 *
 * 这个判断需要读 `@trimjs/web-app` 的运行时标志，而 SDK 工厂（`sdk.ts`）又要用
 * `environment.ts` 里的环境识别——两条线互相 import 会形成**循环依赖**，表现是
 * 整个 `environment` 模块加载失败（测试里一条也跑不起来，页面里所有依赖它的组件
 * 一起消失）。
 *
 * 把它拆出来，依赖方向就变成单向：
 *
 * ```
 * environment（纯 DOM 判断）
 *      ▲
 *      │
 * sdk.ts ──▶ host-bridge.ts
 * ```
 *
 * @module dsh-fnos/client/services/host-bridge
 */

import { detectFnosEnvironment } from './environment.ts'

/** 判断路径所需的最小标志面。 */
export interface HostBridgeFlags {
  /** web carrier 是否就绪；`false` 表示走了 mobile / 原生宿主分支。 */
  readonly isWeb: boolean
  /** 是否不在宿主容器内（`window.parent === window`）。 */
  readonly isStandaloneWeb: boolean
}

/**
 * fnOS 宿主桥是否可用（文件选择、打开文件等）。
 *
 * **判据落在 SDK 能力上，而不是「是不是 iframe」。**
 *
 * 早前只看 DOM（`detectFnosEnvironment() === 'embedded'`），把「不在 iframe」
 * 等同于「没有宿主桥」。但按 `@trimjs/web-app` 的语义：
 *
 * | isWeb | isStandaloneWeb | 含义 | 宿主桥 |
 * | --- | --- | --- | --- |
 * | true | false | iframe / 应用运行时 | 可用 |
 * | true | true | 独立浏览器页面 | 不可用 |
 * | **false** | **任意** | **mobile / 原生宿主** | **可用** |
 *
 * 第三行是关键：`isWeb === false` 说明 SDK 走了 mobile / 原生分支，那时即便
 * `window.parent === window`（不是 iframe），能力也在内嵌宿主那边。只看 DOM
 * 会把这类环境误判成「没有宿主桥」，右上角入口因此整个消失。
 *
 * @param flags - SDK 的两个标志；省略时退回 DOM 判据。
 * @returns 宿主桥是否可用。
 */
export function hasFnosHostBridge(flags?: HostBridgeFlags): boolean {
  if (flags !== undefined) {
    // `isWeb === false`（mobile / 原生宿主）走内嵌 API，可用；
    // `isWeb === true` 时只有不是独立页面才可用。
    return flags.isWeb ? !flags.isStandaloneWeb : true
  }
  return detectFnosEnvironment() === 'embedded'
}

/**
 * 读取 SDK 的运行时标志。
 *
 * 这两个标志决定「能力在哪一侧」，与「是不是 iframe」无关，所以凡是要判断宿主桥
 * 可用性的地方都应该读它，而不是看 DOM。
 *
 * @returns 两个标志；SDK 尚未初始化时返回 `undefined`（调用方退回 DOM 判据）。
 */
export function readSdkCapabilityFlags(): HostBridgeFlags | undefined {
  /*
    **必须延迟 require，不能静态 import。**
    `sdk.ts` 会静态 import `@trimjs/web-app`，而后者在模块顶层就读取 `window`——
    静态引入会让任何 import 了本模块的代码在 node（测试、SSR）里直接抛
    `ReferenceError: window is not defined`。
  */
  try {
    // eslint-disable-next-line ts/no-require-imports
    const { createTrimApp } = require('./sdk.ts') as typeof import('./sdk.ts')
    const app = createTrimApp()
    return { isWeb: app.isWeb, isStandaloneWeb: app.isStandaloneWeb }
  } catch {
    return undefined
  }
}

/**
 * 直接给出结论：当前环境是否有 fnOS 宿主桥。
 *
 * 供无需关心细节的调用方使用，内部先读 SDK 标志、读不到再退回 DOM 判据。
 *
 * @returns 宿主桥是否可用。
 */
export function fnosHostBridgeAvailable(): boolean {
  return hasFnosHostBridge(readSdkCapabilityFlags())
}
