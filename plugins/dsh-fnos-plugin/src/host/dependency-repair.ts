/**
 * 「依赖修复」的宿主侧实现：定位应用环境、只读诊断、执行修复。
 *
 * ## 为什么需要这个功能
 *
 * profile 的 `minimumReleaseAgeExclude` 会随着插件换代逐步失效：条目锚在
 * `6.0.0`，而清单已经指向 `8.1.3`。pnpm 对该字段是 First-Match-Wins，锚在旧
 * 版本上的条目**不再放行任何东西**，反而锁死了围绕它构建的 lockfile；新版本
 * 于是被发布冷静期拦下，用户看到的是 `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`。
 *
 * 恢复路径本身不长（清失效条目 → 重建依赖 → 装回插件），但没有界面入口。
 * 这个模块把路径做成动作。
 *
 * ## 安全边界
 *
 * 只动两个可重建产物（`pnpm-lock.yaml`、`node_modules`）。凭据、会话、工作区
 * 与偏好位于 `DSH_HOME` 的其它路径，本模块从不触碰；删除前按 basename 校验，
 * 路径不符即失败而不是「尽力而为」。
 *
 * @module dsh-fnos/dependency-repair
 */

import { execFile } from 'node:child_process'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type {
  DependencyRepairDiagnosis,
  DependencyRepairEntry,
  DependencyRepairResult,
  DependencyRepairStep,
} from '../contracts/dependency-repair-contract.ts'

/** 一个普通 JSON 对象；只做形状判断，不引入额外依赖。 */
type JsonObject = Record<string, unknown>

/** 修复过程中调用外部命令的超时（毫秒）；重建依赖可能较慢，给足余量。 */
export const DEPENDENCY_REPAIR_COMMAND_TIMEOUT_MS = 10 * 60 * 1000

/** 诊断依赖环境时执行命令的超时（毫秒）。 */
export const DEPENDENCY_REPAIR_PROBE_TIMEOUT_MS = 20_000

/** 修复最多允许运行的输出字节，防止异常输出拖垮宿主。 */
const MAX_OUTPUT_BYTES = 1024 * 1024

/** 应用环境：修复需要的全部路径。 */
export interface DependencyRepairEnvironment {
  /** profile 目录（含 `pnpm-workspace.yaml` 与 `package.json`）。 */
  readonly profileDirectory: string
  /** 发布清单路径（决定「目标版本」）。 */
  readonly manifestPath?: string
  /** `dsh` 可执行文件（重装插件走它）。 */
  readonly dshBin?: string
  /** `pnpm` 可执行文件。 */
  readonly pnpmBin?: string
}

/**
 * 从环境变量推导修复所需路径。
 *
 * 只认应用自己声明的变量（`DSH_HOME`、`NPM_CONFIG_PREFIX`、`TRIM_APPDEST`），
 * 不做目录扫描猜测：在非 fnOS 环境里猜出来的路径可能指向别的东西，而本模块
 * 会删除文件。
 *
 * @param env - 进程环境。
 * @returns 可用的环境；`DSH_HOME` 缺失时返回 undefined（非 fnOS 宿主）。
 */
export function resolveRepairEnvironment(env: NodeJS.ProcessEnv = process.env): DependencyRepairEnvironment | undefined {
  const home = nonEmpty(env.DSH_HOME)
  if (home === undefined) return undefined
  const prefix = nonEmpty(env.NPM_CONFIG_PREFIX)
  const appDest = nonEmpty(env.TRIM_APPDEST)
  return {
    profileDirectory: join(home, 'profiles', 'web'),
    ...(appDest === undefined ? {} : { manifestPath: join(appDest, 'published-dsh-plugins.json') }),
    ...(prefix === undefined ? {} : { pnpmBin: join(prefix, 'bin', 'pnpm'), dshBin: join(prefix, 'bin', 'dsh') }),
  }
}

function nonEmpty(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length === 0 ? undefined : trimmed
}

