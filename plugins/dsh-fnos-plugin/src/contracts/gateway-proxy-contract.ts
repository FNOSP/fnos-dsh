export const FNOS_GATEWAY_PROXY_PATHS_ROUTE = '/plugins/dsh-fnos/gateway/proxy-paths'

/**
 * 网关自带的固定前缀，用户不可编辑。
 *
 * 这三个前缀由网关自身占用：`/api` 是 DSH 上游接口、`/plugins` 是插件路由、
 * `/__fnos-gateway` 是网关内部服务。它们本来就被校验拦在用户可配置项之外
 * （见 {@link normalizeGatewayProxyPaths}），但**拦掉不等于看不见**——用户
 * 编辑反代规则时需要知道这些路径为什么不在自己手里，否则会反复尝试添加并被
 * 拒绝。因此把它们作为只读项单独展示。
 */
export const FNOS_GATEWAY_BUILTIN_PREFIXES: readonly { path: string, description: string }[] = [
  { path: '/api', description: 'DSH 上游接口' },
  { path: '/plugins', description: '插件路由' },
  { path: '/__fnos-gateway', description: '网关内部服务' },
]

export const FNOS_GATEWAY_PROXY_PATHS_FILE = 'gateway/path-allowlist.json'

/** 自动识别出的前缀（由宿主读路由表得到，用户不可编辑）。 */
export const FNOS_GATEWAY_AUTO_PATHS_ROUTE = '/plugins/dsh-fnos/gateway/auto-paths'

/**
 * 前缀文档。
 *
 * `auto` 是新增的可选字段，承载自动识别出的前缀。它**刻意可选**：旧版网关只读
 * `paths`，遇到多出来的 `auto` 会忽略而不会整份拒绝，升级期间两个方向都不会坏。
 */
export interface GatewayProxyPathsDocument { version: 1, paths: string[], auto?: string[] }

/** 自动识别状态，供界面区分「没识别到」与「识别不到」。 */
export interface GatewayAutoPathsStatus {
  /** 是否成功读到宿主路由表。 */
  readonly available: boolean
  /** 不可用原因代码（`webserver-unavailable` / `route-table-unreadable`）。 */
  readonly reason?: string
  /** 前缀分组，按插件前缀归并，供界面按 API 形式展示。 */
  readonly groups: readonly {
    readonly prefix: string
    readonly routes: readonly string[]
    readonly kinds: readonly ('exact' | 'prefix' | 'upgrade')[]
  }[]
  /** 归并后的前缀集合。 */
  readonly prefixes: readonly string[]
}

/** The only document version this plugin and the gateway understand. */
export const FNOS_GATEWAY_PROXY_PATHS_VERSION = 1

/**
 * Read the submitted path list from either accepted shape.
 *
 * Two shapes are legitimate here, and they are deliberately different in kind:
 *
 * - `{ version, paths }` is the **document** shape — the wire body of the PUT
 *   route and the on-disk file. `version` must be exactly the supported
 *   {@link FNOS_GATEWAY_PROXY_PATHS_VERSION}; anything else is refused rather
 *   than silently coerced, so a document written by a future producer cannot be
 *   rewritten as `version: 1` with its unknown contents dropped.
 * - a bare array is the **settings field** shape: `gatewayProxyPaths` is
 *   declared as `string[]`, so the settings mirror and the GET route read the
 *   value directly without wrapping it in a document.
 *
 * The gateway's own reader (`packages/fnos-gateway/src/server/path-allowlist.ts`)
 * parses documents only, so every object shape must be accepted or refused
 * identically on both sides; `packages/fnos-gateway/tests/path-allowlist.spec.ts`
 * asserts that agreement case by case.
 */
function submittedPaths(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as { version?: unknown, paths?: unknown }
  if (record.version !== FNOS_GATEWAY_PROXY_PATHS_VERSION) return undefined
  return Array.isArray(record.paths) ? record.paths : undefined
}

export function normalizeGatewayProxyPaths(value: unknown): string[] | undefined {
  const paths = submittedPaths(value)
  if (paths === undefined) return undefined
  const normalized = paths.flatMap(item => {
    if (typeof item !== 'string') return []
    const path = item.trim().replace(/\/+$/u, '')
    if (!path.startsWith('/') || path.startsWith('//') || path === '' || path.includes('\0') || path.includes('?') || path.includes('#') || /%2f|%5c/iu.test(path)) return []
    if (path.split('/').some(segment => segment === '.' || segment === '..')) return []
    if (path === '/api' || path.startsWith('/api/') || path === '/plugins' || path.startsWith('/plugins/')) return []
    if (path === '/__fnos-gateway' || path.startsWith('/__fnos-gateway/')) return []
    return [path]
  })
  return [...new Set(normalized)].sort()
}

