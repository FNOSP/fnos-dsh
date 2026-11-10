/**
 * 「运行」分组里的进程树：枚举本应用及其子进程，并支持结束 / 强制结束。
 *
 * ## 为什么是「本应用进程树」而不是「会话里的后台任务」
 *
 * 查过宿主接口后确认这条路走不通，且不是能力缺失而是权限设计：
 *
 * | 接口 | 限制 |
 * | --- | --- |
 * | `dsh-terminal` 的 `list(owner)` / `kill(owner, id)` | 都要传 Agent 归属，源码注释写明「exactly one owner」。插件侧拿不到当前会话的 Agent，无法越权枚举别的会话 |
 * | `ctx.subprocess` | 只负责 spawn，**没有任何枚举接口**，列出的是「谁启动过」而非「现在有什么」 |
 *
 * 因此这里退到操作系统层：以本进程为根，沿 `ppid` 收集整棵子树。看到的是真实存在的
 * 进程（含 agent 起过的 bash、终端子进程），能真正结束；代价是它是 OS 视角而非
 * DSH 逻辑任务视角——这一点在界面上如实说明，不冒充「会话任务」。
 *
 * ## 只读 /proc，不 spawn `ps`
 *
 * 采集全在 `readFile` 上：`ps` 每次都要 fork 一个进程，为一个「看看有哪些进程」的
 * 面板付这个代价不值得，而且在受限沙箱里会直接 EPERM。
 *
 * @module dsh-fnos/runtime-processes
 */

import { readdir, readFile } from 'node:fs/promises'
import type { RuntimeProcess } from '../contracts/runtime-status-contract.ts'

/**
 * 允许结束的进程白名单：只认这几个信号。
 *
 * 不放开任意信号（如 SIGUSR2）——这不是通用 kill 工具，只需要「温柔地请它退出」
 * 与「强制退出」两档。
 */
export const ALLOWED_SIGNALS = ['SIGTERM', 'SIGKILL'] as const

/** 一次结束请求的信号类型。 */
export type KillSignal = typeof ALLOWED_SIGNALS[number]

/** 保护名单：这些 pid 永远不允许结束。 */
function isProtected(pid: number, self: number): boolean {
  // 本进程不能杀自己（面板会随之消失，且用户只是点了一下「结束」）；
  // init 进程同样保护，杀了会拖垮容器。
  return pid === self || pid <= 1
}

/**
 * 读单个进程的状态。
 *
 * `/proc/<pid>/stat` 的字段 2 是带括号的进程名，里面可能有空格与括号，
 * 因此不能用空格切分——从**最后一个** `)` 之后开始切，这是唯一稳妥的解析方式。
 *
 * @param pid - 进程号。
 * @returns 解析结果；读不到时返回 undefined。
 */
async function readStat(pid: number): Promise<{ ppid: number, state: string, name: string } | undefined> {
  try {
    const text = await readFile(`/proc/${String(pid)}/stat`, 'utf8')
    const close = text.lastIndexOf(')')
    if (close < 0) return undefined
    const name = text.slice(text.indexOf('(') + 1, close)
    const rest = text.slice(close + 2).split(' ')
    // rest[0] = state, rest[1] = ppid
    const state = rest[0] ?? ''
    const ppid = Number(rest[1])
    if (!Number.isFinite(ppid)) return undefined
    return { ppid, state, name }
  } catch {
    return undefined
  }
}

/**
 * 读命令行。
 *
 * `/proc/<pid>/cmdline` 以 NUL 分隔，末尾也有一个 NUL；转成空格便于展示。
 * @param pid - 进程号。
 * @returns 命令行；读不到时回退到 stat 里的进程名。
 */
async function readCmdline(pid: number, fallback: string): Promise<string> {
  try {
    const raw = await readFile(`/proc/${String(pid)}/cmdline`, 'utf8')
    const text = raw.split('\u0000').filter(Boolean).join(' ').trim()
    return text.length > 0 ? text : `[${fallback}]`
  } catch {
    return `[${fallback}]`
  }
}

