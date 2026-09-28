/**
 * OAuth 授权页的开窗收口（Codex Auth）。
 *
 * `window.open` 的返回值在两种运行形态下含义不同：
 *
 *  - **独立浏览器 / fnOS iframe**：返回窗口句柄，插件的「取消时关掉授权窗口」
 *    依赖它。
 *  - **DSH Desktop（Electron 壳）**：壳在主窗口装了 `setWindowOpenHandler`，
 *    对 http/https 调 `shell.openExternal(url)` 后返回 `{ action: 'deny' }`，
 *    于是 `window.open` 返回 `null`——授权页**确实已在系统浏览器打开**，
 *    只是拿不到句柄。
 *
 * 因此返回值只能回答「有没有窗口句柄」，**不能**回答「窗口有没有打开」。
 * 把 `null` 当作「被浏览器阻止」会让 Desktop 上的登录在请求设备码之前就中断。
 *
 * @module dsh-codex-auth/window-opener
 */

/**
 * 打开授权页。
 *
 * 与 CodeBuddy 的同名能力有一处刻意差异：这里**返回句柄**而不是丢弃它，
 * 因为 Codex 的取消流程要关掉授权窗口；同时**不带 `noopener`**——
 * `noopener` 会让返回值恒为 `null`，也会在跨域导航后让 `close()` 静默失效。
 *
 * @param url - 授权页地址。
 * @returns 窗口句柄；Desktop 壳接管时（以及非浏览器环境）为 `null`。
 */
export function openAuthorizationWindow(url: string): Window | null {
  if (typeof window === 'undefined') return null
  try {
    return window.open(url, '_blank')
  } catch {
    // 策略拦截或跨源限制不应让调用点崩溃：客户端未处理异常会沿宿主 fail-loud 退出进程。
    // 登录结果以宿主侧授权状态为准，开窗失败不阻断流程，用户可重试。
    return null
  }
}
