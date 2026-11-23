/**
 * 「已安装的插件」的版本与更新检测。
 *
 * ## 兼容性优先
 *
 * **版本不一致不等于有更新**。插件声明 `engines.dsh`（或 dsh peer 依赖）要求某个
 * DSH 基线；若它与当前运行版本不匹配，那个「更新」装上去根本起不来。因此每次比较
 * 前先过一遍官方判据——直接复用 `@deepseek-ai/dsh-app-boot` 的
 * `evaluatePluginCompatibility` 与 `getDshRuntimeVersion`（插件市场也是这么做的），
 * 而不是自己再写一套 semver 规则。不兼容的不提示更新，只在界面上说明原因。
 *
 * ## 更新来源
 *
 * 查 npm registry 的**完整版本清单**，取「适配当前 DSH 基线的最高版本」。
 *
 * 不再看 `dist-tags`：本仓库的发布策略是只发 `next`，`latest` 因此长期停在旧版
 * （实测 `@tnnevol/dsh-opencode` 的 latest 是 8.1.3，而 registry 上已有 8.1.148），
 * 装老版本的用户于是被判定成「已是最新」。
 *
 * 不查插件索引：索引可以有很多份（用户可加），而「这个包能装哪些版本」只有一个
 * 权威答案。代价是需要联网，读不到时如实降级。
 *
 * @module dsh-fnos/plugin-updates
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { evaluatePluginCompatibility, getDshRuntimeVersion } from '@deepseek-ai/dsh-app-boot'
import { gt, valid } from 'semver'
import type { InstalledPlugin } from '../contracts/gateway-proxy-contract.ts'

/** npm registry 查询超时（毫秒）。 */
const REGISTRY_TIMEOUT_MS = 8000

/** 一条更新检测结果。 */
export interface PluginUpdate {
  /** 包名。 */
  readonly name: string
  /** 当前安装版本。 */
  readonly installedVersion: string
  /** registry 上的最新版本；查不到时缺省。 */
  readonly latestVersion?: string
  /** 是否有可装的更新。 */
  readonly updateAvailable: boolean
  /**
   * 本地版本高于 registry 最新版。
   *
   * 开发/内测环境常见。界面据此显示「本地版本」而不是「已是最新」——后者会误导
   * 用户以为这就是发布版。
   */
  readonly aheadOfRegistry: boolean
  /**
   * 与当前 DSH 基线不兼容时为 true。
   *
   * 不兼容的**不提示更新**——装上去起不来比「没更新」更糟。
   */
  readonly incompatible: boolean
  /** 不兼容的具体要求（`engines.dsh` 或 dsh peer 名 → 范围）。 */
  readonly requirements?: Record<string, string>
  /** 读包或查 registry 失败时的原因。 */
  readonly error?: string
}

/**
 * 读一个已安装包的完整 `package.json`。
 * @param profile - profile 目录。
 * @param name - 包名。
 * @returns 清单；读不到时 undefined。
 */
