/**
 * 「运行」分组的契约：端口信息与进程指标。
 *
 * 这一组数据只读、只用于展示，不参与任何控制流。契约放在这里是因为宿主与
 * 浏览器必须对「哪个数是从哪来的」用同一套说法——两边各写一份字段名，界面上
 * 就会出现「显示 CPU 0% 但进程在跑」这类无声漂移。
 *
 * ## 为什么区分 `source`
 *
 * 三类指标的可靠程度不同，混在一起会被当成同等可信：
 *
 * | 字段 | 来源 | 可靠性 |
 * | --- | --- | --- |
 * | 端口 | 配置变量 / 请求头 | 确定（就是实际监听的那个） |
 * | CPU、内存 | `process.cpuUsage()`、`process.memoryUsage()` | 确定（本进程实测） |
 * | 磁盘读写 | `/proc/<pid>/io` | 仅 Linux 有；读不到时给 `null`，**不要**填 0 |
 *
 * 读不到就是读不到：填 0 会让用户以为「没有读写」，与「读不到」是两回事。
 *
 * @module dsh-fnos/runtime-status-contract
 */

/** 运行状态的只读快照。 */
export const FNOS_RUNTIME_STATUS_ROUTE = '/plugins/dsh-fnos/runtime/status'

/** 端口信息。 */
export interface RuntimePorts {
  /** DSH Web 监听端口（浏览器访问应用时用的那个）。 */
  readonly web?: number
  /** fnOS 网关入口端口（用户在 NAS 上访问的端口）。 */
  readonly gateway?: number
}

/** 一次性进程指标。 */
export interface RuntimeMetrics {
  /** 进程运行时长（毫秒）。 */
  readonly uptimeMs: number
  /**
   * CPU 占用百分比（0–100，按整机核数归一）。
   *
   * **首帧没有值**：百分比必须由两次采样求差得到，只有一个时间点算不出来。
   * 因此首次调用返回 `undefined`，客户端采集两次后才有曲线。
   */
  readonly cpuPercent?: number
  /** 常驻内存（字节）。 */
  readonly rssBytes: number
  /** 堆内存已用（字节）。 */
  readonly heapUsedBytes: number
  /** 堆内存上限（字节）。 */
  readonly heapTotalBytes: number
  /** 磁盘累计读字节；读不到时为 `null`（不是 0）。 */
  readonly diskReadBytes: number | null
  /** 磁盘累计写字节；读不到时为 `null`（不是 0）。 */
  readonly diskWriteBytes: number | null
  /** 采样时刻（epoch 毫秒）。 */
  readonly at: number
}

/** 运行状态响应。 */
export interface RuntimeStatus {
  /** 进程 pid。 */
  readonly pid: number
  /** 运行环境标识（如 `fnos` / `local`）。 */
  readonly platform: string
  readonly ports: RuntimePorts
  readonly metrics: RuntimeMetrics
}
