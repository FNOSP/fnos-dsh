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
export interface GatewayProxyPathsDocument { version: 1, paths: string[] }

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
