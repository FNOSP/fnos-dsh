/**
 * 「三方插件代理」自动识别：从 DSH web 服务的路由表推导本应用的一级路径前缀。
 *
 * ## 为什么要读宿主内部路由表
 *
 * 飞牛网关只转发 `gatewayPrefix`（`/app/fn-deepseek-harness`）下的请求，前缀之外的
 * 请求**根本到不了应用进程**。而插件若按站点根绝对路径暴露接口（`/dsh-market/...`、
 * `/dsh-taskboard/...`），浏览器发出的请求就落在网关前缀之外，页面拿到宿主 404。
 *
 * 现有解法是让用户自己看调试面板反推前缀再手填。可这份知识本来就在应用里——
 * **插件是在本进程注册的路由**。DSH 0.2.2-rc.1 的 `WebServer` 没有路由枚举 API、
 * 也没有注册事件，只能读实例上的 `exact` / `prefixes` 两张 Map。这是内部字段，
 * 因此本模块把「读不到」设计成一个正常分支（返回 `available: false` + 原因），
 * 而不是抛错——升级 DSH 后读不到时，用户仍能退回手动填写。
 *
 * ## 归并口径
 *
 * 只取路径的**首个路径段**：`/plugin-api/get/me` → `/plugin-api`。这与界面上给用户
 * 的示例一致（「API 是 `/plugin-api/get/me`，就填 `/plugin-api`」），手动项与自动项
 * 因此可以混在一起去重。
 *
 * @module dsh-fnos/gateway-proxy-detect
 */

/** 一条被识别的路由来源，供界面按插件展示。 */
export interface ProxyRouteGroup {
  /** 一级前缀，如 `/plugin-api`。 */
  readonly prefix: string
  /** 该前缀下注册的完整路径（已排序、去重）。 */
  readonly routes: readonly string[]
  /** 注册形态：`exact` 精确路径、`prefix` 前缀、`upgrade` WebSocket/升级。 */
  readonly kinds: readonly ('exact' | 'prefix' | 'upgrade')[]
}

/** 识别结果。 */
export interface ProxyDetection {
  /** 是否成功读到路由表。false 时界面要给降级原因。 */
  readonly available: boolean
  /** 不可用原因代码。 */
  readonly reason?: string
  /** 识别到的前缀分组，按前缀字典序。 */
  readonly groups: readonly ProxyRouteGroup[]
  /** 归并后的前缀集合（即要写进自动区段的内容）。 */
  readonly prefixes: readonly string[]
}

/**
 * 永不接管的命名空间。
 *
 * 两类：飞牛宿主自己用的（`/static`、`/cgi`、`/app`），以及网关内置前缀
 * （`/api`、`/plugins`、`/__fnos-gateway`）。即便某个插件真的注册了同名前缀也不接管——
 * 改写这些路径会把宿主页面或网关自身的请求打乱，代价远大于收益。
 */
export const RESERVED_PREFIXES: readonly string[] = [
  '/static',
  '/cgi',
  '/app',
  '/api',
  '/plugins',
  '/__fnos-gateway',
]

/**
 * 从一个完整路径取一级前缀。
 *
 * 返回 undefined 表示这条路径不该被接管：
 * - 不是绝对路径；
 * - 只有根；
 * - 首段像文件名（含 `.`），那是静态资源而非接口；
 * - 命中保留命名空间。
 *
 * @param path - 注册的路径。
 * @returns 一级前缀，或 undefined。
 */
export function toPrefix(path: string): string | undefined {
  if (!path.startsWith('/')) return undefined
  const segment = path.split('/')[1]
  if (segment === undefined || segment.length === 0) return undefined
  // 首段含点号的一律跳过：`/favicon.ico`、`/app.js` 这类是文件，不是接口命名空间。
  if (segment.includes('.')) return undefined
  const prefix = `/${segment}`
  if (RESERVED_PREFIXES.includes(prefix)) return undefined
  return prefix
}

/**
 * 由前缀段推出最可能的插件包名。
 *
 * ## 为什么是「猜」而不是「查」
 *
 * DSH 的路由表只有 `{ kind, path, handler }`（`packages/host/webserver` 的
 * `WebRoute`），**没有 owner 字段**——注册时不记录是谁注册的。所以插件名无法
 * 反查，只能按命名约定推断：包名最后一段去掉 `dsh-` / `dsh-plugin-` 前缀后与
 * 前缀段比较（`/chat-wallpaper` 对 `dsh-plugin-chat-wallpaper`）。
 *
 * 推断不出来就留空——显示一个猜错的包名比不显示更糟。
 *
 * @param prefix - 路由前缀，形如 `/chat-wallpaper`。
 * @param packageNames - 已安装的包名。
 * @returns 匹配到的包名；无匹配时 undefined。
 */
function resolvePackageName(prefix: string, packageNames: readonly string[]): string | undefined {
  const segment = prefix.replace(/^\//u, '').toLowerCase()
  if (segment === '') return undefined
  for (const name of packageNames) {
    const tail = (name.split('/').pop() ?? '').toLowerCase()
    if (tail === segment || tail.replace(/^dsh-(?:plugin-)?/u, '') === segment) return name
  }
  return undefined
}

/**
 * 读路由表并归并。
 *
 * @param webServer - DSH 的 webServer 服务实例。
 * @param packageNames - 已安装的包名，用于把前缀推断回插件（推断不到则留空）。
 * @returns 识别结果；读不到时 `available: false`。
 */
export function detectProxyPrefixes(webServer: unknown, packageNames: readonly string[] = []): ProxyDetection {
  if (webServer === null || typeof webServer !== 'object') {
    return { available: false, reason: 'webserver-unavailable', groups: [], prefixes: [] }
  }
  const holder = webServer as Record<string, unknown>
  const exact = holder.exact
  const prefixes = holder.prefixes
  const upgrades = holder.upgrades
  if (!(exact instanceof Map) && !(prefixes instanceof Map)) {
    // DSH 换了实现（路由表不再是实例上的 Map）：正常降级，不抛错。
    return { available: false, reason: 'route-table-unreadable', groups: [], prefixes: [] }
  }

  const collected = new Map<string, { routes: Set<string>, kinds: Set<'exact' | 'prefix' | 'upgrade'> }>()
  const add = (path: string, kind: 'exact' | 'prefix' | 'upgrade'): void => {
    const prefix = toPrefix(path)
    if (prefix === undefined) return
    let entry = collected.get(prefix)
    if (entry === undefined) {
      entry = { routes: new Set<string>(), kinds: new Set() }
      collected.set(prefix, entry)
    }
    entry.routes.add(path)
    entry.kinds.add(kind)
  }

  if (exact instanceof Map) for (const path of exact.keys()) if (typeof path === 'string') add(path, 'exact')
  if (prefixes instanceof Map) for (const path of prefixes.keys()) if (typeof path === 'string') add(path, 'prefix')
  // 升级路由（WebSocket）同样要接管：它们的路径规则一致，但一旦漏掉就没有重试机会。
  if (upgrades instanceof Map) for (const path of upgrades.keys()) if (typeof path === 'string') add(path, 'upgrade')

  const groups: ProxyRouteGroup[] = [...collected.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([prefix, entry]) => {
      const pluginName = resolvePackageName(prefix, packageNames)
      return {
        prefix,
        ...(pluginName === undefined ? {} : { pluginName }),
        routes: [...entry.routes].sort(),
        kinds: [...entry.kinds].sort(),
      }
    })

  return {
    available: true,
    groups,
    prefixes: groups.map(group => group.prefix),
  }
}
