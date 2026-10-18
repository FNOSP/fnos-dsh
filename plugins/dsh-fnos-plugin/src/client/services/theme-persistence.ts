/** Persist the resolved fnOS theme without changing DSH's theme preference. */

import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { DshThemePreference } from '../../host/theme-bootstrap.ts'
import { FNOS_SYSTEM_THEME_FIELD, type FnosSettings, type FnosTheme } from '../../contracts/theme-contract.ts'

/**
 * 本模块的职责：把 fnOS 解析出的主题缓存进 DSH 设置，供宿主在响应 index.html
 * 时注入 bootstrap，避免「跟随系统」下首屏闪 light/dark。
 *
 * 为什么抑制逻辑不能只看「快照值是否等于目标」（issue #13）：
 * 写入被拒绝、或写入报告成功但紧随其后的 describe 仍返回原值时，那个条件永远
 * 不成立；而设置镜像每轮刷新都会再触发一次 sync，于是每轮都重发一次写入，形成
 * 自持循环（真实环境下 300–400ms 一轮，连带整页周期性重渲染）。
 *
 * 因此改为三重抑制，任一成立都不重发：
 * 1. 写入在途（pendingOperation）；
 * 2. 同一操作已请求且宿主 revision 尚未越过写入前的值（写成功但未收敛时不再追写）；
 * 3. 该字段被判定为本次会话不可写（降级，见 {@link unwritableFields}）。
 *
 * 只有「目标真实变化」才绕过第 2 条——那是必须写的场景（用户切主题、fnOS 主题变化）。
 */

/** 相邻两次写入之间的最小间隔：宿主 revision 未前进时避免同帧内重复排队。 */
const MIN_RETRY_INTERVAL_MS = 1_000

export function createThemePersistence(scope: ConfigForm<FnosSettings>) {
  let pendingOperation: string | undefined
  /**
   * 已请求但宿主视图尚未印证的操作。解除条件不再看「值是否等于目标」，而看
   * 「宿主 revision 是否越过本次写入前的 revision」——宿主接受了写入就会推进它。
   */
  let requestedOperation: string | undefined
  /** 发起 requestedOperation 时看到的 revision；宿主推进过它就说明该次写入已生效。 */
  let requestedRevision: number | undefined
  let lastWriteAt = 0
  /**
   * 本次会话内被判定为不可写的字段：写入明确被拒或写入后视图仍返回原值。
   * 降级只针对该字段，不阻塞其它字段与主题跟随；不持久化，重载后重试一次。
   */
  const unwritableFields = new Set<string>()

  const isSettled = (snapshot: ConfigFormSnapshot<FnosSettings>, operation: string): boolean => {
    if (requestedOperation !== operation) return false
    const current = snapshot.revision
    // 宿主接受写入会推进 revision；未推进说明该次写入没有落到文档上。
    return requestedRevision !== undefined && current !== undefined && current > requestedRevision
  }

  const sync = (preference: DshThemePreference, theme: FnosTheme | null): void => {
    const snapshot = scope.getSnapshot()
    // 上游 0.2.1 移除了 `mode: 'host' | 'memory'`：设置一律走 Host 文档，能否写入
    // 只由 `writable`（以及不可用时的 `status`）表达，不再存在「进程内记忆模式」。
    if (snapshot.status !== 'ready' || !snapshot.writable) return

    const target = preference === 'system' && theme !== null ? theme : undefined
    const operation = target === undefined ? 'unset' : `set:${target}`
    const field = FNOS_SYSTEM_THEME_FIELD

    // 该字段已判定不可写：不再尝试，也不再产生日志噪音。
    if (unwritableFields.has(field)) return

    // 写入在途：等它结算，结算时会用最新请求复核。
    if (pendingOperation !== undefined) return

    const current = snapshot.value?.[field]
    if (current === target) {
      // 快照已经与目标一致：本次无需写入，并放开同一操作的抑制。
      if (requestedOperation === operation) {
        requestedOperation = undefined
        requestedRevision = undefined
      }
      return
    }

    // 同一操作在宿主 revision 越过写入点之前不重发：这正是 issue #13 的抑制点。
    if (requestedOperation === operation && !isSettled(snapshot, operation)) {
      // 值确已收敛（对 set 而言）时让位；unset 的收敛只能由 revision 判定。
      return
    }

    const now = Date.now()
    if (now - lastWriteAt < MIN_RETRY_INTERVAL_MS) return
    lastWriteAt = now

    pendingOperation = operation
    requestedOperation = operation
    requestedRevision = snapshot.revision

    let request: Promise<boolean>
    try {
      request = target === undefined ? scope.unset(field) : scope.set(field, target)
    } catch (error) {
      // 同步抛出：视为本次不可写，降级而不是下轮重试。
      pendingOperation = undefined
      requestedOperation = undefined
      requestedRevision = undefined
      unwritableFields.add(field)
      console.debug('[dsh-fnos] fnOS theme cache is not writable this session; stopping retries', error)
      return
    }

    void Promise.resolve(request)
      .then((accepted) => {
        // 宿主明确拒绝（false）：该字段本次会话不可写，停止重试。
        // 这是 unset 被转成 set: inherited 或 revision 栅栏冲突时的实际返回值。
        if (!accepted) {
          unwritableFields.add(field)
          console.debug(`[dsh-fnos] host declined ${operation} for ${field}; marking it unwritable for this session`)
        }
      })
      .catch((error: unknown) => {
        // 传输失败同样降级：反复重试只会放大请求量，而缓存缺失是可接受的降级。
        unwritableFields.add(field)
        console.debug(`[dsh-fnos] unable to persist fnOS theme snapshot (${operation}); marking ${field} unwritable for this session`, error)
      })
      .finally(() => {
        if (pendingOperation === operation) pendingOperation = undefined
      })
  }

  return {
    sync,
    /** 供测试与排错：本次会话被判定为不可写的字段。 */
    unwritableFields,
  }
}
