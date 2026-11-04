/** fnOS 界面语言 → DSH 界面语言的同步（FNOS-045-05）。 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'

/**
 * fnOS 语言标签到 DSH 语言 id 的映射。
 *
 * DSH 的语言 id 是主标签形式（`zh`/`en`），fnOS 给的是带地区的标签
 * （`zh-CN`/`ja-JP`）。这里只取主标签，取不到或不在支持列表内时回退英文——
 * 语言对不上时界面必须是「看得懂」而不是空白或报错。
 */
const PRIMARY_TO_DSH: Readonly<Record<string, string>> = {
  zh: 'zh',
  en: 'en',
  ja: 'ja',
  ko: 'ko',
  de: 'de',
  fr: 'fr',
  es: 'es',
  it: 'it',
  ru: 'ru',
}

/** 把 fnOS 的语言标签解析成 DSH 语言 id；无法识别时返回 `en`。 */
export function resolveDshLocale(fnosLanguage: unknown): string {
  if (typeof fnosLanguage !== 'string') return 'en'
  const primary = fnosLanguage.trim().toLowerCase().split(/[-_]/u)[0] ?? ''
  return PRIMARY_TO_DSH[primary] ?? 'en'
}

/** 本模块用到的飞牛 SDK 表面（其余能力不关心）。 */
export interface TrimSdkLike {
  readonly isWeb: boolean
  readonly isStandaloneWeb: boolean
  ready: () => Promise<unknown>
  getPlatformConfig: () => Promise<{ language?: unknown }>
  $on: (event: 'os/language', handler: (language: unknown) => void) => Promise<void>
  $off: (event: 'os/language', handler: (language: unknown) => void) => Promise<void>
}

export interface LanguageSyncOptions {
  /** 读取当前可用语言，用来判断目标语言是否已注册。 */
  readonly availableLocales: () => readonly { readonly id: string }[]
  /** 切换 DSH 当前语言。 */
  readonly setLocale: (id: string) => void
  /**
   * 创建飞牛 SDK。由调用方注入而不是在本模块静态 import：SDK 只在浏览器里有
   * `window`，静态依赖会让本模块连同其单测都无法在 Node 下加载。
   */
  readonly createSdk: () => TrimSdkLike
}

/**
 * 订阅飞牛界面语言并同步到 DSH。
 *
 * 语义：**只在飞牛语言变化时切换**。启动时按当前飞牛语言对齐一次，此后跟随
 * `os/language` 事件。DSH 里手动选择的语言不会被持续覆盖——只有飞牛语言再变
 * 或下次启动时才重新对齐，这与「跟随系统语言」一致，也不会在用户改完 DSH 设置
 * 后被无声改回去。
 *
 * 非飞牛 Web 宿主（独立浏览器页面、移动端内嵌）不启用：那里没有飞牛语言可跟。
 */
export async function installFnosLanguageSync(
  ctx: ClientContext,
  options: LanguageSyncOptions,
): Promise<() => void | Promise<void>> {
  const sdk = options.createSdk()
  await sdk.ready()
  if (!sdk.isWeb || sdk.isStandaloneWeb) return () => {}

  const apply = (language: unknown): void => {
    const target = resolveDshLocale(language)
    if (!options.availableLocales().some(locale => locale.id === target)) return
    try {
      options.setLocale(target)
    } catch (error) {
      console.debug('[dsh-fnos] unable to switch DSH locale from fnOS', error)
    }
  }

  const config = await sdk.getPlatformConfig()
  apply(config.language)

  const handleLanguage = (language: unknown): void => { apply(language) }
  await sdk.$on('os/language', handleLanguage)
  return () => { void sdk.$off('os/language', handleLanguage) }
}
