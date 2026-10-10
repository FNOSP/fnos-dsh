/**
 * 凭据文件的属主权限判定（FNOS-011-01/05）。
 *
 * 上游 `@deepseek-ai/dsh-credentials-local` 的 `assertOwnerOnly` 只检查
 * group/other 位（`(mode & 0o077) === 0` 即放行），属主不可读的 `0000` 因此被
 * 当作「安全且可读」放行，随后 `readFile` 抛出裸 `EACCES`。本模块在保留既有
 * 拒绝语义的基础上**补充属主可读位**，并以三态结果区分「不存在 / 可用 /
 * 不可用」，供各插件统一消费——同一个异常不应在不同插件里得到相反结论。
 *
 * 判定是纯函数（输入 `stat` 结果），不产生 IO；带路径的便捷封装只包一层
 * `stat`。错误信息只引用文件路径与权限位，绝不包含凭据内容。
 *
 * @module dsh-plugin-kit/credential-permission
 */

/** 一次权限判定的结论。 */
export type CredentialFileState =
  /** 文件不存在：调用方按「未登录」处理，行为与从前一致。 */
  | 'absent'
  /** group/other 位为空且属主可读：可以安全读取。 */
  | 'usable'
  /** 文件存在但权限不满足：group/other 位被置位，或属主不可读。 */
  | 'unusable'

/** 判定所需的文件事实（`fs.stat` 的最小切面）。 */
export interface CredentialFileFacts {
  mode: number
}

/** group + other 的读/写/执行位（0o077）。 */
const GROUP_OTHER_BITS = 0o077

/** 属主读位（0o400）。 */
const OWNER_READ_BIT = 0o400

/**
 * 从 `stat` 结果判定凭据文件可用性（纯函数）。
 *
 * 判定条件 = 「group/other 位为空**且**属主可读」。既有拒绝语义不回退：
 * `644` 等放宽权限的文件继续被拒绝；本条件只在其上补充属主可读位——
 * `0000`（属主也不可读）不再被当作「安全且可读」放行。
 *
 * Windows 没有 POSIX mode，判定在调用方跳过（与上游行为一致）：本函数仍按
 * 位运算给出结论，但 Windows 的 `mode` 不承载 POSIX 语义，调用方应以
 * `process.platform === 'win32'` 为准跳过判定、直接视为可用。
 * @param facts - `stat` 结果（至少含 `mode`）。
 * @returns 三态结论。
 */
export function assessCredentialMode(facts: CredentialFileFacts): CredentialFileState {
  if ((facts.mode & GROUP_OTHER_BITS) !== 0) return 'unusable'
  if ((facts.mode & OWNER_READ_BIT) === 0) return 'unusable'
  return 'usable'
}

/**
 * 便捷封装：stat 一个凭据文件并给出三态结论。
 * @param stat - 与 `fs.promises.stat` 同形的读取函数（便于测试注入）。
 * @param path - 凭据文件路径。
 * @returns 三态结论；stat 失败且 errno 为 ENOENT 时为 `absent`，其他失败
 *   上抛——非 ENOENT 的读取失败必须暴露（与上游 `isENOENT` 立场一致）。
 */
export async function assessCredentialFile(
  stat: (path: string) => Promise<CredentialFileFacts>,
  path: string,
): Promise<CredentialFileState> {
  try {
    return assessCredentialMode(await stat(path))
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') return 'absent'
    throw error
  }
}

/**
 * 生成「属主不可读」场景的可诊断错误信息。
 *
 * 与上游对权限过宽的既有文案同构（`... is readable beyond its owner (mode
 * 644); run "chmod 600 ..."`），补充属主不可读的分支。信息只含路径与权限位，
 * 不含凭据内容。
 * @param path - 凭据文件路径。
 * @param mode - 当前权限位。
 * @param context - 出错场景前缀（如 `codebuddy-auth` / `credentials-local`）。
 * @returns 可直接 throw / 上报的错误。
 */
export function ownerUnreadableError(path: string, mode: number, context: string): Error {
  const octal = (mode & 0o777).toString(8).padStart(3, '0')
  return new Error(
    `${context}: ${path} is not readable by its owner (mode ${octal});`
    + ` run "chmod 600 ${path}" before starting again`,
  )
}
