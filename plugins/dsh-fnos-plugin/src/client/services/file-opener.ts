/**
 * 用 fnOS 自己的界面打开授权目录里的一个条目。
 *
 * 目录交给文件管理器定位，文件交给 fnOS 的文件预览/默认应用打开——面板只负责
 * 发起，不在 DSH 里另做一套浏览或预览。与 `file-manager.ts` 同一手法：SDK 由
 * 调用方注入，本模块不 import `sdk.ts`，保证可以脱离 DOM 单测。
 */

/** 打开条目所需的 SDK 最小形状。 */
export interface EntryOpenerSdk {
  readonly isWeb: boolean
  readonly isStandaloneWeb: boolean
  ready(): Promise<unknown>
  openFile(path: string): Promise<unknown>
  openFileManager(path: string): Promise<unknown>
}

/**
 * 打开一个 NAS 条目：目录走文件管理器，文件走 fnOS 的打开/预览能力。
 *
 * 只在 web carrier 就绪时调用：fnOS iframe 未连上宿主时 SDK 以 standalone
 * 模式启动，调用会静默无效。这里显式失败，由调用方转成可见提示，不回退到
 * DSH 原生打开——NAS 服务容器里没有桌面环境，回退只会把错误藏起来。
 *
 * 路径直接传给 fnOS，不由插件预检：面板展示的授权列表可能滞后于 fnOS 的
 * ACL 状态，预检会误拒合法路径。是否允许由 fnOS 自行判断。
 *
 * @param path - 目标条目的内部路径。
 * @param kind - 条目类型，决定用文件管理器还是文件打开。
 * @param createSdk - SDK 工厂，由调用方传入。
 */
export async function openFnosEntry(
  path: string,
  kind: 'directory' | 'file',
  createSdk: () => EntryOpenerSdk,
): Promise<void> {
  const sdk = createSdk()
  await sdk.ready()
  if (!sdk.isWeb || sdk.isStandaloneWeb) {
    throw new Error('fnOS iframe SDK did not initialize its web carrier')
  }
  if (kind === 'directory') await sdk.openFileManager(path)
  else await sdk.openFile(path)
}
