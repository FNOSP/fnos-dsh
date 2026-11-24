/**
 * 中间件：把每个经过网关的代理请求记成一行日志。
 *
 * 只挂 `res` 的 `finish`/`close` 钩子，不改请求、不阻塞响应——日志是旁路，
 * 哪怕 DSH 完全不可达，代理链路也必须照常工作。
 *
 * @module fnos-gateway/proxy-request-log-middleware
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { NextFunction } from 'connect'

import { reportProxyRequest, type ProxyLogTarget } from './proxy-request-log.js'
import type { UpstreamSession } from './upstream-session.js'

/** 需要记录日志的请求。 */
export interface ProxyLogOptions {
  readonly upstreamHost: string
  readonly upstreamPort: number
}

/**
 * 生成请求日志中间件。
 * @param options - 上游地址。
 * @param session - 网关持有的 DSH 会话；上报时带上，否则会被 webServer 挡在路由外。
 * @returns connect 中间件。
 */
export function proxyRequestLogMiddleware(
  options: ProxyLogOptions,
  session: UpstreamSession,
): (req: IncomingMessage, res: ServerResponse, next: NextFunction) => void {
  /*
    `0.0.0.0` / `::` 是监听地址，不是可连接的地址。用它去 fetch 会失败，
    统一换成回环——日志本来就打在同一个进程的上游。
  */
  const connectable = options.upstreamHost === '0.0.0.0' || options.upstreamHost === '::'
    ? '127.0.0.1'
    : options.upstreamHost
  const target: ProxyLogTarget = { host: connectable, port: options.upstreamPort }
  return (req, res, next) => {
    const startedAt = Date.now()
    /*
      响应结束的两种情况都要记：

      - `finish`：正常写完；
      - `close`：连接被客户端提前掐断（`finish` 不会触发）。

      用 `once` 保证只记一条——两个事件可能都来。
    */
    let recorded = false
    const record = (): void => {
      if (recorded) return
      recorded = true
      /*
        只取路径，**丢掉查询串**：插件请求的查询串里可能带 token 或很长的参数，
        日志中心是给人扫读的地方，不该承载这些。
      */
      const path = (req.url ?? '/').split('?')[0] ?? '/'
      void reportProxyRequest(target, {
        method: req.method ?? 'GET',
        path,
        status: res.statusCode,
        durationMs: Date.now() - startedAt,
      }, session.current())
    }
    res.once('finish', record)
    res.once('close', record)
    next()
  }
}
