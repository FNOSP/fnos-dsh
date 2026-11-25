/**
 * 「日志」分组：挂一个 Cordis 日志接收器，把最近的记录留在环形缓冲里。
 *
 * ## 为什么走 `ctx.logger.exporter` 而不是读文件
 *
 * 真机确认这个应用**不写日志文件**，stdout/stderr 由 fnOS 接管且
 * `/proc/<pid>/fd/1` 读不到。也就是说「读哪个文件」这条路根本不存在。
 *
 * Cordis 自己就是日志的来源：所有插件的 `ctx.logger.info/warn/error` 都经过
 * `LoggerService`，注册一个 exporter 就能拿到结构化记录（时间、名称、级别、参数）。
 * 这是唯一不需要改应用启动链路、又能拿到真实日志的接法。
 *
 * ## 为什么是环形缓冲
 *
 * 日志会一直产生，面板只需要「最近 N 条」。缓冲有上限，满了丢最旧的——不设上限
 * 会让宿主进程随时间吃光内存，而这恰好是「运行时诊断面板」最不该造成的故障。
 *
 * @module dsh-fnos/runtime-logs
 */

import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import {
  RUNTIME_LOG_DEFAULT_LIMIT, RUNTIME_LOG_MAX_LIMIT,
  type RuntimeLogEntry,
  type RuntimeLogLevel,
  type RuntimeLogSnapshot,
} from '../contracts/runtime-status-contract.ts'
import { appendRuntimeLogFile, attachRuntimeLogFile, detachRuntimeLogFile, searchLogFiles } from './runtime-log-file.ts'

/** 默认保留条数。 */
export const DEFAULT_LOG_LIMIT = RUNTIME_LOG_DEFAULT_LIMIT

/** 允许用户请求的上限，防止一次拉太多把响应撑大。 */
export const MAX_LOG_LIMIT = RUNTIME_LOG_MAX_LIMIT

/** 缓冲本体。 */
let buffer: RuntimeLogEntry[] = []

/** 落盘目录；`undefined` 表示没接上（无 profile 或写盘不可用）。 */
let currentLogDirectory: string | undefined

/** 单调递增序号，用于去重与稳定排序。 */
let sequence = 0

/** 把 Cordis 的数字级别映射成可读级别。 */
function toLevel(level: number): RuntimeLogLevel {
  // LoggerLevel: ERROR=0, WARN=1, INFO=2, DEBUG=3（数值越大越啰嗦）
  if (level <= 0) return 'error'
  if (level === 1) return 'warn'
  if (level === 2) return 'info'
  return 'debug'
}

/**
 * 把日志参数压成一行文本。
 *
 * 参数可能是 Error、对象或任意值：`String()` 对 Error 会给出 `Error: msg`，
 * 对对象会给出 `[object Object]`。这里对对象走 JSON，Error 取 message + stack
 * 首行，其余直接 String —— 目标是「可读、不丢关键信息」。
 * @param args - 原始参数。
 * @returns 单行文本。
 */
function stringify(args: readonly unknown[]): string {
  return args.map(arg => {
    if (arg instanceof Error) {
      const head = arg.stack?.split('\n')[0] ?? `${arg.name}: ${arg.message}`
      return head
    }
    if (typeof arg === 'string') return arg
    if (arg === null || arg === undefined) return String(arg)
    if (typeof arg === 'object') {
      try {
        return JSON.stringify(arg)
      } catch {
        return String(arg)
      }
    }
    return String(arg)
  }).join(' ')
}

/**
 * 注册日志采集器。
 *
 * 用 `ctx.effect` 包住 exporter 的注册，插件的 effect 结束时自动摘除——
 * 否则插件被停用后 exporter 仍留在 logger 里，缓冲会继续增长却没人读。
 *
 * @param ctx - 宿主上下文。
 * @param limit - 环形缓冲上限。
 */
export function registerLogCollector(
  ctx: Context,
  limit: number = MAX_LOG_LIMIT,
  profileDirectory?: string,
): void {
  buffer = new Array<RuntimeLogEntry>()
  sequence = 0
  /*
    **同一行既进内存缓冲，也写进磁盘。**

    内存缓冲只有 200 条且重启即失；磁盘那份按大小轮转保留，用于回看历史。两份
    内容一致（同一行文本，含时间戳与级别），可以互相对照。
  */
  if (profileDirectory !== undefined) {
    currentLogDirectory = join(profileDirectory, 'gateway')
    attachRuntimeLogFile(profileDirectory)
  }
  ctx.effect(() => ctx.logger.exporter({
    // 接收全部级别：筛选是界面的事，采集端先过滤会让用户查不到 debug。
    levels: { default: 3 },
    export(message) {
      sequence += 1
      const entry: RuntimeLogEntry = {
        seq: sequence,
        at: message.ts,
        name: message.name,
        level: toLevel(message.level),
        text: stringify(message.args),
      }
      buffer.push(entry)
      if (buffer.length > limit) {
        // 一次多丢一些，避免每来一条都执行 splice(0, 1)。
        buffer.splice(0, buffer.length - limit)
      }
      /* 落盘一行：与上面入缓冲的是同一条记录。 */
      appendRuntimeLogFile(`${new Date(entry.at).toISOString()} [${entry.level}] ${entry.name} ${entry.text}`)
    },
  }), 'dsh-fnos: runtime log exporter')
  /* 流随插件卸载一起收尾：不处理会让最后几行留在用户态缓冲区里。 */
  ctx.effect(() => () => { detachRuntimeLogFile() })
}

