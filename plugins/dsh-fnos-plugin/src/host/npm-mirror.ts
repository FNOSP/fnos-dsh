/**
 * 「npm 镜像管理」：用 `nrm` 列出/切换 npm registry 加速源。
 *
 * ## 为什么用 nrm 而不是直接改 .npmrc
 *
 * 改 `.npmrc` 要自己处理「保留用户原有的其它配置、只换 registry 一行」这件事，
 * 而 nrm 已经做好了，并且 `nrm ls` 自带一份常用镜像列表与当前源标记。用户如果
 * 本来就在用 nrm，这里应当与他的习惯一致，而不是另建一套写入逻辑。
 *
 * ## 输出格式（实测 nrm 2.1.0）
 *
 * ```text
 *   npm ---------- https://registry.npmjs.org/
 * 星号 taobao ------- https://registry.npmmirror.com/
 * ```
 *
 * 行首的星号标记当前源；名字与 URL 之间是若干个减号。解析要同时容错：
 * 没有星号、减号数量不同、以及 nrm 的报错行。
 *
 * ## 未安装时不代装
 *
 * 安装 nrm 是全局操作（`npm i -g nrm`），会写用户的全局 node_modules。这类改动
 * 不该由应用替用户做——界面给出命令让用户自己执行，然后重新检测。
 *
 * @module dsh-fnos/npm-mirror
 */

import { execFile, spawn } from 'node:child_process'
import { appendLog, installLogPath, startLog } from './plugin-install.ts'

/** nrm 命令的超时（毫秒）。它要访问网络，给宽一点。 */
const NRM_TIMEOUT_MS = 30_000

/** 一个镜像源。 */
export interface NpmMirror {
  /** nrm 里的名字，如 `taobao`。 */
  readonly name: string
  /** registry URL。 */
  readonly registry: string
  /** 是否当前使用的源。 */
  readonly current: boolean
}

/** 镜像状态。 */
export interface NpmMirrorStatus {
  /** nrm 是否已安装。false 时界面给安装指引。 */
  readonly available: boolean
  /** 不可用原因。 */
  readonly reason?: string
  /** nrm 版本；读到才有。 */
  readonly version?: string
  /** 所有源，按 nrm 输出顺序（当前源仍在原位，不提到最前）。 */
  readonly mirrors: readonly NpmMirror[]
  /** 原始报错（便于排查）。 */
  readonly error?: string
}

/**
 * 执行 nrm 命令。
 * @param args - 参数。
 * @returns 退出码与合并输出。
 */
function runNrm(args: readonly string[]): Promise<{ code: number, output: string, codeName?: string }> {
  return new Promise(resolve => {
    execFile('nrm', [...args], {
      timeout: NRM_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
      env: process.env,
    }, (error, stdout, stderr) => {
      /*
        **`error.message` 必须并入 output。**

        实测：命令不存在时 execFile 的 `stdout` 与 `stderr` **都是空字符串**，
        `spawn nrm ENOENT` 只出现在 `error.message` 里。只用 stdout+stderr 判断
        「是否安装」永远为 false，于是「没装」被误报成「装了但执行失败」——
        用户看到的提示变成「重装 nrm」（而它压根没装过）。
      */
      const merged = `${stdout ?? ''}${stderr ?? ''}${error?.message ?? ''}`.trim()
      const rawCode = (error as { code?: unknown } | null)?.code
      const code = error === null
        ? 0
        : typeof rawCode === 'number' ? rawCode : 1
      resolve({
        code,
        output: merged,
        ...(typeof rawCode === 'string' ? { codeName: rawCode } : {}),
      })
    })
  })
}

/**
 * 从 `nrm ls` 输出里解析镜像列表。
 *
 * 单独导出以便测试：这是整个功能里唯一需要「读懂外部工具输出」的地方，
 * 而外部工具的格式最容易随版本变。
 *
 * @param output - nrm 的合并输出。
 * @returns 镜像列表。
 */
