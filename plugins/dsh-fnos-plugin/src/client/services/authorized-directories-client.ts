/** Browser-side API helpers for the fnOS authorized-directory route. */

import {
  FNOS_AUTHORIZED_CREATE_PATH,
  FNOS_AUTHORIZED_DELETE_ENTRY_PATH,
  FNOS_AUTHORIZED_DIRECTORIES_PATH,
  FNOS_AUTHORIZED_DIRECTORIES_PERSIST_PATH,
  FNOS_AUTHORIZED_ENTRIES_PATH,
  FNOS_PATH_CONVERSION_PATH,
  FNOS_PATH_OPEN_VALIDATION_PATH,
  type AuthorizedCreateKind,
  type AuthorizedDirectory,
  type AuthorizedEntry,
  type AuthorizedEntriesResponse,
  type ReadablePath,
} from '../../contracts/authorized-directories-contract.ts'

export interface AuthorizedDirectoriesResponse {
  directories?: unknown
  paths?: unknown
}

export interface ReadablePathsResponse {
  paths?: unknown
}

export interface AuthorizedEntriesResult {
  directory?: ReadablePath
  entries: AuthorizedEntry[]
  truncated: boolean
}

export class DirectoryRequestError extends Error {
  constructor(readonly code: string, message = code) {
    super(message)
    this.name = 'DirectoryRequestError'
  }
}

function requestHeaders(): HeadersInit {
  const headers: HeadersInit = { accept: 'application/json' }
  if (typeof navigator === 'object' && typeof navigator.language === 'string' && navigator.language.length > 0) {
    headers['accept-language'] = navigator.language
  }
  return headers
}

/** De-duplicate paths while keeping the Host response order. */
export function directoriesFromResponse(value: AuthorizedDirectoriesResponse): AuthorizedDirectory[] {
  const entries = Array.isArray(value.directories)
    ? value.directories
    : Array.isArray(value.paths) ? value.paths : []
  const seen = new Set<string>()
  return entries.flatMap(entry => {
    if (typeof entry === 'object' && entry !== null && !Array.isArray(entry)) {
      const path = typeof entry.path === 'string' ? entry.path : ''
      const semanticPath = typeof entry.semanticPath === 'string' ? entry.semanticPath : path
      const removable = entry.removable !== false
      if (path.length === 0 || semanticPath.length === 0 || seen.has(path)) return []
      seen.add(path)
      // `valid` 必须一起带上：Host 用它标注该目录是否仍在 fnOS 授权范围内。
      // 丢了这个字段，客户端会把每条目录都看成「无法判定」而永久降级。
      const valid = typeof entry.valid === 'boolean' ? entry.valid : undefined
      return [{ path, semanticPath, removable, ...(valid === undefined ? {} : { valid }) }]
    }
    if (typeof entry !== 'string' || entry.length === 0 || seen.has(entry)) return []
    seen.add(entry)
    return [{ path: entry, semanticPath: entry, removable: true }]
  })
}

export async function requestAuthorizedDirectories(): Promise<AuthorizedDirectory[]> {
  const response = await fetch(FNOS_AUTHORIZED_DIRECTORIES_PATH, {
    headers: requestHeaders(),
    credentials: 'same-origin',
  })
  const value: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    const code = typeof value === 'object' && value !== null && 'error' in value && typeof value.error === 'string'
      ? value.error
      : `HTTP ${response.status}`
    throw new DirectoryRequestError(code)
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return []
  return directoriesFromResponse(value as AuthorizedDirectoriesResponse)
}

function entriesFromResponse(value: AuthorizedEntriesResponse): AuthorizedEntriesResult {  const seen = new Set<string>()
  const entries = Array.isArray(value.entries)
    ? value.entries.flatMap(entry => {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return []
      const path = typeof entry.path === 'string' ? entry.path : ''
      const semanticPath = typeof entry.semanticPath === 'string' ? entry.semanticPath : path
      const kind = entry.kind === 'directory' || entry.kind === 'file' ? entry.kind : undefined
      if (path.length === 0 || semanticPath.length === 0 || kind === undefined || seen.has(path)) return []
      seen.add(path)
      return [{
        path,
        semanticPath,
        kind,
        ...(typeof entry.size === 'number' && Number.isFinite(entry.size) ? { size: entry.size } : {}),
        ...(typeof entry.modifiedAt === 'number' && Number.isFinite(entry.modifiedAt) ? { modifiedAt: entry.modifiedAt } : {}),
      }]
    })
    : []
  const directory = value.directory?.path !== undefined && value.directory.semanticPath !== undefined
    ? { path: value.directory.path, semanticPath: value.directory.semanticPath }
    : undefined
  return {
    ...(directory === undefined ? {} : { directory }),
    entries,
    truncated: value.truncated === true,
  }
}

