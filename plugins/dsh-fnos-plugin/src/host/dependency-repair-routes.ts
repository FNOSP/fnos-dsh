/**
 * 「依赖修复」的 Web 路由：只读诊断与修复执行。
 *
 * 两条路由都要求同源：修复会删 `node_modules` 并重装依赖，跨站触发等于让外部
 * 页面操纵安装环境。诊断同样是 POST，因为它的入参是「当前环境」而非查询条件。
 *
 * @module dsh-fnos/dependency-repair-routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import {
  FNOS_DEPENDENCY_REPAIR_DIAGNOSE_ROUTE,
  FNOS_DEPENDENCY_REPAIR_RUN_ROUTE,
} from '../contracts/dependency-repair-contract.ts'
import {
  diagnoseDependencyRepair,
  resolveRepairEnvironment,
  runDependencyRepair,
} from './dependency-repair.ts'

function send(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(value))
}

/**
 * 同源判定：只比 `host`。
 *
 * 与网关白名单路由一致——fnOS 网关会把 `host` 与 `origin` 一起改写成回环地址，
 * 两者在第二跳上是一致的；`x-forwarded-host` 属于平台代理，永不匹配。没有
 * `Origin` 的请求保持默认放行（非浏览器调用方）。
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
 * 注册依赖修复路由。
 *
 * @param ctx - 宿主上下文（需已注入 `webServer`）。
 */
export function registerDependencyRepairRoutes(ctx: Context): void {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: FNOS_DEPENDENCY_REPAIR_DIAGNOSE_ROUTE,
    handler: async (req, res) => {
      if (!trusted(req)) return send(res, 403, { error: 'remote-web-origin-not-trusted' })
      if (req.method !== 'POST' && req.method !== 'GET') return send(res, 405, { error: 'method-not-allowed' })
      try {
        send(res, 200, await diagnoseDependencyRepair(resolveRepairEnvironment()))
      } catch (error) {
        send(res, 500, { error: 'fnos-dependency-repair-diagnose-failed', message: describe(error) })
      }
    },
  }), 'dsh-fnos: dependency repair diagnose')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: FNOS_DEPENDENCY_REPAIR_RUN_ROUTE,
    handler: async (req, res) => {
      if (!trusted(req)) return send(res, 403, { error: 'remote-web-origin-not-trusted' })
      if (req.method !== 'POST') return send(res, 405, { error: 'method-not-allowed' })
      try {
        const environment = resolveRepairEnvironment()
        // 修复前先重跑一次诊断：界面上的结果可能已经过期（用户在这期间装过插件，
        // 或清单更新过）。以当下的失效条目为准，避免删掉仍然有效的豁免。
        const diagnosis = await diagnoseDependencyRepair(environment)
        if (!diagnosis.available) {
          return send(res, 503, {
            error: diagnosis.reason ?? 'fnos-host-unavailable',
            result: { ok: false, steps: [], removed: [], durationMs: 0, message: diagnosis.reason },
          })
        }
        send(res, 200, await runDependencyRepair(environment, diagnosis))
      } catch (error) {
        send(res, 500, { error: 'fnos-dependency-repair-failed', message: describe(error) })
      }
    },
  }), 'dsh-fnos: dependency repair run')
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