export function parseNrmList(output: string): NpmMirror[] {
  const mirrors: NpmMirror[] = []
  for (const rawLine of output.split('\n')) {
    const line = rawLine.trimEnd()
    if (line.trim() === '') continue
    // nrm 的报错行（` ERROR  ...` / ` SUCCESS  ...`）：跳过。
    if (/^\s*(?:ERROR|SUCCESS|WARN)\b/u.test(line)) continue

    /*
      形如：
        `  npm ---------- https://registry.npmjs.org/`
        `* taobao ------- https://registry.npmmirror.com/`
      行首 `*` 是可选的当前源标记；名字与 URL 之间至少两个 `-`。
    */
    const match = /^\s*(\*)?\s*(\S+)\s+-{2,}\s+(\S+)\s*$/u.exec(line)
    if (match === null) continue
    const [, star, name, registry] = match
    if (name === undefined || registry === undefined) continue
    // 只接受 http(s)：nrm 也可能打印别的东西（比如某源的自定义字段）。
    if (!/^https?:\/\//u.test(registry)) continue
    mirrors.push({ name, registry, current: star === '*' })
  }
  return mirrors
}

/**
 * 读镜像状态（`nrm ls` + `nrm --version`）。
 * @returns 状态。
 */
export async function readNpmMirrorStatus(): Promise<NpmMirrorStatus> {
  const version = await runNrm(['--version'])
  if (version.code !== 0) {
    /*
      区分「没装」与「装了但报错」。没装时 execFile 的 error.code 是 'ENOENT'，
      合并进 output 后是一句 `spawn nrm ENOENT`；其它失败（比如 .npmrc 读不了）
      要如实报出来，否则用户会以为是没装而去重装一遍。
    */
    // codeName 是 execFile 明确给出的 'ENOENT'；output 里也兜一层（其它平台可能只给文字）。
    const notInstalled = version.codeName === 'ENOENT' || /ENOENT|not found|command not found/iu.test(version.output)
    return {
      available: false,
      reason: notInstalled ? 'nrm-not-installed' : 'nrm-failed',
      mirrors: [],
      error: version.output,
    }
  }

  const listed = await runNrm(['ls'])
  const mirrors = parseNrmList(listed.output)
  if (mirrors.length === 0) {
    return {
      available: false,
      reason: 'nrm-output-unreadable',
      mirrors: [],
      ...(listed.output === '' ? {} : { error: listed.output }),
      ...(version.output === '' ? {} : { version: version.output }),
    }
  }
  return {
    available: true,
    ...(version.output === '' ? {} : { version: version.output }),
    mirrors,
  }
}

/**
 * 切换镜像源（`nrm use <name>`）。
 * @param name - 镜像名。
 * @returns 是否成功。
 */
export async function switchNpmMirror(name: string): Promise<{ ok: boolean, error?: string }> {
  // 名字必须是 nrm 认识的形式：它会被拼进命令行，不能带空格或选项符号。
  if (!/^[A-Za-z0-9._-]+$/u.test(name)) return { ok: false, error: 'invalid-mirror-name' }
  const result = await runNrm(['use', name])
  if (result.code === 0) return { ok: true }
  return { ok: false, error: result.output }
}

/**
 * 安装 nrm：`npm install -g nrm`。
 *
 * ## 为什么由应用代装
 *
 * 早前的做法是只显示命令、让用户自己去终端执行。但这是个 **fnOS 应用**：用户打开
 * 的是一个 Web 界面，未必有可以直接执行的 shell 环境；「请你去终端跑这条命令」
 * 等于把问题丢回去。既然界面已经提供了「安装」按钮，就该真的把它装上。
 *
 * 仍然只装 `nrm` 这一个包、只用 `-g` 标准安装方式，不改其它全局状态。
 *
 * @returns 是否成功。
 */
export async function installNrm(): Promise<{ ok: boolean, error?: string }> {
  const logPath = installLogPath('mirror')
  if (logPath !== undefined) await startLog(logPath, '准备安装 nrm（npm install -g nrm）')

  return new Promise(resolve => {
    /*
      用 spawn 而不是 execFile：需要**流式**把输出写进日志。

      execFile 只在结束时一次性给出全部输出，安装要几十秒，界面那段时间只能显示
      一个「正在安装…」而无任何进展——用户无法判断它是在下载、还是卡住了。
    */
    const child = spawn('npm', ['install', '-g', 'nrm'], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let pending = ''
    const flush = (): void => {
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed !== '' && logPath !== undefined) void appendLog(logPath, trimmed)
      }
    }
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => { pending += chunk; flush() })
    child.stderr?.on('data', (chunk: string) => { pending += chunk; flush() })

    let settled = false
    const finish = (result: { ok: boolean, error?: string }): void => {
      if (settled) return
      settled = true
      if (pending.trim() !== '' && logPath !== undefined) void appendLog(logPath, pending.trim())
      if (logPath !== undefined) {
        void appendLog(logPath, result.ok ? 'nrm 安装成功' : `nrm 安装失败：${result.error ?? 'unknown'}`)
      }
      resolve(result)
    }

    child.on('error', error => { finish({ ok: false, error: error.message }) })
    child.on('close', code => {
      finish(code === 0 ? { ok: true } : { ok: false, error: `npm 退出码 ${String(code)}` })
    })
  })
}

/**
 * 卸载 nrm：`npm uninstall -g nrm`。
 *
 * ## 为什么要提供卸载
 *
 * 用户可能只是想试一下、或者换了别的镜像管理方式。装得上去不掉，只能去终端
 * 手动处理——而这个界面明明已经承担了安装。
 *
 * ## 与安装共用一套日志
 *
 * 写同一个 `mirror-log.txt`，卡片上的进度与浮层看到的是同一条链路；先装后卸
 * 的记录连在一起，排查「什么时候动过它」时不用去别处找。
 *
 * @returns 是否成功。
 */
export async function uninstallNrm(): Promise<{ ok: boolean, error?: string }> {
  const logPath = installLogPath('mirror')
  if (logPath !== undefined) await startLog(logPath, '准备卸载 nrm（npm uninstall -g nrm）')

  return new Promise(resolve => {
    const child = spawn('npm', ['uninstall', '-g', 'nrm'], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let pending = ''
    const flush = (): void => {
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed !== '' && logPath !== undefined) void appendLog(logPath, trimmed)
      }
    }
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => { pending += chunk; flush() })
    child.stderr?.on('data', (chunk: string) => { pending += chunk; flush() })

    let settled = false
    const finish = (result: { ok: boolean, error?: string }): void => {
      if (settled) return
      settled = true
      if (pending.trim() !== '' && logPath !== undefined) void appendLog(logPath, pending.trim())
      if (logPath !== undefined) {
        void appendLog(logPath, result.ok ? 'nrm 卸载成功' : `nrm 卸载失败：${result.error ?? 'unknown'}`)
      }
      resolve(result)
    }

    child.on('error', error => { finish({ ok: false, error: error.message }) })
    child.on('close', code => {
      finish(code === 0 ? { ok: true } : { ok: false, error: `npm 退出码 ${String(code)}` })
    })
  })
}
