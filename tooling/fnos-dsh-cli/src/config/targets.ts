import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { repositoryRoot } from './paths.js'

export type PluginTarget = {
  /** 稳定别名，用于 --plugin 参数与多选值。 */
  value: string
  /** 展示名称，优先使用包内的 displayName。 */
  label: string
  /** 完整 npm 包名，例如 @tnnevol/dsh-codex-auth。 */
  name: string
  /** Turbo filter，包含依赖图。 */
  filter: string
  /** 相对仓库根目录的 package.json 路径。 */
  path: string
  /** 包名最后一段，用于插件选择和发布提交消息。 */
  slug: string
  /**
   * 是否只在本机维护：源码不由 git 追踪、不进仓库文档，但照常参与本地构建、
   * 本地 profile、版本维护与 npm 发布。
   */
  localOnly: boolean
}

type PluginManifest = {
  name?: unknown
  displayName?: unknown
}

// 仅保留历史 CLI 简称，避免破坏既有 `--plugin codex` / `--plugin showcase` 用法。
// 插件列表本身完全由 plugins/ 目录动态发现，新增插件无需在此登记。
const LEGACY_ALIASES: Record<string, string> = {
  '@tnnevol/dsh-codex-auth': 'codex',
  '@tnnevol/dsh-semi-ui-showcase': 'showcase',
}

/**
 * 只在本机维护的插件目录。
 *
 * 这些插件的源码**不由 git 追踪**（目录被 `.gitignore` 忽略），也不出现在仓库文档与
 * 插件市场索引里，但它们仍是正常的插件：可以本地构建、进本地 profile、跟随项目的
 * 版本迭代号，并**照常发布到 npm**。
 *
 * 之所以要显式登记，而不是「目录被忽略了自然就消失」：插件列表是按 `plugins/` 目录
 * **动态发现**的，目录还在磁盘上就仍会被一切链路看见。要让它们真正留在本机，需要在
 * 两处区别对待：
 *
 * - **版本提交**必须跳过它们的路径——`git add` 遇到被忽略的路径会直接以退出码 1
 *   失败，把整个版本命令打断；
 * - **批量发布**（`publish --all`）默认跳过它们——批量发布面向的是随仓库一起发布的
 *   那批插件，本机专属插件应由人显式指定发布，不该在一次例行发版里被顺带推上去。
 *
 * 其余链路（本地构建、本地 profile、版本号迭代、显式发布）一律与普通插件一致。
 */
const LOCAL_ONLY_PLUGIN_DIRECTORIES = new Set([
  // CodeBuddy：2026-10-22 起按「不入仓库、不入文档、可发 npm」的约定在本机维护。
  'dsh-codebuddy-plugin',
])

const pluginsDirectory = join(repositoryRoot, 'plugins')

function deriveAlias(slug: string): string {
  return slug.replace(/^dsh-/, '')
}

function readPluginTarget(directoryName: string): PluginTarget | undefined {
  const packagePath = join(pluginsDirectory, directoryName, 'package.json')
  let manifest: PluginManifest
  try {
    manifest = JSON.parse(readFileSync(packagePath, 'utf8')) as PluginManifest
  } catch {
    return undefined
  }
  if (typeof manifest.name !== 'string' || manifest.name.length === 0) return undefined

  const slug = manifest.name.split('/').pop() ?? manifest.name
  const alias = deriveAlias(slug)
  return {
    value: LEGACY_ALIASES[manifest.name] ?? alias,
    label: typeof manifest.displayName === 'string' && manifest.displayName.length > 0
      ? manifest.displayName
      : alias,
    name: manifest.name,
    filter: `${manifest.name}...`,
    path: `plugins/${directoryName}/package.json`,
    slug,
    localOnly: LOCAL_ONLY_PLUGIN_DIRECTORIES.has(directoryName),
  }
}

function readPluginTargets(): PluginTarget[] {
  let entries
  try {
    entries = readdirSync(pluginsDirectory, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter(entry => entry.isDirectory())
    .map(entry => readPluginTarget(entry.name))
    .filter((target): target is PluginTarget => target !== undefined)
}

export const pluginTargets: PluginTarget[] = readPluginTargets()

export function findPluginTarget(alias: string | undefined): PluginTarget | undefined {
  if (alias === undefined) return undefined
  return pluginTargets.find(target =>
    target.value === alias || target.slug === alias || target.name === alias,
  )
}