/** 读 RSS（字节）。`/proc/<pid>/statm` 第二列是常驻页数。 */
async function readRss(pid: number): Promise<number | undefined> {
  try {
    const text = await readFile(`/proc/${String(pid)}/statm`, 'utf8')
    const pages = Number(text.split(' ')[1])
    if (!Number.isFinite(pages)) return undefined
    // 页大小在 Node 里没有直接 API，用 4096（Linux 主流架构的常量）足够展示用。
    return pages * 4096
  } catch {
    return undefined
  }
}

/**
 * 本应用的运行用户（uid）。
 *
 * fnOS 会为每个应用建一个专用用户（`TRIM_USERNAME`，实测形如
 * `fn-deepseek-harness`，uid 992），应用进程以它运行。因此「按 uid 枚举」比
 * 「按 ppid 爬树」更完整：它能捞到**同一个应用用户下所有进程**，包括
 * 网关（`gateway-proxy.mjs`，ppid=1 而非本进程的子进程）与各会话起的命令，
 * 而这些在纯进程树里是看不到的。
 *
 * 用 `process.getuid()` 直接拿，不需要读环境变量：插件的宿主代码就跑在这个
 * uid 下，天然是同一个。
 *
 * @returns 当前进程的 uid。
 */
function currentUid(): number {
  return typeof process.getuid === 'function' ? process.getuid() : -1
}

/**
 * 读 `/proc/<pid>/status` 里的 `Uid:` 行（取 real uid）。
 * @param pid - 进程号。
 * @returns uid；读不到时 undefined。
 */
async function readUid(pid: number): Promise<number | undefined> {
  try {
    const text = await readFile(`/proc/${String(pid)}/status`, 'utf8')
    const match = /^Uid:\s*(\d+)/mu.exec(text)
    return match === null ? undefined : Number(match[1])
  } catch {
    return undefined
  }
}

/** 枚举范围。 */
export type ProcessScope = 'tree' | 'user'

/**
 * 枚举本应用进程树。
 *
 * @param rootPid - 根进程号，默认当前进程。
 * @returns 进程列表（含根），按 pid 升序。
 */
