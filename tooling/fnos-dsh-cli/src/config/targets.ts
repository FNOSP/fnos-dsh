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
 * 已下架插件的目录名。
 *
 * 这些插件的源码仍留在本机（供查阅历史实现、以备日后恢复），但它们**已不属于本
 * 仓库的工作范围**：不再由 git 追踪、不再随 FPK 内置、不再发布到 npm，也不再
 * 出现在文档站。
 *
 * 之所以必须显式排除，而不是「目录没了自然就消失」：插件列表是按 `plugins/` 目录
 * **动态发现**的，而下架只解除了 git 追踪，源码仍在磁盘上。目录还在，它就会继续
 * 被 `pnpm run version` 一起升版本（紧接着 `git add` 一个被 gitignore 的路径直接
 * 失败）、被 `pnpm run publish --all` 发到 npm、被构建与发布的插件选择列表选中。
 * 「下架」因此是一条必须写下来的规则，不是「把文件挪走」的自然结果。
 */
const DELISTED_PLUGIN_DIRECTORIES = new Set([
  // CodeBuddy：2026-10-22 因上游对非官方客户端通道收紧拦截而停止维护并下架，
  // 见 FNOS-025。源码保留在本机，不参与版本维护、发布与打包。
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
    .filter(entry => !DELISTED_PLUGIN_DIRECTORIES.has(entry.name))
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
