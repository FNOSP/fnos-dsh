/**
 * 插件安装：用 pnpm 往 profile 里装插件，并把过程实时写进日志文件供界面轮询。
 *
 * ## 为什么用 pnpm 而不是 npm
 *
 * profile 由 pnpm workspace 管理（`pnpm-workspace.yaml` + `pnpm-lock.yaml`），
 * 官方 `dsh-plugin-manager` 也是用 `pnpm add`。用 npm 会写出第二份 lockfile，
 * 之后 pnpm 的解析结果就和它对不上——这是「装完之后依赖莫名变成两份」的常见来源。
 *
 * ## 为什么钉版本而不是装 latest
 *
 * 插件声明 `engines.dsh`（或 dsh peer）。latest 往往要求更新的 DSH 基线，装上
 * 起不来。这里先按当前 `getDshRuntimeVersion()` 过滤可用版本，再取其中最高的
 * 稳定版——与官方 `compatibilityOf` 的口径一致。
 *
 * ## 为什么过程写文件而不是留在内存
 *
 * 安装要几十秒到几分钟。HTTP 请求等不了那么久，页面也会刷新。官方做法是把输出
 * ticket 落到日志文件，界面轮询读。这里同构：
 * 写 `gateway/install-log.txt`，前端按 offset 增量读。
 *
 * ## 失败处理
 *
 * 装之前备份 `package.json` 与 `pnpm-lock.yaml`；`pnpm add` 失败时还原这两份，
 * 避免 profile 停留在「依赖声明里有、实际没装上」的中间态。已下载的模块留在
 * 磁盘上——那不影响正确性，下次装会复用。
 *
 * @module dsh-fnos/plugin-install
 */

import { execFile, spawn } from 'node:child_process'
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { getDshRuntimeVersion, evaluatePluginCompatibility } from '@deepseek-ai/dsh-app-boot'
import { resolveRepairEnvironment } from './dependency-repair.ts'

/** 单次安装的总超时（毫秒）。pnpm 在慢网下也可能超过这个数。 */
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000

/** 日志文件保留的字节上限，超出后从头截断，避免无限增长。 */
const LOG_MAX_BYTES = 256 * 1024

/** 一次安装的进度。 */
export interface PluginInstallState {
  /** 是否正在安装。 */
  readonly running: boolean
  /** 正在安装的包名。 */
  readonly name?: string
  /** 钉住的版本。 */
  readonly version?: string
  /** 结束状态：成功/失败；未结束时缺省。 */
  readonly status?: 'succeeded' | 'failed'
  /** 失败原因。 */
  readonly error?: string
  /** 开始时间（epoch ms）。 */
  readonly startedAt?: number
  /** 结束时间（epoch ms）。 */
  readonly finishedAt?: number
}

/** 进程内的当前状态（同一时刻只允许一个安装）。 */
let current: PluginInstallState = { running: false }

/**
 * 读当前安装状态。
 * @returns 状态。
 */
export function readInstallState(): PluginInstallState {
  return current
}

/**
 * 日志文件路径。
 * @returns 路径；环境不可用时 undefined。
 */
export function installLogPath(): string | undefined {
  const environment = resolveRepairEnvironment()
  if (environment === undefined) return undefined
  return join(environment.profileDirectory, 'gateway', 'install-log.txt')
}

/**
 * 读日志（从头或从偏移）。
 * @param offset - 起始字节；缺省读全部。
 * @returns 内容与新的偏移。
 */
export async function readInstallLog(offset = 0): Promise<{ text: string, offset: number }> {
  const path = installLogPath()
  if (path === undefined) return { text: '', offset: 0 }
  try {
    const buffer = await readFile(path)
    const start = Math.min(Math.max(0, offset), buffer.length)
    return { text: buffer.subarray(start).toString('utf8'), offset: buffer.length }
  } catch {
    return { text: '', offset: 0 }
  }
}

/**
 * 追加一行日志（带时间戳）。
 * @param path - 日志文件。
 * @param line - 内容。
 */
