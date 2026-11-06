/**
 * 设备码授权页的自动开窗编排。
 *
 * 「点登录就自动打开授权页」在两种运行形态下的可行做法不同，必须分开处理：
 *
 * - **浏览器 / fnOS iframe**：授权地址要等接口返回才知道，而 `window.open` 只有
 *   在用户手势的同步调用栈里才不被拦截。因此先在手势内开一个 `about:blank`
 *   占位页，拿到地址后把它的 `location.href` 写过去。
 * - **DSH Desktop（Electron 壳）**：主窗口的 `setWindowOpenHandler` 只对
 *   `http:` / `https:` 调 `shell.openExternal`，其余协议一律 `deny`，所以占位页
 *   拿不到句柄；但壳的开窗发生在原生层、**不受浏览器手势限制**，因此拿到真实
 *   https 地址后直接再开一次即可。
 *
 * 关键约束：`window.open` 返回 `null` **不代表没打开**。Desktop 壳接管时返回值
 * 恒为 `null`（`deny`），而授权页已在系统浏览器里打开。因此任何一步都不把
 * `null` 当失败处理，也不弹「浏览器拦截了」的提示——把 `null` 判成拦截会让
 * Desktop 上的登录直接中断（Codex 插件踩过这个坑）。
 *
 * 真的被拦截时（浏览器禁用弹窗）无法与壳接管区分，界面保留「复制授权地址」
 * 按钮作为兜底，用户可自行到浏览器打开；设备码流程本身不受影响。
 *
 * @module dsh-opencode/client/authorization-window
 */

/**
 * 开窗能力：只做「开一个窗口」，不假设返回值语义。测试可注入。
 *
 * 实现可以抛错（CSP、跨源限制），本模块的编排函数会把异常收敛成「没拿到句柄」，
 * 调用点因此不需要再包 try/catch。
 */
export interface AuthorizationWindowOpener {
  /**
   * 打开一个新窗口。
   * @param url - 目标地址。
   * @returns 窗口句柄；壳接管、被拦截或不在浏览器环境时为 `null`。
   */
  readonly open: (url: string) => Window | null
}

/** 占位页地址：手势内先开它，拿到授权地址后再导航。 */
export const PENDING_AUTHORIZATION_URL = 'about:blank'

/** 浏览器环境的默认开窗实现。 */
export function browserWindowOpener(): AuthorizationWindowOpener {
  return {
    open: (url: string): Window | null => {
      if (typeof window === 'undefined') return null
      try {
        // 刻意不带 `noopener`：那会让返回值恒为 `null`，既无法导航占位页，
        // 也与「壳接管」的 null 混在一起无法区分。
        return window.open(url, '_blank')
      } catch {
        // CSP 或跨源限制不该让调用点崩溃：客户端未处理异常会沿宿主链路放大。
        return null
      }
    },
  }
}

/**
 * 在用户手势的同步栈里打开占位页。
 *
 * 必须在任何 `await` 之前调用，否则浏览器会按「非手势触发」拦截弹窗。
 *
 * @param opener - 开窗能力，默认浏览器实现。
 * @returns 占位页句柄；拿不到时为 `null`（Desktop 壳接管或已被拦截）。
 */
export function openAuthorizationPlaceholder(
  opener: AuthorizationWindowOpener = browserWindowOpener(),
): Window | null {
  try {
    return opener.open(PENDING_AUTHORIZATION_URL)
  } catch {
    // 开窗能力本身抛错也不冒泡：登录不依赖这个窗口。
    return null
  }
}

/**
 * 把占位页导航到授权地址。
 *
 * @param placeholder - `openAuthorizationPlaceholder` 拿到的句柄。
 * @param verificationUri - 授权页地址（宿主已校验为 http/https 且不带内嵌凭据）。
 * @returns 是否真的导航了；句柄缺失、已被用户关闭或写入失败时 `false`，
 *          调用方据此改用直接开窗。
 */
export function navigateAuthorizationPlaceholder(
  placeholder: Window | null,
  verificationUri: string,
): boolean {
  if (placeholder === null) return false
  try {
    // 不清空 `opener`：清空后窗口跨域就不再是 script-closable，
    // `close()` 会静默失效，登录失败时无法收回这个标签页。
    if (placeholder.closed) return false
    placeholder.location.href = verificationUri
    return true
  } catch {
    return false
  }
}

/**
 * 直接打开授权地址（占位页不可用时的第二条路）。
 *
 * Desktop 上这一步由壳在原生层交给系统浏览器，返回值恒为 `null` 且**不是失败**；
 * 浏览器里若被拦截同样返回 `null`，此时界面上的「复制授权地址」按钮是兜底。
 *
 * @param verificationUri - 授权页地址。
 * @param opener - 开窗能力，默认浏览器实现。
 */
export function openAuthorizationUrl(
  verificationUri: string,
  opener: AuthorizationWindowOpener = browserWindowOpener(),
): void {
  try {
    opener.open(verificationUri)
  } catch {
    // 同上：开窗失败由「复制授权地址」兜底，不打断设备码流程。
  }
}

/**
 * 收回占位页：登录请求没发起来时不要留一个空白标签。
 *
 * @param placeholder - 占位页句柄；`null` 时什么都不做。
 */
export function closeAuthorizationPlaceholder(placeholder: Window | null): void {
  if (placeholder === null) return
  try {
    if (!placeholder.closed) placeholder.close()
  } catch {
    // 关不掉不影响登录结果，也不该冒泡成未处理异常。
  }
}
