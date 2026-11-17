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

/**
 * **常驻名单一：不可卸载的内置插件。**
 *
 * `@tnnevol/dsh-fnos` 是 fnOS 能力与 DSH 之间的桥。它一旦被卸载，授权目录、
 * 文件打开、网关反代、进程管理全部失效——而「装回来」这个动作正是它自己提供的，
 * 用户没有别的入口（只能重装整个应用）。
 *
 * 所以这一项**永远出现、排在最前、且不给卸载入口**；未安装时只给「安装」。
 * 注意它与 `bundled` 不是一个概念：`bundled` 指「随 FPK 打包」，这里是「业务上
 * 不许卸载」，两者恰好重叠在本插件上，但判据独立。
 */
const BUILTIN_UNINSTALLABLE: readonly string[] = ['@tnnevol/dsh-fnos']

/**
 * **常驻名单二：推荐插件。**
 *
 * `dshmarket` 是插件市场的入口，用户可能自己卸掉它，那是合理选择——所以它**可以
 * 卸载**。但卸载后卡片不能跟着消失，否则用户找不到再装回来的地方。
 *
 * 与名单一的区别只有一点：这里**保留卸载入口**，未安装时给「安装」。
 */
const RECOMMENDED_PLUGINS: readonly string[] = ['dshmarket']

/**
 * 全部常驻项（两份名单合并）。
 *
 * 常驻 = 卡片不随卸载消失、并排在最前。其余插件保持原规则：卸了就从列表里消失。
 */
const PINNED_PLUGIN_NAMES: readonly string[] = [...BUILTIN_UNINSTALLABLE, ...RECOMMENDED_PLUGINS]

/** 常驻插件的兜底展示信息（未安装、读不到 manifest 时用） */
const PINNED_PLUGIN_FALLBACK: Readonly<Record<string, { title: string, description: string }>> = {
  '@tnnevol/dsh-fnos': {
    title: 'fnOS',
    description: '在飞牛 fnOS 中提供主题跟随、授权目录管理、NAS 文件访问与会话日志导出。',
  },
  dshmarket: {
    title: 'dshmarket',
    description: 'DSH 插件市场：浏览并安装社区插件。',
  },
}

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
 * 描述里中英文并列时**优先取中文**。
 *
 * 现实中很常见的写法是英文在前、`·` 或 `-` 分隔、中文在后：
 *
 * ```
 * Visual plugin market inside DeepSeek Harness — browse… · DSH 可视化插件市场：逛一逛，点一下，装好。
 * ```
 *
 * 界面语言是中文时，把英文那段显示出来对用户没有帮助。规则很保守：
 * 只在确实存在连续中文片段时取那一段，否则原样返回——不去猜也不去翻译。
 *
 * @param text - `package.json` 的 `description`。
 * @returns 中文片段（若存在），否则原文。
 */
