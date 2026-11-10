import { readFile, watch, type FSWatcher } from 'node:fs'
import { dirname } from 'node:path'

export const PATH_ALLOWLIST_EVENTS_PATH = '/__fnos-gateway/path-allowlist/events'
export interface PathAllowlistSnapshot {
  version: 1
  /** 手动配置的前缀。 */
  paths: string[]
  /**
   * 自动识别的前缀。
   *
   * 刻意与 `paths` 分开保存：手动项归用户、自动项归宿主，任何一方变化都不该
   * 覆盖另一方（需求 FNOS-052-03/04）。旧文档没有这个字段时按空数组处理。
   */
  auto: string[]
}

/**
 * 归一化一组路径。
 *
 * 与插件侧的 `normalizeGatewayProxyPaths` 必须逐条一致：两侧解析同一份文档，
 * 口径一旦分叉就会出现「插件写了、网关不认」的静默失败。
 * @param input - 原始数组。
 * @returns 归一化后的路径；全部合法项。
 */
function normalizePathList(input: unknown[]): string[] {
  const normalized = input.flatMap(item => {
    if (typeof item !== 'string') return []
    const path = item.trim().replace(/\/+$/u, '') || '/'
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('\0') || path.includes('?') || path.includes('#') || path === '/' || /%2f|%5c/iu.test(path)) return []
    if (path.split('/').some(segment => segment === '.' || segment === '..')) return []
    if (path === '/api' || path.startsWith('/api/') || path === '/plugins' || path.startsWith('/plugins/')) return []
    if (path === '/__fnos-gateway' || path.startsWith('/__fnos-gateway/')) return []
    return [path]
  })
  return [...new Set(normalized)].sort()
}

/**
 * 解析前缀文档。
 *
 * `auto` 可选：旧版网关（或旧版插件写出的文档）没有该字段时按空数组处理，
 * 行为等价于升级前。
 * @param value - 文档。
 * @returns `{ paths, auto }`；文档不合法时 undefined。
 */
export function parseProxyPaths(value: unknown): { paths: string[], auto: string[] } | undefined {
  if (typeof value !== 'object' || value === null || (value as { version?: unknown }).version !== 1) return undefined
  const record = value as { paths?: unknown, auto?: unknown }
  if (!Array.isArray(record.paths)) return undefined
  return {
    paths: normalizePathList(record.paths),
    auto: Array.isArray(record.auto) ? normalizePathList(record.auto) : [],
  }
}

/**
 * 兼容旧调用点的包装：只返回手动项。
 * @param value - 文档。
 * @returns 手动前缀；文档不合法时 undefined。
 */
export function normalizeProxyPaths(value: unknown): string[] | undefined {
  return parseProxyPaths(value)?.paths
}

export class PathAllowlistStore {
  private paths: string[] = []
  private auto: string[] = []
  private watcher?: FSWatcher
  private timer?: NodeJS.Timeout
  private readonly listeners = new Set<(snapshot: PathAllowlistSnapshot) => void>()
  constructor(readonly filePath: string) {}
  /**
   * 当前快照。
   *
   * `paths` 给的是**并集**：bridge 只需要「哪些前缀要改写」，不必关心来源。
   * 分组值同时保留，便于排查与界面展示。
   * @returns 快照。
   */
  snapshot(): PathAllowlistSnapshot {
    return {
      version: 1,
      paths: [...new Set([...this.paths, ...this.auto])].sort(),
      auto: [...this.auto],
    }
  }
  /**
   * Register a listener and immediately push the current snapshot.
   *
   * A listener must not be able to break the store: `reload()` runs from
   * `fs.watch` as an unawaited promise, so a throw here would surface as an
   * UNHANDLED rejection, which `cli.ts` treats as fatal and answers by
   * restarting the whole gateway. Isolation keeps one broken consumer from
   * dropping every other connection and the DSH Web child.
   */
  subscribe(listener: (snapshot: PathAllowlistSnapshot) => void): () => void {
    this.listeners.add(listener)
    this.notify(listener)
    return () => { this.listeners.delete(listener) }
  }
  /** Deliver one snapshot, disabling a listener that throws. */
  private notify(listener: (snapshot: PathAllowlistSnapshot) => void): void {
    try {
      listener(this.snapshot())
    } catch (error) {
      console.error('[fnos-gateway] path allowlist listener failed and was removed', error)
      this.listeners.delete(listener)
    }
  }
  async reload(): Promise<boolean> {
    let value: unknown
    try { value = JSON.parse(await new Promise<string>((resolve, reject) => readFile(this.filePath, 'utf8', (error, data) => error ? reject(error) : resolve(data)))) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error('[fnos-gateway] invalid path allowlist; retaining last snapshot', error); return false }
    const parsed = parseProxyPaths(value)
    if (parsed === undefined) return false
    if (JSON.stringify(parsed.paths) === JSON.stringify(this.paths) && JSON.stringify(parsed.auto) === JSON.stringify(this.auto)) return true
    this.paths = parsed.paths
    this.auto = parsed.auto
    // Snapshot the set first: `notify` may delete a failing listener mid-loop.
    for (const listener of [...this.listeners]) this.notify(listener)
    return true
  }
  async start(): Promise<void> {
    await this.reload()
    this.watcher = watch(dirname(this.filePath), () => { if (this.timer !== undefined) clearTimeout(this.timer); this.timer = setTimeout(() => { void this.reload() }, 80) })
  }
  close(): void { if (this.timer !== undefined) clearTimeout(this.timer); this.watcher?.close(); this.listeners.clear() }
}
