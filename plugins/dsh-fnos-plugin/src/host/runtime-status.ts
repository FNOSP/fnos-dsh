/**
 * 「运行」分组的宿主侧采集：端口与进程指标。
 *
 * ## 只读，且不引入依赖
 *
 * 全部数据来自 Node 自带能力：`process.memoryUsage()`、`process.cpuUsage()`、
 * `process.uptime()`，Linux 上再读 `/proc/<pid>/io`。没有 child_process 调用，
 * 也没有 `pidusage` 之类的包——展示进程自身占比不值得再起一个子进程去 `ps`。
 *
 * ## CPU 百分比为什么要「上一次采样」
 *
 * `process.cpuUsage()` 给的是**累计** CPU 时间，单次读取算不出百分比，必须用两次
 * 读数之差除以墙钟差。因此模块内保留上一次采样；第一次调用返回 `undefined`，
 * 客户端轮询两次后曲线才有值。这不是缺陷，是百分比的固有定义。
 *
 * @module dsh-fnos/runtime-status
 */

import { readFile } from 'node:fs/promises'
import { availableParallelism } from 'node:os'
import type {
  RuntimeMetrics,
  RuntimePorts,
  RuntimeStatus,
} from '../contracts/runtime-status-contract.ts'
import { listProcessTree } from './runtime-processes.ts'

/** 上一次 CPU 采样，用于求差。 */
interface CpuSample {
  readonly cpuMicros: number
  readonly at: number
}

let lastCpu: CpuSample | undefined

/** 累计 CPU 时间（微秒）。 */
function cpuMicros(): number {
  const usage = process.cpuUsage()
  return usage.user + usage.system
}

/**
 * 读 `/proc/<pid>/io` 的 `read_bytes` / `write_bytes`。
 *
 * 只有 Linux 有这份文件；其它平台或权限不足时返回 `null`——**不是** 0。
 * 用 0 会让界面显示「无读写」，与「读不到」混淆。
 * @returns 读写字节数，读不到时为 null。
 */
async function readDiskIo(): Promise<{ read: number, write: number } | null> {
  try {
    const text = await readFile(`/proc/${String(process.pid)}/io`, 'utf8')
    const pick = (key: string): number | undefined => {
      const match = new RegExp(`^${key}:\\s*(\\d+)$`, 'm').exec(text)
      // exec 不匹配时返回 null（不是 undefined）。
      return match === null ? undefined : Number(match[1])
    }
    const read = pick('read_bytes')
    const write = pick('write_bytes')
    if (read === undefined || write === undefined) return null
    return { read, write }
  } catch {
    return null
  }
}

/**
 * 读网络累计收发字节。
 *
 * **口径要如实说明**：Node 没有「本进程的网络字节」API，Linux 上能读到的是
 * `/proc/<pid>/net/dev`——它属于该进程所在的**网络命名空间**，在 fnOS 这种原生
 * 应用里就是整机所有非回环网卡的累计收发。它不是严格意义上的「本应用网速」，
 * 因此界面上标注为「网络」而不是「应用网络」，读不到时给 `null`。
 *
 * @returns 收/发字节数，读不到时为 null。
 */
async function readNetworkIo(): Promise<{ rx: number, tx: number } | null> {
  try {
    const text = await readFile(`/proc/${String(process.pid)}/net/dev`, 'utf8')
    let rx = 0
    let tx = 0
    let found = false
    for (const line of text.split('\n')) {
      const idx = line.indexOf(':')
      if (idx < 0) continue
      const name = line.slice(0, idx).trim()
      // 回环不计入：它只反映本机内部流量，会让「网速」虚高。
      if (name === 'lo') continue
      const cols = line.slice(idx + 1).trim().split(/\s+/u)
      // net/dev 的列固定：第 0 列收字节、第 8 列发字节。
      const rxBytes = Number(cols[0])
      const txBytes = Number(cols[8])
      if (!Number.isFinite(rxBytes) || !Number.isFinite(txBytes)) continue
      rx += rxBytes
      tx += txBytes
      found = true
    }
    return found ? { rx, tx } : null
  } catch {
    return null
  }
}

