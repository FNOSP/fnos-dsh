/**
 * 插件详情页的额度卡片：Start Plan 的每份额度。
 *
 * ZCode 的额度是「模型 × 周期」的矩阵，同一模型可能既有日额度又有一次性活动
 * 额度。这里逐条展示而不是合成一个总百分比——合并会掩盖「日额度用完但活动
 * 额度还有」这类实际情况，而用户正是靠这个差别决定要不要继续用。
 *
 * @module dsh-zcode/components/UsageCard
 */

import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { DshProgress } from '@tnnevol/dsh-semi-ui'
import type { ZCodeTranslate } from '../client/locales.ts'
import { describeDuration, formatIsoTimestamp, formatTokens } from '../client/services/format.ts'
import { errorMessage } from '../client/services/http.ts'
import type { TimerService } from '../client/services/polling.ts'
import { readUsage } from '../client/services/usage-data.ts'
import type { ZCodeUsageResponse } from '../client/services/usage-data.ts'
import type { ZCodeUsageWindow } from '../contracts/usage.ts'

/** 额度卡片参数。 */
export interface ZCodeUsageCardProps {
  readonly t: ZCodeTranslate
  readonly timer: TimerService
  /** 自动刷新间隔（分钟）；0 表示关闭。 */
  readonly refreshMinutes: number
  /** 登录代际：变化时重新拉取。 */
  readonly revision: number
}

/** 周期标签。 */
function periodLabel(period: string | undefined, t: ZCodeTranslate): string {
  if (period === 'daily') return t('usagePeriodDaily')
  if (period === 'weekly') return t('usagePeriodWeekly')
  if (period === 'monthly') return t('usagePeriodMonthly')
  if (period === 'one_time') return t('usagePeriodOneTime')
  if (period === 'custom') return t('usagePeriodCustom')
  return t('usagePeriodUnknown')
}

/** 重置倒计时文字。 */
function resetText(window: ZCodeUsageWindow, t: ZCodeTranslate, now: number): string {
  if (window.resetsAt === undefined) return t('usageNoReset')
  const at = Date.parse(window.resetsAt)
  if (!Number.isFinite(at)) return t('usageNoReset')
  const remaining = at - now
  if (remaining <= 0) return t('usageNoReset')
  const { value, unit } = describeDuration(remaining)
  const when = unit === 'minutes'
    ? t('timeMinutes', { count: value })
    : unit === 'hours'
      ? t('timeHours', { count: value })
      : t('timeDays', { count: value })
  return t('usageResets', { when })
}

/** 一个额度窗口行。 */
function UsageRow({
  window,
  t,
  now,
}: {
  window: ZCodeUsageWindow
  t: ZCodeTranslate
  now: number
}): ReactNode {
  const percent = Math.max(0, Math.min(100, window.percent))
  return (
    <li className="dsh-zcode-usage-row">
      <div className="dsh-zcode-usage-head">
        <span className="dsh-zcode-usage-label">{window.label}</span>
        <span className="dsh-zcode-usage-period">{periodLabel(window.period, t)}</span>
        {window.exhausted ? <span className="dsh-zcode-usage-badge">{t('usageExhausted')}</span> : null}
      </div>
      <DshProgress
        percent={percent}
        showInfo={false}
        aria-label={`${window.label} ${t('usageUsed', { percent: Math.round(percent) })}`}
        stroke={window.exhausted ? 'var(--dsw-alias-state-error)' : undefined}
      />
      <div className="dsh-zcode-usage-foot">
        <span>
          {t('usageRemaining', {
            remaining: formatTokens(window.remainingUnits),
            total: formatTokens(window.totalUnits),
          })}
        </span>
        <span>{t('usageUsed', { percent: Math.round(percent) })}</span>
        <span>{resetText(window, t, now)}</span>
      </div>
    </li>
  )
}

/**
 * 额度卡片。
 * @returns 额度卡片元素。
 */
export function ZCodeUsageCard({ t, timer, refreshMinutes, revision }: ZCodeUsageCardProps): ReactNode {
  const [response, setResponse] = useState<ZCodeUsageResponse>()
  const [loadError, setLoadError] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(() => Date.now())

  const load = useCallback(async (): Promise<void> => {
    try {
      setResponse(await readUsage())
      setLoadError(undefined)
    } catch (error) {
      setLoadError(errorMessage(error, t('usageRequestFailed')))
    } finally {
      setLoading(false)
      setNow(Date.now())
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load, revision])

  useEffect(() => {
    if (refreshMinutes <= 0) return
    const ms = Math.max(60_000, refreshMinutes * 60_000)
    return timer.interval(() => { void load() }, ms)
  }, [load, refreshMinutes, timer])

  // 倒计时每秒重算：只改本地时间戳，不重新请求。
  useEffect(() => {
    return timer.interval(() => { setNow(Date.now()) }, 30_000)
  }, [timer])

  const signedIn = response?.signedIn === true
  const usage = response !== undefined && response.signedIn === true && 'usage' in response
    ? response.usage
    : undefined
  const requestError = response !== undefined && response.signedIn === true && 'error' in response
    ? response.error
    : undefined

  return (
    <section className="dsh-zcode-card" aria-labelledby="dsh-zcode-usage-title">
      <header className="dsh-zcode-card-header">
        <div className="dsh-zcode-card-heading">
          <h3 id="dsh-zcode-usage-title" className="dsh-zcode-card-title">{t('usageTitle')}</h3>
          <p className="dsh-zcode-card-desc">{t('usageIntro')}</p>
        </div>
      </header>

      {loadError === undefined ? null : <p className="dsh-zcode-error" role="alert">{loadError}</p>}
      {requestError === undefined ? null : <p className="dsh-zcode-error" role="alert">{requestError}</p>}

      {loading ? (
        <p className="dsh-zcode-body">{t('accountLoading')}</p>
      ) : signedIn !== true ? (
        <p className="dsh-zcode-body">{t('usageSignedOut')}</p>
      ) : usage === undefined ? (
        <p className="dsh-zcode-body">{t('usageEmpty')}</p>
      ) : (
        <>
          {usage.plans.length === 0 ? null : (
            <div className="dsh-zcode-plans">
              <span className="dsh-zcode-plans-label">{t('usagePlans')}</span>
              <ul className="dsh-zcode-plan-list">
                {usage.plans.map(plan => (
                  <li key={plan.planId} className="dsh-zcode-plan">
                    <span className="dsh-zcode-plan-name">{plan.name ?? plan.planId}</span>
                    {plan.endsAt === undefined ? null : (
                      <span className="dsh-zcode-plan-ends">
                        {formatIsoTimestamp(plan.endsAt) ?? plan.endsAt}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {usage.windows.length === 0
            ? <p className="dsh-zcode-body">{t('usageEmpty')}</p>
            : (
                <ul className="dsh-zcode-usage-list">
                  {usage.windows.map(window => (
                    <UsageRow
                      key={`${window.capability ?? window.label}:${window.period ?? 'unknown'}`}
                      window={window}
                      t={t}
                      now={now}
                    />
                  ))}
                </ul>
              )}
        </>
      )}
    </section>
  )
}
