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

import { execFile } from 'node:child_process'

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
function runNrm(args: readonly string[]): Promise<{ code: number, output: string }> {
  return new Promise(resolve => {
    execFile('nrm', [...args], {
      timeout: NRM_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
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
    const notInstalled = /ENOENT|not found|command not found/iu.test(version.output)
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
