/**
 * 授权目录的 SDK 权限校验（FNOS-009-10）。
 *
 * 用 fnOS SDK 的**无交互**授权接口逐项校验持久化目录：`authorizeSharedFile`
 * 用于共享目录（用户在 fnOS 里授权给本应用的路径），`authorizeUserFile` 用于
 * 用户目录。两者都不会弹选择器或确认框。
 *
 * 关键区分：**单项校验不通过**与**整体不可用**是两件事。桥接缺失（独立浏览器、
 * iframe 桥接失败）时调用会 reject 或返回 `undefined`，此时必须跳过剔除，
 * 按持久化数据展示，避免把「问不到」误判成「没权限」而删掉用户的目录。
 */

/** SDK 应答：`undefined` 表示没有宿主桥。 */
export type FnosAuthorizeResult = { ok: boolean } | undefined

/** 一次逐项校验的汇总结果。 */
export interface DirectoryValidationOutcome {
  /** SDK 桥接整体是否可用；false 时调用方必须跳过剔除。 */
  available: boolean
  /** 校验通过、应当保留的路径。 */
  valid: string[]
  /** 校验明确不通过、应当剔除的路径。 */
  invalid: string[]
}

/** 校验用的 SDK 子集，便于测试注入替身。 */
export interface AuthorizeCapableSdk {
  authorizeSharedFile(path: string): Promise<FnosAuthorizeResult>
  authorizeUserFile(path: string): Promise<FnosAuthorizeResult>
}

/** 一次单项校验的结论。 */
type PathVerdict = 'valid' | 'invalid' | 'unavailable'

function isUnavailable(response: FnosAuthorizeResult): response is undefined {
  return response === undefined || typeof response !== 'object' || response === null
}

/**
 * 校验单个路径。
 *
 * 先试共享目录接口，再试用户目录接口——两类目录由不同接口管辖，未知归属时
 * 按顺序探测即可，调用方不需要先分类。任一接口「不可用」都直接判定为整体
 * 不可用，因为此时无法区分「没权限」与「问不到」。
 */
async function verifyPath(sdk: AuthorizeCapableSdk, path: string): Promise<PathVerdict> {
  for (const authorize of [sdk.authorizeSharedFile.bind(sdk), sdk.authorizeUserFile.bind(sdk)]) {
    let response: FnosAuthorizeResult
    try {
      response = await authorize(path)
    } catch {
      // 桥接在调用中失败：按整体不可用处理，不剔除。
      return 'unavailable'
    }
    if (isUnavailable(response)) return 'unavailable'
    if (response.ok === true) return 'valid'
  }
  return 'invalid'
}

/**
 * 逐项校验持久化目录。
 *
 * 一旦遇到「整体不可用」立即停止并返回，已判定的结果照常带回，由调用方决定
 * 展示策略；调用方在 `available === false` 时**必须跳过剔除**。
 *
 * @param sdk - 已 `ready()` 的 fnOS SDK。
 * @param paths - 待校验的内部路径列表。
 * @returns 可用性与通过/不通过清单。
 */
export async function validateAuthorizedDirectories(
  sdk: AuthorizeCapableSdk,
  paths: readonly string[],
): Promise<DirectoryValidationOutcome> {
  const valid: string[] = []
  const invalid: string[] = []

  for (const [index, path] of paths.entries()) {
    const verdict = await verifyPath(sdk, path)
    if (verdict === 'unavailable') {
      // 其余未校验项按「保留」处理：宁可多展示，不可因桥接故障丢目录。
      return { available: false, valid: [...valid, path, ...paths.slice(index + 1)], invalid }
    }
    if (verdict === 'valid') valid.push(path)
    else invalid.push(path)
  }

  return { available: true, valid, invalid }
}
