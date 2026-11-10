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
 * 查 npm registry 的 latest 版本。
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
 * 比较两个语义化版本，判断 `latest` 是否严格高于 `installed`。
 *
 * 不引入 semver 依赖：这里只需三段式数字比较，且两边都可能带预发布后缀。
 * 预发布版本一律视为「不算更新」——把 8.2.0-beta 提示成更新会让稳定用户莫名升级。
 * @param installed - 已装版本。
 * @param latest - registry 最新版本。
 * @returns 是否有更新。
 */
export function isNewerVersion(installed: string, latest: string): boolean {
  const parse = (value: string): number[] | undefined => {
    const core = value.split('-')[0] ?? ''
    const parts = core.split('.').map(part => Number.parseInt(part, 10))
    if (parts.length < 3 || parts.some(part => !Number.isFinite(part))) return undefined
    return parts
  }
  // 预发布不提示：用户装的是稳定版，不该被诱导到 beta。
  if (latest.includes('-')) return false
  const a = parse(installed)
  const b = parse(latest)
  if (a === undefined || b === undefined) return false
  for (let i = 0; i < 3; i += 1) {
    const left = a[i] ?? 0
    const right = b[i] ?? 0
    if (right > left) return true
    if (right < left) return false
  }
  return false
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
    return { name: plugin.name, installedVersion: plugin.version, updateAvailable: false, incompatible: false, error: 'manifest-unreadable' }
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