async function readManifest(profile: string, name: string): Promise<Record<string, unknown> | undefined> {
  try {
    const text = await readFile(join(profile, 'node_modules', ...name.split('/'), 'package.json'), 'utf8')
    const value: unknown = JSON.parse(text)
    return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

/**
 * 从 registry 上挑出**适配当前 DSH 版本的最高版本**。
 *
 * ## 为什么不再看 dist-tag
 *
 * 之前只读 `dist-tags.latest`。这个仓库的发布策略是**只发 `next`**，`latest`
 * 因此长期停在旧版——实测 `@tnnevol/dsh-opencode` 的 `latest` 是 8.1.3，而
 * registry 上已有 8.1.148。于是装 8.1.3 的用户被判定成「已是最新」，而真正
 * 能装的新版本就挂在那里。
 *
 * ## 判据
 *
 * 1. **跳过预发布**：`-alpha`/`-beta`/`-rc` 不进候选。稳定用户不该被悄悄推到
 *    预发布线；仓库自己的版本号（如 `0.2.0-rc.2.4`）本身带后缀，这里按 semver
 *    的 prerelease 字段判断，而不是匹配字符串。
 * 2. **按当前 DSH 基线筛**：每个候选版本读它的 `engines.dsh` / dsh peer，用
 *    与宿主相同的 `evaluatePluginCompatibility` 判定。装上去起不来的版本不能
 *    提示更新——那比「没更新」更糟。
 * 3. **取最高的**：候选里用 `semver` 排序取最大值，不依赖 registry 的返回顺序。
 *
 * registry 的完整包文档比 `/latest` 大得多（含所有版本与 README），因此这里
 * 用 `accept: abbreviated` 让 registry 返回精简元数据。
 *
 * @param name - 包名。
 * @param dshVersion - 当前 DSH 运行版本。
 * @returns 适配的最高版本；查不到或没有适配版本时 undefined。
 */
async function fetchHighestCompatible(name: string, dshVersion: string): Promise<string | undefined> {
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, REGISTRY_TIMEOUT_MS)
  try {
    const response = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2F')}`, {
      signal: controller.signal,
      headers: {
        // 精简格式：只要版本清单与各自的 engines/peer，不要 README 等大字段。
        accept: 'application/vnd.npm.install-v1+json',
      },
    })
    if (!response.ok) return undefined
    const value = await response.json() as { versions?: Record<string, unknown> }
    const versions = value.versions
    if (versions === undefined) return undefined

    let best: string | undefined
    for (const [version, manifest] of Object.entries(versions)) {
      // 只认合法版本；预发布（含 -rc/-beta/-alpha）一律不提示。
      const normalized = valid(version)
      if (normalized === null) continue
      if (normalized.includes('-')) continue

      // 与宿主同一套兼容性判定；清单异常时当作不适配，跳过这个版本。
      try {
        const issue = evaluatePluginCompatibility(
          typeof manifest === 'object' && manifest !== null ? manifest as Record<string, unknown> : {},
          undefined,
          dshVersion,
        )
        if (issue !== undefined) continue
      } catch {
        continue
      }
      if (best === undefined || gt(normalized, best)) best = normalized
    }
    return best
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 判断本地版本是否**高于** registry 上的最新版。
 *
 * 这在开发/内测环境很常见（本地装着 8.1.148，而 npm 上还停在 8.1.3）。此时
 * 「没有更新」是对的，但**不能显示成「已是最新」**——那会让用户以为自己的版本
 * 就是发布版。界面需要单独标明「本地版本高于 registry」。
 *
 * @param installed - 已装版本。
 * @param latest - registry 最新版本。
 * @returns 本地是否更新。
 */
export function isAheadOfRegistry(installed: string, latest: string): boolean {
  return isNewerVersion(latest, installed)
}

/**
 * 比较两个语义化版本，判断 `latest` 是否严格高于 `installed`。
 *
 * ## 为什么用 `semver` 而不是自己写
 *
 * 这里曾手写三段式解析加预发布比较，理由是「不新增依赖」。但版本比较是个**规格
 * 问题**，不是几行 if 能覆盖的：`8.1.3` vs `8.1.148` 要按数字比（按字符串比会得出
 * 相反结论）、`1.0.0-alpha` 与 `1.0.0-alpha.1` 段数不同、数字标识符优先级低于字母
 * 标识符、构建元数据 `+build` 不参与排序……任何一条漏掉都会把「有更新」判成
 * 「已是最新」，而这类错误在界面上只表现为一句错话，极难被发现。
 *
 * `semver` 是 npm 自己用的实现，`@deepseek-ai/dsh-app-boot` 与插件市场也都依赖它；
 * 用它可以保证与宿主、与 registry 的判定**完全一致**。非法版本先过 `valid()`：
 * 手写解析会把 `latest` 之类的字符串读成 NaN 段并静默返回 false。
 *
 * @param installed - 已装版本。
 * @param latest - registry 最新版本。
 * @returns 是否有更新。
 */
export function isNewerVersion(installed: string, latest: string): boolean {
  const left = valid(installed.trim())
  const right = valid(latest.trim())
  // 任一侧不是合法 semver（如 `latest`、`workspace:*`）时不判为「有更新」。
  if (left === null || right === null) return false
  return gt(right, left)
}

/**
 * 检测一个插件的更新情况。
 * @param profile - profile 目录。
 * @param plugin - 已安装插件条目。
 * @returns 检测结果。
 */
export async function checkPluginUpdate(profile: string, plugin: InstalledPlugin): Promise<PluginUpdate> {
  const manifest = await readManifest(profile, plugin.name)
  if (manifest === undefined) {
    return { name: plugin.name, installedVersion: plugin.version, updateAvailable: false, aheadOfRegistry: false, incompatible: false, error: 'manifest-unreadable' }
  }

  // 先判兼容性：不兼容的插件连「更新有没有」都不必问。
  let incompatible = false
  let requirements: Record<string, string> | undefined
  try {
    const issue = evaluatePluginCompatibility(manifest, undefined, getDshRuntimeVersion())
    if (issue !== undefined) {
      incompatible = true
      requirements = issue.requirements
    }
  } catch {
    // 清单里的 engines/peer 格式异常：当成未知，不阻断更新检测。
  }

  // 按「适配当前 DSH 的最高版本」判定，而不是看 dist-tag——本仓库只发 next，
  // latest 长期滞后，会让装老版本的用户看不到真正能装的新版本。
  const dshVersion = getDshRuntimeVersion()
  const latestVersion = await fetchHighestCompatible(plugin.name, dshVersion)
  return {
    name: plugin.name,
    installedVersion: plugin.version,
    ...(latestVersion === undefined ? {} : { latestVersion }),
    // 不兼容时不提示更新：装上去起不来比「没更新」更糟。
    updateAvailable: !incompatible && latestVersion !== undefined && isNewerVersion(plugin.version, latestVersion),
    aheadOfRegistry: latestVersion !== undefined && isAheadOfRegistry(plugin.version, latestVersion),
    incompatible,
    ...(requirements === undefined ? {} : { requirements }),
    ...(latestVersion === undefined ? { error: 'registry-unreachable' } : {}),
  }
}

/**
 * 批量检测（限并发，避免一次打十几个请求）。
 * @param profile - profile 目录。
 * @param plugins - 已安装插件。
 * @returns 检测结果，按包名排序。
 */
export async function checkAllPluginUpdates(profile: string, plugins: readonly InstalledPlugin[]): Promise<PluginUpdate[]> {
  const CONCURRENCY = 4
  const out: PluginUpdate[] = []
  for (let i = 0; i < plugins.length; i += CONCURRENCY) {
    const batch = plugins.slice(i, i + CONCURRENCY)
    out.push(...await Promise.all(batch.map(plugin => checkPluginUpdate(profile, plugin))))
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}


/**
 * 批量检测，**每查完一组就回调一次**。
 *
 * 与 {@link checkAllPluginUpdates} 的区别：那个等全部查完才返回，界面上十几个
 * 插件要一起等最慢的那个；这里每凑够一批就交出去，前端可以逐个更新卡片。
 *
 * ## 为什么分批而不是全并发
 *
 * 每个插件一次 registry 请求。十几个同时打过去既容易被限流，也会把首屏挤满。
 * 四路一批是「足够快」与「不惊动 registry」之间的折中。
 *
 * @param profile - profile 目录。
 * @param plugins - 已安装插件。
 * @param onBatch - 每批完成时回调；参数是这一批的结果。
 * @param concurrency - 每批并发数，默认 4。
 */
export async function streamPluginUpdates(
  profile: string,
  plugins: readonly InstalledPlugin[],
  onBatch: (batch: PluginUpdate[]) => void,
  concurrency = 4,
): Promise<void> {
  for (let i = 0; i < plugins.length; i += concurrency) {
    const batch = plugins.slice(i, i + concurrency)
    onBatch(await Promise.all(batch.map(plugin => checkPluginUpdate(profile, plugin))))
  }
}
