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
  setRepairHostLogger,
  setRepairLogSink,
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
  /*
    把宿主日志服务接到修复模块。

    修复过程原本只走 `console.log`，那些记录**不进运行日志中心**（console 写的是
    Node 标准输出，与 Cordis 日志服务是两条路）。注入后每行同时进日志中心，
    用户才能在「日志」页回看一次修复到底做了什么。
  */
  setRepairHostLogger(ctx.logger)
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: FNOS_DEPENDENCY_REPAIR_DIAGNOSE_ROUTE,
    handler: async (req, res) => {
      if (!trusted(req)) return send(res, 403, { error: 'remote-web-origin-not-trusted' })
      if (req.method !== 'POST' && req.method !== 'GET') return send(res, 405, { error: 'method-not-allowed' })
      try {
        const diagnosis = await diagnoseDependencyRepair(resolveRepairEnvironment())
        // 入口日志：用户报「点了没反应」时，先由这一行区分「请求没到」与「到了但
        // 判定为健康」。判定明细在 diagnoseDependencyRepair 内部输出。
        console.log(`[dsh-fnos][dependency-repair] ${FNOS_DEPENDENCY_REPAIR_DIAGNOSE_ROUTE} available=${String(diagnosis.available)} stale=${diagnosis.entries.length}`)
        send(res, 200, diagnosis)
      } catch (error) {
        console.warn('[dsh-fnos][dependency-repair] diagnose 失败', error)
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
        console.log(`[dsh-fnos][dependency-repair] ${FNOS_DEPENDENCY_REPAIR_RUN_ROUTE} 请求到达 hostAvailable=${String(environment !== undefined)}`)

        /*
          **整条路由只用一种协议：SSE。**

          这里曾把「环境不可用」「依赖状态正常」两个提前返回写成普通 JSON，
          只有真正跑修复那条路才用 SSE。结果客户端按 SSE 解析时收不到 `result`
          事件，健康 profile 上点修复必然报「修复失败：no-result」——而服务端
          日志里明明三步全 ok。协议不能按分支切换，否则每个分支都要记住客户端
          解析哪一套。

          因此响应头先发，所有出口都走 `emit('result', …)`；提前返回只是少推
          日志行，事件形态完全一致。
        */
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          // 关掉各级代理的缓冲，否则日志仍会被攒到最后一起出现。
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
        })
        const emit = (event: string, data: unknown): void => {
          res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        }

        /*
          **边走边发，不等结束。**

          修复要跑 `pnpm install`，真机上几十秒到几分钟。此前整份结果在结束时
          一次性返回，界面只能「先干等、最后突然冒出一大段日志」——用户看不出
          它是在跑还是卡住了。SSE 让每条日志立刻推给浏览器，前端像看终端一样
          逐行显示。
        */
        const release = setRepairLogSink(line => { emit('log', { line }) })
        try {
          const result = await runDependencyRepair(environment)
          console.log(`[dsh-fnos][dependency-repair] 修复结束 ok=${String(result.ok)} 步骤=${result.steps.map(step => `${step.id}:${step.status}`).join(',') || '无'}`)
          emit('result', result)
        } finally {
          release()
          res.end()
        }
      } catch (error) {
        console.warn('[dsh-fnos][dependency-repair] 修复失败', error)
        // 响应头已经发出去时不能再写 JSON，改为推一个 error 事件让前端显示。
        if (res.headersSent) {
          res.write(`event: error\ndata: ${JSON.stringify({ message: describe(error) })}\n\n`)
          res.end()
        } else {
          send(res, 500, { error: 'fnos-dependency-repair-failed', message: describe(error) })
        }
      }
    },
  }), 'dsh-fnos: dependency repair run')
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