export function preferChinese(text: string): string {
  // 连续中文（含全角标点）至少 4 字才算「一段中文描述」，避免只匹配到零星符号。
  const matches = text.match(/[\u4E00-\u9FA5][\u4E00-\u9FA5\uFF00-\uFFEF\s。、「」『』—·…]*/gu)
  if (matches === null) return text
  const best = matches
    .map(item => item.trim())
    .filter(item => item.length >= 4)
    .sort((a, b) => b.length - a.length)[0]
  return best === undefined ? text : best
}

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
  let description: string | undefined
  let title: string | undefined
  let icon: string | undefined
  try {
    const packageDirectory = join(profile, 'node_modules', ...name.split('/'))
    const text = await readFile(join(packageDirectory, 'package.json'), 'utf8')
    const manifest = JSON.parse(text) as {
      version?: unknown, main?: unknown, exports?: unknown, repository?: unknown, description?: unknown, icon?: unknown
    }
    if (typeof manifest.version === 'string') version = manifest.version
    repository = normalizeRepository(manifest.repository)
    /*
      只取 `description`（官方 `plugin-manager` 的 `INSPECT_FIELDS` 也是这个字段）。
      空串按「没有」处理——空描述与缺描述在界面上都该什么都不显示。
    */
    if (typeof manifest.description === 'string' && manifest.description.trim() !== '') {
      description = preferChinese(manifest.description.trim())
    }
    if (typeof manifest.icon === 'string' && manifest.icon.trim() !== '') icon = manifest.icon.trim()
    /*
      **优先用包自带的展示元信息**（`locale/zh.json` 的 `meta`）。

      与官方 `readPluginMeta` 同源：`title` 来自 `meta.title`、`description` 来自
      `meta.description`。包作者写在这里的中文名（如「插件市场」）比包名末段可读
      得多，而 `package.json` 的 `description` 常是中英混排的长句。
    */
    try {
      const locale = JSON.parse(await readFile(join(packageDirectory, 'locale', 'zh.json'), 'utf8')) as {
        meta?: { title?: unknown, description?: unknown }
      }
      if (typeof locale.meta?.title === 'string' && locale.meta.title.trim() !== '') title = locale.meta.title.trim()
      if (typeof locale.meta?.description === 'string' && locale.meta.description.trim() !== '') {
        description = locale.meta.description.trim()
      }
    } catch {
      // 没有 locale/zh.json 就退回 package.json 的描述，这是常态。
    }
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
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description }),
    ...(icon === undefined ? {} : { icon }),
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

  const installedNames = [...new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ])]

  /*
    **常驻插件即使没装也要进列表。**

    它们被强制卸载后如果卡片跟着消失，用户就再也找不到「装回来」的入口。
    这里的合并顺序保证常驻项排在最前，界面不必再排序。
  */
  const names = [
    ...PINNED_PLUGIN_NAMES.filter(name => installedNames.includes(name)),
    ...installedNames.filter(name => !(PINNED_PLUGIN_NAMES as readonly string[]).includes(name)).sort(),
  ]

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
    **未安装的常驻插件：造一个占位条目。**

    `absent: true` 告诉界面「这个包现在不在 profile 里」——渲染成「安装」按钮，
    而不是卸载 + 开关。展示信息优先取兜底表（读不到包就没有 manifest 可读）。
  */
  const absentPinned: InstalledPlugin[] = PINNED_PLUGIN_NAMES
    .filter(name => !installedNames.includes(name))
    .map(name => ({
      name,
      version: '—',
      hasClient: true,
      bundled: false,
      enabled: false,
      pinned: true,
      absent: true,
      uninstallable: !BUILTIN_UNINSTALLABLE.includes(name),
      title: PINNED_PLUGIN_FALLBACK[name]?.title,
      description: PINNED_PLUGIN_FALLBACK[name]?.description,
    } as InstalledPlugin))

  /*
    **只做排序与「能不能卸载」两件事，不在界面上分模块。**

    常驻项排最前，其余保持原顺序；`uninstallable` 由名单决定，界面只看这个布尔值
    决定要不要给卸载入口——不需要知道有哪些名单、也不需要分节渲染。
  */
  const withPinned = [
    ...PINNED_PLUGIN_NAMES
      .filter(name => base.some(plugin => plugin.name === name))
      .flatMap(name => {
        const plugin = base.find(item => item.name === name)
        if (plugin === undefined) return []
        return [{
          ...plugin,
          pinned: true,
          uninstallable: !BUILTIN_UNINSTALLABLE.includes(name),
        }]
      }),
    ...absentPinned,
  ]
  // 常驻在前，其余按原顺序（`names` 已排好序）。
  const ordered = [
    ...withPinned,
    ...base.filter(plugin => !(PINNED_PLUGIN_NAMES as readonly string[]).includes(plugin.name)),
  ]

  /*
    启用状态有**两条**判据，与官方的 bundle/entry 分工一致：

    1. **bundle 型插件**（`package.json` 有 `dsh.bundle.patch`）：看它是否在
       profile 的 `dsh.profile.bundles` 数组里。装了但没选进 bundles = 未启用。
    2. 普通插件：看 patch 里是否全部条目都 `disabled: true`。

    真机踩到：`dsh-plugin-wallpaper-engine` 在 dependencies 里、但**不在 bundles**
    数组里（即未启用），早前只查 patch 就把它显示成了「启用」。
  */
  const withEnabled = await Promise.all(ordered.map(async plugin => {
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
