/**
 * 对话输入区的 ZCode 额度图标。
 *
 * 结构与 Codex 插件的用量图标保持一致（同一座位、同一交互约定）：
 * - 环形进度（26px，环心放品牌标记）表达额度剩余比例；
 * - 悬停出 tooltip 摘要（模型 · 剩余 · 重置）；
 * - 点击出 popover 列出每一份额度（模型 × 周期）；
 * - 未登录、或选中模型不属于本供应商时整体不挂出。
 *
 * 与 Codex 的唯一差别是额度粒度：Codex 是固定的五小时 / 每周 / 每月三个窗口，
 * ZCode 是「每个模型 × 周期」。所以环形取**当前选中模型**那一份，popover 再列
 * 全部——否则用户看不出环上那个百分比属于哪一份额度。
 *
 * @module dsh-zcode/components/UsageStatus
 */

import { useEffect, useState, useSyncExternalStore } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { DshPopover, DshProgress, DshTooltip } from '@tnnevol/dsh-semi-ui'
import { ZCODE_PROVIDER_NAME } from '../contracts/identity.ts'
import type { ZCodeUsage, ZCodeUsageWindow } from '../contracts/usage.ts'
import type { ZCodeTranslate } from '../client/locales.ts'
import { authEpoch, subscribeAuthEpoch } from '../client/services/auth-events.ts'
import {
  readSelectedModel,
  readSelectedProvider,
  shouldShowCapsule,
  type ModelSelectionProjectionLike,
} from '../client/services/capsule-visibility.ts'
import { describeDuration, formatTokens } from '../client/services/format.ts'
import { aggregateUsage, windowsForModel } from '../client/services/usage-window-select.ts'
import { primaryWindow, remainingOf } from '../client/services/usage-window-select.ts'
import type { TimerService } from '../client/services/polling.ts'
import type { ZCodePreferencesStore } from '../client/services/preferences-data.ts'
import { readUsage } from '../client/services/usage-data.ts'

/** `conversation.input.right` 座位注入的依赖。 */
export interface ZCodeUsageStatusInjected {
  readonly t: ZCodeTranslate
  readonly timer: TimerService
  readonly preferences: ZCodePreferencesStore
}

/**
 * 座位标准套件里本组件用到的字段。
 *
 * `useProjection` 由渲染器的会话作用域座位提供，**不能**通过 `inject` 传：
 * `inject` 在 React 之外执行，传不了 hook。投影形状是 `{ next, lastUsed }`，
 * 取 `next ?? lastUsed`。
 */
interface UsageStatusSlotProps {
  readonly useProjection: <T>(name: 'modelSelection') => T | undefined
}

/** 轮询间隔（毫秒）：额度是低频变化数据。 */
const REFRESH_MS = 5 * 60_000

/** 周期标签。 */
function periodLabel(period: string | undefined, t: ZCodeTranslate): string {
  if (period === 'daily') return t('usagePeriodDaily')
  if (period === 'weekly') return t('usagePeriodWeekly')
  if (period === 'monthly') return t('usagePeriodMonthly')
  if (period === 'one_time') return t('usagePeriodOneTime')
  if (period === 'custom') return t('usagePeriodCustom')
  return t('usagePeriodUnknown')
}

/** 重置时间文字。 */
function resetLabel(window: ZCodeUsageWindow, t: ZCodeTranslate, now: number): string | undefined {
  if (window.resetsAt === undefined) return undefined
  const at = Date.parse(window.resetsAt)
  if (!Number.isFinite(at) || at <= now) return undefined
  const { value, unit } = describeDuration(at - now)
  const when = unit === 'minutes'
    ? t('timeMinutes', { count: value })
    : unit === 'hours'
      ? t('timeHours', { count: value })
      : t('timeDays', { count: value })
  return t('usageResets', { when })
}

/**
 * ZCode 官方标记：白色几何 Z。
 *
 * 环心只有 12px，所以只取「Z」本身、用 `currentColor` 上色，与外环描边同一
 * 色阶；不画底板，避免小尺寸下糊成一块。
 */