async function appendLog(path: string, line: string): Promise<void> {
  const stamp = new Date().toISOString().slice(11, 19)
  const text = `[${stamp}] ${line}\n`
  try {
    const existing = await readFile(path).catch(() => Buffer.alloc(0))
    // 超过上限就整份重写：日志是给人看的，保留最近的一段就够。
    const base = existing.length > LOG_MAX_BYTES ? Buffer.alloc(0) : existing
    await writeFile(path, Buffer.concat([base, Buffer.from(text, 'utf8')]))
  } catch {
    // 日志写不进去不该让安装失败。
  }
}

/**
 * 查询某插件在 npm registry 上所有版本。
 * @param name - 包名。
 * @returns 版本号列表；查不到时空数组。
 */
async function fetchVersions(name: string): Promise<string[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, 10_000)
  try {
    const response = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2F')}`, {
      signal: controller.signal,
      headers: { accept: 'application/vnd.npm.install-v1+json' },
    })
    if (!response.ok) return []
    const value = await response.json() as { versions?: Record<string, unknown> }
    return Object.keys(value.versions ?? {})
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 读某版本在 registry 上的 `package.json`（用于兼容性判定）。
 * @param name - 包名。
 * @param version - 版本。
 * @returns 清单；读不到时 undefined。
 */
async function fetchVersionManifest(name: string, version: string): Promise<Record<string, unknown> | undefined> {
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, 10_000)
  try {
    const response = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2F')}/${version}`, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    })
    if (!response.ok) return undefined
    const value: unknown = await response.json()
    return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

/** 把三段式版本拆成数字；无法解析时 undefined。 */
function parseVersion(value: string): number[] | undefined {
  const core = value.split('-')[0] ?? ''
  const parts = core.split('.').map(part => Number.parseInt(part, 10))
  return parts.length >= 3 && parts.every(part => Number.isFinite(part)) ? parts : undefined
}

/**
 * 选一个「与当前 DSH 基线兼容」的最高稳定版本。
 *
 * 这是「安装不一定装 latest」的落点：latest 常要求更新的 DSH，装上去起不来。
 *
 * @param name - 包名。
 * @returns 版本，以及被跳过的原因（没找到兼容版本时）。
 */
export async function resolveInstallableVersion(name: string): Promise<{ version?: string, error?: string }> {
  const versions = await fetchVersions(name)
  if (versions.length === 0) return { error: 'package-not-found' }

  // 先排除预发布：稳定用户不该被装到 beta。
  const stable = versions.filter(version => !version.includes('-'))
  const candidates = (stable.length > 0 ? stable : versions)
    .map(version => ({ version, parts: parseVersion(version) }))
    .filter((item): item is { version: string, parts: number[] } => item.parts !== undefined)
    .sort((a, b) => {
      for (let i = 0; i < 3; i += 1) {
        const delta = (b.parts[i] ?? 0) - (a.parts[i] ?? 0)
        if (delta !== 0) return delta
      }
      return 0
    })

  const runtime = getDshRuntimeVersion()
  for (const candidate of candidates) {
    const manifest = await fetchVersionManifest(name, candidate.version)
    if (manifest === undefined) continue
    try {
      // 官方判据：返回 undefined 表示要求都满足。
      if (evaluatePluginCompatibility(manifest, undefined, runtime) === undefined) {
        return { version: candidate.version }
      }
    } catch {
      // 清单的 engines/peer 格式异常：跳过该版本，试下一个。
    }
  }
  return { error: 'no-compatible-version' }
}

/**
 * 写日志文件头（清空旧内容）。
 * @param path - 日志文件。
 * @param name - 包名。
 * @param version - 版本。
 */
async function resetLog(path: string, name: string, version: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, '')
  await appendLog(path, `准备安装 ${name}@${version}（当前 DSH 基线 ${getDshRuntimeVersion()}）`)
}

/**
 * 备份 profile 的依赖声明与 lockfile。
 * @param profile - profile 目录。
 * @returns 备份路径映射；失败时 undefined。
 */
async function backupProfile(profile: string): Promise<Map<string, string> | undefined> {
  const saved = new Map<string, string>()
  const suffix = `.dsh-install-backup-${String(process.pid)}`
  for (const name of ['package.json', 'pnpm-lock.yaml']) {
    const source = join(profile, name)
    try {
      await copyFile(source, `${source}${suffix}`)
      saved.set(source, `${source}${suffix}`)
    } catch {
      // 文件不存在（首次安装时可能是没 lockfile）：不视为失败。
    }
  }
  return saved
}