export async function listProcessTree(
  rootPid: number = process.pid,
  scope: ProcessScope = 'tree',
): Promise<RuntimeProcess[]> {
  let entries: string[]
  try {
    entries = await readdir('/proc')
  } catch {
    // 非 Linux（macOS 没有 /proc）：返回空列表而不是报错——面板显示「不可用」，
    // 与「没有进程」区分开由界面处理。
    return []
  }

  /*
    先读所有进程的 stat 来还原父子关系。

    **上限是刻意的**：一次全表扫描在 NAS 上通常是几百个进程，但异常情况下
    （容器里跑了成千上万进程）会把这次请求拖成秒级。给一个明确上界，超出就
    只统计已经读到的部分——面板是观测工具，不该因为「进程太多」而卡住整个插件。
  */
  const MAX_SCAN = 4000
  const stats = new Map<number, { ppid: number, state: string, name: string }>()
  let scanned = 0
  for (const entry of entries) {
    if (scanned >= MAX_SCAN) break
    const pid = Number(entry)
    if (!Number.isInteger(pid) || pid <= 0) continue
    scanned += 1
    const stat = await readStat(pid)
    if (stat !== undefined) stats.set(pid, stat)
  }

  let tree: number[]
  if (scope === 'user') {
    /*
      按 uid 枚举：覆盖同一应用用户的**全部**进程。

      比进程树更完整——网关进程的 ppid 是 1（由框架拉起），在树里根本到不了；
      而它和 DSH 同属应用用户，按 uid 就能抓到。
    */
    const uid = currentUid()
    tree = []
    for (const pid of stats.keys()) {
      const owner = await readUid(pid)
      if (owner !== undefined && owner === uid) tree.push(pid)
    }
  } else {
    // 从根往下收集子节点：先把 ppid → 子 pid 建索引，再 BFS。
    const children = new Map<number, number[]>()
    for (const [pid, stat] of stats) {
      const list = children.get(stat.ppid)
      if (list === undefined) children.set(stat.ppid, [pid])
      else list.push(pid)
    }
    tree = []
    const queue = [rootPid]
    const seen = new Set<number>()
    while (queue.length > 0) {
      const pid = queue.shift() as number
      if (seen.has(pid)) continue
      seen.add(pid)
      tree.push(pid)
      for (const child of children.get(pid) ?? []) queue.push(child)
    }
  }

  /*
    排序：可操作的排前面，根进程固定最后。

    这一栏的用途是「找到该结束的那个进程」。根进程永远不可结束（按钮是置灰的
    「受保护」），把它按 pid 混在中间只会占掉最显眼的位置、还得让人先扫过去；
    放到末尾相当于「其它进程」列表之后的固定脚注。

    同组内仍按 pid 升序：稳定、可预期，刷新时不会跳来跳去。
  */
  const ordered = [...tree].sort((a, b) => {
    const rootA = a === rootPid ? 1 : 0
    const rootB = b === rootPid ? 1 : 0
    if (rootA !== rootB) return rootA - rootB
    return a - b
  })

  const out: RuntimeProcess[] = []
  for (const pid of ordered) {
    const stat = stats.get(pid)
    if (stat === undefined) continue
    const rss = await readRss(pid)
    out.push({
      pid,
      ppid: stat.ppid,
      name: stat.name,
      command: await readCmdline(pid, stat.name),
      // 读不到就不写这个键：`exactOptionalPropertyTypes` 下缺省字段必须是「不存在」
      // 而不是「存在但 undefined」。
      ...(rss === undefined ? {} : { rssBytes: rss }),
      // Z（zombie）等非运行态也照实给出，界面上可以区分「已退出待回收」。
      state: stat.state,
      isRoot: pid === rootPid,
      canKill: !isProtected(pid, rootPid),
    })
  }
  return out
}

/**
 * 结束一个进程。
 *
 * ## 安全边界（三条都必要）
 *
 * 1. **只能动本应用进程树内的进程**：pid 必须出现在 `listProcessTree` 的结果里。
 *    没有这条，一个被篡改的请求就能杀掉 NAS 上任意进程（包括别的应用）。
 * 2. **根进程与 init 不可杀**：杀了根面板就没了，用户只是点了一下按钮。
 * 3. **只接受两种信号**：SIGTERM（请它退出）与 SIGKILL（强制）。
 *
 * pid 复用是这类操作固有的风险：校验与实际发信号之间进程可能退出、pid 被复用。
 * 这里在发信号前重新确认一次它仍在本树内，把窗口压到最小。
 *
 * @param pid - 目标进程。
 * @param signal - SIGTERM 或 SIGKILL。
 * @param rootPid - 根进程号，默认当前进程。
 * @returns 是否已发出信号。
 */
export async function killProcess(
  pid: number,
  signal: KillSignal,
  rootPid: number = process.pid,
): Promise<{ ok: boolean, reason?: string }> {
  if (!ALLOWED_SIGNALS.includes(signal)) return { ok: false, reason: 'signal-not-allowed' }
  if (isProtected(pid, rootPid)) return { ok: false, reason: 'protected-process' }

  // 发信号前重新确认仍在树内，缩小「校验后 pid 被复用」的窗口。
  const tree = await listProcessTree(rootPid)
  const target = tree.find(item => item.pid === pid)
  if (target === undefined) return { ok: false, reason: 'not-in-tree' }

  try {
    process.kill(pid, signal)
    return { ok: true }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return { ok: false, reason: code ?? 'kill-failed' }
  }
}
