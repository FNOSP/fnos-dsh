/**
 * OAuth 授权页的开窗收口。
 *
 * 三个登录入口（设置区块的添加账号、设置区块的重新登录、后台面板的添加账号）
 * 都要打开 CodeBuddy 授权页。此前它们各自裸调 `window.open`，值不返回值；
 * 这里把语义固定下来，让 Desktop 的行为不再依赖调用点的写法。
 *
 * @module dsh-codebuddy/external-opener
 */

/**
 * `window.open` 的取值形态。
 *
 * 只声明真实需要的部分：独立浏览器返回窗口句柄，Electron 壳返回 null。
 * 返回值**不参与成功判定**，因此这里不做 Window 类型收窄。
 */
export type OpenAuthUrl = (url: string) => unknown

/** 页面默认的开窗实现；非浏览器环境（测试、SSR）下退化为空操作。 */
const defaultOpen: OpenAuthUrl = (url) => {
  if (typeof window === 'undefined') return undefined
  return window.open(url, '_blank', 'noopener')
}

/**
 * 打开 CodeBuddy 授权页。
 *
 * **刻意不检查返回值。** Desktop 是 Electron 壳，主窗口装了
 * `setWindowOpenHandler`：对 http/https 链接调用 `shell.openExternal(url)`
 * 后**一律返回 `{ action: 'deny' }`**。于是授权页确实在系统浏览器里打开了，
 * 但 `window.open(...)` 返回 `null`。
 *
 * 若把 `null` 判为「弹窗被拦截」，Desktop 上每次登录都会被误报为失败，
 * 而真正的浏览器（返回窗口句柄）反而正常——恰好与直觉相反。因此这里只负责
 * 「发起打开」，成功与否由宿主侧的登录轮询判定（`pollLogin` 才是真相来源）。
 *
 * 开窗本身抛异常（策略拦截、跨源限制）也不能让调用点崩溃：客户端未处理的
 * 异常会沿着 `guardRpc` 之外的路径逃逸，而宿主侧任何未处理的拒绝都会触发
 * fail-loud 直接退出进程。登录流程仍会继续等待授权结果。
 *
 * @param url - 宿主握手签发的授权地址；空值直接忽略。
 * @param open - 开窗实现，默认走 `window.open`；测试传入替身。
 */
export function openAuthUrl(url: string, open: OpenAuthUrl = defaultOpen): void {
  if (url.length === 0) return
  try {
    open(url)
  } catch {
    // 打不开授权页不是致命错误：用户可自行复制链接或重试，
    // 宿主侧的握手与轮询仍在进行，登录结果以 `pollLogin` 为准。
  }
}
