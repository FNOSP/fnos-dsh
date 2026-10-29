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

import { diagnosePickerResult, isPickerNoSelection } from '../input-references/picker-result.ts'
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
    result = await sdk.pickSharedFile(params)
  } catch (error: unknown) {
    const diagnosis = diagnosePickerResult(error)
    // 用户取消在 SDK 里也可能以异常形式出现，必须与真正的失败区分开。
    if (diagnosis.outcome === 'cancelled') return { status: 'cancelled' }
    return {
      status: 'failed',
      code: diagnosis.code === 1 ? 'fnos-authorized-directory-permission-denied' : 'fnos-authorized-directory-request-failed',
      ...(diagnosis.message === undefined ? {} : { message: diagnosis.message }),
    }
  }

  if (isPickerNoSelection(result)) return { status: 'cancelled' }
  const diagnosis = diagnosePickerResult(result)
  if (diagnosis.outcome === 'cancelled') return { status: 'cancelled' }
  const path = pickedPath(result)
  if (diagnosis.outcome !== 'success' || path === undefined) {
    return {
      status: 'failed',
      code: diagnosis.code === 1 ? 'fnos-authorized-directory-permission-denied' : 'fnos-authorized-directory-request-failed',
      ...(diagnosis.message === undefined ? {} : { message: diagnosis.message }),
    }
  }
  return { status: 'picked', path }
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
