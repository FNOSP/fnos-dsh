export const FNOS_GATEWAY_PROXY_PATHS_ROUTE = '/plugins/dsh-fnos/gateway/proxy-paths'
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
