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

import type { Context } from '@deepseek-ai/cordis'
import type {
  RuntimeLogEntry,
  RuntimeLogLevel,
  RuntimeLogSnapshot,
} from '../contracts/runtime-status-contract.ts'

/** 默认保留条数。 */
export const DEFAULT_LOG_LIMIT = 200

/** 允许用户请求的上限，防止一次拉太多把响应撑大。 */
export const MAX_LOG_LIMIT = 2000

/** 缓冲本体。 */
let buffer: RuntimeLogEntry[] = []

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
export function registerLogCollector(ctx: Context, limit: number = MAX_LOG_LIMIT): void {
  buffer = new Array<RuntimeLogEntry>()
  sequence = 0
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
    },
  }), 'dsh-fnos: runtime log exporter')
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
  }
}

/** 仅供测试：清空缓冲。 */
export function resetLogsForTest(): void {
  buffer = []
  sequence = 0
}