function ZCodeLogo(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M4 4h16v3.6H10.4zM4 16.4h16V20H9.2zM14.2 4H20L9.8 20H4z"
      />
    </svg>
  )
}

/** popover 里的单份额度。 */
function WindowDetails({
  window,
  t,
  now,
}: {
  window: ZCodeUsageWindow
  t: ZCodeTranslate
  now: number
}): ReactNode {
  const remainingPercent = Math.round(remainingOf(window))
  const reset = resetLabel(window, t, now)
  return (
    <div className="dsh-zcode-usage-popover-window">
      <div className="dsh-zcode-usage-popover-heading">
        <span className="dsh-zcode-usage-popover-title">
          {window.label}
          <span className="dsh-zcode-usage-popover-period">{periodLabel(window.period, t)}</span>
        </span>
        <span>{t('usageRemainingPercent', { percent: remainingPercent })}</span>
      </div>
      <DshProgress
        percent={remainingPercent}
        showInfo={false}
        stroke="var(--dsw-alias-label-tertiary)"
        orbitStroke="var(--dsw-alias-border-l3)"
        className="dsh-zcode-usage-popover-progress"
      />
      <div className="dsh-zcode-usage-popover-foot">
        <span>
          {t('usageUnitsRemaining', {
            remaining: formatTokens(window.remainingUnits),
            total: formatTokens(window.totalUnits),
          })}
        </span>
        <span>{window.exhausted ? t('usageExhausted') : reset ?? t('usageNoReset')}</span>
      </div>
    </div>
  )
}

/** 全部额度的 popover 内容。 */
function UsagePopover({
  usage,
  t,
  now,
  fallback,
}: {
  usage: ZCodeUsage | undefined
  t: ZCodeTranslate
  now: number
  fallback: string
}): ReactNode {
  const windows = usage?.windows ?? []
  const plans = usage?.plans ?? []
  return (
    <div className="dsh-zcode-usage-popover-content">
      {plans.length === 0
        ? null
        : (
            <span className="dsh-zcode-usage-popover-plan">
              {`${t('usagePlans')}: ${plans.map(plan => plan.name ?? plan.planId).join(' / ')}`}
            </span>
          )}
      {windows.length === 0
        ? <span className="dsh-zcode-usage-popover-empty">{fallback}</span>
        : windows.map(window => (
            <WindowDetails
              key={`${window.capability ?? window.label}:${window.period ?? 'unknown'}`}
              window={window}
              t={t}
              now={now}
            />
          ))}
    </div>
  )
}

