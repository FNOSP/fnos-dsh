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
  await sdk.ready()
  if (!sdk.isWeb) throw new Error('fnOS iframe SDK did not initialize its web carrier')
  /*
    **独立浏览器页面走 `openURL`。**
    这一形态没有宿主桥，`openFileManager` 只会抛
    `Host bridge is not available`；但 `openURL` 在 Web 宿主里就是
    `window.open`，不依赖宿主桥，因此用它把 fnOS 文件管理器开成新标签页。

    URL 用 fnOS 桌面自身的地址（`<origin>/`）——文件管理器是桌面 SPA 的内部
    路由，没有可外部直达的稳定路径，能可靠打开的就只有桌面首页。
  */
  if (sdk.isStandaloneWeb) {
    if (sdk.openURL === undefined) throw new Error('fnOS openURL is unavailable in a standalone browser page')
    await sdk.openURL(fnosDesktopUrl(), '_blank', 'noopener')
    return
  }
  // 不预检插件自己展示的授权目录列表：该列表用于浏览和选择，可能滞后于 fnOS
  // ACL 状态，预检会误拒合法路径。是否允许由 fnOS 自行判断。
  await sdk.openFileManager(path)
}
