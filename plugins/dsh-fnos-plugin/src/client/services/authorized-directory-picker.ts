/**
 * 唤起 fnOS 原生目录选择器申请一个授权目录。
 *
 * 为什么必须走原生选择器：fnOS 的目录权限只能由**用户在系统主程序里逐级确认**，
 * 插件没有「直接授权任意路径」的能力。因此这里的语义是「请用户挑一个目录并授权」，
 * 而不是「在面板里自由浏览文件系统」。
 *
 * 该函数把「创建 SDK → 就绪 → 选目录 → 判定结果」这条链路收敛到一处：设置页的
 * 授权卡片与输入区选择器面板都要用它，两处各写一遍必然在错误分类上漂移。
 */

import { diagnosePickerResult, isPickerNoSelection, logPickerSdkEvent, logPickerSdkValue } from '../input-references/picker-result.ts'
import { createTrimApp } from './sdk.ts'

/** 选择器返回的授权结果。 */
export type AuthorizedPickOutcome =
  /** 用户选中了目录。 */
  | { readonly status: 'picked', readonly path: string }
  /** 用户取消或未选任何目录（非错误，调用方静默处理）。 */
  | { readonly status: 'cancelled' }
  /** 授权失败（权限拒绝或接口异常）。 */
  | { readonly status: 'failed', readonly code: string, readonly message?: string }

export interface PickAuthorizedDirectoryOptions {
  /** 选择器窗口标题。 */
  readonly title: string
  /** 确认按钮文案。 */
  readonly okText: string
}

/** fnOS 选择器允许出现的侧边栏分组。 */
const SIDEBAR_GROUPS = ['myFiles', 'otherShare', 'external', 'remote', 'favorites'] as const

/**
 * 打开原生选择器，返回用户授权的目录。
 *
 * 不抛异常：整条链路的结果都折叠进 {@link AuthorizedPickOutcome}，让调用方用
 * 一个 `switch` 处理完，避免「取消」被当成错误弹提示。
 */
export async function pickAuthorizedDirectory(
  options: PickAuthorizedDirectoryOptions,
): Promise<AuthorizedPickOutcome> {
  const params = {
    title: options.title,
    okText: options.okText,
    sidebarGroup: SIDEBAR_GROUPS,
  } as const

  let result: unknown
  try {
    const sdk = createTrimApp()
    await sdk.ready()
    logPickerSdkEvent('created', { via: 'authorized-directory-picker', isWeb: sdk.isWeb, isStandaloneWeb: sdk.isStandaloneWeb })
    result = await sdk.pickSharedFile(params)
    // 记录真实返回形态：本地无法复现真机取消/失败的各种 shape，出问题时
    // 这条日志是唯一能定性的一手证据（不含选中的 NAS 路径）。
    logPickerSdkValue('resolved', result)
    // 原始返回单独打一条：诊断只保留形状摘要，而真机取消的形态比契约更杂，
    // 排障时需要看到完整对象才能判定。不含选中的 NAS 路径以外的敏感信息。
    console.info('[dsh-fnos][fnos-sdk] raw-result', JSON.stringify(result))
  } catch (error: unknown) {
    logPickerSdkValue('rejected', error)
    // `pickSharedFile` 阶段的异常一律视为「用户没有选到目录」。
    //
    // 依据是插件设置页的既有行为：它在该阶段无条件静默返回。设置页从未出现
    // 「取消却提示无权限」，而选择器面板反复出现——两者唯一的结构差异就在这里。
    // 设置页不判断异常是不是取消，直接当成取消。
    //
    // 为什么可以这样放宽：原生选择器是独立窗口，它能抛出的异常只有「用户关掉了
    // 它」这一类；真正的授权失败走的是**正常返回**（`status: 'error'` /
    // `error: 'access_denied'`），由下方返回值的判定覆盖，不会落到这里。
    // 因此这里静默不会掩盖真实错误。
    if (isCancellation(error)) return { status: 'cancelled' }
    console.info('[dsh-fnos][fnos-sdk] pick-rejected-as-cancel', {
      reason: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : undefined,
    })
    return { status: 'cancelled' }
  }

  if (isPickerNoSelection(result)) return { status: 'cancelled' }
  if (isCancellation(result)) return { status: 'cancelled' }
  const path = pickedPath(result)
  if (path === undefined) {
    // 取不到路径时再判一次「这算不算取消」，而不是直接当失败。
    //
    // 语义上「成功必然带路径」，所以 `code: 0` 但拿不到路径只能是用户没选。
    // 真机上取消的形态比契约更杂（`data` 可能是 null、`[]`、缺失，或包了一层
    // 非标准结构），只靠文案/status 会漏；把它当取消比弹「无法授权」更贴近事实。
    // 但必须先排除「明确的错误」：`status: 'error'` 或 `error: 'access_denied'`
    // 是真实的权限/接口失败，绝不能因为没取到路径就改判成取消——那会把真问题
    // 变成静默，用户以为没事、实际什么都没发生。
    const record = typeof result === 'object' && result !== null && !Array.isArray(result)
      ? result as Record<string, unknown>
      : undefined
    const explicitError = typeof record?.status === 'string' && record.status.trim().toLowerCase() === 'error'
    if (explicitError || record?.error === 'access_denied') return failureOf(result)
    const code = record?.code
    if (code === 0 || code === undefined) return { status: 'cancelled' }
    return failureOf(result)
  }
  return { status: 'picked', path }
}

