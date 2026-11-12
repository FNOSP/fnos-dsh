/**
 * fnOS 原生文件操作：把文件管理器调用从 React 组件里分离出来。
 *
 * 单独成模块有两个原因：组件一旦被 import 就会拉起 Semi 组件，测试环境解析
 * 不了；而这里的调用逻辑（web carrier 校验、路径直传）本身是纯的，可以独立
 * 断言。SDK 工厂由调用方注入，与 `sdk-title.ts` 的 `installFnosPageTitle`
 * 同一手法——该模块也不 import `sdk.ts`，因为 `@trimjs/web-app` 在 import 期
 * 就会读 `window`，测试环境没有 DOM。
 */

/**
 * 打开文件管理器所需的 SDK 最小形状。
 *
 * 显式声明而不是直接用 `TrimApp`：测试可以注入一个假实现。
 */
export interface FileManagerSdk {
  readonly isWeb: boolean
  readonly isStandaloneWeb: boolean
  ready(): Promise<unknown>
  openFileManager(path: string): Promise<unknown>
  /** 独立浏览器页面里唯一还能用的「打开」通道（内部即 `window.open`）。 */
  openURL?(url: string, target?: string, features?: string): Promise<unknown>
}

/**
 * fnOS 桌面首页地址（去掉应用前缀）。
 *
 * 页面在 fnOS 里时 `<base>` 是 `<origin>/app/<应用>/`；桌面是它的上一级。
 * 没有 `<base>` 时退回当前 origin。
 * @returns 桌面首页 URL。
 */
function fnosDesktopUrl(): string {
  if (typeof document === 'undefined' || typeof location === 'undefined') return '/'
  const base = document.querySelector('base')?.href
  if (base !== undefined) {
    try {
      const url = new URL(base)
      // `/app/<应用>/` → `/`
      return url.origin + '/'
    } catch { /* 落到下面 */ }
  }
  return location.origin + '/'
}

/**
 * 用 fnOS SDK 打开 NAS 文件管理器并定位到给定路径。
 *
 * 只在 web carrier 就绪时调用：fnOS iframe 未连上宿主时 SDK 会以 standalone
 * 模式启动，此时调用静默无效，必须显式失败。失败向上抛出，由调用方转成可见
 * 提示，不回退到 DSH 原生打开逻辑——NAS 服务容器里没有 `xdg-open`，回退只会
 * 把错误藏起来。
 *
 * 用 `openFileManager` 而不是 `openFile`：后者按文件类型交给系统默认应用打开，
 * 对目录没有意义，而这里的目标就是会话工作目录。
 *
 * @param path - 目标目录，通常是当前会话的工作目录。
 * @param createSdk - SDK 工厂，由组件传入（它负责 User-Agent 归一化）。
 */
export async function openFnosFileManager(
  path: string,
  createSdk: () => FileManagerSdk,
): Promise<void> {
  const sdk = createSdk()

  /*
    **独立浏览器页面必须在 `await` 之前就打开新标签页。**

    实测：`window.open` 只有在**用户点击的同步调用栈**里才放行，脱离手势后一律
    返回 null（弹窗拦截）。早前写成 `await sdk.ready()` 之后再 `openURL`，已经
    不在手势里，于是新标签页打不开、也没有任何报错。

    所以这里先开窗、再补地址：先用 `about:blank` 占住窗口（这一步仍在手势内），
    等拿到地址后写入 `location`。`noopener` 下拿不到句柄，因此这里**不用**
    `noopener`（同源页面，且我们会立即导航到固定地址）。
  */
  if (sdk.isStandaloneWeb) {
    const target = fnosDesktopUrl()
    const opened = typeof window === 'undefined' ? null : window.open('about:blank', '_blank')
    if (opened !== null) {
      opened.location.href = target
      return
    }
    /*
      窗口没开出来（弹窗拦截器仍拦住了，或浏览器限制）：退回给一个可点击的
      链接式导航，而不是静默失败。
    */
    throw new Error('fnos-open-blocked: popup was blocked; allow popups for this site and retry')
  }

  await sdk.ready()
  if (!sdk.isWeb) throw new Error('fnOS iframe SDK did not initialize its web carrier')
  // 不预检插件自己展示的授权目录列表：该列表用于浏览和选择，可能滞后于 fnOS
  // ACL 状态，预检会误拒合法路径。是否允许由 fnOS 自行判断。
  await sdk.openFileManager(path)
}
