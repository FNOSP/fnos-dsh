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
import { checkAllPluginUpdates } from './plugin-updates.ts'
import { readPackageEntries } from './plugin-toggle.ts'

/** profile `package.json` 里关心的字段。 */
interface ProfileManifest {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

/**
 * 判断一个包是否为 bundle（`dsh.bundle.patch` 存在，与官方 `bundleManifest` 同判据）。
 * @param profile - profile 目录。
 * @param name - 包名。
 * @returns 是否 bundle。
 */
async function isBundlePackage(profile: string | undefined, name: string): Promise<boolean> {
  if (profile === undefined) return false
  try {
    const manifest = JSON.parse(await readFile(join(profile, 'node_modules', ...name.split('/'), 'package.json'), 'utf8')) as {
      dsh?: { bundle?: { patch?: unknown } }
    }
    return typeof manifest.dsh?.bundle?.patch === 'string'
  } catch {
    return false
  }
}

/**
 * 读 profile 选中的 bundle 列表。
 * @param profile - profile 目录。
 * @returns 包名列表。
 */
async function readBundleSelection(profile: string | undefined): Promise<readonly string[]> {
  if (profile === undefined) return []
  try {
    const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8')) as {
      dsh?: { profile?: { bundles?: string[] } }
    }
    return manifest.dsh?.profile?.bundles ?? []
  } catch {
    return []
  }
}

/**
 * 读一个已安装包的元信息。
 * @param profile - profile 目录。
 * @param name - 包名。
 * @param bundledNames - 内置插件名集合。
 * @returns 插件条目。
 */
/**
 * 把 `repository` 字段归一化成可点击的 http(s) URL。
 *
 * npm 生态里它有三种常见形态，都要认：
 *   - `"git+https://github.com/x/y.git"`（最常见）
 *   - `{ "type": "git", "url": "git+ssh://git@github.com/x/y.git" }`
 *   - `"github:x/y"` / `"x/y"` 之类的简写
 *
 * @param value - `package.json` 的 repository 字段。
 * @returns 可点击 URL；无法识别时 undefined（界面就不做链接，而不是给个死链）。
 */
export function normalizeRepository(value: unknown): string | undefined {
  const raw = typeof value === 'string'
    ? value
    : (typeof value === 'object' && value !== null && typeof (value as { url?: unknown }).url === 'string'
        ? (value as { url: string }).url
        : undefined)
  if (raw === undefined) return undefined

  let url = raw.trim()
  // `git+` 前缀与 `.git` 后缀对浏览器无意义，去掉更像「仓库主页」。
  url = url.replace(/^git\+/u, '').replace(/\.git$/u, '')
  if (/^https?:\/\//u.test(url)) return url
  // scp 形态 `git@github.com:x/y` → https。
  const scp = /^git@([^:]+):(.+)$/u.exec(url)
  if (scp?.[1] !== undefined && scp[2] !== undefined) return `https://${scp[1]}/${scp[2]}`
  if (/^ssh:\/\/git@/u.test(url)) return url.replace(/^ssh:\/\/git@/u, 'https://').replace(/\//u, '/')
  // `github:x/y` 简写。
  const shorthand = /^(?:github:)?([\w.-]+)\/([\w.-]+)$/u.exec(url)
  if (shorthand?.[1] !== undefined && shorthand[2] !== undefined) return `https://github.com/${shorthand[1]}/${shorthand[2]}`
  return undefined
}

async function readPlugin(profile: string, name: string, bundledNames: ReadonlySet<string>): Promise<InstalledPlugin> {
  let version = '—'
  let hasClient = false
  let repository: string | undefined
  try {
    const text = await readFile(join(profile, 'node_modules', ...name.split('/'), 'package.json'), 'utf8')
    const manifest = JSON.parse(text) as { version?: unknown, main?: unknown, exports?: unknown, repository?: unknown }
    if (typeof manifest.version === 'string') version = manifest.version
    repository = normalizeRepository(manifest.repository)
    // 「有客户端入口」的判据：声明了 main 或 exports。纯宿主插件没有，不会出现在界面里。
    hasClient = typeof manifest.main === 'string' || manifest.exports !== undefined
  } catch {
    // 装了但没落盘（或权限不足）：仍列出来，版本给 `—`，不假装它不存在。
  }
  return {
    name,
    version,
    hasClient,
    bundled: bundledNames.has(name),
    ...(repository === undefined ? {} : { repository }),
  }
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
  /** 是否检测更新（联网查 registry）；界面按需传 false 以加快首屏。 */
  checkUpdates = true,
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

  const base = await Promise.all(names.map(name => readPlugin(profileDirectory, name, bundledNames)))

  /*
    启用状态有**两条**判据，与官方的 bundle/entry 分工一致：

    1. **bundle 型插件**（`package.json` 有 `dsh.bundle.patch`）：看它是否在
       profile 的 `dsh.profile.bundles` 数组里。装了但没选进 bundles = 未启用。
    2. 普通插件：看 patch 里是否全部条目都 `disabled: true`。

    真机踩到：`dsh-plugin-wallpaper-engine` 在 dependencies 里、但**不在 bundles**
    数组里（即未启用），早前只查 patch 就把它显示成了「启用」。
  */
  const withEnabled = await Promise.all(base.map(async plugin => {
    const bundled = await isBundlePackage(profileDirectory, plugin.name)
    if (bundled) {
      const selected = await readBundleSelection(profileDirectory)
      return { ...plugin, enabled: selected.includes(plugin.name) }
    }
    const entries = await readPackageEntries(plugin.name)
    if (entries.length === 0) return plugin
    return { ...plugin, enabled: entries.some(entry => entry.enabled) }
  }))

  if (!checkUpdates) return { available: true, plugins: withEnabled }

  /*
    更新检测放在这里统一做（而不是客户端逐包查）：兼容性判据要拿 DSH 运行时版本，
    那是宿主侧才知道的东西；放客户端就得把版本号传下来，规则会漂到两处。
  */
  const updates = await checkAllPluginUpdates(profileDirectory, withEnabled)
  const byName = new Map(updates.map(update => [update.name, update]))
  const plugins = withEnabled.map(plugin => {
    const update = byName.get(plugin.name)
    if (update === undefined) return plugin
    return {
      ...plugin,
      ...(update.latestVersion === undefined ? {} : { latestVersion: update.latestVersion }),
      updateAvailable: update.updateAvailable,
      aheadOfRegistry: update.aheadOfRegistry,
      incompatible: update.incompatible,
      ...(update.requirements === undefined ? {} : { requirements: update.requirements }),
    }
  })
  return { available: true, plugins }
}
