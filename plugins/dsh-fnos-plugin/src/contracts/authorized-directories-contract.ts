/** Browser/Host contract for fnOS shared-directory management. */

/** Settings namespace used to pair the Host namespace with the Client card. */
export const FNOS_AUTHORIZED_DIRECTORIES_SETTINGS_NAMESPACE = 'dsh-fnos-authorized-directories'

/** Same-origin route that lists the directories currently authorized for the app. */
export const FNOS_AUTHORIZED_DIRECTORIES_PATH = '/plugins/dsh-fnos/authorized-directories'

/** Same-origin route that removes one application directory ACL. */
export const FNOS_AUTHORIZED_DIRECTORIES_DELETE_PATH = '/plugins/dsh-fnos/authorized-directories/delete'

/** Same-origin route that persists the user-authorised directory list. */
export const FNOS_AUTHORIZED_DIRECTORIES_PERSIST_PATH = '/plugins/dsh-fnos/authorized-directories/persist'

/** Same-origin route that converts internal fnOS paths to readable paths. */
export const FNOS_PATH_CONVERSION_PATH = '/plugins/dsh-fnos/paths/convert'

/** Same-origin route that validates a DSH path before fnOS opens it. */
export const FNOS_PATH_OPEN_VALIDATION_PATH = '/plugins/dsh-fnos/paths/open/validate'

/** Same-origin route that lists one level below an authorized NAS directory. */
export const FNOS_AUTHORIZED_ENTRIES_PATH = '/plugins/dsh-fnos/authorized-directories/entries'

export interface AuthorizedDirectory {
  /** Internal fnOS path used by the Host side when removing the ACL. */
  path: string
  /** User-facing path returned by trim.file.convertPath. */
  semanticPath: string
  /** Shared application paths are display-only and cannot be removed here. */
  removable: boolean
  /**
   * 该目录是否仍在 fnOS 的授权范围内（FNOS-009-10）。
   *
   * 由 Host 侧用**无交互**的查询接口（`trim.file.getSharedAccessibleFolders`
   * 与 `trim.file.getUserAccessibleFolders`）比对得出，而不是逐个路径去
   * 「申请授权」——后者会弹出确认框并等待用户操作。
   *
   * `undefined` 表示**无法判定**（查询接口不可用）。此时必须保留目录，不能
   * 当成失效剔除：把「问不到」误判成「没权限」会删掉用户的有效授权。
   */
  valid?: boolean
}

export interface AuthorizedDirectoriesResponse {
  directories: AuthorizedDirectory[]
}

export interface ReadablePath {
  /** Internal fnOS path used by the Host and DSH reference codec. */
  path: string
  /** User-facing path returned by trim.file.convertPath. */
  semanticPath: string
}

export interface ReadablePathsResponse {
  paths: ReadablePath[]
}

export type AuthorizedEntryKind = 'file' | 'directory'

export interface AuthorizedEntry {
  /** Internal fnOS path used by DSH's reference codec. */
  path: string
  /** User-facing path returned by trim.file.convertPath. */
  semanticPath: string
  /** Whether the entry can be opened as a directory in the picker. */
  kind: AuthorizedEntryKind
  /** Optional file size supplied by the Host for a lightweight listing. */
  size?: number
  /** Optional modification timestamp in milliseconds. */
  modifiedAt?: number
}

export interface AuthorizedEntriesResponse {
  /** Directory represented by this listing; omitted for the authorized roots. */
  directory?: ReadablePath
  entries: AuthorizedEntry[]
  truncated?: boolean
}