/**
 * 取最近的日志。
 *
 * @param options - 过滤条件。
 * @param options.limit - 最多返回条数，默认 200，上限 MAX_LOG_LIMIT。
 * @param options.level - 只要该级别；不传表示全部。
 * @param options.query - 大小写不敏感的子串匹配（匹配名称与正文）。
 * @returns 快照；`total` 是过滤前的缓冲总数，便于界面显示「200 / 1200」。
 */
export function readLogs(options: {
  limit?: number
  level?: RuntimeLogLevel
  query?: string
  /** 是否连磁盘上的历史文件一起查。 */
  scope?: 'memory' | 'files'
} = {}): RuntimeLogSnapshot {
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_LOG_LIMIT, 1), MAX_LOG_LIMIT)
  const query = options.query?.trim().toLowerCase()
  // 从新到旧取：面板上最关心刚发生的事。
  const matched: RuntimeLogEntry[] = []
  for (let i = buffer.length - 1; i >= 0; i -= 1) {
    const entry = buffer[i] as RuntimeLogEntry
    if (options.level !== undefined && entry.level !== options.level) continue
    if (query !== undefined && query.length > 0) {
      const hay = `${entry.name} ${entry.text}`.toLowerCase()
      if (!hay.includes(query)) continue
    }
    matched.push(entry)
    if (matched.length >= limit) break
  }
  return {
    total: buffer.length,
    entries: matched,
    limit,
    scope: options.scope ?? 'memory',
    ...(currentLogDirectory === undefined ? {} : { logDirectory: currentLogDirectory }),
  }
}

/**
 * 读日志；**有搜索词时把磁盘历史也取回来，合并去重**。
 *
 * ## 为什么合并而不是二选一
 *
 * 内存缓冲只有 200 条且重启即失，磁盘上的 `.log` 按大小轮转保留。用户输入关键词
 * 是为了找「现在不在屏幕上的那条」——只查内存搜不到，只查文件又会漏掉最近写入
 * （文件是异步落盘，最后几行可能还在内存里）。
 *
 * ## 去重依据
 *
 * 文件行与内存条目的时间戳精度不同（内存是毫秒、文件是 ISO 秒级），所以不能比
 * `seq` 或对象相等。用「**时间戳去毫秒 + 名字 + 正文**」作为身份：同一条日志在
 * 两份里的这三项一致。
 *
 * @param options - 过滤条件与范围。
 * @param options.limit - 最多返回条数。
 * @param options.level - 只要该级别。
 * @param options.query - 搜索词。
 * @param options.scope - `memory` 只查缓冲；`files` 合并磁盘历史。
 * @returns 日志快照。
 */
export async function readLogsWithScope(options: {
  limit?: number
  level?: RuntimeLogLevel
  query?: string
  scope?: 'memory' | 'files'
} = {}): Promise<RuntimeLogSnapshot> {
  const memory = readLogs(options)
  if (options.scope !== 'files' || currentLogDirectory === undefined) return memory

  const limit = memory.limit
  const fromFiles = await searchLogFiles(currentLogDirectory.replace(/\/gateway$/u, ''), {
    ...(options.level === undefined ? {} : { level: options.level }),
    ...(options.query === undefined ? {} : { query: options.query }),
    limit,
  })

  /*
    **文件在前（更旧），内存在后（更新），按时间倒序合并。**

    身份键取「秒级时间戳 + 名字 + 正文」：文件行只精确到秒，用它做归一才能与内存
    条目对上。
  */
  const identity = (at: number, name: string, text: string): string =>
    `${String(Math.floor(at / 1000))}|${name}|${text}`
  const seen = new Set<string>()
  const merged: RuntimeLogEntry[] = []
  const push = (entry: RuntimeLogEntry): void => {
    if (merged.length >= limit) return
    const key = identity(entry.at, entry.name, entry.text)
    if (seen.has(key)) return
    seen.add(key)
    merged.push(entry)
  }

  /* 内存条目带真实 seq，优先保留它们（界面按 seq 做 key）。 */
  for (const entry of memory.entries) push(entry)
  for (const [index, entry] of fromFiles.entries()) {
    push({ seq: -(index + 1), at: entry.at, name: entry.name, level: entry.level, text: entry.text })
  }
  merged.sort((a, b) => b.at - a.at)

  return {
    total: merged.length,
    entries: merged.slice(0, limit),
    limit,
    scope: 'files',
    ...(currentLogDirectory === undefined ? {} : { logDirectory: currentLogDirectory }),
  }
}

/** 仅供测试：清空缓冲。 */
export function resetLogsForTest(): void {
  buffer = []
  sequence = 0
}
