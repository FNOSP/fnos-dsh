/**
 * 运行日志落盘：按大小轮转的 `.log` 文件。
 *
 * ## 为什么要落盘
 *
 * 「日志」页读的是内存环形缓冲（上限 200 条）。宿主重启、应用升级都会把它清空
 * ——用户想回看「刚才那次安装失败」时，记录已经没了。落盘之后，即便页面里的
 * 那份丢了，磁盘上还有完整的。
 *
 * ## 为什么用 `rotating-file-stream`
 *
 * 按大小轮转 + 保留 N 份这件事看着简单，边界却不少：写入并发、轮转瞬间的原子性、
 * 文件名序号推进、并发进程同时写同一目录。这些自己写必然出错，而这是成熟库的
 * 正好职责。项目里的配置在 catalog 统一管理版本。
 *
 * ## 位置与文件布局
 *
 * `<profile>/gateway/`，与 `install-log.txt` / `mirror-log.txt` 同目录——「查看日志」
 * 按钮打开这一个目录就能看到全部：
 *
 * ```
 * runtime-log.log                    当前正在写的（固定名，随时 tail）
 * 20261124-1434-1-runtime-log.log    轮转出来的历史，序号越大越旧
 * runtime-log.log.txt                库自己记的轮转历史（换名/恢复用）
 * ```
 *
 * 当前文件**始终是这个固定名**，所以外部工具（tail、编辑器）不必猜时间戳。
 *
 * @module dsh-fnos/host/runtime-log-file
 */

import { join } from 'node:path'
import { createStream, type RotatingFileStream } from 'rotating-file-stream'

/** 单个文件的大小上限：2 MiB。按行平均 120 字节估算，约 1.7 万条。 */
const MAX_SIZE = '2M'

/** 保留的轮转份数（`runtime-log.1.log` … `runtime-log.5.log`）。 */
const MAX_FILES = 5

/** 日志文件名。 */
export const RUNTIME_LOG_FILE = 'runtime-log.log'

/** 当前流；`undefined` 表示没接上（无 profile 目录或初始化失败）。 */
let stream: RotatingFileStream | undefined

/**
 * 接上落盘流。
 *
 * 幂等：重复调用只会复用已有流。创建失败（目录不可写、磁盘满）时静默降级为
 * 「不落盘」——日志是旁路，写不进去不该让插件启动失败。
 *
 * @param profileDirectory - profile 绝对路径。
 */
export function attachRuntimeLogFile(profileDirectory: string): void {
  if (stream !== undefined) return
  const directory = join(profileDirectory, 'gateway')
  try {
    stream = createStream(RUNTIME_LOG_FILE, {
      path: directory,
      size: MAX_SIZE,
      maxFiles: MAX_FILES,
      /*
        `immutable: false`：允许库在轮转后复用序号。

        不传 `history`——它会让库写一份额外的 `.txt` 记录，而那一份与日志内容无关，
        用户在文件管理器里看到只会困惑。
      */
      immutable: false,
    })
    /*
      写盘失败只放弃落盘，不影响内存缓冲与页面。

      `on` 在这里的类型签名要求事件名落在 `RotatingFileStreamEventMap` 里，而该
      map 对 `error` 的声明来自 `WritableEventMap` 的交叉，TS 解析不出。用
      `addListener` 的宽签名绕开——运行时行为一致。
    */
    stream.addListener('error' as never, () => { stream = undefined })
  } catch {
    stream = undefined
  }
}

/**
 * 写一行到磁盘。
 *
 * 与内存缓冲接收的是同一行文本（已含时间戳与级别），因此两份记录可以互相对照。
 *
 * @param line - 单行文本。
 */
export function appendRuntimeLogFile(line: string): void {
  stream?.write(`${line}\n`)
}

/**
 * 断开落盘流（插件卸载时调用）。
 * @param done - 流关闭后的回调。
 */
export function detachRuntimeLogFile(done?: () => void): void {
  const current = stream
  stream = undefined
  if (current === undefined) {
    done?.()
    return
  }
  current.end(() => { done?.() })
}