/** List authorized roots or one authorized directory level without using the fnOS SDK picker. */
export async function requestAuthorizedEntries(path?: string): Promise<AuthorizedEntriesResult> {
  const response = await fetch(FNOS_AUTHORIZED_ENTRIES_PATH, {
    method: 'POST',
    headers: { ...requestHeaders(), 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(path === undefined ? {} : { path }),
  })
  const value: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    const code = typeof value === 'object' && value !== null && 'error' in value && typeof value.error === 'string'
      ? value.error
      : `HTTP ${response.status}`
    throw new DirectoryRequestError(code)
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { entries: [], truncated: false }
  }
  return entriesFromResponse(value as AuthorizedEntriesResponse)
}

/**
 * 在已授权目录内新建一个空目录或空文件。
 *
 * 与列举走同一条授权校验；这里只负责发请求并把宿主返回的错误码原样抛给 UI，
 * 让弹框能显示「已存在 / 权限不足 / 空间不足」这类可操作的原因，而不是
 * 统一的「失败」。
 */
export async function createAuthorizedEntry(
  parent: string,
  name: string,
  kind: AuthorizedCreateKind,
): Promise<AuthorizedEntry> {
  const response = await fetch(FNOS_AUTHORIZED_CREATE_PATH, {
    method: 'POST',
    headers: { ...requestHeaders(), 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ parent, name, kind }),
  })
  const value: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    const code = typeof value === 'object' && value !== null && 'error' in value && typeof value.error === 'string'
      ? value.error
      : `HTTP ${response.status}`
    throw new DirectoryRequestError(code)
  }
  const entry = typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as { entry?: unknown }).entry
    : undefined
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    throw new DirectoryRequestError('invalid-create-response')
  }
  const record = entry as Record<string, unknown>
  const path = typeof record.path === 'string' ? record.path : ''
  const semanticPath = typeof record.semanticPath === 'string' ? record.semanticPath : path
  if (path.length === 0 || semanticPath.length === 0) throw new DirectoryRequestError('invalid-create-response')
  return { path, semanticPath, kind }
}

/**
 * 删除授权目录内的一个条目。
 *
 * 与新建对称：只把宿主返回的错误码原样抛给 UI，由弹框翻成可操作的原因。
 */
export async function deleteAuthorizedEntry(path: string): Promise<void> {
  const response = await fetch(FNOS_AUTHORIZED_DELETE_ENTRY_PATH, {
    method: 'POST',
    headers: { ...requestHeaders(), 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ path }),
  })
  if (response.ok) return
  const value: unknown = await response.json().catch(() => undefined)
  const code = typeof value === 'object' && value !== null && 'error' in value && typeof value.error === 'string'
    ? value.error
    : `HTTP ${response.status}`
  throw new DirectoryRequestError(code)
}

export function readablePathsFromResponse(value: ReadablePathsResponse): ReadablePath[] {
  if (!Array.isArray(value.paths)) return []
  const seen = new Set<string>()
  return value.paths.flatMap(entry => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return []
    const path = typeof entry.path === 'string' ? entry.path : ''
    const semanticPath = typeof entry.semanticPath === 'string' ? entry.semanticPath : path
    if (path.length === 0 || semanticPath.length === 0 || seen.has(path)) return []
    seen.add(path)
    return [{ path, semanticPath }]
  })
}

export async function requestReadablePaths(paths: readonly string[]): Promise<ReadablePath[]> {
  const response = await fetch(FNOS_PATH_CONVERSION_PATH, {
    method: 'POST',
    headers: { ...requestHeaders(), 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ paths }),
  })
  const value: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    const code = typeof value === 'object' && value !== null && 'error' in value && typeof value.error === 'string'
      ? value.error
      : `HTTP ${response.status}`
    throw new DirectoryRequestError(code)
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return []
  return readablePathsFromResponse(value as ReadablePathsResponse)
}

/** Validate a path against the current fnOS ACL before opening it. */
export async function requestPathOpenAuthorization(path: string): Promise<void> {
  const response = await fetch(FNOS_PATH_OPEN_VALIDATION_PATH, {
    method: 'POST',
    headers: { ...requestHeaders(), 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ path }),
  })
  const value: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    const code = typeof value === 'object' && value !== null && 'error' in value && typeof value.error === 'string'
      ? value.error
      : `HTTP ${response.status}`
    throw new DirectoryRequestError(code)
  }
}

/**
 * 持久化用户授权目录列表（FNOS-009-09）。
 *
 * 只在用户确实增删目录或校验剔除后调用；读取路径不写盘，避免一次加载就把
 * 实时查询到的共享路径误写进持久化记录。
 */
export async function requestPersistAuthorizedDirectories(paths: readonly string[]): Promise<string[]> {
  const response = await fetch(FNOS_AUTHORIZED_DIRECTORIES_PERSIST_PATH, {
    method: 'POST',
    headers: { ...requestHeaders(), 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ paths }),
  })
  const value: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    const code = typeof value === 'object' && value !== null && 'error' in value && typeof value.error === 'string'
      ? value.error
      : `HTTP ${response.status}`
    throw new DirectoryRequestError(code)
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return []
  const stored = (value as { paths?: unknown }).paths
  return Array.isArray(stored) ? stored.filter((item): item is string => typeof item === 'string') : []
}
