/**
 * 账号登录的宿主状态读取。
 *
 * ## 为什么单独成模块
 *
 * 这个读取函数原先写在 `FnosAccountLoginOverlay.tsx` 里，而那个文件又 import 了
 * `FnosAccountLoginDialog.tsx`——后者反过来要 import 这个函数，于是两个模块
 * 形成**循环依赖**。表现是浮层组件在宿主里静默不渲染：`shell.overlay` 槽位
 * 里只有一个空壳，没有报错、没有警告，最难查的那种。
 *
 * 把它拆到这里，依赖方向就变成单向：
 *
 * ```
 * FnosAccountLoginOverlay ──▶ FnosAccountLoginDialog ──▶ account-login-state
 * ```
 *
 * @module dsh-fnos/client/services/account-login-state
 */

import {
  FNOS_ACCOUNT_LOGIN_STATE_ROUTE,
  type AccountLoginAttemptView,
} from '../../contracts/account-login-contract.ts'

/**
 * 读一次宿主的授权页地址。
 *
 * **单次读取，不是轮询**：是否显示粘贴框由 DOM 监听决定（官方弹框出现即显示），
 * 这里只负责把地址取回来给「复制链接」按钮用。取不到就返回 undefined，不影响
 * 粘贴框本身。
 *
 * @returns 授权页地址；当前没有进行中的尝试时为 undefined。
 */
export async function readAuthorizeUrlOnce(): Promise<string | undefined> {
  try {
    const response = await fetch(FNOS_ACCOUNT_LOGIN_STATE_ROUTE, { credentials: 'same-origin' })
    const state = await response.json() as AccountLoginAttemptView | undefined
    return state?.authorizeUrl
  } catch {
    return undefined
  }
}
