/**
 * 客户端统一日志入口。
 *
 * ## 为什么要有这一层
 *
 * `console.*` 只写浏览器控制台。用户在 NAS 上遇到问题时打不开 DevTools，而
 * 「日志」页读的是宿主 `ctx.logger` 的环形缓冲——两者之间没有通路。之前在依赖
 * 修复那里踩过：`console.log` 打的记录从未出现在日志中心。
 *
 * 因此前端所有日志都走这里：**同一条同时进控制台与日志中心**。控制台保留是给
 * 开发时看堆栈的，日志中心是给用户与排障用的。
 *
 * ## 为什么不是 `console` 的替身
 *
 * 这里不 patch `console`：第三方代码（Semi、React）的 console 输出量很大，
 * 全部转发会把日志缓冲冲干净，真正的插件日志反而被挤掉。只有本插件主动调用
 * 的地方才转发。
 *
 * ## 失败静默
 *
 * 转发是旁路：宿主不可达（本地开发、路由未注册）时丢掉即可。日志不该让业务
 * 失败，也不该在控制台刷一片「发送日志失败」的噪音。
 *
 * @module dsh-fnos/client/logger
 */

import { postTaskLog } from './services/runtime-status-client.ts'

/** 日志级别，与宿主日志服务的三个方法对应。 */
export type ClientLogLevel = 'info' | 'warn' | 'error'

/** 日志中心里的模块名来源。 */
const PREFIX = '[dsh-fnos]'

/**
 * 写一条日志到控制台与日志中心。
 * @param level - 级别。
 * @param message - 正文；非字符串会被序列化成一行。
 * @param detail - 附加信息（错误对象、上下文）；只进控制台，进日志中心的部分
 *   取其简短形式——日志中心是给人扫读的，不承载完整堆栈。
 */
function write(level: ClientLogLevel, message: string, detail?: unknown): void {
  const line = `${PREFIX} ${message}`

  // 控制台保留完整对象，便于看堆栈。
  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.debug
  if (detail === undefined) sink(line)
  else sink(line, detail)

  // 日志中心只收一行文本。
  const suffix = detail === undefined ? '' : ` ${describe(detail)}`
  void postTaskLog(level, `${line}${suffix}`)
}

/**
 * 把附加信息压成一行。
 *
 * 错误对象取 `message` 而不是 `stack`：日志中心是环形缓冲，一条多行堆栈能挤掉
 * 十几条正常记录；定位问题时有控制台的那份完整堆栈。
 * @param detail - 任意附加信息。
 * @returns 单行描述。
 */
function describe(detail: unknown): string {
  if (detail instanceof Error) return detail.message
  if (typeof detail === 'string') return detail
  try {
    return JSON.stringify(detail)
  } catch {
    return String(detail)
  }
}

/** 客户端日志。 */
export const log = {
  /**
   * 一般信息。
   * @param message - 正文。
   * @param detail - 附加信息。
   */
  info: (message: string, detail?: unknown): void => { write('info', message, detail) },

  /**
   * 可恢复的问题：功能降级但仍能用。
   * @param message - 正文。
   * @param detail - 附加信息。
   */
  warn: (message: string, detail?: unknown): void => { write('warn', message, detail) },

  /**
   * 失败。
   * @param message - 正文。
   * @param detail - 附加信息。
   */
  error: (message: string, detail?: unknown): void => { write('error', message, detail) },
}
