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
import { FNOS_RUNTIME_STATUS_ROUTE } from '../contracts/runtime-status-contract.ts'
import { readRuntimeStatus } from './runtime-status.ts'

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
}
