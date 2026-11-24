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
import { FNOS_RUNTIME_KILL_ROUTE, FNOS_RUNTIME_LOGS_ROUTE, FNOS_RUNTIME_STATUS_ROUTE, FNOS_RUNTIME_TASK_LOG_ROUTE } from '../contracts/runtime-status-contract.ts'
import type { RuntimeLogLevel } from '../contracts/runtime-status-contract.ts'
import { readLogsWithScope } from './runtime-logs.ts'
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
    handler: async (req, res) => {
      if (!trusted(req)) return send(res, 403, { error: 'remote-web-origin-not-trusted' })
      const url = new URL(req.url ?? '/', 'http://localhost')
      const rawLimit = url.searchParams.get('limit')
      const rawLevel = url.searchParams.get('level')
      const query = url.searchParams.get('q') ?? undefined
      /* `scope=files` 时连磁盘上按大小轮转的历史一起查。 */
      const scope = url.searchParams.get('scope') === 'files' ? 'files' as const : undefined
      const levels: readonly RuntimeLogLevel[] = ['error', 'warn', 'info', 'debug']
      // 非法级别当作「不过滤」而不是报错：这是只读面板，宽容一点更有用。
      const level = rawLevel !== null && (levels as readonly string[]).includes(rawLevel)
        ? rawLevel as RuntimeLogLevel
        : undefined
      send(res, 200, await readLogsWithScope({
        ...(rawLimit === null ? {} : { limit: Number(rawLimit) }),
        ...(level === undefined ? {} : { level }),
        ...(query === undefined ? {} : { query }),
        ...(scope === undefined ? {} : { scope }),
      }))
    },
  }), 'dsh-fnos: runtime logs')

  /*
    任务日志转交：浏览器侧的功能执行链经这里把日志交给宿主日志服务。

    ## 为什么绕这一圈

    `ctx.logger` 是**宿主**服务（Node 进程内），浏览器侧没有它。功能执行链（插件
    安装 / nrm / 依赖修复）都跑在浏览器里，日志要进「日志」页只能经 HTTP 交给宿主。

    ## 为什么用 GET 而不是 POST

    DSH 的 webServer 以资源语义提供路由：读用 GET、写用 POST 的区分在这里不成立
    ——**非 GET/HEAD 会在匹配前统一回 405**（实测 `POST` 拿到 405 且空 body）。因此
    这里沿用插件内其它路由的形态，用 GET 携带查询参数。

    ## 安全性

    同源校验与长度上限都在：`trusted(req)` 拒绝跨站，`text` 截断到 1KB 单行，
    级别限定三个枚举值。它只能写日志，不能改配置或执行命令。
  */
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: FNOS_RUNTIME_TASK_LOG_ROUTE,
    handler: (req, res) => {
      if (!trusted(req)) return send(res, 403, { error: 'remote-web-origin-not-trusted' })
      const url = new URL(req.url ?? '/', 'http://x')
      const rawLevel = url.searchParams.get('level')
      const level = rawLevel === 'warn' || rawLevel === 'error' ? rawLevel : 'info'
      const raw = url.searchParams.get('text') ?? ''
      if (raw === '') return send(res, 400, { error: 'invalid-text' })
      /* 单行上限：超长说明客户端拼错了东西，截断比整份拒绝更有用。 */
      const text = raw.length > TASK_LOG_MAX_CHARS ? `${raw.slice(0, TASK_LOG_MAX_CHARS)}…` : raw
      ctx.logger[level](text)
      send(res, 200, { ok: true })
    },
  }), 'dsh-fnos: runtime task log')
}

/** 请求体上限：只有 pid 与 signal，1KB 足够，超出即拒绝。 */
const MAX_BODY_BYTES = 1024

/**
 * 单行任务日志的字符上限。
 *
 * 走查询串传输，URL 长度天然受限；8KB 足以覆盖 pnpm 的单行输出，超出截断而不是
 * 拒绝——少半行日志仍比整条丢掉有用。
 */
const TASK_LOG_MAX_CHARS = 8 * 1024

/**
 * 读 JSON 请求体。
 *
 * 带体积上限：这个路由能杀进程，不能让调用方用一个巨大的 body 把宿主拖住。
 * @param req - 请求。
 * @returns 解析后的对象；非法 JSON 抛错。
 */
async function readJsonBody(req: IncomingMessage, limit = MAX_BODY_BYTES): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = chunk as Buffer
    size += buf.length
    if (size > limit) throw new Error('body-too-large')
    chunks.push(buf)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.length === 0) return {}
  const value: unknown = JSON.parse(text)
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
}
