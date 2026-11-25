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
import { copyFile, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
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
 * 操作日志的来源。
 *
 * 插件安装与 nrm 镜像源安装曾**共用同一个文件**：谁先开始就清空对方的内容，
 * 于是先装插件再装 nrm，插件那份记录就没了——用户以为历史都在，实际只剩最后
 * 一次。现在按来源分成两个文件，互不覆盖。
 */
export type InstallLogKind = 'install' | 'mirror'

/**
 * 日志文件路径。
 * @param kind - 日志来源；缺省为插件安装（兼容既有调用）。
 * @returns 路径；环境不可用时 undefined。
 */
export function installLogPath(kind: InstallLogKind = 'install'): string | undefined {
  const environment = resolveRepairEnvironment()
  if (environment === undefined) return undefined
  const file = kind === 'mirror' ? 'mirror-log.txt' : 'install-log.txt'
  return join(environment.profileDirectory, 'gateway', file)
}

/**
 * 读日志（从头或从偏移）。
 * @param offset - 起始字节；缺省读全部。
 * @returns 内容与新的偏移。
 */
export async function readInstallLog(offset = 0, kind: InstallLogKind = 'install'): Promise<{ text: string, offset: number }> {
  const path = installLogPath(kind)
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
export async function appendLog(path: string, line: string): Promise<void> {
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
 * 立即清空日志并写入一行说明。
 *
 * 与 {@link resetLog} 的区别：这个不等任何异步操作，**进入安装的第一步就调用**。
 *
 * ## 为什么必须提前
 *
 * 前端在卡片挂载时就开始按 offset 拉日志。若日志还留着上一次安装的内容，第一次
 * 拉取会把**上一个插件**的整份日志当成本次的内容追加进任务浮层——实测表现为
 * 「只装了 fnos-cli，浮层里却有 dshmarket 的记录」。
 *
 * 版本解析、备份 profile 都可能耗时几十到几百毫秒，那段时间足够前端拉一次。
 *
 * @param path - 日志文件。
 * @param firstLine - 首行说明。
 */
async function beginLog(path: string, firstLine: string): Promise<void> {
  await startLog(path, firstLine)
}

/**
 * 把刚安装的 bundle 型插件加入 `dsh.profile.bundles`（即启用）。
 *
 * 与官方 `plugin-manager` 的行为一致：装完自动启用。只有声明了
 * `dsh.bundle.patch` 的包才是 profile 层，普通依赖加进去没有意义。
 *
 * @param profile - profile 目录。
 * @param name - 包名。
 * @returns 是否真的加进去了（未声明 bundle 或已存在时为 false）。
 */
/**
 * 判断某个包是否已经是 profile 的依赖（即这次是「更新」而非「安装」）。
 * @param profile - profile 目录。
 * @param name - 包名。
 * @returns 是否已声明。
 */
async function isDeclaredDependency(profile: string, name: string): Promise<boolean> {
  try {
    const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, unknown>
    }
    return typeof manifest.dependencies?.[name] === 'string'
  } catch {
    /* 读不到清单：当作首次安装，与「什么都没有」时的行为一致。 */
    return false
  }
}

async function activateBundleIfDeclared(profile: string, name: string): Promise<boolean> {
  const packageManifestPath = join(profile, 'node_modules', ...name.split('/'), 'package.json')
  const packageManifest = JSON.parse(await readFile(packageManifestPath, 'utf8')) as {
    dsh?: { bundle?: { patch?: unknown } }
  }
  if (typeof packageManifest.dsh?.bundle?.patch !== 'string') return false

  const manifestPath = join(profile, 'package.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    dsh?: { profile?: { bundles?: string[] } }
  }
  const previous = manifest.dsh?.profile?.bundles ?? []
  if (previous.includes(name)) return false
  const next = { ...manifest, dsh: { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles: [...previous, name] } } }
  await writeFile(manifestPath, `${JSON.stringify(next, null, 2)}\n`)
  return true
}

/**
 * 清空日志并写入首行（供其它安装流程复用，如 nrm）。
 * @param path - 日志文件。
 * @param firstLine - 首行说明。
 */
export async function startLog(path: string, firstLine: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, '')
  await appendLog(path, firstLine)
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
 * 安装成功后删掉备份。
 *
 * 备份只在失败时有用（`rename` 还原）。成功路径原本什么都不做，于是每装一次就
 * 在 profile 里留下两份 `*.dsh-install-backup-<pid>`——用户会在文件管理器里看到
 * 一堆看不到用途的文件，也不知道能不能删。
 *
 * @param saved - 备份路径映射。
 */
async function discardProfileBackup(saved: Map<string, string>): Promise<void> {
  for (const [, backup] of saved) {
    try {
      await unlink(backup)
    } catch {
      /* 删不掉（权限、已被移走）不阻断安装：这是收尾清理，不是成功条件。 */
    }
  }
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
 * DSH 宿主 `pluginManager` 服务的最小形状。
 *
 * 官方把它注册在 Cordis 上下文里（`@deepseek-ai/dsh-plugin-manager` 的
 * `declare module` 段），`updateBundle` 负责全部我们曾经手写、且写不全的步骤：
 *
 * - 版本校验（必须严格大于已装版本）；
 * - `--save-exact`（写精确版本，不用 `^` 范围）；
 * - `expected: { name, version }` 校验（装出来的不是期望的包/版本即失败）；
 * - 失败时还原被移除的旧版本；
 * - 保留 `enabled` 状态、registry 回退链。
 *
 * 这里只声明用到的那一个方法，不引入宿主包的运行期依赖——服务从 `ctx.get`
 * 取，取不到就退回本模块自己拼命令的路径。
 */
interface PluginManagerLike {
  readonly updateBundle: (
    name: string,
    version: string,
    options?: { readonly requestId?: string },
  ) => Promise<{ readonly from: string, readonly to: string, readonly result: { readonly application: string, readonly error?: { readonly code: string, readonly diagnostic?: string } } }>
}

/**
 * 从上下文取官方的插件管理服务。
 * @param ctx - 插件上下文；缺省时返回 `undefined`。
 * @returns 服务实例或 `undefined`。
 */
function pluginManagerOf(ctx: Context | undefined): PluginManagerLike | undefined {
  if (ctx === undefined) return undefined
  return ctx.get('pluginManager') as PluginManagerLike | undefined
}

/**
 * 用 pnpm 装一个插件（流式写日志）。
 * @param name - 包名。
 * @param ctx - 插件上下文；给出时优先走官方 `updateBundle`。
 * @returns 结束状态。
 */
export async function installPlugin(name: string, ctx?: Context): Promise<PluginInstallState> {
  if (current.running) return current

  const environment = resolveRepairEnvironment()
  if (environment === undefined || environment.pnpmBin === undefined) {
    return { running: false, name, status: 'failed', error: 'pnpm-unavailable' }
  }
  const logPath = installLogPath()
  if (logPath === undefined) return { running: false, name, status: 'failed', error: 'log-unavailable' }

  current = { running: true, name, startedAt: Date.now() }
  /*
    **先清日志，再做别的。**

    前端挂载后立刻按 offset 拉日志；这里若晚一步（等版本解析、备份 profile），
    第一次拉取会读到上一次安装的完整内容，整份串进本次的任务浮层。
  */
  await beginLog(logPath, `准备安装 ${name}`)
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
    /*
      **优先走官方 `ctx.pluginManager.updateBundle`。**

      官方实现覆盖了我们手写却补不全的全部步骤（见 `PluginManagerLike` 的注释）。
      早前自己拼 `dsh plugin --profile web add`，缺 `--save-exact` 与 `expected`
      校验：前者让 profile 里写进 `^1.84.1` 这类范围，冷静期豁免却按精确版本记录，
      两者对不上；后者让「装出来的不是想要的版本」这种失败静默通过。

      服务取不到（旧宿主、测试环境）时退回本模块自己的路径，功能不因此消失。
    */
    /* 先记下这次是「安装」还是「更新」：只有全新安装才自动启用。 */
    const previouslyInstalled = await isDeclaredDependency(profile, name)
    /*
      **`updateBundle` 只处理「已安装」的包。**

      它先 `listBundles().find(item => item.name === name)`，找不到就直接返回
      `invalid-spec`——所以**首次安装不能走它**，否则新插件的「安装」按钮永远失败。
      未安装时继续走下面的 `dsh plugin add` 路径。
    */
    const manager = previouslyInstalled ? pluginManagerOf(ctx) : undefined
    if (manager !== undefined) {
      await appendLog(logPath, `更新：pluginManager.updateBundle("${name}", "${resolved.version}")`)
      try {
        const updated = await manager.updateBundle(name, resolved.version)
        const ok = updated.result.application !== 'failed'
        if (!ok) {
          const detail = updated.result.error?.diagnostic ?? updated.result.error?.code ?? 'unknown'
          await appendLog(logPath, `更新失败：${detail}`)
          current = { ...current, running: false, status: 'failed', error: detail, finishedAt: Date.now() }
          return current
        }
        await appendLog(logPath, `更新完成：${updated.from} → ${updated.to}`)
        /* 官方已把包装进 profile；这里补上「首次安装才自动启用」的收尾。 */
        if (!previouslyInstalled) {
          try {
            const activated = await activateBundleIfDeclared(profile, name)
            if (activated) await appendLog(logPath, `已加入 profile bundles：${name}`)
          } catch (error: unknown) {
            await appendLog(logPath, `加入 profile bundles 失败：${error instanceof Error ? error.message : String(error)}`)
          }
        }
        /* 官方不碰我们的备份文件，成功后自己收尾。 */
        if (saved !== undefined) await discardProfileBackup(saved)
        current = { ...current, running: false, status: 'succeeded', finishedAt: Date.now() }
        return current
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        await appendLog(logPath, `更新异常：${message}`)
        current = { ...current, running: false, status: 'failed', error: message, finishedAt: Date.now() }
        return current
      }
    }

    /*
      **用 `dsh plugin add`，不用裸 `pnpm add`。**

      官方 `dsh plugin` 是插件安装的正规入口：它负责把包装进 profile、写
      `dsh.profile.bundles`、处理冷静期豁免（`minimumReleaseAgeExclude`）与
      bundle 层的收尾。自己拼 `pnpm add` 等于只做了「装包」这一步，剩下的都要
      在本模块里各自补一遍，而且每补一处就多一处可能与官方行为漂移的实现。

      也因此**不再传 `--config.minimum-release-age=0`**：冷静期的判定与豁免
      交给 pnpm/dsh 自己，业务代码不越过这层。

      `DSH_HOME` 必须显式给出——`dsh` 靠它定位 profiles 目录，而本进程的环境里
      它可能存在但指向别处，缺了就会写到默认位置。
    */
    const dshBin = environment.dshBin
    if (dshBin === undefined) {
      await appendLog(logPath, '无法定位 dsh 可执行文件（缺少 NPM_CONFIG_PREFIX）')
      current = { ...current, running: false, status: 'failed', error: 'dsh-unavailable', finishedAt: Date.now() }
      return current
    }
    /*
      **先记下这次是「安装」还是「更新」。**

      更新时用户已经表过态（他把开关关着），此时再自动启用等于推翻他的选择。
      只有全新安装才该自动开——那时「装」就隐含「我要用它」。
    */
    const spec = `${name}@${resolved.version}`
    await appendLog(logPath, `${previouslyInstalled ? '更新' : '安装'}：dsh plugin --profile web add ${spec}`)

    /*
      **带 `--save-exact`，与官方 `updateBundle` 一致。**

      官方 `installBundle` 拼的是
      `['add', installSpec, ...saveExact ? ['--save-exact'] : [], ...registryArguments]`，
      而 `checkRegistryUpdate` 恒返回 `saveExact: true`——更新插件时写的永远是精确版本。

      不带这个标志时 pnpm 会写成 `^1.84.1` 这类范围：profile 的 `package.json` 里是范围，
      而冷静期豁免条目按精确版本记，两者对不上；下次安装就按范围解析到不同版本，
      同一个包于是攒出多个版本条目。
    */
    const code = await new Promise<number>(resolve => {
      const child = spawn(dshBin, ['plugin', '--profile', 'web', 'add', spec, '--save-exact'], {
        cwd: profile,
        env: { ...process.env, CI: '1', DSH_HOME: environment.dshHome },
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
      /*
        **只有全新安装才自动启用。**

        「装」隐含「我要用它」，所以首次安装后把 bundle 加进 `dsh.profile.bundles`
        是合理的。但**更新不能这么做**：用户此前把它关着，更新后强行打开等于推翻
        他的选择——他关掉它是有原因的。

        更新时 `dsh plugin add` 自己会保留 bundles 选择，不需要我们插手。
      */
      if (previouslyInstalled) {
        await appendLog(logPath, `保留原有启用状态：${name}`)
      } else {
        try {
          const activated = await activateBundleIfDeclared(profile, name)
          if (activated) await appendLog(logPath, `已加入 profile bundles：${name}`)
        } catch (error: unknown) {
          /* 启用失败不该让安装判为失败：包已装上，用户仍可手动开。 */
          await appendLog(logPath, `加入 profile bundles 失败：${error instanceof Error ? error.message : String(error)}`)
        }
      }
      /* 装好了就不需要备份了，删掉避免在 profile 里堆积。 */
      if (saved !== undefined) await discardProfileBackup(saved)
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
/**
 * 卸载一个插件：**先停用（从 bundles 移出），再 `pnpm remove`**。
 *
 * ## 为什么必须先停用
 *
 * 只跑 `pnpm remove` 会留下半套状态：包装备被删了，但 `dsh.profile.bundles` 里
 * 还留着它的名字——下次启动时 loader 找不到这个 bundle 层，插件视图里则显示成
 * 一个「有名字、没内容」的残影。用户看到的现象就是「卸了但还在列表里」。
 *
 * 官方 `dsh-plugin-manager.removeBundle` 的顺序正是如此：
 * `selectBundle(name, false)` → `pnpm remove` → `publishAndReload()`。
 * 这里做前两步；第三步（重新加载插件组合）需要热更新能力，本应用没有，因此
 * 由界面提示用户重启 Web 生效。
 *
 * ## 失败时不留中间态
 *
 * 停用成功而 `pnpm remove` 失败时，把 bundle 重新选回去——否则用户会得到一个
 * 「已停用但仍占用磁盘」的插件，既没删掉也没在使用。
 *
 * @param name - 包名。
 * @returns 是否成功，以及是否需要重启才完全生效。
 */
/**
 * 正在卸载的包名集合。
 *
 * 卸载要跑 `pnpm remove`（会改 `node_modules` 与 lockfile），耗时数秒到数十秒。
 * 这期间用户完全可能再点一次——两次 `pnpm remove` 并发写同一个 profile 会让
 * lockfile 与磁盘状态互相覆盖，轻则报错，重则留下半卸状态。
 *
 * 用进程内集合而不是文件锁：插件跑在网关的单个 Node 进程里，同一进程内判重
 * 足够；文件锁还要处理残留与跨平台锁语义，代价不成比例。
 */
const removingPlugins = new Set<string>()

export async function removePlugin(name: string): Promise<{ ok: boolean, error?: string, needRestart?: boolean }> {
  /*
    **同一插件禁止并发卸载。**
    在进入任何 IO 之前判重，把它当作一次明确的拒绝而不是静默忽略——调用方要能
    把这个结果转成「请勿重复操作」的提示，而不是看到一个空成功。
  */
  if (removingPlugins.has(name)) return { ok: false, error: 'plugin-remove-in-progress' }
  removingPlugins.add(name)

  const environment = resolveRepairEnvironment()
  if (environment === undefined || environment.pnpmBin === undefined) {
    removingPlugins.delete(name)
    return { ok: false, error: 'pnpm-unavailable' }
  }
  const profile = environment.profileDirectory
  try {
    return await removePluginUnlocked(name, profile, environment.pnpmBin)
  } finally {
    removingPlugins.delete(name)
  }
}

/**
 * 真正执行卸载，调用方必须已持有 `removingPlugins` 里的占位。
 *
 * @param name - 包名。
 * @param profile - profile 目录。
 * @param pnpmBin - pnpm 可执行文件路径，由调用方解析后传入。
 * @returns 是否成功，以及是否需要重启才完全生效。
 */
async function removePluginUnlocked(
  name: string,
  profile: string,
  pnpmBin: string,
): Promise<{ ok: boolean, error?: string, needRestart?: boolean }> {

  // 第一步：从 profile 的 bundles 里移出（停用整层）。
  const manifestPath = join(profile, 'package.json')
  let wasSelected = false
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { dsh?: { profile?: { bundles?: string[] } } }
    const previous = manifest.dsh?.profile?.bundles ?? []
    wasSelected = previous.includes(name)
    if (wasSelected) {
      manifest.dsh = {
        ...manifest.dsh,
        profile: { ...manifest.dsh?.profile, bundles: previous.filter(item => item !== name) },
      }
      await writeFileAtomic(manifestPath, `${JSON.stringify(manifest, undefined, 2)}\n`)
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }

  // 第二步：删掉依赖本身。
  const removed = await new Promise<{ ok: boolean, error?: string }>(resolve => {
    execFile(pnpmBin, ['remove', name], {
      cwd: profile,
      timeout: 120_000,
      env: process.env,
    }, (error, stdout, stderr) => {
      if (error === null) {
        resolve({ ok: true })
        return
      }
      // 把 pnpm 的输出带回去：失败原因通常是网络或 lockfile 冲突，用户需要看到。
      resolve({ ok: false, error: `${stdout ?? ''}${stderr ?? ''}${error.message}`.trim() })
    })
  })

  if (!removed.ok) {
    // 回滚停用，避免「已停用但仍占磁盘」的中间态。
    if (wasSelected) {
      try {
        const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { dsh?: { profile?: { bundles?: string[] } } }
        const previous = manifest.dsh?.profile?.bundles ?? []
        manifest.dsh = {
          ...manifest.dsh,
          profile: { ...manifest.dsh?.profile, bundles: previous.includes(name) ? previous : [...previous, name] },
        }
        await writeFileAtomic(manifestPath, `${JSON.stringify(manifest, undefined, 2)}\n`)
      } catch {
        // 回滚失败也只好作罢：错误已经上报，用户可重试。
      }
    }
    return { ok: false, ...(removed.error === undefined ? {} : { error: removed.error }) }
  }

  /*
    第三步：删完之后确认它真的不在依赖里了。

    官方还会 `publishAndReload()` 让组合立即生效；本应用没有热更新通道，
    所以返回 `needRestart` 让界面提示「重启 Web 后完全生效」——已加载的模块
    仍在当前进程内存里，直到重启才会消失。
  */
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      dependencies?: Record<string, string>, devDependencies?: Record<string, string>
    }
    const stillThere = Object.hasOwn(manifest.dependencies ?? {}, name) || Object.hasOwn(manifest.devDependencies ?? {}, name)
    if (stillThere) return { ok: false, error: 'still-in-dependencies' }
  } catch {
    // 读不到 package.json 时不阻断——pnpm 已成功即可。
  }

  return { ok: true, needRestart: true }
}

/**
 * 原子写入：先写临时文件再改名，避免中途失败留下半个 JSON。
 * @param path - 目标。
 * @param content - 内容。
 */
async function writeFileAtomic(path: string, content: string): Promise<void> {
  const temporary = `${path}.dsh-plugin-remove-${String(process.pid)}`
  await writeFile(temporary, content, { mode: 0o600 })
  await rename(temporary, path)
}
