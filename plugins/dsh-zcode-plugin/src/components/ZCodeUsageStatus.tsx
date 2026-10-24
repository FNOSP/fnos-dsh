/**
 * 对话输入区右侧的 ZCode 额度胶囊。
 *
 * 显隐由偏好决定：`auto` 只在当前会话选中 ZCode 模型时出现，`always` 常驻，
 * `off` 完全隐藏并停止轮询。`auto` 的判定读会话的模型选择——胶囊出现在
 * 用户正在用 ZCode 对话的时候，而不是任何对话都挂着。
 *
 * @module dsh-zcode/components/UsageStatus
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { DshPopover, DshProgress, DshSpin } from '@tnnevol/dsh-semi-ui'
import { shouldShowCapsule } from '../client/services/capsule-visibility.ts'
import type { ZCodeUsage, ZCodeUsageWindow } from '../contracts/usage.ts'
import type { ZCodeTranslate } from '../client/locales.ts'
import { authEpoch, subscribeAuthEpoch } from '../client/services/auth-events.ts'
import { describeDuration, formatTokens } from '../client/services/format.ts'
import { errorMessage } from '../client/services/http.ts'
import type { TimerService } from '../client/services/polling.ts'
import type { ZCodePreferencesStore } from '../client/services/preferences-data.ts'
import { readUsage } from '../client/services/usage-data.ts'

/** `conversation.input.right` 座位注入的依赖。 */
export interface ZCodeUsageStatusInjected {
  readonly t: ZCodeTranslate
  readonly timer: TimerService
  readonly preferences: ZCodePreferencesStore
}

/** 座位标准套件里本组件用到的字段。 */
interface UsageStatusSlotProps {
  /** 当前会话的模型选择；未选中时为 undefined。 */
  readonly modelSelection?: { readonly providerId?: string } | undefined
}

/** 周期标签。 */
function periodLabel(period: string | undefined, t: ZCodeTranslate): string {
  if (period === 'daily') return t('usagePeriodDaily')
  if (period === 'weekly') return t('usagePeriodWeekly')
  if (period === 'monthly') return t('usagePeriodMonthly')
  if (period === 'one_time') return t('usagePeriodOneTime')
  return t('usagePeriodUnknown')
}

/** 重置倒计时。 */
function resetText(window: ZCodeUsageWindow, t: ZCodeTranslate, now: number): string {
  if (window.resetsAt === undefined) return t('usageNoReset')
  const at = Date.parse(window.resetsAt)
  if (!Number.isFinite(at) || at <= now) return t('usageNoReset')
  const { value, unit } = describeDuration(at - now)
  const when = unit === 'minutes'
    ? t('timeMinutes', { count: value })
    : unit === 'hours'
      ? t('timeHours', { count: value })
      : t('timeDays', { count: value })
  return t('usageResets', { when })
}

/**
 * 用量胶囊。
 * @param props - 座位注入面 + 座位标准套件。
 * @returns 胶囊元素；不该显示时返回 `null`。
 */
export function ZCodeUsageStatus(
  props: ZCodeUsageStatusInjected & UsageStatusSlotProps,
): ReactNode {
  const { t, timer, preferences } = props
  const { value: prefs, loaded } = useSyncExternalStore(
    preferences.subscribe,
    preferences.getSnapshot,
    preferences.getSnapshot,
  )
  const revision = useSyncExternalStore(subscribeAuthEpoch, authEpoch, authEpoch)
  const [usage, setUsage] = useState<ZCodeUsage>()
  const [error, setError] = useState<string>()
  // 是否完成过至少一次读取；只有「读过了且既没数据也没错误」才当作空。
  const [settled, setSettled] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    void preferences.ensureLoaded().catch(() => undefined)
  }, [preferences])

  const visible = loaded && shouldShowCapsule(prefs.usageVisibility, props.modelSelection)

  useEffect(() => {
    if (!visible) return
    // 用局部标记代替在 effect 里同步 setLoading(true)：同步 set 会造成一次
    // 多余渲染，而这里真正关心的是「首次读取完成前显示占位」。
    let live = true
    void (async () => {
      try {
        const response = await readUsage()
        if (!live) return
        if (response.signedIn && 'usage' in response) {
          setUsage(response.usage)
          setError(undefined)
        } else if (response.signedIn && 'error' in response) {
          setError(response.error)
        } else {
          setUsage(undefined)
          setError(undefined)
        }
      } catch (loadError) {
        if (live) setError(errorMessage(loadError, t('usageRequestFailed')))
      } finally {
        if (live) {
          setSettled(true)
          setNow(Date.now())
        }
      }
    })()
    return () => { live = false }
  }, [revision, t, visible])

  // 胶囊跟着偏好间隔轮询；关闭自动刷新时不建定时器。
  useEffect(() => {
    if (!visible || prefs.refreshMinutes <= 0) return
    const ms = Math.max(60_000, prefs.refreshMinutes * 60_000)
    return timer.interval(() => { void readUsage().then(response => {
      if (response.signedIn && 'usage' in response) setUsage(response.usage)
    }).catch(() => undefined) }, ms)
  }, [prefs.refreshMinutes, timer, visible])

  useEffect(() => {
    if (!visible) return
    return timer.interval(() => { setNow(Date.now()) }, 30_000)
  }, [timer, visible])

  const headline = useMemo(() => usage?.windows[0], [usage])

  if (!visible) return null

  if (error !== undefined) {
    return (
      <span className="dsh-zcode-capsule dsh-zcode-capsule--error" title={error}>
        {t('capsuleTitle')}
      </span>
    )
  }

  if (!settled && usage === undefined && error === undefined) {
    return (
      <span className="dsh-zcode-capsule" title={t('capsuleTitle')}>
        <DshSpin size="small" />
      </span>
    )
  }

  if (usage === undefined || headline === undefined) {
    return (
      <span className="dsh-zcode-capsule" title={t('capsuleEmpty')}>
        {t('capsuleTitle')}
      </span>
    )
  }

  const percent = Math.max(0, Math.min(100, headline.percent))
  const remaining = Math.max(0, 100 - percent)

  return (
    <DshPopover
      trigger="hover"
      position="topRight"
      content={(
        <div className="dsh-zcode-capsule-panel">
          <p className="dsh-zcode-capsule-panel-title">{t('capsuleTitle')}</p>
          <ul className="dsh-zcode-capsule-list">
            {usage.windows.map(window => (
              <li key={`${window.capability ?? window.label}:${window.period ?? 'unknown'}`} className="dsh-zcode-capsule-row">
                <div className="dsh-zcode-capsule-row-head">
                  <span>{window.label}</span>
                  <span className="dsh-zcode-capsule-row-period">{periodLabel(window.period, t)}</span>
                </div>
                <DshProgress percent={Math.max(0, Math.min(100, window.percent))} showInfo={false} />
                <div className="dsh-zcode-capsule-row-foot">
                  <span>{formatTokens(window.remainingUnits)} / {formatTokens(window.totalUnits)}</span>
                  <span>{resetText(window, t, now)}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    >
      <span
        className="dsh-zcode-capsule"
        title={t('usageRemaining', {
          remaining: formatTokens(headline.remainingUnits),
          total: formatTokens(headline.totalUnits),
        })}
      >
        <span className="dsh-zcode-capsule-label">{headline.label}</span>
        <span className="dsh-zcode-capsule-value">{Math.round(remaining)}%</span>
      </span>
    </DshPopover>
  )
}

export { shouldShowCapsule } from '../client/services/capsule-visibility.ts'
