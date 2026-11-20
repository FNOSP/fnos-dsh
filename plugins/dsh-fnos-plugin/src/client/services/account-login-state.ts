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

/**
 * 读一次登录尝试的完整状态（阶段 + 授权页地址）。
 *
 * 与 {@link readAuthorizeUrlOnce} 的区别：那个只关心地址，这个还关心**阶段**
 * ——`succeeded` 意味着授权页已经完成登录，弹框该自动收尾了。
 *
 * ## 为什么这里能知道登录完成
 *
 * 授权页跑在新标签页里、且是跨域的，主窗口读不到它的地址（实测 `SecurityError`），
 * 官方还主动 `popup.opener = null` 切断了引用。但登录完成时浏览器会跳到
 * `127.0.0.1:<relayPort>/oauth/callback`——那个端口在**宿主**上，宿主拿到码后
 * 转发给账号服务并推进阶段。于是主窗口只需问宿主「现在是什么阶段」。
 * @returns 当前尝试的阶段与地址；没有进行中的尝试时为 undefined。
 */
export async function readLoginStateOnce(): Promise<AccountLoginAttemptView | undefined> {
  try {
    const response = await fetch(FNOS_ACCOUNT_LOGIN_STATE_ROUTE, { credentials: 'same-origin' })
    if (!response.ok) return undefined
    return await response.json() as AccountLoginAttemptView
  } catch {
    return undefined
  }
}