/**
 * 端口信息。
 *
 * DSH 端口取环境变量 `DSH_UPSTREAM_PORT`（应用启动脚本写的就是它）；网关端口取
 * `wizard_port`——那是 fnOS 里用户访问应用的端口。两者可能相同（网关把固定端口
 * 转发给同端口的 DSH），因此这里如实各报各的，不推断相等关系。
 *
 * @param env - 环境变量，便于测试注入。
 * @returns 端口信息；解析不出时字段缺省。
 */
export function resolveRuntimePorts(env: NodeJS.ProcessEnv = process.env): RuntimePorts {
  const parse = (value: string | undefined): number | undefined => {
    if (value === undefined) return undefined
    const n = Number.parseInt(value, 10)
    return Number.isFinite(n) && n > 0 && n < 65536 ? n : undefined
  }
  // DSH 自身端口：应用脚本用 DSH_UPSTREAM_PORT，本地开发常用 DSH_WEB_PORT。
  const web = parse(env.DSH_UPSTREAM_PORT) ?? parse(env.DSH_WEB_PORT)
  // 网关端口：fnOS 注入的 wizard_port 就是用户访问的端口。
  const gateway = parse(env.wizard_port)
  return {
    ...(web === undefined ? {} : { web }),
    ...(gateway === undefined ? {} : { gateway }),
  }
}

/**
 * 采集一次进程指标。
 *
 * @param now - 采样时刻，默认 Date.now()；测试可注入以得到确定的时间差。
 * @returns 本次指标。
 */
export async function collectMetrics(now: number = Date.now()): Promise<RuntimeMetrics> {
  const memory = process.memoryUsage()
  const cpu = cpuMicros()
  const previous = lastCpu
  lastCpu = { cpuMicros: cpu, at: now }

  // 第一次没有上一次采样可减，百分比留空而不是给一个想象中的数。
  let cpuPercent: number | undefined
  if (previous !== undefined) {
    const elapsedMs = now - previous.at
    if (elapsedMs > 0) {
      const usedMs = (cpu - previous.cpuMicros) / 1000
      // 按逻辑核数归一：8 核跑满一个核是 12.5%，与系统监视器口径一致。
      const cores = Math.max(availableParallelism(), 1)
      cpuPercent = Math.min(100, Math.max(0, (usedMs / elapsedMs / cores) * 100))
    }
  }

  const io = await readDiskIo()
  const net = await readNetworkIo()
  return {
    uptimeMs: Math.round(process.uptime() * 1000),
    ...(cpuPercent === undefined ? {} : { cpuPercent }),
    rssBytes: memory.rss,
    heapUsedBytes: memory.heapUsed,
    heapTotalBytes: memory.heapTotal,
    diskReadBytes: io === null ? null : io.read,
    diskWriteBytes: io === null ? null : io.write,
    netRxBytes: net === null ? null : net.rx,
    netTxBytes: net === null ? null : net.tx,
    at: now,
  }
}

/**
 * 组装一份运行状态快照。
 *
 * @param env - 环境变量，便于测试注入。
 * @returns 运行状态。
 */
export async function readRuntimeStatus(env: NodeJS.ProcessEnv = process.env): Promise<RuntimeStatus> {
  // 默认按 uid 枚举：比进程树完整（网关进程的 ppid 是 1，树里到不了）。
  const processes = await listProcessTree(process.pid, 'user')
  return {
    pid: process.pid,
    platform: env.DSH_HOME === undefined || env.DSH_HOME.length === 0 ? 'local' : 'fnos',
    ports: resolveRuntimePorts(env),
    metrics: await collectMetrics(),
    processes,
    // 只有根进程在列表里才说明真的读到了 /proc；空数组可能是「读不到」。
    processTreeAvailable: processes.some(item => item.isRoot),
    processScope: 'user',
    ...(typeof process.getuid === 'function' ? { uid: process.getuid() } : {}),
  }
}

/** 仅供测试：清掉上一次采样，让下一次重新当作首帧。 */
export function resetCpuSamplingForTest(): void {
  lastCpu = undefined
}
