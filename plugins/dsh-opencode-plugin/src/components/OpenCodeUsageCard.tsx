/** 插件详情页的套餐额度卡片，以及详情页与输入区共用的用量读取 hook。 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { DshButton, DshIconRefresh, DshProgress, DshSpin, DshTag } from '@tnnevol/dsh-semi-ui'
import type { OpenCodeTranslate } from '../client/locales.ts'
import { formatTimestamp } from '../client/services/format.ts'
import { autoRefreshIntervalMs, POLL_HEARTBEAT_MS, shouldPoll } from '../client/services/polling.ts'
import type { TimerService } from '../client/services/polling.ts'
import { readUsage, usageSnapshotFromError, usageSnapshotFromResponse } from '../client/services/usage-data.ts'
import type { OpenCodeUsageSnapshot } from '../client/services/usage-data.ts'
import {
  countdownUnitKey,
  formatCountdownParts,
  OPENCODE_USAGE_WINDOW_KINDS,
  resetCountdown,
  usageWindowLabelKey,
  usageWindowOf,
  usedPercentText,
  usedPercentValue,
} from '../client/services/usage-windows.ts'
import type { ResetCountdown } from '../client/services/usage-windows.ts'

/** 用量读取 hook 的入参。 */
export interface UseOpenCodeUsageInput {
  readonly timer: TimerService
  /** 自动刷新间隔（分钟）；0 表示只做首次读取与手动刷新。 */
  readonly refreshMinutes: number
  /** 是否建立轮询；胶囊在隐藏时不轮询，卡片始终为 true。 */
  readonly active: boolean
  /** 登录代际；变化后立即重拉。 */
  readonly revision?: number | undefined
  /** 异常且无宿主文案时的兜底。 */
  readonly fallbackError: string
}

/** 用量读取 hook 的返回值。 */
export interface OpenCodeUsageController {
  readonly snapshot: OpenCodeUsageSnapshot
  readonly refreshing: boolean
  refresh: () => Promise<void>
}

/**
 * 读取用量并维护轮询。
 *
 * 轮询按心跳运行，页面隐藏时整拍跳过（`document.hidden`）；恢复可见与登录
 * 代际变化时立即补一次。卸载或 `active` 变 false 时递增序号，丢弃在途响应。
 *
 * @param input - 定时器、刷新间隔、是否启用与兜底文案。
 * @returns 快照、刷新状态与手动刷新函数。
 */
export function useOpenCodeUsage(input: UseOpenCodeUsageInput): OpenCodeUsageController {
  const { timer, refreshMinutes, active, fallbackError } = input
  const revision = input.revision ?? 0
  const [snapshot, setSnapshot] = useState<OpenCodeUsageSnapshot>({ state: 'loading' })
  const [refreshing, setRefreshing] = useState(false)
  const sequenceRef = useRef(0)
  const lastPolledAtRef = useRef<number | undefined>(undefined)

  const refresh = useCallback(async (): Promise<void> => {
    const seq = ++sequenceRef.current
    lastPolledAtRef.current = Date.now()
    setRefreshing(true)
    try {
      const response = await readUsage()
      if (seq !== sequenceRef.current) return
      setSnapshot(previous => usageSnapshotFromResponse(response, previous))
    } catch (error) {
      if (seq !== sequenceRef.current) return
      // 失败时保留上一次确认的登录状态与最近成功读取的窗口，界面据此显示
      // 「获取时间」而不是把未读到的窗口画成 0%。
      setSnapshot(previous => usageSnapshotFromError(error, previous, fallbackError))
    } finally {
      if (seq === sequenceRef.current) setRefreshing(false)
    }
  }, [fallbackError])

  useEffect(() => {
    if (!active) return
    const intervalMs = autoRefreshIntervalMs(refreshMinutes)
    const hidden = (): boolean => typeof document !== 'undefined' && document.hidden
    const tick = (): void => {
      if (hidden()) return
      if (!shouldPoll({ hidden: false, intervalMs, lastPolledAt: lastPolledAtRef.current, now: Date.now() })) return
      void refresh()
    }
    const onVisibilityChange = (): void => {
      if (hidden()) return
      void refresh()
    }
    if (!hidden()) void refresh()
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibilityChange)
    const disposeInterval = intervalMs > 0 ? timer.interval(tick, POLL_HEARTBEAT_MS) : undefined
    return () => {
      sequenceRef.current += 1
      disposeInterval?.()
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [active, refresh, refreshMinutes, revision, timer])

  return { snapshot, refreshing, refresh }
}

/**
 * 每 30 秒推进一次的「现在」，用于刷新重置倒计时。
 * @returns 当前 epoch 毫秒。
 */
export function useOpenCodeNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => { setNow(Date.now()) }, 30_000)
    return () => { window.clearInterval(id) }
  }, [])
  return now
}

