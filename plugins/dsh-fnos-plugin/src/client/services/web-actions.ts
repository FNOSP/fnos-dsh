/**
 * 应用级动作（刷新页面、重启 Web 服务）的共享实现。
 *
 * ## 为什么抽成服务而不是各自实现
 *
 * 这两个动作原先分别写在「更多」菜单的两个菜单项组件里。入口搬到侧栏底部后
 * 由同一份实现供下拉菜单使用——如果两处各写一遍，「是否提供」的判断迟早会
 * 出现「一处有入口、一处没有」。
 *
 * ## 可用性判据
 *
 * 刷新与重启都依赖应用网关 `/__fnos-gateway/...`，它只在 fnOS 宿主内存在。
 * 但它**不是**「是否在 iframe 里」——独立浏览器页面（非 iframe）同样经网关
 * 访问应用，只是没有宿主注入的 fnOS SDK。因此这里用「网关是否可达」判断，
 * 而不是 `window.parent !== window`。
 *
 * @module dsh-fnos/services/web-actions
 */

import { isGatewayHosted } from './environment.ts'

/** 下拉菜单里「刷新」「重启」两个动作的可用面。 */
export interface FnosWebActions {
  /** 刷新整页；不可用时为 undefined（菜单不渲染该行）。 */
  readonly refresh?: () => void
  /** 重启 Web 服务并重载页面；不可用时为 undefined。 */
  readonly restart?: () => Promise<void>
}

/**
 * 网关控制地址。
 *
 * 应用被嵌在 fnOS 里时页面 `<base>` 指向 `/app/fn-deepseek-harness/`，
 * 直接用绝对路径 `/__fnos-gateway/...` 会打到宿主根而不是应用网关，因此要
 * 从 `<base>` 解出真实地址。
 * @param path - 以 `/` 开头的路径。
 * @returns 可直接 fetch 的地址。
 */
export function gatewayControlUrl(path: string): string {
  if (typeof document === 'undefined') return path
  const base = document.querySelector('base')?.href
  if (base !== undefined) {
    try { return new URL(path.slice(1), base).toString() } catch { /* 落到下面用原路径 */ }
  }
  return path
}

/**
 * 当前可用的应用级动作。
 * @returns 供下拉菜单消费的动作集合。
 */
export function getFnosWebActions(): FnosWebActions {
  if (!isGatewayHosted()) return {}
  return {
    refresh: () => { globalThis.location.reload() },
    restart: async () => {
      const response = await fetch(gatewayControlUrl('/__fnos-gateway/control/web/restart'), {
        method: 'POST',
        headers: { 'x-requested-with': 'fetch' },
        credentials: 'same-origin',
      })
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
      // 延迟 300ms 再 reload：重启接口是异步的，立刻 reload 会打到还没起来的
      // 进程上，用户看到的是「白屏 + 报错」而不是「正在重启」。
      globalThis.setTimeout(() => { globalThis.location.reload() }, 300)
    },
  }
}
