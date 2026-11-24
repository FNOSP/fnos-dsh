/**
 * 把网关代理的请求写进 DSH 的运行日志中心。
 *
 * ## 为什么需要这一层
 *
 * 插件通过网关暴露的路由（`/dsh-market`、`/connect`、`/fnos-plugins` 等）是它们
 * 对外工作的主要方式。请求成功还是失败、走的是哪条路径、耗时多少，只有网关知道
 * ——而用户排障时看的「日志」页读的是 DSH 宿主侧 `ctx.logger` 的缓冲，两者之间
 * 没有通路。没有这一层，插件请求在日志里完全不可见。
 *
 * ## 为什么走 HTTP 而不是直接调 logger
 *
 * 网关是**独立进程**（`packages/fnos-gateway`），运行在自己的 Node 里，进程内
 * 拿不到 DSH 的 `ctx`。唯一可用的通道是 DSH 已经暴露的
 * `/plugins/dsh-fnos/runtime/task-log`（只写日志、不能改配置，见该路由的安全说明）。
 *
 * ## 为什么不上报全部字段
 *
 * 日志中心是 200 条环形缓冲。记全套请求头或请求体，几次批量加载就能把它冲干净，
 * 真正的错误反而留不住。这里只记「方法 + 路径 + 状态码 + 耗时」——足以定位
 * 「哪个插件调了什么、成没成功、慢不慢」。
 *
 * @module fnos-gateway/proxy-request-log
 */

/** 上报目标：DSH 的日志路由与上游地址。 */
export interface ProxyLogTarget {
  /** 上游主机（DSH webServer 所在）。 */
  readonly host: string
  /** 上游端口。 */
  readonly port: number
}

/** 一条请求日志。 */
export interface ProxyRequestRecord {
  readonly method: string
  /** 请求路径；**不含查询串**（可能带凭据或很长的参数）。 */
  readonly path: string
  readonly status: number
  readonly durationMs: number
}

/** 单次上报的超时。日志是旁路，不该拖住代理链路。 */
const REPORT_TIMEOUT_MS = 2000

/**
 * 状态码是否值得标成 warn / error。
 *
 * 4xx 多数是调用方写错了路径或没带凭据，值得看一眼但不是系统故障；5xx 与超时
 * 才是真错误。
 *
 * @param status - HTTP 状态码。
 * @returns 日志级别。
 */
export function levelOf(status: number): 'info' | 'warn' | 'error' {
  if (status >= 500) return 'error'
  if (status >= 400) return 'warn'
  return 'info'
}

/**
 * 把一条记录格式化成单行文本。
 * @param record - 请求记录。
 * @returns 单行文本。
 */
export function formatRecord(record: ProxyRequestRecord): string {
  return `[proxy] ${record.method} ${record.path} → ${String(record.status)} (${String(record.durationMs)}ms)`
}

/**
 * 上报一条记录。**失败静默**：日志是旁路，DSH 不可达时丢掉即可，不能让代理
 * 链路因为写日志失败而报错。
 *
 * @param target - 上报目标。
 * @param record - 请求记录。
 * @param session - 网关持有的 DSH 会话（`名=值`）；有就带上。
 */
export async function reportProxyRequest(
  target: ProxyLogTarget,
  record: ProxyRequestRecord,
  session?: string,
): Promise<void> {
  const level = levelOf(record.status)
  const text = formatRecord(record)
  const url = `http://${target.host}:${String(target.port)}/plugins/dsh-fnos/runtime/task-log`
    + `?level=${level}&text=${encodeURIComponent(text)}`
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, REPORT_TIMEOUT_MS)
  try {
    /*
      **带上网关持有的会话。**

      这是网关自己发往 DSH 的请求，不是浏览器发起的。DSH 的 webServer 对未认证
      请求有前置拦截，不带会话会被挡在路由之外——日志照样丢，而且失败得毫无
      痕迹（旁路本来就是静默的）。
    */
    await fetch(url, {
      signal: controller.signal,
      ...(session === undefined || session === '' ? {} : { headers: { cookie: session } }),
    })
  } catch {
    /* 旁路失败不影响业务。 */
  } finally {
    clearTimeout(timer)
  }
}
