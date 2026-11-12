/**
 * 「飞牛 OS 设置」入口的快捷键定义。
 *
 * ## 为什么是 `primary + Comma`（而不是 `primary + Alt + Comma`）
 *
 * | 组合 | 归谁 | 说明 |
 * | --- | --- | --- |
 * | `Cmd/Ctrl + ,` | **本插件** | 在 fnOS 里打开飞牛 OS 设置弹框 |
 * | `Cmd/Ctrl + Alt + ,` | DSH 官方 | 打开 DSH 自己的设置面板 |
 *
 * 官方在 **Web** 运行时把 `settings.open` 绑到 `primary + Alt + ,`，而
 * `Cmd/Ctrl + ,` 在 Web 运行时本来是空着的——但浏览器会把它抢去开浏览器设置。
 * 于是这个组合在 fnOS 页面里既没归属、又按不动，正好可以让给飞牛自己的设置。
 *
 * ## 快捷键提示为什么要判断系统
 *
 * 提示要显示用户**手上真按得到**的键：macOS 是 `⌘ ,`，Windows/Linux 是
 * `Ctrl ,`。写死其中一个，另一半用户会照着按却没反应。
 *
 * @module dsh-fnos/shortcuts/fnos-settings-shortcut
 */

/** 快捷键的平台形态。 */
export type ShortcutPlatform = 'mac' | 'other'

/**
 * 判断当前平台是不是 macOS。
 *
 * 优先用 `navigator.userAgentData.platform`（Chromium 系），再退到
 * `navigator.platform` 与 UA 字符串——三者都能被伪造，这里只需要「显示哪个
 * 修饰键」这一个用途，取到任意一个可靠来源即可。
 *
 * @param nav - 可注入的 navigator 形状（便于单测）。
 * @returns `mac` 或 `other`。
 */
export interface ShortcutPlatformSource {
  /** Chromium 的 `navigator.userAgentData`（TS 的 `Navigator` 里没有这个字段）。 */
  readonly userAgentData?: { readonly platform?: string }
  readonly platform?: string
  readonly userAgent?: string
}

/**
 * @param nav - 可注入的 navigator 形状（便于单测）。
 * @returns `mac` 或 `other`。
 */
export function detectShortcutPlatform(nav?: ShortcutPlatformSource): ShortcutPlatform {
  const source: ShortcutPlatformSource | undefined = nav
    ?? (typeof navigator === 'undefined' ? undefined : navigator as ShortcutPlatformSource)
  if (source === undefined) return 'other'

  const uaDataPlatform = source.userAgentData?.platform
  if (typeof uaDataPlatform === 'string' && uaDataPlatform !== '') {
    return /mac/iu.test(uaDataPlatform) ? 'mac' : 'other'
  }

  if (typeof source.platform === 'string' && source.platform !== '') {
    return /mac/iu.test(source.platform) ? 'mac' : 'other'
  }

  if (typeof source.userAgent === 'string' && source.userAgent !== '') {
    return /mac os x|macintosh/iu.test(source.userAgent) ? 'mac' : 'other'
  }

  return 'other'
}

/**
 * 快捷键提示要渲染的键帽。
 *
 * 用 DSH 官方的键帽文案（`⌘` / `Ctrl`）而不是自定义符号：设置面板里官方那条
 * 「打开设置」用的就是这套，两者并排时才能看出是同一种控件。
 *
 * @param platform - 平台形态。
 * @returns 修饰键与逗号两枚键帽。
 */
export function fnosSettingsShortcutKeys(platform: ShortcutPlatform): readonly string[] {
  return platform === 'mac' ? ['⌘', ','] : ['Ctrl', ',']
}

/** 快捷键的 `aria-keyshortcuts` 值（读屏与键盘用户据此发现该命令）。 */
export function fnosSettingsAriaKeys(platform: ShortcutPlatform): string {
  return platform === 'mac' ? 'Meta+,' : 'Control+,'
}