/**
 * 是否为用户取消。
 *
 * 两层判定：先走通用诊断（覆盖 `undefined` 结果、`cancel` 状态、取消文案、
 * AbortError），再兜一层官方契约的显式信号——`status: 'cancel'`。后者是
 * `@trimjs/web-app` 的 `AppAuthCallbackStatus` 定义值，不该依赖正则去猜。
 */
function isCancellation(value: unknown): boolean {
  const record = typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
  if (typeof record?.status === 'string' && record.status.trim().toLowerCase() === 'cancel') return true
  return diagnosePickerResult(value).outcome === 'cancelled'
}

/**
 * 把失败折叠成调用方能展示的原因。
 *
 * 只有官方契约里明确的 `access_denied` 才算权限问题；其余一律按接口失败处理。
 * 早先实现用 `code === 1` 判断权限，但 `code: 1` 在 fnOS 各版本里也用于普通的
 * 取消失败，会把取消说成「没有权限」。
 */
function failureOf(value: unknown): AuthorizedPickOutcome {
  const diagnosis = diagnosePickerResult(value)
  const denied = diagnosis.error === 'access_denied'
  return {
    status: 'failed',
    code: denied ? 'fnos-authorized-directory-permission-denied' : 'fnos-authorized-directory-request-failed',
    ...(diagnosis.message === undefined ? {} : { message: diagnosis.message }),
  }
}

/**
 * 从选择器结果里取出目录路径。
 *
 * fnOS 各版本返回形状不完全一致（`data.path` / `paths[]` / 裸字符串），这里按
 * 宽松顺序取第一个合法绝对路径；取不到就返回 undefined，由调用方判为失败。
 */
function pickedPath(value: unknown): string | undefined {
  const accept = (candidate: unknown): string | undefined =>
    typeof candidate === 'string' && candidate.startsWith('/') ? candidate : undefined

  const direct = accept(value)
  if (direct !== undefined) return direct
  if (typeof value !== 'object' || value === null) return undefined

  const record = value as Record<string, unknown>
  const data = record.data
  // 最常见形态：`{ code: 0, data: ['/path'] }`。data 本身就是路径数组，
  // 早期实现只查了 `data.path`，于是成功结果被判成失败。
  if (Array.isArray(data)) {
    for (const item of data) {
      const candidate = accept(item)
      if (candidate !== undefined) return candidate
    }
  }
  if (typeof data === 'object' && data !== null) {
    const nested = accept((data as Record<string, unknown>).path)
    if (nested !== undefined) return nested
  }
  for (const key of ['path', 'resultPath']) {
    const candidate = accept(record[key])
    if (candidate !== undefined) return candidate
  }
  const paths = record.paths
  if (Array.isArray(paths)) {
    for (const item of paths) {
      const candidate = accept(item)
      if (candidate !== undefined) return candidate
    }
  }
  return undefined
}
