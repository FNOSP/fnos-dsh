import { readdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { repositoryRoot } from '../config/paths.js'

/**
 * 多语言资源校验（FNOS-045）。
 *
 * 两件事靠机器判定，不靠人眼：
 *
 * 1. **应用包**的九份 `i18n/<locale>` 必须 section 与 key 完全一致，且
 *    `manifest`、`app/ui/config`、`wizard/*` 里引用的每个 `${section.key}`
 *    都要在每份语言文件里存在。缺一份或缺一个键，平台就会回退英文——界面不崩，
 *    但某个语言会突然冒出英文，这种退化只有校验能拦住。
 * 2. **插件**的新增语言字典文件必须存在。键集合完整性由类型系统保证
 *    （`{ [Key in XLocaleKey]: string }`），`tsc` 比正则更可靠，这里只查文件在不在、
 *    导出的名字对不对。
 */

/** 应用包语言文件（文件名即 locale）。`en-US` 为平台要求的必需文件。 */
export const APP_LOCALES = ['zh-CN', 'en-US', 'ja-JP', 'ko-KR', 'de-DE', 'fr-FR', 'es-ES', 'it-IT', 'ru-RU'] as const

/** 插件在 DSH 里新增的语言 id（`zh`/`en` 为 DSH 内置，不在此列）。 */
export const PLUGIN_LOCALES = ['ja', 'ko', 'de', 'fr', 'es', 'it', 'ru'] as const

const APP_NAME = 'fn-deepseek-harness'
/** 引用本地化文本的仓库文件（相对应用目录）。 */
const PLACEHOLDER_SOURCES = ['manifest', 'app/ui/config', 'wizard/install', 'wizard/upgrade', 'wizard/config', 'wizard/uninstall']

/** 一份语言文件：section → key → 文本。 */
export type LocaleFile = Map<string, Map<string, string>>

/**
 * 解析 INI 形式的语言文件。
 *
 * 只支持平台约定的一层 section 与 `key="value"` 形式：这里的输入是仓库自己的文件，
 * 不是通用 INI，容忍更多语法只会让「写错了但不报错」更难发现。
 */
export function parseLocaleFile(text: string): LocaleFile {
  const sections = new Map<string, Map<string, string>>()
  let current: Map<string, string> | undefined
  text.split(/\r?\n/u).forEach((rawLine, index) => {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#') || line.startsWith(';')) return
    const section = /^\[([^\]]+)\]$/u.exec(line)
    if (section !== null) {
      const name = section[1]?.trim()
      if (name === undefined || name === '') throw new Error(`第 ${index + 1} 行：section 名为空`)
      if (sections.has(name)) throw new Error(`第 ${index + 1} 行：section [${name}] 重复`)
      current = new Map()
      sections.set(name, current)
      return
    }
    const entry = /^([A-Za-z][A-Za-z0-9]*)\s*=\s*"(.*)"$/u.exec(line)
    if (entry === null) throw new Error(`第 ${index + 1} 行：不是 key="value" 形式：${line.slice(0, 60)}`)
    const [, key, value] = entry
    if (current === undefined) throw new Error(`第 ${index + 1} 行：key 出现在任何 section 之前`)
    if (key === undefined || value === undefined) throw new Error(`第 ${index + 1} 行：无法解析`)
    if (current.has(key)) throw new Error(`第 ${index + 1} 行：key ${key} 重复`)
    current.set(key, value)
  })
  return sections
}

/** 展开成 `section.key` 的扁平键集合。 */
export function localeKeys(file: LocaleFile): string[] {
  const keys: string[] = []
  for (const [section, entries] of file) for (const key of entries.keys()) keys.push(`${section}.${key}`)
  return keys.sort()
}

/** 取出文本里所有 `${section.key}` 引用。 */
export function placeholderRefs(text: string): string[] {
  return [...text.matchAll(/\$\{([A-Za-z][A-Za-z0-9]*)\.([A-Za-z][A-Za-z0-9]*)\}/gu)].map(match => `${match[1]}.${match[2]}`)
}

async function readLocaleFile(path: string): Promise<LocaleFile> {
  return parseLocaleFile(await readFile(path, 'utf8'))
}

