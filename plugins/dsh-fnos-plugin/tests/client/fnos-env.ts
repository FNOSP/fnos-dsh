import { vi } from 'vitest'

/**
 * 测试用的 fnOS 环境夹具。
 *
 * ## 为什么需要它
 *
 * 环境判据已从「是不是 iframe」改成「是不是 fnOS 托管」，而后者的依据是页面里
 * 由应用网关注入的 `<base href="/app/<应用名>/">`。只 stub `window.parent` 只能
 * 伪造「在 iframe 里」，伪造不出「在 fnOS 里」——用它写出来的测试会得到
 * `none`（本地开发）环境，与真实 fnOS 行为不符。
 *
 * 三个工厂分别对应三种真实环境，测试里按被测行为选一个：
 *  - {@link stubEmbeddedFnos}：应用中心内嵌 iframe，有宿主桥
 *  - {@link stubStandaloneFnos}：新标签页直接访问，无宿主桥
 *  - {@link stubLocalDev}：本地 `dsh web`，与 fnOS 无关
 */

/** 应用网关给页面注入的 `<base>`。 */
const GATEWAY_BASE = 'http://nas.example:5666/app/fn-deepseek-harness/'

/**
 * 安装环境判定所需的全局对象。
 *
 * `document` 只实现判据真正用到的那一个查询（`querySelector('base')`），其余
 * 一律返回 `null`——比引入 jsdom 轻，也不会意外满足被测代码未声明的依赖。
 *
 * @param options - 环境形态。
 * @param options.embedded - 是否在 iframe 里。
 * @param options.base - `<base>` 的 href；`undefined` 表示页面没有这个标签。
 * @param options.body - 是否提供一个可挂载的 `document.body`（快捷键安装器需要）。
 */
export function stubFnosGlobals(options: {
  embedded: boolean
  base?: string | undefined
  body?: boolean
}): void {
  const windowStub: Record<string, unknown> = {}
  windowStub.parent = options.embedded ? {} : windowStub
  windowStub.location = { href: options.base ?? 'http://localhost:8070/' }
  vi.stubGlobal('window', windowStub)

  const documentStub: Record<string, unknown> = {
    querySelector: (selector: string) => {
      if (selector === 'base') return options.base === undefined ? null : { href: options.base }
      return null
    },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    documentElement: { hasAttribute: () => false },
  }
  if (options.body === true) documentStub.body = { append: () => undefined }
  vi.stubGlobal('document', documentStub)
}

/** 应用中心内嵌（iframe + 网关托管）：宿主桥可用。 */
export function stubEmbeddedFnos(options: { base?: string, body?: boolean } = {}): void {
  stubFnosGlobals({ embedded: true, base: options.base ?? GATEWAY_BASE, ...options })
}

/** 独立浏览器页面（非 iframe + 网关托管）：属于 fnOS，但没有宿主桥。 */
export function stubStandaloneFnos(options: { base?: string, body?: boolean } = {}): void {
  stubFnosGlobals({ embedded: false, base: options.base ?? GATEWAY_BASE, ...options })
}

/** 本地 `dsh web` 开发：网关未托管，与 fnOS 无关。 */
export function stubLocalDev(options: { body?: boolean } = {}): void {
  stubFnosGlobals({ embedded: false, base: undefined, ...options })
}

/** 网关 `<base>` 的绝对地址，供断言 `redirectUri` 等使用。 */
export const FNOS_GATEWAY_BASE = GATEWAY_BASE
