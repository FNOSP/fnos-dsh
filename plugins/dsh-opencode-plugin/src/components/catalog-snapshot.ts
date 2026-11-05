/**
 * 目录快照的读取编排。
 *
 * 详情页区块统一读一次 `/catalog`，账号卡（套餐）与目录卡（过滤口径、列表）共用
 * 同一份响应：两边分别请求会出现「套餐 A、列表 B」的错位。纯函数部分单独导出，
 * 便于在 node 环境里直接断言降级规则。
 *
 * @module dsh-opencode/components/catalog-snapshot
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { readCatalog, refreshCatalog } from '../client/services/catalog-data.ts'
import type { OpenCodeCatalogResponse } from '../client/services/catalog-data.ts'
import { errorMessage } from '../client/services/http.ts'
import { autoRefreshIntervalMs, POLL_HEARTBEAT_MS, shouldPoll } from '../client/services/polling.ts'
import type { TimerService } from '../client/services/polling.ts'

/** 目录视图：响应 + 状态机 + 可展示的原因。 */
export interface OpenCodeCatalogView {
  readonly response: OpenCodeCatalogResponse | undefined
  readonly status: 'loading' | 'ready' | 'error'
  readonly message: string | undefined
  readonly refreshing: boolean
}

/** 首次进入详情页时的视图。 */
export const INITIAL_CATALOG_VIEW: OpenCodeCatalogView = {
  response: undefined,
  status: 'loading',
  message: undefined,
  refreshing: false,
}

/**
 * 当前视图里是否有可展示的目录快照。
 * @param view - 目录视图。
 * @returns 已有快照时为 true；此时请求失败只更新原因，不清空列表。
 */
export function hasCatalogSnapshot(view: OpenCodeCatalogView): boolean {
  return view.response?.catalog !== undefined && view.response?.catalog !== null
}

/**
 * 用一次宿主响应推导视图。
 *
 * `catalog` 为 `null` 表示宿主连旧快照都没有，只能按失败展示；有快照时本次
 * 刷新失败的原因仍要保留为提示。
 * @param next - 宿主响应。
 * @param fallback - 无原因时的 locale 兜底。
 * @returns 下一次视图。
 */
export function catalogViewFromResponse(
  next: OpenCodeCatalogResponse,
  fallback: string,
): OpenCodeCatalogView {
  if (next.catalog === null) {
    return { response: next, status: 'error', message: next.error ?? fallback, refreshing: false }
  }
  return { response: next, status: 'ready', message: next.error, refreshing: false }
}

/**
 * 用一次异常推导视图：已有快照则保留列表，只更新原因。
 * @param previous - 当前视图。
 * @param message - 可展示的原因。
 * @returns 下一次视图。
 */
export function catalogViewFromError(
  previous: OpenCodeCatalogView,
  message: string,
): OpenCodeCatalogView {
  return {
    response: previous.response,
    status: hasCatalogSnapshot(previous) ? 'ready' : 'error',
    message,
    refreshing: false,
  }
}

/** 一次读取的入口：`force` 会打到上游，`silent` 表示轮询触发的后台刷新。 */
export type CatalogLoader = (force: boolean, silent: boolean) => void

/** 目录读取的依赖。 */
export interface OpenCodeCatalogSnapshotOptions {
  readonly timer: TimerService
  /** 自动刷新间隔（分钟）；0 表示关闭。 */
  readonly refreshMinutes: number
  /** 登录代际；变化后重拉目录。 */
  readonly revision: number
  /** 无原因时的 locale 兜底文案。 */
  readonly fallbackMessage: string
}

/**
 * 读取并维护目录视图（含自动刷新）。
 * @param options - 定时器、刷新间隔与登录代际。
 * @returns 当前视图与手动刷新入口。
 */
export function useCatalogSnapshot(options: OpenCodeCatalogSnapshotOptions): {
  readonly view: OpenCodeCatalogView
  readonly load: CatalogLoader
} {
  const { timer, refreshMinutes, revision, fallbackMessage } = options
  const [view, setView] = useState<OpenCodeCatalogView>(INITIAL_CATALOG_VIEW)
  const sequenceRef = useRef(0)
  // 兜底文案随语言切换变化，但不能让它重建 load 并触发重新请求。
  const fallbackRef = useRef(fallbackMessage)
  fallbackRef.current = fallbackMessage

  const load = useCallback<CatalogLoader>((force, silent) => {
    // 异步函数体内的 setState 不触发 lint 的「effect 内同步 setState」告警，
    // 与原有目录卡的写法一致。
    const run = async (): Promise<void> => {
      const seq = ++sequenceRef.current
      if (!silent) {
        setView(current => ({ ...current, status: 'loading', refreshing: force }))
      }
      try {
        const next = force ? await refreshCatalog() : await readCatalog()
        if (seq !== sequenceRef.current) return
        setView(catalogViewFromResponse(next, fallbackRef.current))
      } catch (error) {
        if (seq !== sequenceRef.current) return
        setView(current => catalogViewFromError(current, errorMessage(error, fallbackRef.current)))
      }
    }
    void run()
  }, [])

  useEffect(() => {
    load(false, false)
    return () => { sequenceRef.current += 1 }
  }, [load, revision])

  useEffect(() => {
    const intervalMs = autoRefreshIntervalMs(refreshMinutes)
    if (intervalMs <= 0) return
    let lastPolledAt = Date.now()
    return timer.interval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      if (!shouldPoll({ hidden: false, intervalMs, lastPolledAt, now: Date.now() })) return
      lastPolledAt = Date.now()
      load(true, true)
    }, POLL_HEARTBEAT_MS)
  }, [load, refreshMinutes, timer])

  return { view, load }
}
