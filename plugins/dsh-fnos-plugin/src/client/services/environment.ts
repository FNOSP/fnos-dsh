/**
 * fnOS 运行环境识别。
 *
 * ## 为什么要单独成模块
 *
 * 原先全插件用 `isEmbeddedFnosFrame()`（即 `window.parent !== window`）判断
 * 「是否运行在 fnOS 里」。这个判据只答得出「是不是 iframe」，答不出「是不是
 * 跑在 fnOS 上」——**独立浏览器页面不是 iframe，却同样是由 fnOS 应用网关提供
 * 的**（用户在新标签页打开 `http://<nas>:<port>/app/fn-deepseek-harness/`）。
 *
 * 后果是那一整支功能在独立浏览器页面里被当成「本地开发」静默跳过：会话头部的
 * 日志/刷新/重启入口不注册、授权目录不走 SDK。用户看到的是「很多功能不生效」，
 * 而控制台没有任何报错——最难查的那种失败。
 *
 * ## 三种环境
 *
 * | 环境 | 判定 | fnOS SDK | 典型场景 |
 * | --- | --- | --- | --- |
 * | `embedded` | 在 iframe 内且网关托管 | 宿主桥可用 | fnOS 应用中心里打开 |
 * | `standalone` | 不在 iframe、网关托管 | **宿主桥不可用** | 新标签页直接访问 |
 * | `none` | 网关未托管 | 无 | 本地 `dsh web` 开发 |
 *
 * 「网关托管」的判据是页面存在指向 `/app/` 的 `<base>`：应用网关
 * （`packages/fnos-gateway`）给每个响应注入它，而本地 DSH Web 没有。
 *
 * ## SDK 可用性
 *
 * `standalone` 下 `@trimjs/web-app` 会在 init 时直接跳过宿主桥
 * （`isStandaloneWeb = window.parent === window`），此后任何 `getWebMethods()`
 * 调用都会抛 `Host bridge is not available outside iframe or app runtime`。
 * 因此**文件类操作在 standalone 下没有可用路径**，只有授权类能力可以走
 * `openAppAuth` 打开授权页。
 *
 * @module dsh-fnos/services/environment
 */

/** 本插件识别的运行环境。 */
export type FnosEnvironment = 'embedded' | 'standalone' | 'none'

/**
 * 是否由 fnOS 应用网关托管。
 *
 * 网关会给 HTML 注入 `<base href="/app/<应用名>/">`；本地 `dsh web` 没有这条
 * 标记。这是唯一能同时覆盖 iframe 与独立浏览器页面的判据。
 * @returns 是否处于应用网关之下。
 */
export function isGatewayHosted(): boolean {
  if (typeof document === 'undefined') return false
  const base = document.querySelector('base')?.href
  if (base === undefined) return false
  try {
    return new URL(base).pathname.startsWith('/app/')
  } catch {
    return false
  }
}

/**
 * 是否在 iframe 里（fnOS 应用中心内嵌）。
 *
 * 只回答「是不是 iframe」，**不能**用它判断「是不是 fnOS」——独立浏览器页面
 * 同样属于 fnOS 应用，只是没有宿主桥。
 * @returns 是否处于子框架。
 */
export function isFnosFrame(): boolean {
  return typeof window !== 'undefined' && window.parent !== window
}

/**
 * 当前运行环境。
 * @returns `embedded` / `standalone` / `none`。
 */
export function detectFnosEnvironment(): FnosEnvironment {
  if (!isGatewayHosted()) return 'none'
  return isFnosFrame() ? 'embedded' : 'standalone'
}

/**
 * 是否运行在 fnOS 应用内（内嵌或独立浏览器页面都算）。
 *
 * 用于「注册 UI、接入网关能力」这类判断：这些功能在两种形态下都该存在。
 * @returns 是否属于 fnOS 应用。
 */
export function isFnosHosted(): boolean {
  return detectFnosEnvironment() !== 'none'
}

/**
 * 宿主桥是否可用（**仅按 DOM 判断**）。
 *
 * 这是纯 DOM 的保守判据：只有 iframe 里才算有宿主桥。需要感知
 * `@trimjs/web-app` 的 `isWeb` 标志（`isWeb === false` 时即便不是 iframe 也有
 * 宿主桥）请用 `host-bridge.ts` 的 `fnosHostBridgeAvailable()`。
 *
 * 留在这里是因为本模块不依赖 SDK，纯 DOM 判断没有循环依赖风险。
 *
 * @returns 是否处于 iframe（`embedded`）。
 */
export function hasFnosHostBridge(): boolean {
  return detectFnosEnvironment() === 'embedded'
}
