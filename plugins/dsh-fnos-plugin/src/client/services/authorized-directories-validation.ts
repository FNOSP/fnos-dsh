/**
 * 授权目录的 SDK 权限校验（FNOS-009-10）。
 *
 * 用 fnOS SDK 的**无交互**授权接口逐项校验持久化目录：`authorizeSharedFile`
 * 用于共享目录（管理员授权给本应用的路径），`authorizeUserFile` 用于用户目录。
 * 两者都不会弹选择器，但**都可能弹出「申请访问」确认框**——用户点「允许」之前
 * 调用不会返回，因此每次调用都必须带超时（见 `AUTHORIZE_TIMEOUT_MS`）。
 *
 * 关键区分：**单项校验不通过**与**整体不可用**是两件事。桥接缺失（独立浏览器、
 * iframe 桥接失败）、调用超时、响应无法解析时，都必须跳过剔除并按持久化数据
 * 展示，避免把「问不到」误判成「没权限」而删掉用户的目录。
 */

/**
 * fnOS SDK 的统一应答结构。
 *
 * 来自官方文档的 `AppBridgeResponse<T>`：`code` 为 `0` 表示成功，非 0 是业务
 * 错误码（例如普通用户调 `authorizeSharedFile` 会得到 `code: 1`）。
 * **不要**假设存在 `ok` 字段——早期实现按 `{ ok: boolean }` 判定，该字段恒为
 * `undefined`，导致每个可移除目录都被判为无权限并从列表和持久化记录中删除。
 */
export interface FnosAppBridgeResponse<T = unknown> {
  code?: number
  msg?: string
  data?: T
}

/** SDK 应答：`undefined` 表示没有宿主桥。 */
export type FnosAuthorizeResult = FnosAppBridgeResponse<string[]> | undefined

/** 单次授权调用的超时。用户未在确认框上作出选择时，靠它把控制权交回调用方。 */
export const AUTHORIZE_TIMEOUT_MS = 10_000

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
 * 带超时地调用一次授权接口。
 *
 * SDK 的桥接调用本身**没有超时**：它 postMessage 之后只等宿主回复，宿主不回复
 * 就永不 settle。授权确认框出现而用户未操作时正是这种状态，因此这里自行兜底，
 * 超时按「问不到」处理而不是「没权限」。
 *
 * @returns 应答；超时或调用抛错时返回 `undefined`。
 */
async function authorizeWithTimeout(
  authorize: (path: string) => Promise<FnosAuthorizeResult>,
  path: string,
  timeoutMs: number,
): Promise<FnosAuthorizeResult> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      authorize(path),
      new Promise<undefined>(resolve => { timer = setTimeout(resolve, timeoutMs, undefined) }),
    ])
  } catch {
    return undefined
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * 校验单个路径。
 *
 * 先试共享目录接口，再试用户目录接口——两类目录由不同接口管辖，未知归属时按
 * 顺序探测即可。**只有明确成功（`code === 0`）才判为通过**；只要任一次调用
 * 「问不到」（超时/桥接缺失/异常），整体即判为不可用，交由调用方跳过剔除。
 *
 * 两个接口都被明确拒绝才判为 `invalid`：单个接口拒绝一件事只能说明该接口不
 * 管辖这条路径（例如用户目录必然不满足共享目录接口），不足以证明用户没权限。
 */
async function verifyPath(
  sdk: AuthorizeCapableSdk,
  path: string,
  timeoutMs: number,
): Promise<PathVerdict> {
  for (const probe of [sdk.authorizeSharedFile.bind(sdk), sdk.authorizeUserFile.bind(sdk)]) {
    const response = await authorizeWithTimeout(probe, path, timeoutMs)
    if (isUnavailable(response)) return 'unavailable'
    if (response.code === 0) return 'valid'
    // 明确返回了非 0 业务码：该接口不认这条路径，继续试下一个。
  }

  // 两个接口都明确拒绝：判定为用户已失去该路径的权限。
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
 * @param timeoutMs - 单次授权调用超时，默认 {@link AUTHORIZE_TIMEOUT_MS}。
 * @returns 可用性与通过/不通过清单。
 */
export async function validateAuthorizedDirectories(
  sdk: AuthorizeCapableSdk,
  paths: readonly string[],
  timeoutMs: number = AUTHORIZE_TIMEOUT_MS,
): Promise<DirectoryValidationOutcome> {
  const valid: string[] = []
  const invalid: string[] = []

  for (const [index, path] of paths.entries()) {
    const verdict = await verifyPath(sdk, path, timeoutMs)
    if (verdict === 'unavailable') {
      // 其余未校验项按「保留」处理：宁可多展示，不可因桥接故障丢目录。
      return { available: false, valid: [...valid, path, ...paths.slice(index + 1)], invalid }
    }
    if (verdict === 'valid') valid.push(path)
    else invalid.push(path)
  }

  return { available: true, valid, invalid }
}
