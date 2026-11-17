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
 * 查 npm registry 的 `dist-tags.latest`。不查插件索引：索引可以有很多份（用户可加），
 * 而「这个包的最新版」只有一个权威答案。代价是需要联网，读不到时如实降级。
 *
 * @module dsh-fnos/plugin-updates
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { evaluatePluginCompatibility, getDshRuntimeVersion } from '@deepseek-ai/dsh-app-boot'
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
 * 查 npm registry 的 `dist-tags.latest`。
 *
 * **只认 `latest`，不认 `beta`/`dev`**：这两个 tag 指向的是预发布线，提示给稳定
 * 用户会把他们从稳定版推到 beta（fork 的 `newerVersions` 也把预发布单列、默认
 * 不当作可升级目标）。
 *
 * @param name - 包名。
 * @returns 版本号；查不到时 undefined（不抛错，更新检测失败不该让整页报错）。
 */
async function fetchLatest(name: string): Promise<string | undefined> {
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, REGISTRY_TIMEOUT_MS)
  try {
    const response = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2F')}/latest`, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    })
    if (!response.ok) return undefined
    const value = await response.json() as { version?: unknown }
    return typeof value.version === 'string' ? value.version : undefined
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 判断本地版本是否**高于** registry 上的最新版。
 *
 * 这在开发/内测环境很常见（本地装着 8.1.57，而 npm 上还停在 8.1.1）。此时
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
 * 与 fork 的 `newerVersions` 同判据：用 `semver.valid` 过滤非法版本、用
 * `semver.gt` 严格比较，**预发布按 semver 规则参与比较**。
 *
 * 这里只用 `semver` 的核心两个函数，不自己写三段式解析——`1.73.10` 与
 * `1.73.9` 这类按字符串比会得出相反结果，而带预发布后缀时手写规则更容易出错。
 *
 * @param installed - 已装版本。
 * @param latest - registry 最新版本。
 * @returns 是否有更新。
 */
export function isNewerVersion(installed: string, latest: string): boolean {
  const a = parseVersion(installed)
  const b = parseVersion(latest)
  if (a === undefined || b === undefined) return false

  // 主次修订逐段比数字：1.73.10 > 1.73.9（按字符串比会得出相反结论）。
  for (let i = 0; i < 3; i += 1) {
    const left = a.numbers[i] ?? 0
    const right = b.numbers[i] ?? 0
    if (right > left) return true
    if (right < left) return false
  }

  /*
    主版本相同：按 semver 规则**预发布低于正式版**。

    - `1.73.20` vs `1.73.15`：两段都没有预发布，前面已判相等 → 不是更新；
    - `1.74.0-beta.1` vs `1.73.20`：主版本更大，前面已返回 true；
    - `1.73.20-beta.1` vs `1.73.20`：同为 1.73.20，正式版更高 → 不是更新；
    - `1.73.20` vs `1.73.20-beta.1`：装的是 beta、registry 上是正式版 → 是更新。

    与 fork `newerVersions` 用 `semver.gt` 的结论一致；这里手写是为了不新增依赖。
  */
  const leftPre = a.prerelease
  const rightPre = b.prerelease
  if (rightPre === undefined && leftPre !== undefined) return true
  if (rightPre !== undefined && leftPre === undefined) return false
  if (rightPre === undefined && leftPre === undefined) return false
  return comparePrerelease(leftPre!, rightPre!) > 0
}

/** 解析后的版本：三段数字 + 可选预发布分段。 */
interface ParsedVersion {
  readonly numbers: readonly number[]
  readonly prerelease?: readonly (string | number)[]
}

/**
 * 解析 `major.minor.patch[-prerelease]`。
 * @param value - 版本字符串。
 * @returns 解析结果；格式不合法时 undefined。
 */
function parseVersion(value: string): ParsedVersion | undefined {
  const [core, ...rest] = value.trim().split('-')
  const numbers = (core ?? '').split('.').map(part => Number.parseInt(part, 10))
  if (numbers.length < 3 || numbers.slice(0, 3).some(part => !Number.isFinite(part))) return undefined
  if (rest.length === 0) return { numbers: numbers.slice(0, 3) }
  const identifiers = rest.join('-').split('.').map(part => (/^\d+$/u.test(part) ? Number.parseInt(part, 10) : part))
  return { numbers: numbers.slice(0, 3), prerelease: identifiers }
}

/**
 * 比较两个预发布段（semver 第 11 条优先级规则）。
 * @param left - 左侧标识符列表。
 * @param right - 右侧标识符列表。
 * @returns 负数/0/正数，分别表示左小于/等于/大于。
 */
function comparePrerelease(left: readonly (string | number)[], right: readonly (string | number)[]): number {
  const max = Math.max(left.length, right.length)
  for (let i = 0; i < max; i += 1) {
    const a = left[i]
    const b = right[i]
    // 段数少的一方优先级更低（1.0.0-alpha < 1.0.0-alpha.1）。
    if (a === undefined) return -1
    if (b === undefined) return 1
    if (typeof a === 'number' && typeof b === 'number') {
      if (a !== b) return a - b
      continue
    }
    // 数字标识符优先级低于字母标识符。
    if (typeof a === 'number') return -1
    if (typeof b === 'number') return 1
    if (a !== b) return a < b ? -1 : 1
  }
  return 0
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

  const latestVersion = await fetchLatest(plugin.name)
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
