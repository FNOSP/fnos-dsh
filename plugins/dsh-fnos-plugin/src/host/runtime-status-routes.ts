/**
 * 「运行」状态的只读路由。
 *
 * 与其它路由一致要求同源：指标虽不敏感，但把宿主进程的 pid、内存与端口暴露给
 * 任意来源的页面没有正当用途。GET 即可，因为它不改变任何状态。
 *
 * @module dsh-fnos/runtime-status-routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { FNOS_RUNTIME_KILL_ROUTE, FNOS_RUNTIME_LOGS_ROUTE, FNOS_RUNTIME_STATUS_ROUTE } from '../contracts/runtime-status-contract.ts'
import type { RuntimeLogLevel } from '../contracts/runtime-status-contract.ts'
import { readLogs } from './runtime-logs.ts'
import { readRuntimeStatus } from './runtime-status.ts'
import { ALLOWED_SIGNALS, killProcess, type KillSignal } from './runtime-processes.ts'

function send(res: ServerResponse, status: number, value: unknown): void {
  // 指标每秒都在变，必须禁止缓存，否则轮询拿到的是同一份旧快照。
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

/**
 * 同源判定：只比 `host`，与其它路由保持同一口径。
 * @param req - 请求。
 * @returns 是否可信。
 */
function trusted(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (origin === undefined) return true
  const host = req.headers.host
  if (host === undefined) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

/**
 * 注册运行状态路由。
 * @param ctx - 宿主上下文（需已注入 `webServer`）。
 */
export function registerRuntimeStatusRoutes(ctx: Context): void {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: FNOS_RUNTIME_STATUS_ROUTE,
    handler: async (req, res) => {
      if (!trusted(req)) return send(res, 403, { error: 'remote-web-origin-not-trusted' })
      // 请求本身带 host，可据此补出 DSH 端口——它比环境变量更贴近「用户实际访问的端口」。
      const env = { ...process.env }
      const host = req.headers.host
      if (typeof host === 'string' && env.DSH_UPSTREAM_PORT === undefined) {
        const port = /:(\d+)$/.exec(host)?.[1]
        if (port !== undefined) env.DSH_UPSTREAM_PORT = port
      }
      try {
        send(res, 200, await readRuntimeStatus(env))
      } catch (error) {
        send(res, 500, { error: 'runtime-status-failed', message: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'dsh-fnos: runtime status')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: FNOS_RUNTIME_KILL_ROUTE,
    handler: async (req, res) => {
      /*
        结束进程是**写操作**，两道门槛都要过：
        1. 同源——跨站请求不能借这个路由杀掉宿主进程；
        2. POST——GET 会被预取/缓存机制意外触发，杀进程不能有这个可能。
      */
      if (!trusted(req)) return send(res, 403, { error: 'remote-web-origin-not-trusted' })
      if (req.method !== 'POST') return send(res, 405, { error: 'method-not-allowed' })
      try {
        const body = await readJsonBody(req)
        const pid = Number(body.pid)
        const signal = body.signal
        if (!Number.isInteger(pid) || pid <= 0) return send(res, 400, { error: 'invalid-pid' })
        if (typeof signal !== 'string' || !ALLOWED_SIGNALS.includes(signal as KillSignal)) {
          return send(res, 400, { error: 'signal-not-allowed' })
        }
        const result = await killProcess(pid, signal as KillSignal)
        if (!result.ok) return send(res, 409, { error: result.reason ?? 'kill-refused' })
        send(res, 200, { ok: true, pid, signal })
      } catch (error) {
        send(res, 500, { error: 'runtime-kill-failed', message: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'dsh-fnos: runtime kill')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: FNOS_RUNTIME_LOGS_ROUTE,
    handler: (req, res) => {
      if (!trusted(req)) return send(res, 403, { error: 'remote-web-origin-not-trusted' })
      const url = new URL(req.url ?? '/', 'http://localhost')
      const rawLimit = url.searchParams.get('limit')
      const rawLevel = url.searchParams.get('level')
      const query = url.searchParams.get('q') ?? undefined
      const levels: readonly RuntimeLogLevel[] = ['error', 'warn', 'info', 'debug']
      // 非法级别当作「不过滤」而不是报错：这是只读面板，宽容一点更有用。
      const level = rawLevel !== null && (levels as readonly string[]).includes(rawLevel)
        ? rawLevel as RuntimeLogLevel
        : undefined
      send(res, 200, readLogs({
        ...(rawLimit === null ? {} : { limit: Number(rawLimit) }),
        ...(level === undefined ? {} : { level }),
        ...(query === undefined ? {} : { query }),
      }))
    },
  }), 'dsh-fnos: runtime logs')
}

/** 请求体上限：只有 pid 与 signal，1KB 足够，超出即拒绝。 */
const MAX_BODY_BYTES = 1024

/**
 * 读 JSON 请求体。
 *
 * 带体积上限：这个路由能杀进程，不能让调用方用一个巨大的 body 把宿主拖住。
 * @param req - 请求。
 * @returns 解析后的对象；非法 JSON 抛错。
 */
async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = chunk as Buffer
    size += buf.length
    if (size > MAX_BODY_BYTES) throw new Error('body-too-large')
    chunks.push(buf)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.length === 0) return {}
  const value: unknown = JSON.parse(text)
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
}