/** 比较与基准键集合的差异。 */
function diffKeys(base: string[], other: string[]): { missing: string[]; extra: string[] } {
  const baseSet = new Set(base)
  const otherSet = new Set(other)
  return {
    missing: base.filter(key => !otherSet.has(key)),
    extra: other.filter(key => !baseSet.has(key)),
  }
}

export interface I18nCheckResult {
  readonly locales: number
  readonly keys: number
  readonly plugins: number
}

/**
 * 校验应用包与插件的多语言资源，失败时抛出带具体文件与键名的错误。
 */
export async function checkI18n(): Promise<I18nCheckResult> {
  const appDirectory = join(repositoryRoot, 'apps', APP_NAME)
  const i18nDirectory = join(appDirectory, 'i18n')
  const problems: string[] = []

  // 1. 语言文件齐全，且 section 与 key 完全一致（以 en-US 为基准）。
  const files = new Map<string, LocaleFile>()
  for (const locale of APP_LOCALES) {
    const path = join(i18nDirectory, locale)
    if (!existsSync(path)) {
      problems.push(`缺少语言文件：apps/${APP_NAME}/i18n/${locale}`)
      continue
    }
    try {
      files.set(locale, await readLocaleFile(path))
    } catch (error) {
      problems.push(`apps/${APP_NAME}/i18n/${locale}：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const base = files.get('en-US')
  const baseKeys = base === undefined ? [] : localeKeys(base)
  if (base !== undefined) {
    for (const [locale, file] of files) {
      if (locale === 'en-US') continue
      const { missing, extra } = diffKeys(baseKeys, localeKeys(file))
      if (missing.length > 0) problems.push(`i18n/${locale} 缺少 ${missing.length} 个键：${missing.join('、')}`)
      if (extra.length > 0) problems.push(`i18n/${locale} 多出 ${extra.length} 个键：${extra.join('、')}`)
    }
  }

  // 2. 引用处写到的每个占位符，都要在每份语言文件里存在。
  const referenced = new Set<string>()
  for (const relative of PLACEHOLDER_SOURCES) {
    const path = join(appDirectory, relative)
    if (!existsSync(path)) {
      problems.push(`缺少本地化引用源：apps/${APP_NAME}/${relative}`)
      continue
    }
    for (const key of placeholderRefs(await readFile(path, 'utf8'))) referenced.add(key)
  }
  for (const [locale, file] of files) {
    const keys = new Set(localeKeys(file))
    const missing = [...referenced].filter(key => !keys.has(key)).sort()
    if (missing.length > 0) problems.push(`i18n/${locale} 缺少被引用的键：${missing.join('、')}`)
  }

  // 3. 每个随包插件都要有新增语言的字典文件。
  const pluginsDirectory = join(repositoryRoot, 'plugins')
  let pluginCount = 0
  for (const entry of await readdir(pluginsDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const clientDirectory = join(pluginsDirectory, entry.name, 'src', 'client')
    if (!existsSync(join(clientDirectory, 'locales.ts'))) continue
    pluginCount += 1
    for (const locale of PLUGIN_LOCALES) {
      const dictionary = join(clientDirectory, `locales.${locale}.ts`)
      if (!existsSync(dictionary)) {
        problems.push(`缺少字典：plugins/${entry.name}/src/client/locales.${locale}.ts`)
        continue
      }
      const source = await readFile(dictionary, 'utf8')
      if (!new RegExp(`export const ${locale}\\b`, 'u').test(source)) {
        problems.push(`plugins/${entry.name}/src/client/locales.${locale}.ts：未导出 const ${locale}`)
      }
      if (!/\[Key in [A-Za-z]+LocaleKey\]/u.test(source)) {
        problems.push(`plugins/${entry.name}/src/client/locales.${locale}.ts：缺少 { [Key in …LocaleKey]: string } 类型约束`)
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(`多语言资源校验失败（${problems.length} 项）：\n  - ${problems.join('\n  - ')}`)
  }
  return { locales: files.size, keys: baseKeys.length, plugins: pluginCount }
}

/** CLI 入口：打印结果并保持与其它检查一致的输出形态。 */
export async function runCheckI18n(): Promise<void> {
  const result = await checkI18n()
  console.log(`i18n check passed: ${result.locales} locale(s) × ${result.keys} key(s), ${result.plugins} plugin(s)`)
}