/**
 * Validate user-submitted paths without silently dropping an invalid rule.
 *
 * Every entry is validated individually so one bad rule refuses the whole
 * snapshot rather than being filtered out silently. The per-entry check passes
 * the bare settings-field array shape (which the normalizer accepts) instead of
 * wrapping the entry in a `{ paths }` document, because a document would also
 * need a supported `version` and re-adding it here would duplicate the check
 * `submittedPaths` already performed.
 */
export function validateGatewayProxyPaths(value: unknown): string[] | undefined {
  const paths = submittedPaths(value)
  if (paths === undefined) return undefined
  for (const item of paths) {
    if (typeof item !== 'string' || (item.trim() !== '' && normalizeGatewayProxyPaths([item])?.length !== 1)) return undefined
  }
  return normalizeGatewayProxyPaths(value)
}

/** 已安装插件清单路由（只读）。 */
export const FNOS_INSTALLED_PLUGINS_ROUTE = '/plugins/dsh-fnos/plugins/installed'

/** 一个已安装的插件。 */
export interface InstalledPlugin {
  /** 包名，如 `@tnnevol/dsh-fnos`。 */
  readonly name: string
  /** 版本；`package.json` 没写时为 `—`。 */
  readonly version: string
  /** 是否声明了 dsh 客户端入口（能出现在界面里）。 */
  readonly hasClient: boolean
  /** 是否为随 FPK 内置、由本应用管理的插件。 */
  readonly bundled: boolean
  /** registry 上的最新版本；查不到时缺省。 */
  readonly latestVersion?: string
  /** 是否有可装的更新（已过兼容性门禁）。 */
  readonly updateAvailable?: boolean
  /**
   * 本地版本高于 registry 最新版（开发/内测环境常见）。
   *
   * 界面显示「本地版本」而不是「已是最新」——后者会让人以为这就是发布版。
   */
  readonly aheadOfRegistry?: boolean
  /**
   * 与当前 DSH 基线不兼容。
   *
   * 不兼容时**不提示更新**——装上去起不来比「没更新」更糟。
   */
  readonly incompatible?: boolean
  /** 不兼容的具体要求。 */
  readonly requirements?: Record<string, string>
}

/** 插件清单响应。 */
export interface InstalledPluginsSnapshot {
  /** 是否读到 profile 目录。false 时界面给降级说明。 */
  readonly available: boolean
  /** 不可用原因代码。 */
  readonly reason?: string
  /** 已安装插件，按包名排序。 */
  readonly plugins: readonly InstalledPlugin[]
}

/** 自定义插件索引状态路由（只读）。 */
export const FNOS_PLUGIN_INDEX_STATUS_ROUTE = '/plugins/dsh-fnos/plugins/index-status'

/** 一键写入推荐索引源（写）。 */
export const FNOS_PLUGIN_INDEX_APPLY_ROUTE = '/plugins/dsh-fnos/plugins/index-apply'

/** 一个索引源的展示信息。 */
export interface PluginIndexSourceInfo {
  /** 索引 URL。 */
  readonly url: string
  /**
   * 索引自带的标题（`index.json` 的 `title`，按当前语言取值）。
   *
   * 从索引本身读，而不是在代码里写死：索引改名（比如从「dsh 插件目录」变成
   * 「Awesome DSH Plugin 插件精选」）时这里自动跟上，不需要改代码。
   * 读不到时 undefined，界面退回显示 URL。
   */
  readonly label?: string
}

/** 安装插件（写）。 */
export const FNOS_PLUGIN_INSTALL_ROUTE = '/plugins/dsh-fnos/plugins/install'

/** 安装状态（只读）。 */
export const FNOS_PLUGIN_INSTALL_STATE_ROUTE = '/plugins/dsh-fnos/plugins/install-state'

/** 安装日志（只读，支持 offset 增量）。 */
export const FNOS_PLUGIN_INSTALL_LOG_ROUTE = '/plugins/dsh-fnos/plugins/install-log'
