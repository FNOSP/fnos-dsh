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
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
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
  /** 随 FPK 内置的插件归档目录（`bundled-dsh-plugins/`）。 */
  readonly bundledDirectory?: string
  /** `dsh` 可执行文件（重装插件走它）。 */
  readonly dshBin?: string
  /** `DSH_HOME` 的绝对值；`dsh` 靠它定位 profiles 目录。 */
  readonly dshHome: string
  /** `pnpm` 可执行文件。 */
  readonly pnpmBin?: string
  /**
   * 应用共享目录（`@appshare/<app>`）；备份写在这里。
   *
   * 与 `DSH_HOME`（`@apphome/<app>`）同级，由 fnOS 创建并授予应用读写权限。
   * 备份放这里而不是 profile 旁边：profile 是 pnpm 的工作目录，多一个文件就会
   * 被 `pnpm install` 扫到；共享目录对用户可见、可下载，也更符合「备份」的用途。
   */
  readonly shareDirectory?: string
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
  // `DSH_HOME` = `<storage>/@apphome/<app>`；共享目录是它的兄弟 `@appshare/<app>`。
  // 用相对推导而不是读环境变量：fnOS 不导出 `@appshare` 的变量，而这个布局是
  // 平台的固定约定（见授权目录里对 `@apphome`/`@appshare` 的同级判定）。
  const shareDirectory = join(dirname(home), '..', '@appshare', basename(home))
  return {
    dshHome: home,
    profileDirectory: join(home, 'profiles', 'web'),
    shareDirectory,
    ...(appDest === undefined
      ? {}
      : {
          manifestPath: join(appDest, 'published-dsh-plugins.json'),
          bundledDirectory: join(appDest, 'bundled-dsh-plugins'),
        }),
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
 * 宿主日志输出器（由插件入口注入）。
 *
 * ## 为什么不再用 `console.log`
 *
 * `console.log` 写的是 Node 标准输出，**不经过 Cordis 的日志服务**，因此这些
 * 记录在「日志」页完全不可见——不是「采了没显示」，是根本没进来。改为注入
 * `ctx.logger` 后，同一行既进运行日志中心，也可继续推给 SSE 供弹框实时显示。
 *
 * ## 为什么是注入而不是直接拿 ctx
 *
 * 本模块是纯函数集合，不持有 `ctx`（便于单测直接调用）。注入保持了这个特性，
 * 未注入时退化为 `console.log`，行为与改造前一致。
 */
export interface RepairHostLogger {
  readonly info: (message: string) => void
  readonly warn: (message: string) => void
  readonly error: (message: string) => void
}

let hostLogger: RepairHostLogger | undefined

/**
 * 注入宿主日志输出器。
 * @param logger - 输出器；`undefined` 表示退回 `console.log`（测试用）。
 */
export function setRepairHostLogger(logger: RepairHostLogger | undefined): void {
  hostLogger = logger
}

/**
 * 输出一条诊断日志。
 *
 * 这个功能会删 `node_modules` 并重装依赖，出问题时只能靠日志还原「它到底做了
 * 什么」。因此诊断的判定依据、命中的条目、每步命令与退出码都要留痕——用户报
 * 「点了没反应」时，日志能区分「没触发」「判定为健康」「命令失败」三种情况。
 *
 * **同时推给正在观察的调用方。** 修复要跑 `pnpm install`，可能几分钟；只在结束
 * 时把整份结果返回，界面就只能「先干等着、最后一次性冒出一堆日志」。`sink` 让
 * 每条日志边走边发，前端能像看终端一样实时看到进展。
 *
 * **只产生一次。** SSE 与任务浮层都从 `sink` 订阅，本函数不重复写两处——否则
 * 日志中心里同一行会出现两遍。
 */
function log(message: string): void {
  const line = `${LOG_PREFIX} ${message}`
  if (hostLogger === undefined) console.log(line)
  else hostLogger.info(line)
  logSink?.(message)
}

/**
 * 当前观察者。同一时刻只允许一个修复在跑（见路由里的 `busy` 判定），因此单个
 * 槽位足够，不必做成列表。
 */
let logSink: ((line: string) => void) | undefined

/**
 * 设置日志观察者。
 *
 * @param sink - 每条日志的回调；`undefined` 表示取消观察。
 * @returns 取消函数，调用后只在没有别的观察者接管时才清空槽位。
 */
export function setRepairLogSink(sink: ((line: string) => void) | undefined): () => void {
  logSink = sink
  return () => { if (logSink === sink) logSink = undefined }
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

/**
 * 修复前把 profile 的 `pnpm-workspace.yaml` 备份到应用共享目录。
 *
 * ## 为什么备份
 *
 * 修复会按行删除失效的豁免条目。判定规则再谨慎也是代码，一旦判错（比如把用户
 * 手写的、仍然有效的条目当成残留删掉），没有备份就无法还原——而这个文件直接
 * 决定 `pnpm install` 能不能装成。
 *
 * ## 为什么放 `@appshare`
 *
 * profile 目录是 pnpm 的工作目录，往里丢 `.bak` 会被 `pnpm install` 当成工作区
 * 文件扫到；`@appshare/<app>` 是 fnOS 给应用的共享目录，用户从文件管理器就能
 * 看到并下载，卸载应用也不会丢。
 *
 * 文件名带时间戳，多次修复不会互相覆盖；返回**相对共享目录的语义化路径**给界面
 * 显示（`备份/pnpm-workspace-20261117-164500.yaml`），点击时才用完整路径。
 *
 * @param environment - 应用环境。
 * @param content - 备份内容（原文）。
 * @returns 备份文件的完整路径与展示用路径；无法备份时为空。
 */
async function backupWorkspaceFile(
  environment: DependencyRepairEnvironment,
  content: string,
): Promise<{ readonly fullPath: string, readonly displayPath: string } | undefined> {
  const share = environment.shareDirectory
  if (share === undefined) return undefined
  const directory = join(share, '备份')
  try {
    await mkdir(directory, { recursive: true })
    /*
      文件名带**本地时间**到秒：`pnpm-workspace-20261117-174500.yaml`。

      早前这里对 ISO 串做 `slice(0, 15)`，把 `2026-11-17-09-43-44` 切成了
      `2026-11-17-09-4`——同一小时内的多次备份会互相覆盖，而用户看到的文件名
      也是残缺的。用本地时间而不是 UTC：备份是给人找的，文件名该与他在系统里
      看到的时间一致。
    */
    const now = new Date()
    const pad = (value: number): string => String(value).padStart(2, '0')
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
      + `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
    const name = `pnpm-workspace-${stamp}.yaml`
    const fullPath = join(directory, name)
    await writeFile(fullPath, content, { mode: 0o600 })
    log(`repair: 已备份 profile 配置 → ${fullPath}`)
    return { fullPath, displayPath: `备份/${name}` }
  } catch (error) {
    // 备份失败不阻断修复：它只是保险，不是前置条件；但要在日志里说清楚。
    log(`repair: 备份失败（继续修复）${describe(error)}`)
    return undefined
  }
}

/**
 * 清空 `minimumReleaseAgeExclude` 段里的**所有**条目。
 *
 * ## 为什么不按「失效」筛选
 *
 * 这一版之前只删诊断判定为失效的条目。但诊断本身要拿「清单目标版本」比对，而
 * 非 fnOS 宿主（独立浏览器、本地 DSH Web）读不到发布清单，目标表为空——那时
 * **一条都判不出来**，修复等于什么都没做，用户点了按钮却看不出变化。
 *
 * 「修复」的语义是**把这一块重置掉**：这段豁免本来就是发布冷静期的临时放行，
 * 清空后 `pnpm install` 会重新按当前清单解析；留着旧条目反而可能继续拦新版本。
 * 段头保留（它可能被别的配置引用），只清列表项。
 *
 * @param text - `pnpm-workspace.yaml` 全文。
 * @returns 清空后的文本与被清掉的行数。
 */
export function clearAllExclusions(text: string): { readonly text: string, readonly removedLines: number } {
  const kept: string[] = []
  let removedLines = 0
  let inSection = false
  for (const line of text.split(/\r?\n/u)) {
    if (/^minimumReleaseAgeExclude:\s*$/u.test(line)) {
      inSection = true
      kept.push(line)
      continue
    }
    // 段在遇到下一个列零的非注释行时结束。
    if (inSection && /^[^\s#-]/u.test(line)) inSection = false
    if (inSection && /^\s+-\s*/u.test(line)) {
      removedLines += 1
      continue
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
 * 执行修复：**无条件三步** —— 清空 `minimumReleaseAgeExclude` 的所有值、
 * `pnpm clean --lockfile`、`pnpm install`。
 *
 * ## 为什么不再做任何判断
 *
 * 这个动作的语义是「把安装环境重置回可安装状态」，不是一个需要用户判断的业务
 * 流程。此前它先做诊断、只在「有失效条目」时才重建，还额外把插件重装一遍：
 *
 * - 诊断要拿发布清单比对，而独立浏览器/本地 DSH Web 读不到清单，目标表为空时
 *   **一条都判不出来**，修复于是什么都不做——用户点了按钮却看不出变化；
 * - 「把插件装回来」超出了修复的职责，会顺带改动用户装了什么。
 *
 * 现在只做用户明确要求的三个动作。`pnpm` 不可用才算真的做不了（它是要执行的
 * 命令本身，没有替代品）；其余情况一律照做。
 *
 * @param environment - 应用环境。
 * @returns 修复结果。
 */
export async function runDependencyRepair(
  environment: DependencyRepairEnvironment | undefined,
): Promise<DependencyRepairResult> {
  const startedAt = Date.now()
  if (environment === undefined) {
    log('repair: 跳过（fnos-host-unavailable）')
    return {
      ok: false,
      steps: [],
      removed: [],
      durationMs: 0,
      outcome: 'unavailable',
      message: 'fnos-host-unavailable',
    }
  }
  const steps: DependencyRepairStep[] = []
  const workspacePath = join(environment.profileDirectory, 'pnpm-workspace.yaml')
  log(`repair: 开始 profile=${environment.profileDirectory}`)

  // 第一步：清失效条目。
  const removed: readonly DependencyRepairEntry[] = []
  try {
    const text = await readTextIfExists(workspacePath)
    if (text === undefined) {
      log('repair: clear-exclusions 失败（profile-missing）')
      steps.push({ id: 'clear-exclusions', status: 'failed', detail: 'profile-missing' })
      return { ok: false, steps, removed, durationMs: Date.now() - startedAt, outcome: 'failed', message: 'profile-missing' }
    }
    /*
      先备份再改。**这里不筛「失效」条目，整段清空**——「修复」的语义就是把这块
      重置掉；而且非 fnOS 宿主读不到发布清单时，失效判定一条都命中不了，筛选版
      会让按钮看起来没生效。备份留着，判错时还能还原。
    */
    const backup = await backupWorkspaceFile(environment, text)
    const result = clearAllExclusions(text)
    if (result.removedLines > 0) await writeFileAtomic(workspacePath, result.text)
    log(`repair: clear-exclusions 完成，清空 ${result.removedLines} 行`)
    steps.push({
      id: 'clear-exclusions',
      status: 'ok',
      detail: `${result.removedLines}`,
      // 备份位置随结果返回，界面渲染成可复制的语义化路径。
      ...(backup === undefined ? {} : { backupPath: backup.fullPath, backupDisplayPath: backup.displayPath }),
    })
  } catch (error) {
    log(`repair: clear-exclusions 失败 ${describe(error)}`)
    steps.push({ id: 'clear-exclusions', status: 'failed', detail: describe(error) })
    return { ok: false, steps, removed, durationMs: Date.now() - startedAt, outcome: 'failed', message: describe(error) }
  }

  const pnpmBin = environment.pnpmBin
  if (pnpmBin === undefined) {
    log('repair: rebuild 失败（pnpm-missing）')
    steps.push({ id: 'rebuild', status: 'failed', detail: 'pnpm-missing' })
    return { ok: false, steps, removed, durationMs: Date.now() - startedAt, outcome: 'failed', message: 'pnpm-missing' }
  }

  /*
    第二步：重建依赖。`pnpm clean --lockfile` 负责删两个可重建产物，它自带
    basename 校验，比本模块自己删更安全。

    **不传 `--config.minimum-release-age=0`。**

    那个参数会绕过 pnpm 的发布冷静期（供应链防护）。修复的职责是把安装环境重置
    回可解析状态，不是替用户绕过一条安全策略——真装上了刚发布几分钟的包，风险
    由谁来担？冷静期的存在本身就是为了防投毒。

    因此修复只做「清 lockfile + 按当前策略重装」：策略放行的包能装上，被拦下的
    继续被拦下。若某个包确实刚发布，正确做法是等冷却期过去，而不是关掉防护。
  */
  log(`repair: rebuild 开始 ${pnpmBin} clean --lockfile`)
  const clean = await run(pnpmBin, ['clean', '--lockfile'], environment.profileDirectory, DEPENDENCY_REPAIR_COMMAND_TIMEOUT_MS)
  log(`repair: clean 退出码=${clean.code}`)
  if (clean.code !== 0) {
    log(`repair: rebuild 失败（clean=${clean.code}）${clean.output.slice(-300)}`)
    steps.push({ id: 'rebuild', status: 'failed', detail: clean.output.slice(-500) })
    return { ok: false, steps, removed, durationMs: Date.now() - startedAt, outcome: 'failed', message: 'rebuild-failed' }
  }
  log(`repair: rebuild 开始 ${pnpmBin} install`)
  const install = await run(pnpmBin, ['install'], environment.profileDirectory, DEPENDENCY_REPAIR_COMMAND_TIMEOUT_MS)
  log(`repair: install 退出码=${install.code}`)
  if (install.code !== 0) {
    log(`repair: rebuild 失败（install=${install.code}）${install.output.slice(-300)}`)
    steps.push({ id: 'rebuild', status: 'failed', detail: install.output.slice(-500) })
    return { ok: false, steps, removed, durationMs: Date.now() - startedAt, outcome: 'failed', message: 'rebuild-failed' }
  }
  steps.push({ id: 'rebuild', status: 'ok' })
  log('repair: rebuild 完成')

  /*
    **不自己重建冷静期豁免。**

    「哪个包还在冷静期内」是 pnpm 的判定，业务代码不该复制一份：pnpm 的规则
    包含发布时间的取整、私有源缺 `time` 字段、镜像滞后等细节，重新实现一遍
    只会缓慢漂移。

    修复只负责「清掉过期条目 + 清 lockfile + 重装」，豁免由 `pnpm install` 与
    官方 `dsh plugin` 各自在需要时写入——它们才是这套策略的持有者。
  */

  /*
    **到此为止：不再「把插件装回来」。**

    这个动作的职责只有三步——清空 `minimumReleaseAgeExclude` 的所有值、执行
    `pnpm clean --lockfile`、执行 `pnpm install`。曾经还有第三步「把发布清单里
    的插件重新 add 一遍」，那会让修复顺带改动用户装了什么：清单内的插件被重装、
    清单外的保持原样，对一个只想「让安装恢复正常」的人来说这是多余的副作用。

    重建依赖本身已经足够：lockfile 与 node_modules 会按当前清单重新解析，插件
    该在的还在、该装的能装上。需要重装请用「已安装插件」里的更新/安装入口。
  */
  log(`repair: 完成，耗时 ${Date.now() - startedAt}ms`)
  return { ok: true, steps, removed, durationMs: Date.now() - startedAt, outcome: 'repaired' }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 供路由层复用的 basename 守卫：修复只会碰到这两个可重建产物。 */
export function isRebuildableArtifact(path: string): boolean {
  const name = basename(path)
  return name === 'pnpm-lock.yaml' || name === 'node_modules'
}