/**
 * 用量图标。
 * @param props - 座位注入面 + 座位标准套件。
 * @returns 图标元素；不该显示时返回 `null`。
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
  // 会话作用域座位的标准套件由渲染器保证存在，因此无条件调用 hook。
  const selection = props.useProjection<ModelSelectionProjectionLike>('modelSelection')
  const provider = readSelectedProvider(selection)
  const selectedModel = readSelectedModel(selection)

  const [usage, setUsage] = useState<ZCodeUsage>()
  const [signedIn, setSignedIn] = useState<boolean>()
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    void preferences.ensureLoaded().catch(() => undefined)
  }, [preferences])

  /*
   * 未登录或选中别的供应商时整体不挂出。
   *
   * 偏好在这里只作为额外开关：`always` 允许跨供应商常驻，`off` 一律隐藏，
   * 其余按 Codex 的规则只看供应商是否匹配——这样两个插件在同一个位置上
   * 的显隐行为一致。
   */
  const visible = loaded && shouldShowCapsule(prefs.usageVisibility, provider, signedIn !== false)

  useEffect(() => {
    // 图标不挂出时不建立轮询，否则看不见也会继续打接口。
    if (!visible) return
    let active = true
    let sequence = 0
    const refresh = async (): Promise<void> => {
      const current = ++sequence
      try {
        const response = await readUsage()
        if (!active || current !== sequence) return
        setNow(Date.now())
        if (response.signedIn !== true) {
          setSignedIn(false)
          setUsage(undefined)
          setState('unavailable')
          return
        }
        setSignedIn(true)
        if ('usage' in response) {
          setUsage(response.usage)
          setState('ready')
        } else {
          setUsage(undefined)
          setState('unavailable')
        }
      } catch {
        if (!active || current !== sequence) return
        setUsage(undefined)
        setState('unavailable')
      }
    }
    void refresh()
    const dispose = timer.interval(() => { void refresh() }, REFRESH_MS)
    return () => {
      active = false
      sequence += 1
      dispose()
    }
  }, [revision, timer, visible])

  // 重置倒计时每 30 秒重算，只改本地时间戳，不重新请求。
  useEffect(() => {
    if (!visible) return
    return timer.interval(() => { setNow(Date.now()) }, 30_000)
  }, [timer, visible])

  const primary = usage === undefined ? undefined : primaryWindow(usage.windows, selectedModel)
  /**
   * 环与百分比用**聚合值**：同一模型在上游会有多份额度（日额度、活动额度、
   * 不同套餐各一份），只取其中一份会把实际可用量显示错。
   */
  const aggregate = usage === undefined
    ? undefined
    : aggregateUsage(windowsForModel(usage.windows, selectedModel))
  useEffect(() => {
    // 图标隐藏后浮层状态不该残留，否则重新显示时会自己弹开。
    if ((primary === undefined || !visible) && popoverOpen) setPopoverOpen(false)
  }, [popoverOpen, primary, visible])

  if (!visible) return null
  // 未登录时挂一个空图标没有信息量；与 Codex 一致，直接不挂出。
  if (signedIn === false) return null

  const hasUsage = primary !== undefined && aggregate !== undefined
  const aggregateReset = aggregate?.resetsAt === undefined
    ? undefined
    : resetLabel({ resetsAt: aggregate.resetsAt } as ZCodeUsageWindow, t, now)
  const currentSummary = hasUsage
    ? [
        primary.label,
        t('usageRemainingPercent', { percent: Math.round(aggregate.remainingPercent) }),
        aggregateReset,
      ].filter((part): part is string => part !== undefined).join(' · ')
    : state === 'loading'
      ? t('capsuleLoading')
      : t('capsuleUnavailable')

  const togglePopover = (): void => { setPopoverOpen(open => !open) }
  const onKeyDown = (event: KeyboardEvent<HTMLSpanElement>): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    togglePopover()
  }

  const progressContent = (
    <span className="dsh-zcode-usage-progress-track" aria-label={currentSummary}>
      <DshProgress
        type="circle"
        percent={hasUsage ? aggregate.remainingPercent : 0}
        width={26}
        strokeWidth={3}
        stroke="var(--dsw-alias-label-tertiary)"
        orbitStroke="var(--dsw-alias-border-l3)"
        showInfo
        format={() => <ZCodeLogo />}
      />
    </span>
  )
  // Tooltip 必须在 Popover 打开时卸载：只控制 `visible` 会留下 Semi 的 hover
  // 触发器，导致已经关掉的 tooltip 又弹回来。
  const progress = popoverOpen
    ? progressContent
    : (
        <DshTooltip content={currentSummary} mouseEnterDelay={0.35} mouseLeaveDelay={0.35}>
          {progressContent}
        </DshTooltip>
      )

  return (
    <span
      className="dsh-zcode-usage-progress"
      aria-label={`${ZCODE_PROVIDER_NAME} ${currentSummary}`}
      aria-busy={state === 'loading'}
    >
      <DshPopover
        trigger="custom"
        position="topRight"
        content={<UsagePopover usage={usage} t={t} now={now} fallback={currentSummary} />}
        contentClassName="dsh-zcode-usage-popover"
        visible={popoverOpen}
        onVisibleChange={setPopoverOpen}
        onClickOutSide={() => { setPopoverOpen(false) }}
        showArrow={false}
      >
        <span
          className="dsh-zcode-usage-popover-trigger"
          role="button"
          tabIndex={0}
          onClick={togglePopover}
          onKeyDown={onKeyDown}
        >
          {progress}
        </span>
      </DshPopover>
    </span>
  )
}

export { primaryWindow, remainingOf } from '../client/services/usage-window-select.ts'
