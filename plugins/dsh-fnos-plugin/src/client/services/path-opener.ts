/** Route DSH's existing path-open action through the fnOS iframe bridge. */

import { isFnosHosted } from './environment.ts'
import { fnosHostBridgeAvailable } from './host-bridge.ts'

export interface PathOpenerWorkspaces {
  openPath(path: string): Promise<void>
}

export interface PathOpenerSdk {
  readonly isWeb: boolean
  readonly isStandaloneWeb: boolean
  ready(): Promise<unknown>
  openFile(path: string): Promise<unknown>
}

export type PathOpenerMessageKey = 'pathOpenUnavailable'

export interface PathOpenerOptions {
  createSdk: () => PathOpenerSdk
  message?: (key: PathOpenerMessageKey) => string
}

/** The alpha.4 remote face used by DSH's chat and tool views to open paths. */
export interface PathOpenerRemote {
  openWorkspacePath(request: { path: string }, signal?: AbortSignal): Promise<unknown>
}

const defaultMessages: Record<PathOpenerMessageKey, string> = {
  pathOpenUnavailable: 'Unable to open this path through fnOS.',
}

/**
 * Decorate the public DSH workspaces service and return a lifecycle disposer.
 * 只有**不在 fnOS 里**（本地开发）才保留 DSH 原生 opener；fnOS 下无论内嵌还是
 * 独立浏览器页面，都不回落到 xdg-open——NAS 容器里没有它。
 */
export function installFnosPathOpener(
  workspaces: PathOpenerWorkspaces,
  options: PathOpenerOptions,
): () => void {
  const originalOpenPath = workspaces.openPath
  const createSdk = options.createSdk
  const message = (key: PathOpenerMessageKey): string => options.message?.(key) ?? defaultMessages[key]
  let sdkPromise: Promise<PathOpenerSdk> | undefined

  const getSdk = (): Promise<PathOpenerSdk> => sdkPromise ??= (async () => {
    const sdk = createSdk()
    await sdk.ready()
    return sdk
  })()

  const wrappedOpenPath = async (path: string): Promise<void> => {
    let sdk: PathOpenerSdk
    try {
      sdk = await getSdk()
    } catch (error: unknown) {
      throw new Error(message('pathOpenUnavailable'), { cause: error })
    }

    /*
      回落原生只在「根本不在 fnOS 里」时成立（本地 `dsh web` 开发）。
      独立浏览器页面**是** fnOS 应用，但宿主桥不可用；此时回落到原生 opener 会
      在 NAS 上跑 `xdg-open`——容器里没有这个命令，用户看到的是一个与真实原因
      无关的失败。这种情况必须走下面的明确报错。
    */
    if (!isFnosHosted()) {
      await originalOpenPath.call(workspaces, path)
      return
    }

    try {
      /*
        Never fall back to DSH's native opener inside fnOS. That opener runs
        xdg-open in the NAS service container, where the command is absent.
        独立浏览器页面同样在这里失败：没有宿主桥，`openFile` 不可能成功。
      */
      /*
        这里**必须实时判断**，不能读 `runtime-env.ts` 的静态常量：本模块是「执行
        一次操作」的运行时函数，调用发生在用户点下去那一刻；而静态常量在模块加载
        时就固定了，测试里改环境标志后它不会跟随（实测三条用例因此失败）。

        静态常量适合**渲染分支**（页面加载时定一次、之后不变），不适合运行时守卫。
      */
      if (!fnosHostBridgeAvailable()) throw new Error('Opening files requires the fnOS app')
      if (!sdk.isWeb) throw new Error('fnOS iframe SDK did not initialize its web carrier')
      // The SDK is the authority for opening a path. Do not preflight against
      // the plugin's displayed authorization roots: the list is intended for
      // browsing and selecting paths, but it can lag behind fnOS ACL state or
      // use a different path representation. A preflight here caused valid
      // NAS paths to be rejected before fnOS could make the real decision.
      await sdk.openFile(path)
    } catch (error: unknown) {
      throw new Error(message('pathOpenUnavailable'), { cause: error })
    }
  }

  workspaces.openPath = wrappedOpenPath
  return () => {
    if (workspaces.openPath === wrappedOpenPath) workspaces.openPath = originalOpenPath
  }
}

/**
 * Route the alpha.4 session path remote through fnOS while preserving DSH's
 * result contract for the chat view. The old workspace service exposed
 * `openPath`; alpha.4 moved the operation to `remote.session`.
 */
export function installFnosRemotePathOpener(
  remote: PathOpenerRemote,
  options: PathOpenerOptions,
): () => void {
  const originalOpenWorkspacePath = remote.openWorkspacePath
  const createSdk = options.createSdk
  let sdkPromise: Promise<PathOpenerSdk> | undefined

  const getSdk = (): Promise<PathOpenerSdk> => sdkPromise ??= (async () => {
    const sdk = createSdk()
    await sdk.ready()
    return sdk
  })()

  const wrappedOpenWorkspacePath = async (
    request: { path: string },
    signal?: AbortSignal,
  ): Promise<unknown> => {
    // 不在 fnOS 里（本地开发）：保留 DSH 原生行为。
    if (!isFnosHosted()) return originalOpenWorkspacePath.call(remote, request, signal)

    /*
      在 fnOS 里但没有宿主桥（独立浏览器页面）：**不回落原生**。
      回落会在 NAS 服务容器里跑 `xdg-open`，那里没有桌面环境，失败信息与真实
      原因无关。给一条能指导用户的错误，比一个查不出所以然的系统错误有用。
    */
    if (!fnosHostBridgeAvailable()) {
      return {
        ok: false,
        error: {
          code: 'gateway/internal',
          message: 'Opening files requires the fnOS app; open this session inside fnOS.',
        },
      }
    }

    let sdk: PathOpenerSdk
    try {
      sdk = await getSdk()
    } catch (error) {
      return { ok: false, error: { code: 'gateway/internal', message: String(error) } }
    }

    try {
      if (!sdk.isWeb) throw new Error('fnOS iframe SDK did not initialize its web carrier')
      await sdk.openFile(request.path)
      return { ok: true, value: { opened: true } }
    } catch (error) {
      return {
        ok: false,
        error: {
          code: 'gateway/internal',
          message: error instanceof Error ? error.message : String(error),
        },
      }
    }
  }

  remote.openWorkspacePath = wrappedOpenWorkspacePath
  return () => {
    if (remote.openWorkspacePath === wrappedOpenWorkspacePath) remote.openWorkspacePath = originalOpenWorkspacePath
  }
}