/**
 * 把倒计时状态拼成一句可读文案。
 * @param countdown - `resetCountdown` 的结果。
 * @param t - 翻译函数。
 * @returns 例如「3小时 2分后重置」。
 */
export function resetCountdownText(countdown: ResetCountdown, t: OpenCodeTranslate): string {
  if (countdown.kind === 'soon') return t('usageResetSoon')
  if (countdown.kind === 'unknown') return t('usageResetUnknown')
  const duration = formatCountdownParts(countdown.parts, unit => t(countdownUnitKey(unit)))
  return t('usageResetsIn', { duration })
}

/** 卡片参数。 */
export interface OpenCodeUsageCardProps {
  readonly t: OpenCodeTranslate
  readonly timer: TimerService
  readonly refreshMinutes: number
  readonly revision: number
}

/**
 * 套餐额度卡片：三个窗口的已用百分比、进度条与重置倒计时。
 * @returns 额度卡片元素。
 */
export function OpenCodeUsageCard({ t, timer, refreshMinutes, revision }: OpenCodeUsageCardProps): ReactNode {
  const controller = useOpenCodeUsage({
    timer,
    refreshMinutes,
    active: true,
    revision,
    fallbackError: t('usageUnavailable'),
  })
  const { snapshot, refreshing, refresh } = controller
  const now = useOpenCodeNow()
  const usage = snapshot.usage
  const updatedAt = formatTimestamp(usage?.fetchedAt)
  const plan = usage?.plan

  return (
    <section className="dsh-opencode-card" aria-labelledby="dsh-opencode-usage-title">
      <header className="dsh-opencode-card-header">
        <div className="dsh-opencode-card-heading">
          <h3 id="dsh-opencode-usage-title" className="dsh-opencode-card-title">{t('usageTitle')}</h3>
          <p className="dsh-opencode-card-desc">{t('usageIntro')}</p>
        </div>
        <div className="dsh-opencode-card-actions">
          {plan === undefined ? null : <DshTag size="small" type="light">{`${t('usagePlan')}: ${plan}`}</DshTag>}
          <DshButton
            htmlType="button"
            theme="borderless"
            type="tertiary"
            size="small"
            icon={<DshIconRefresh />}
            loading={refreshing}
            onClick={() => { void refresh() }}
          >
            {t('usageRefresh')}
          </DshButton>
        </div>
      </header>

      {snapshot.state === 'loading' ? (
        <div className="dsh-opencode-status-row" role="status">
          <DshSpin size="small" />
          <span>{t('usageLoading')}</span>
        </div>
      ) : null}
      {snapshot.state === 'unavailable' ? (
        <p className="dsh-opencode-muted">
          {snapshot.signedIn === false ? t('usageSignedOut') : snapshot.message ?? t('usageUnavailable')}
        </p>
      ) : null}

      {usage === undefined ? null : (
        <div className="dsh-opencode-usage-windows">
          {OPENCODE_USAGE_WINDOW_KINDS.map(kind => {
            const window = usageWindowOf(usage, kind)
            if (window === undefined) return null
            const label = t(usageWindowLabelKey(kind))
            const used = usedPercentText(window) ?? '—'
            return (
              <div className="dsh-opencode-usage-window" key={kind}>
                <div className="dsh-opencode-usage-heading">
                  <span className="dsh-opencode-usage-label">{label}</span>
                  <span className="dsh-opencode-usage-value">{`${t('usageUsed')} ${used}`}</span>
                </div>
                <DshProgress
                  percent={usedPercentValue(window)}
                  showInfo={false}
                  stroke="var(--dsw-alias-label-tertiary)"
                  orbitStroke="var(--dsw-alias-border-l3)"
                  className="dsh-opencode-usage-progress"
                  aria-label={`${label} ${t('usageUsed')} ${used}`}
                />
                <div className="dsh-opencode-usage-footer">
                  <span className="dsh-opencode-usage-reset">{resetCountdownText(resetCountdown(window, now), t)}</span>
                  {window.status === 'rate-limited' ? (
                    <DshTag size="small" color="orange">{t('usageRateLimited')}</DshTag>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {updatedAt === undefined ? null : (
        <p className="dsh-opencode-muted">{t('usageFetchedAt', { time: updatedAt })}</p>
      )}
    </section>
  )
}
