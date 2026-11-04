/** DSH 语言包注册：为本插件增加可选语言并登记各语言字典（FNOS-045-04）。 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { LocaleDict } from '@deepseek-ai/dsh-client-locale/client'

/**
 * 本插件新增的界面语言。
 *
 * `id` 用 BCP 47 主标签，与 DSH 内置的 `zh`/`en` 同形，飞牛侧的 `ja-JP`
 * 这类带地区标签由语言同步模块折成主标签后再匹配；`label` 写该语言的自称，
 * 语言列表里直接显示，不做二次翻译。
 */
export const PLUGIN_LANGUAGES = [
  { id: 'ja', label: '日本語' },
  { id: 'ko', label: '한국어' },
  { id: 'de', label: 'Deutsch' },
  { id: 'fr', label: 'Français' },
  { id: 'es', label: 'Español' },
  { id: 'it', label: 'Italiano' },
  { id: 'ru', label: 'Русский' },
] as const

/**
 * 保证七种语言已在语言目录里。
 *
 * **必须查现有目录再注册**：`addLanguage` 对已被占用的 id 会抛错，而六个随包插件
 * 都可能先加载、都想要同一批语言，先到先注册、后到不能报错。
 *
 * @returns 释放函数：只回收这次真正新增的定义。
 */
export function ensurePluginLanguages(ctx: ClientContext): () => void {
  const disposers: (() => void)[] = []
  for (const language of PLUGIN_LANGUAGES) {
    const exists = ctx.locale.getLocale().locales.some(entry => entry.id === language.id)
    if (exists) continue
    disposers.push(ctx.locale.addLanguage({ id: language.id, label: language.label, fallback: 'en' }))
  }
  return () => { for (const dispose of disposers.reverse()) dispose() }
}

/**
 * 用一个语言一份字典的形式登记本插件的命名空间。
 *
 * 走单语言非类型化入口而不是双语言类型化入口：类型化入口要求一次给齐全部内置
 * 语言，新增语言由语言包贡献。键集合完整性由字典文件的
 * `{ [Key in XxxLocaleKey]: string }` 声明在编译期保证。
 */
export function registerPluginDictionaries(
  ctx: ClientContext,
  namespace: string,
  dictionaries: Readonly<Record<string, LocaleDict>>,
): () => void {
  const disposers = Object.entries(dictionaries).map(([locale, dict]) =>
    ctx.locale.register(namespace, locale, dict))
  return () => { for (const dispose of disposers.reverse()) dispose() }
}