/** 一条解析后的豁免条目。 */
interface ParsedExclusion {
  readonly name: string
  readonly range: string
  /** 该条目在文件中的原始行（用于精确删除）。 */
  readonly line: string
}

/**
 * 解析 `minimumReleaseAgeExclude` 段。
 *
 * 只在段内解析，遇到列零的非列表行即结束；注释与非法行跳过。保留原始行是为了
 * 修复时**按行精确删除**，而不是重写整个文件——重写会丢掉用户手写的注释与格式。
 *
 * @param text - `pnpm-workspace.yaml` 全文。
 * @returns 解析出的条目；没有该段时为空数组。
 */
export function parseExclusions(text: string): ParsedExclusion[] {
  const result: ParsedExclusion[] = []
  let inSection = false
  for (const line of text.split(/\r?\n/u)) {
    if (/^minimumReleaseAgeExclude:\s*$/u.test(line)) {
      inSection = true
      continue
    }
    if (!inSection) continue
    // 列零的非列表行结束该段。
    if (/^[^\s#-]/u.test(line)) break
    const matched = line.match(/^\s+-\s*(.+?)\s*$/u)
    if (matched === null) continue
    const raw = matched[1]!.replace(/^['"]|['"]$/gu, '')
    const separator = raw.lastIndexOf('@')
    if (separator <= 0) continue
    result.push({ name: raw.slice(0, separator), range: raw.slice(separator + 1), line })
  }
  return result
}

/**
 * 一个范围是否放行某个版本。
 *
 * 支持本仓库实际写过的两种形态：精确钉版（`0.1.7-rc.2`）与 `||` 联合
 * （`0.1.7-rc.2 || 0.2.0-rc.2`）。判定与 pnpm 的语义对齐：等于任一支，或某支
 * 是版本在段边界上的前缀（`0.1.7` 放行 `0.1.7-rc.2`）。
 *
 * @param range - 条目的版本范围。
 * @param version - 目标版本。
 * @returns 放行时为 true。
 */
export function rangeAdmitsVersion(range: string, version: string): boolean {
  return range.split('||').some(branch => {
    const pinned = branch.trim()
    if (pinned.length === 0) return false
    if (/^\D/u.test(pinned)) return false
    return version === pinned || version.startsWith(`${pinned}.`) || version.startsWith(`${pinned}-`)
  })
}

/**
 * 从发布清单读出「包名 → 目标版本」。
 *
 * @param manifest - 清单内容。
 * @returns 包名到版本的映射；形态不符时为空对象。
 */
export function targetVersionsFromManifest(manifest: unknown): Record<string, string> {
  const source = manifest !== null && typeof manifest === 'object' ? manifest as JsonObject : undefined
  const plugins = Array.isArray(source?.plugins) ? source.plugins : []
  const versions: Record<string, string> = {}
  for (const entry of plugins) {
    const row = entry !== null && typeof entry === 'object' ? entry as JsonObject : undefined
    const name = typeof row?.name === 'string' ? row.name : undefined
    const version = typeof row?.version === 'string' ? row.version : undefined
    if (name !== undefined && version !== undefined) versions[name] = version
  }
  return versions
}

/**
 * 判断哪些豁免条目已失效。
 *
 * 两种失效形态各自独立：
 *
 * - `pipe-union`：版本段含 `||`。即使当前版本仍被某个分支放行，这种合并写法也
 *   会让后续 `pnpm add` 解析异常，属于该清理的格式残留。
 * - `stale-version`：清单里能查到该包的目标版本，而条目范围不再放行它。
 *
 * 清单里查不到的包**不判失效**：应用不负责维护用户自己装的插件的豁免。
 *
 * @param exclusions - 解析出的条目。
 * @param targets - 包名到目标版本。
 * @returns 失效条目（保持原顺序）。
 */
export function findStaleExclusions(
  exclusions: readonly ParsedExclusion[],
  targets: Readonly<Record<string, string>>,
): DependencyRepairEntry[] {
  const stale: DependencyRepairEntry[] = []
  for (const exclusion of exclusions) {
    if (exclusion.range.includes('||')) {
      stale.push({ name: exclusion.name, range: exclusion.range, reason: 'pipe-union' })
      continue
    }
    const target = targets[exclusion.name]
    if (target === undefined) continue
    if (!rangeAdmitsVersion(exclusion.range, target)) {
      stale.push({ name: exclusion.name, range: exclusion.range, reason: 'stale-version', targetVersion: target })
    }
  }
  return stale
}

/** 读取文本；文件缺失时返回 undefined（不是错误）。 */
async function readTextIfExists(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return undefined
  }
}

/** 读取 JSON；缺失或不可解析时返回 undefined。 */
async function readJsonIfExists(path: string): Promise<unknown> {
  const text = await readTextIfExists(path)
  if (text === undefined) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** 诊断/修复的统一日志前缀，便于在 `pnpm.log` 与宿主输出里检索。 */
const LOG_PREFIX = '[dsh-fnos][dependency-repair]'

/**
 * 输出一条诊断日志。
 *
 * 这个功能会删 `node_modules` 并重装依赖，出问题时只能靠日志还原「它到底做了
 * 什么」。因此诊断的判定依据、命中的条目、每步命令与退出码都要留痕——用户报
 * 「点了没反应」时，日志能区分「没触发」「判定为健康」「命令失败」三种情况。
 */
function log(message: string): void {
  console.log(`${LOG_PREFIX} ${message}`)
}

/**
 * 只读诊断：列出失效的豁免条目。
 *
 * 不写文件、不调 pnpm——用户要先看到问题再决定是否动手。
 *
 * @param environment - 应用环境。
 * @returns 诊断结果。
 */
export async function diagnoseDependencyRepair(
  environment: DependencyRepairEnvironment | undefined,
): Promise<DependencyRepairDiagnosis> {
  if (environment === undefined) {
    log('diagnose: fnos-host-unavailable（未读到 DSH_HOME/应用目录）')
    return { available: false, reason: 'fnos-host-unavailable', entries: [] }
  }
  const workspacePath = join(environment.profileDirectory, 'pnpm-workspace.yaml')
  const text = await readTextIfExists(workspacePath)
  if (text === undefined) {
    log(`diagnose: profile-missing（无 ${workspacePath}）`)
    return { available: false, reason: 'profile-missing', entries: [], profileDirectory: environment.profileDirectory }
  }
  const manifest = environment.manifestPath === undefined
    ? undefined
    : await readJsonIfExists(environment.manifestPath)
  const exclusions = parseExclusions(text)
  const targets = targetVersionsFromManifest(manifest)
  const entries = findStaleExclusions(exclusions, targets)
  log(`diagnose: profile=${environment.profileDirectory} 豁免=${exclusions.length} 条 清单目标=${Object.keys(targets).length} 个 失效=${entries.length} 条`)
  for (const entry of entries) {
    log(`diagnose: 失效 ${entry.name}@${entry.range}（${entry.reason}${entry.targetVersion === undefined ? '' : ` → ${entry.targetVersion}`}）`)
  }
  return { available: true, entries, profileDirectory: environment.profileDirectory }
}

/** 执行一次外部命令，收集输出；不抛错，由调用方按退出码判定。 */
function run(command: string, args: readonly string[], cwd: string, timeoutMs: number): Promise<{
  readonly code: number
  readonly output: string
}> {
  return new Promise(resolve => {
    execFile(command, [...args], {
      cwd,
      timeout: timeoutMs,
      maxBuffer: MAX_OUTPUT_BYTES,
      env: process.env,
    }, (error, stdout, stderr) => {
      const output = `${stdout ?? ''}${stderr ?? ''}`.trim()
      const code = error === null
        ? 0
        : typeof (error as { code?: unknown }).code === 'number'
          ? (error as { code: number }).code
          : 1
      resolve({ code, output })
    })
  })
}

/**
 * 从 workspace 文本里删掉指定条目所在的整行。
 *
 * 按原始行文本精确匹配，不动其它行——这样用户手写的注释与排版都保留。
 *
 * @param text - 原文。
 * @param removed - 要删除的条目。
 * @returns 新文本与被删掉的行数。
 */
export function removeExclusionLines(text: string, removed: readonly DependencyRepairEntry[]): {
  readonly text: string
  readonly removedLines: number
} {
  if (removed.length === 0) return { text, removedLines: 0 }
  const keys = new Set(removed.map(entry => `${entry.name}@${entry.range}`))
  const kept: string[] = []
  let removedLines = 0
  let inSection = false
  for (const line of text.split(/\r?\n/u)) {
    if (/^minimumReleaseAgeExclude:\s*$/u.test(line)) {
      inSection = true
      kept.push(line)
      continue
    }
    if (inSection && /^[^\s#-]/u.test(line)) inSection = false
    if (inSection) {
      const matched = line.match(/^\s+-\s*(.+?)\s*$/u)
      if (matched !== null) {
        const raw = matched[1]!.replace(/^['"]|['"]$/gu, '')
        const separator = raw.lastIndexOf('@')
        const key = separator > 0 ? `${raw.slice(0, separator)}@${raw.slice(separator + 1)}` : undefined
        if (key !== undefined && keys.has(key)) {
          removedLines += 1
          continue
        }
      }
    }
    kept.push(line)
  }
  return { text: kept.join('\n'), removedLines }
}

/** 原子写入：先写临时文件再改名，避免中途失败留下半个文件。 */
async function writeFileAtomic(path: string, content: string): Promise<void> {
  const temporary = `${path}.dsh-repair-${process.pid}`
  await writeFile(temporary, content, { mode: 0o600 })
  await rename(temporary, path)
}

/**
 * 执行修复：清失效条目 → 重建依赖 → 装回清单内插件。
 *
 * 三步各自记录状态；前面失败就不再做后面的（重装依赖一个可疑的 lockfile 没有
 * 意义）。已成功的步骤不会回滚——清掉失效条目本身是无害的。
 *
 * @param environment - 应用环境。
 * @param diagnosis - 先行的诊断结果（决定要清哪些条目）。
 * @returns 修复结果。
 */
export async function runDependencyRepair(
  environment: DependencyRepairEnvironment | undefined,
  diagnosis: DependencyRepairDiagnosis,
): Promise<DependencyRepairResult> {
  const startedAt = Date.now()
  if (environment === undefined || !diagnosis.available) {
    log(`repair: 跳过（${diagnosis.reason ?? 'fnos-host-unavailable'}）`)
    return {
      ok: false,
      steps: [],
      removed: [],
      durationMs: 0,
      message: diagnosis.reason ?? 'fnos-host-unavailable',
    }
  }
  const steps: DependencyRepairStep[] = []
  const workspacePath = join(environment.profileDirectory, 'pnpm-workspace.yaml')
  log(`repair: 开始 profile=${environment.profileDirectory} 待清=${diagnosis.entries.length} 条`)

  // 第一步：清失效条目。
  let removed: readonly DependencyRepairEntry[] = []
  try {
    const text = await readTextIfExists(workspacePath)
    if (text === undefined) {
      log('repair: clear-exclusions 失败（profile-missing）')
      steps.push({ id: 'clear-exclusions', status: 'failed', detail: 'profile-missing' })
      return { ok: false, steps, removed, durationMs: Date.now() - startedAt, message: 'profile-missing' }
    }
    const result = removeExclusionLines(text, diagnosis.entries)
    removed = diagnosis.entries
    if (result.removedLines > 0) await writeFileAtomic(workspacePath, result.text)
    log(`repair: clear-exclusions 完成，删除 ${result.removedLines} 行`)
    steps.push({ id: 'clear-exclusions', status: 'ok', detail: `${result.removedLines}` })
  } catch (error) {
    log(`repair: clear-exclusions 失败 ${describe(error)}`)
    steps.push({ id: 'clear-exclusions', status: 'failed', detail: describe(error) })
    return { ok: false, steps, removed, durationMs: Date.now() - startedAt, message: describe(error) }
  }

  const pnpmBin = environment.pnpmBin
  if (pnpmBin === undefined) {
    log('repair: rebuild 失败（pnpm-missing）')
    steps.push({ id: 'rebuild', status: 'failed', detail: 'pnpm-missing' })
    return { ok: false, steps, removed, durationMs: Date.now() - startedAt, message: 'pnpm-missing' }
  }

  // 第二步：重建依赖。`pnpm clean --lockfile` 负责删两个可重建产物，
  // 它自带 basename 校验，比本模块自己删更安全。
  log(`repair: rebuild 开始 ${pnpmBin} clean --lockfile`)
  const clean = await run(pnpmBin, ['clean', '--lockfile', '--config.minimum-release-age=0'], environment.profileDirectory, DEPENDENCY_REPAIR_COMMAND_TIMEOUT_MS)
  log(`repair: clean 退出码=${clean.code}`)
  if (clean.code !== 0) {
    log(`repair: rebuild 失败（clean=${clean.code}）${clean.output.slice(-300)}`)
    steps.push({ id: 'rebuild', status: 'failed', detail: clean.output.slice(-500) })
    return { ok: false, steps, removed, durationMs: Date.now() - startedAt, message: 'rebuild-failed' }
  }
  log(`repair: rebuild 开始 ${pnpmBin} install`)
  const install = await run(pnpmBin, ['install', '--config.minimum-release-age=0'], environment.profileDirectory, DEPENDENCY_REPAIR_COMMAND_TIMEOUT_MS)
  log(`repair: install 退出码=${install.code}`)
  if (install.code !== 0) {
    log(`repair: rebuild 失败（install=${install.code}）${install.output.slice(-300)}`)
    steps.push({ id: 'rebuild', status: 'failed', detail: install.output.slice(-500) })
    return { ok: false, steps, removed, durationMs: Date.now() - startedAt, message: 'rebuild-failed' }
  }
  steps.push({ id: 'rebuild', status: 'ok' })
  log('repair: rebuild 完成')

  // 第三步：把发布清单里的插件装回来。清单外的插件不碰——那是用户自己的选择。
  const targets = environment.manifestPath === undefined
    ? {}
    : targetVersionsFromManifest(await readJsonIfExists(environment.manifestPath))
  const packages = Object.entries(targets)
  if (environment.dshBin === undefined || packages.length === 0) {
    const detail = environment.dshBin === undefined ? 'dsh-missing' : 'no-managed-plugins'
    log(`repair: reinstall 跳过（${detail}）`)
    steps.push({ id: 'reinstall', status: 'skipped', detail })
    return { ok: true, steps, removed, durationMs: Date.now() - startedAt }
  }
  const specs = packages.map(([name, version]) => `${name}@${version}`)
  log(`repair: reinstall 开始 ${specs.join(' ')}`)
  const add = await run(
    environment.dshBin,
    ['plugin', '--profile', 'web', 'add', ...specs, '--config.minimum-release-age=0'],
    environment.profileDirectory,
    DEPENDENCY_REPAIR_COMMAND_TIMEOUT_MS,
  )
  log(`repair: reinstall 退出码=${add.code}`)
  if (add.code !== 0) {
    log(`repair: reinstall 失败 ${add.output.slice(-300)}`)
    steps.push({ id: 'reinstall', status: 'failed', detail: add.output.slice(-500) })
    return { ok: false, steps, removed, durationMs: Date.now() - startedAt, message: 'reinstall-failed' }
  }
  steps.push({ id: 'reinstall', status: 'ok', detail: specs.join(' ') })
  log(`repair: 完成，耗时 ${Date.now() - startedAt}ms`)
  return { ok: true, steps, removed, durationMs: Date.now() - startedAt }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 供路由层复用的 basename 守卫：修复只会碰到这两个可重建产物。 */
export function isRebuildableArtifact(path: string): boolean {
  const name = basename(path)
  return name === 'pnpm-lock.yaml' || name === 'node_modules'
}