/**
 * 还原备份。
 * @param saved - 备份路径映射。
 */
async function restoreProfile(saved: Map<string, string>): Promise<void> {
  for (const [target, backup] of saved) {
    try {
      await rename(backup, target)
    } catch {
      // 还原失败也只好作罢：日志里已经记下原始错误。
    }
  }
}

/**
 * 用 pnpm 装一个插件（流式写日志）。
 * @param name - 包名。
 * @returns 结束状态。
 */
export async function installPlugin(name: string): Promise<PluginInstallState> {
  if (current.running) return current

  const environment = resolveRepairEnvironment()
  if (environment === undefined || environment.pnpmBin === undefined) {
    return { running: false, name, status: 'failed', error: 'pnpm-unavailable' }
  }
  const logPath = installLogPath()
  if (logPath === undefined) return { running: false, name, status: 'failed', error: 'log-unavailable' }

  current = { running: true, name, startedAt: Date.now() }
  const profile = environment.profileDirectory
  const saved = await backupProfile(profile)

  try {
    const resolved = await resolveInstallableVersion(name)
    if (resolved.version === undefined) {
      await appendLog(logPath, `没有找到与当前基线兼容的版本（${resolved.error ?? 'unknown'}）`)
      current = { ...current, running: false, status: 'failed', ...(resolved.error === undefined ? {} : { error: resolved.error }), finishedAt: Date.now() }
      return current
    }
    current = { ...current, version: resolved.version }
    await resetLog(logPath, name, resolved.version)
    await appendLog(logPath, `执行：pnpm add ${name}@${resolved.version}`)

    const spec = `${name}@${resolved.version}`
    const code = await new Promise<number>(resolve => {
      const child = spawn(environment.pnpmBin ?? 'pnpm', ['add', spec, '--config.minimum-release-age=0'], {
        cwd: profile,
        env: { ...process.env, CI: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      const timer = setTimeout(() => { child.kill('SIGTERM') }, INSTALL_TIMEOUT_MS)

      let pending = ''
      const flush = (): void => {
        const lines = pending.split('\n')
        pending = lines.pop() ?? ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (trimmed !== '') void appendLog(logPath, trimmed)
        }
      }
      child.stdout?.setEncoding('utf8')
      child.stderr?.setEncoding('utf8')
      child.stdout?.on('data', (chunk: string) => { pending += chunk; flush() })
      child.stderr?.on('data', (chunk: string) => { pending += chunk; flush() })

      child.on('error', error => {
        clearTimeout(timer)
        void appendLog(logPath, `启动 pnpm 失败：${error.message}`)
        resolve(1)
      })
      child.on('close', result => {
        clearTimeout(timer)
        if (pending.trim() !== '') void appendLog(logPath, pending.trim())
        resolve(result ?? 1)
      })
    })

    if (code === 0) {
      await appendLog(logPath, `安装成功：${spec}`)
      current = { ...current, running: false, status: 'succeeded', finishedAt: Date.now() }
    } else {
      await appendLog(logPath, `安装失败（pnpm 退出码 ${String(code)}），已还原 package.json 与 lockfile`)
      if (saved !== undefined) await restoreProfile(saved)
      current = { ...current, running: false, status: 'failed', error: 'pnpm-failed', finishedAt: Date.now() }
    }
    return current
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await appendLog(logPath, `安装异常：${message}`)
    if (saved !== undefined) await restoreProfile(saved)
    current = { running: false, name, status: 'failed', error: message, finishedAt: Date.now() }
    return current
  }
}

/**
 * 卸载一个插件：`pnpm remove`。
 * @param name - 包名。
 * @returns 是否成功。
 */
export async function removePlugin(name: string): Promise<{ ok: boolean, error?: string }> {
  const environment = resolveRepairEnvironment()
  if (environment === undefined || environment.pnpmBin === undefined) return { ok: false, error: 'pnpm-unavailable' }

  return new Promise(resolve => {
    execFile(environment.pnpmBin ?? 'pnpm', ['remove', name], {
      cwd: environment.profileDirectory,
      timeout: 120_000,
      env: process.env,
    }, error => {
      if (error === null) {
        resolve({ ok: true })
        return
      }
      resolve({ ok: false, error: error instanceof Error ? error.message : String(error) })
    })
  })
}
