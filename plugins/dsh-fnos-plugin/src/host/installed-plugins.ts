/**
 * 「已安装的插件」：读 profile 的 `package.json` 与 `node_modules`，列出装了哪些插件。
 *
 * ## 为什么读 package.json 而不是问 DSH
 *
 * DSH 客户端有 `dynamicCordisRunner/inventory`，但那是**面向渲染进程**的内部 RPC，
 * 字段随版本变动、也没有稳定契约。而「装了哪些包」这件事在 profile 的依赖表里
 * 本来就有——读文件是稳定的，且不会因为上游改字段而失效。
 *
 * ## 为什么区分 bundled
 *
 * 随 FPK 内置、由应用管理的插件与用户自己装的三方插件是两类：前者卸载会连带丢功能，
 * 后者可以自由装卸。界面上标出来，用户才不会把内置的当三方插件删掉。
 *
 * @module dsh-fnos/installed-plugins
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { InstalledPlugin, InstalledPluginsSnapshot } from '../contracts/gateway-proxy-contract.ts'

/** profile `package.json` 里关心的字段。 */
interface ProfileManifest {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

/**
 * 读一个已安装包的元信息。
 * @param profile - profile 目录。
 * @param name - 包名。
 * @param bundledNames - 内置插件名集合。
 * @returns 插件条目。
 */
async function readPlugin(profile: string, name: string, bundledNames: ReadonlySet<string>): Promise<InstalledPlugin> {
  let version = '—'
  let hasClient = false
  try {
    const text = await readFile(join(profile, 'node_modules', ...name.split('/'), 'package.json'), 'utf8')
    const manifest = JSON.parse(text) as { version?: unknown, main?: unknown, exports?: unknown }
    if (typeof manifest.version === 'string') version = manifest.version
    // 「有客户端入口」的判据：声明了 main 或 exports。纯宿主插件没有，不会出现在界面里。
    hasClient = typeof manifest.main === 'string' || manifest.exports !== undefined
  } catch {
    // 装了但没落盘（或权限不足）：仍列出来，版本给 `—`，不假装它不存在。
  }
  return { name, version, hasClient, bundled: bundledNames.has(name) }
}

/**
 * 列出已安装插件。
 * @param profileDirectory - profile 目录；undefined 表示当前环境没有。
 * @param bundledDirectory - 内置插件归档目录；undefined 表示没有。
 * @returns 快照。
 */
export async function readInstalledPlugins(
  profileDirectory: string | undefined,
  bundledDirectory: string | undefined,
): Promise<InstalledPluginsSnapshot> {
  if (profileDirectory === undefined) {
    return { available: false, reason: 'profile-missing', plugins: [] }
  }

  let manifest: ProfileManifest
  try {
    manifest = JSON.parse(await readFile(join(profileDirectory, 'package.json'), 'utf8')) as ProfileManifest
  } catch {
    return { available: false, reason: 'profile-package-json-unreadable', plugins: [] }
  }

  const names = [...new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ])].sort()

  // 内置插件名：读内置归档目录的文件名（`@scope/name.tgz` 的形态）。
  const bundledNames = new Set<string>()
  if (bundledDirectory !== undefined) {
    try {
      const { readdir } = await import('node:fs/promises')
      const scopes = await readdir(bundledDirectory, { withFileTypes: true })
      for (const entry of scopes) {
        if (!entry.isDirectory()) continue
        const inner = await readdir(join(bundledDirectory, entry.name))
        for (const file of inner) {
          if (file.endsWith('.tgz')) bundledNames.add(`${entry.name}/${file.slice(0, -4)}`)
        }
      }
    } catch {
      // 读不到内置目录不算失败：只是无法标注哪些是内置的。
    }
  }

  const plugins = await Promise.all(names.map(name => readPlugin(profileDirectory, name, bundledNames)))
  return { available: true, plugins }
}
