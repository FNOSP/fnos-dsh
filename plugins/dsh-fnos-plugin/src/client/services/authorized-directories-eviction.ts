/**
 * 授权目录的失效剔除（FNOS-009-10）。
 *
 * 判定完全基于 Host 侧返回的 `valid` 标记：Host 用两个**无交互**查询接口
 * （`trim.file.getSharedAccessibleFolders` 与 `trim.file.getUserAccessibleFolders`）
 * 的返回集合比对每条目录，客户端只做筛选。
 *
 * 这里**不再逐个路径调用 `authorizeSharedFile` / `authorizeUserFile`**：
 * 那两个是「申请授权」接口，会给用户弹出「申请访问以下文件」确认框并等待
 * 操作，用它做校验会让每次刷新列表都弹框；它们的返回值也只表示「这次申请
 * 的结果」，不能表达「当前是否仍有权限」。
 */

import type { AuthorizedDirectory } from '../../contracts/authorized-directories-contract.ts'

/** 降级提示的文案键；由调用方翻译后展示。 */
export type EvictionNoticeKey = 'validateUnavailable'

export interface EvictionResult {
  /** 剔除后应当展示的列表。 */
  directories: AuthorizedDirectory[]
  /** 是否发生了剔除；为 true 时调用方需要回写持久化。 */
  evicted: boolean
  /** 需要展示给用户的降级提示（无法判定时）。 */
  noticeKey?: EvictionNoticeKey
}

/**
 * 剔除已失效的用户授权目录。
 *
 * 三类判定：
 *
 * - `valid === true`：保留；
 * - `valid === false`：明确失效，剔除；
 * - `valid === undefined`：**无法判定**（Host 的查询接口不可用），保留并给出
 *   降级提示。把「问不到」当成「没权限」会删掉用户的有效授权记录——这正是
 *   10-AC-04 要求的降级路径。
 *
 * 只读的应用共享路径（`removable === false`）不参与剔除：它们由 fnOS 声明，
 * 不属于用户授权，问了也不该删。
 *
 * @param directories - 当前展示列表，含 Host 标注的 `valid`。
 * @returns 剔除结果与可选的降级提示。
 */
export function evictInvalidAuthorizedDirectories(directories: AuthorizedDirectory[]): EvictionResult {
  const candidates = directories.filter(directory => directory.removable)
  // 没有可校验项时既不必提示降级，也不构造任何请求。
  if (candidates.length === 0) return { directories, evicted: false }

  const undecidable = candidates.some(directory => directory.valid === undefined)
  const kept = directories.filter(directory => directory.removable ? directory.valid !== false : true)
  const evicted = kept.length !== directories.length

  return {
    directories: kept,
    evicted,
    ...(undecidable ? { noticeKey: 'validateUnavailable' as const } : {}),
  }
}
