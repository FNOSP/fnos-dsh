/** 输入区右侧的 OpenCode 用量胶囊：圆环读数 + 三窗口详情浮层。 */

import { useEffect, useState, useSyncExternalStore } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { DshButton, DshPopover, DshProgress, DshTag, DshTooltip } from '@tnnevol/dsh-semi-ui'
import type { OpenCodeUsage, OpenCodeUsageWindow } from '../contracts/usage.ts'
import type { OpenCodeTranslate } from '../client/locales.ts'
import { authEpoch, subscribeAuthEpoch } from '../client/services/auth-events.ts'
import { formatTimestamp } from '../client/services/format.ts'
import type { TimerService } from '../client/services/polling.ts'
import type { OpenCodePreferencesStore } from '../client/services/preferences-data.ts'
import { readSelectedProvider, usageCapsuleVisible } from '../client/services/usage-visibility.ts'
import type { ModelSelectionProjectionLike } from '../client/services/usage-visibility.ts'
import {
  OPENCODE_USAGE_WINDOW_KINDS,
  peakUsageWindow,
  remainingPercentValue,
  resetCountdown,
  usageWindowLabelKey,
  usageWindowOf,
  usedPercentText,
  usedPercentValue,
} from '../client/services/usage-windows.ts'
import type { OpenCodeUsageSnapshot } from '../client/services/usage-data.ts'
import { resetCountdownText, useOpenCodeNow, useOpenCodeUsage } from './OpenCodeUsageCard.tsx'

/** 注册方注入的业务面：翻译、定时器与偏好 store。 */
export interface OpenCodeUsageStatusInjected {
  readonly t: OpenCodeTranslate
  readonly timer: TimerService
  readonly preferences: OpenCodePreferencesStore
}

/**
 * 完整座位道具：会话作用域标准套件（含 `useProjection`）加上注册方注入的
 * 业务面。`useProjection` 由渲染器提供，不能走 `inject`——`inject` 在 React
 * 之外执行，传不了 hook。
 */
export type OpenCodeUsageStatusProps = PropsRuntime<'conversation.input.right'> & InjectFace<OpenCodeUsageStatusInjected>

/**
 * OpenCode 标识：终端窗口 + 提示符，沿用品牌语义的 `currentColor`，
 * 亮色/暗色主题都随文字色自动反转。
 */
function OpenCodeLogo(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" aria-hidden="true" focusable="false">
      <rect x="3.75" y="3.75" width="16.5" height="16.5" rx="3.25" stroke="currentColor" strokeWidth="1.5" />
      <path d="m8.2 9 2.8 3-2.8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12.8 15h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

/** 胶囊 tooltip 的摘要：窗口类别 + 已用比例 + 重置倒计时。 */
function usageSummary(kind: Parameters<typeof usageWindowLabelKey>[0], window: OpenCodeUsageWindow, t: OpenCodeTranslate, now: number): string {
  const used = usedPercentText(window) ?? '—'
  return [
    t(usageWindowLabelKey(kind)),
    `${t('usageUsed')} ${used}`,
    resetCountdownText(resetCountdown(window, now), t),
  ].join(' · ')
}

/** 浮层里的单个窗口行。 */
function UsagePopoverWindow({ kind, window, t, now }: {
  kind: Parameters<typeof usageWindowLabelKey>[0]
  window: OpenCodeUsageWindow
  t: OpenCodeTranslate
  now: number
}): ReactNode {
  const label = t(usageWindowLabelKey(kind))
  const used = usedPercentText(window) ?? '—'
  return (
    <div className="dsh-opencode-usage-popover-window">
      <div className="dsh-opencode-usage-popover-heading">
        <span>{label}</span>
        <span>{`${t('usageUsed')} ${used}`}</span>
      </div>
      <DshProgress
        percent={usedPercentValue(window)}
        showInfo={false}
        stroke="var(--dsw-alias-label-tertiary)"
        orbitStroke="var(--dsw-alias-border-l3)"
        className="dsh-opencode-usage-popover-progress"
        aria-label={`${label} ${t('usageUsed')} ${used}`}
      />
      <div className="dsh-opencode-usage-popover-footer">
        <span className="dsh-opencode-usage-popover-reset">{resetCountdownText(resetCountdown(window, now), t)}</span>
        {window.status === 'rate-limited' ? <DshTag size="small" color="orange">{t('usageRateLimited')}</DshTag> : null}
      </div>
    </div>
  )
}

/** 浮层内容：未登录/失败提示，或三个窗口的明细。 */
function UsagePopoverContent({ snapshot, t, now, refreshing, refresh }: {
  snapshot: OpenCodeUsageSnapshot
  t: OpenCodeTranslate
  now: number
  refreshing: boolean
  refresh: () => Promise<void>
}): ReactNode {
  const usage: OpenCodeUsage | undefined = snapshot.usage
  const updatedAt = formatTimestamp(usage?.fetchedAt)
  return (
    <div className="dsh-opencode-usage-popover-content">
      {snapshot.state === 'loading' ? <span className="dsh-opencode-usage-popover-empty">{t('usageLoading')}</span> : null}
      {snapshot.state === 'unavailable' ? (
        <span className="dsh-opencode-usage-popover-empty">
          {snapshot.signedIn === false ? t('capsuleSignedOut') : snapshot.message ?? t('capsuleUnavailable')}
        </span>
      ) : null}
      {usage?.plan === undefined ? null : (
        <span className="dsh-opencode-usage-popover-plan">{`${t('usagePlan')}: ${usage.plan}`}</span>
      )}
      {usage === undefined ? null : OPENCODE_USAGE_WINDOW_KINDS.map(kind => {
        const window = usageWindowOf(usage, kind)
        return window === undefined
          ? null
          : <UsagePopoverWindow key={kind} kind={kind} window={window} t={t} now={now} />
      })}
      {updatedAt === undefined ? null : (
        <span className="dsh-opencode-usage-popover-empty">{t('usageFetchedAt', { time: updatedAt })}</span>
      )}
      <div className="dsh-opencode-usage-popover-actions">
        <DshButton
          htmlType="button"
          theme="borderless"
          type="tertiary"
          size="small"
          loading={refreshing}
          onClick={() => { void refresh() }}
        >
          {t('usageRefresh')}
        </DshButton>
      </div>
    </div>
  )
}

/**
 * 输入区右侧用量胶囊。
 *
 * 显隐按偏好 `usageVisibility`：`auto` 仅在选中 `opencode-go` 模型时挂出；
 * `always` 常驻；`off` 完全隐藏且不建立轮询。页面隐藏时轮询暂停，恢复可见
 * 后立即补一次。
 *
 * @returns 胶囊元素；不可见时为 `null`。
 */
export function OpenCodeUsageStatus({ t, timer, preferences, useProjection }: OpenCodeUsageStatusProps): ReactNode {
  const { value: preferenceValues } = useSyncExternalStore(
    preferences.subscribe,
    preferences.getSnapshot,
    preferences.getSnapshot,
  )
  const revision = useSyncExternalStore(subscribeAuthEpoch, authEpoch, authEpoch)
  useEffect(() => {
    void preferences.ensureLoaded().catch(() => undefined)
  }, [preferences])

  // 只显示与当前选中模型供应商匹配的图标。会话作用域座位的标准套件由渲染器
  // 保证存在，因此这里无条件调用 hook；投影缺失时判定按「读不到」处理。
  const selected = useProjection('modelSelection') as ModelSelectionProjectionLike | undefined
  const provider = readSelectedProvider(selected)
  const wanted = usageCapsuleVisible({ visibility: preferenceValues.usageVisibility, provider })
  const controller = useOpenCodeUsage({
    timer,
    refreshMinutes: preferenceValues.refreshMinutes,
    active: wanted,
    revision,
    fallbackError: t('capsuleUnavailable'),
  })
  const { snapshot, refreshing, refresh } = controller
  const visible = usageCapsuleVisible({
    visibility: preferenceValues.usageVisibility,
    provider,
    signedIn: snapshot.signedIn,
  })
  const [popoverOpen, setPopoverOpen] = useState(false)
  const now = useOpenCodeNow()

  useEffect(() => {
    // 胶囊被隐藏后浮层状态不该残留，否则重新显示时会自己弹开。
    if (!visible && popoverOpen) setPopoverOpen(false)
  }, [popoverOpen, visible])

  if (!visible) return null

  const peak = peakUsageWindow(snapshot.usage)
  const summary = peak === undefined
    ? snapshot.state === 'loading'
      ? t('usageLoading')
      : snapshot.signedIn === false
        ? t('capsuleSignedOut')
        : t('capsuleUnavailable')
    : usageSummary(peak.kind, peak.window, t, now)
  const hasUsage = peak !== undefined
  const togglePopover = (): void => setPopoverOpen(open => !open)
  const handleKeyDown = (event: KeyboardEvent<HTMLSpanElement>): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    togglePopover()
  }

  const progressContent = (
    <span className="dsh-opencode-usage-progress-track" aria-label={summary}>
      <DshProgress
        type="circle"
        percent={hasUsage ? remainingPercentValue(peak.window) : 0}
        width={26}
        strokeWidth={3}
        stroke="var(--dsw-alias-label-tertiary)"
        orbitStroke="var(--dsw-alias-border-l3)"
        showInfo
        format={() => <OpenCodeLogo />}
      />
    </span>
  )
  // Tooltip 在 Popover 打开时必须卸载：只关 `visible` 会留下 Semi 的 hover
  // 触发器，稍后可能把旧 tooltip 又弹出来。
  const progress = popoverOpen
    ? progressContent
    : (
        <DshTooltip content={summary} mouseEnterDelay={0.35} mouseLeaveDelay={0.35}>
          {progressContent}
        </DshTooltip>
      )

  return (
    <span
      className="dsh-opencode-usage-progress"
      aria-label={t('capsuleOpenUsage')}
      aria-busy={snapshot.state === 'loading' || refreshing}
    >
      <DshPopover
        trigger="custom"
        position="topRight"
        content={<UsagePopoverContent snapshot={snapshot} t={t} now={now} refreshing={refreshing} refresh={refresh} />}
        contentClassName="dsh-opencode-usage-popover"
        visible={popoverOpen}
        onVisibleChange={setPopoverOpen}
        onClickOutSide={() => { setPopoverOpen(false) }}
        showArrow={false}
      >
        <span
          className="dsh-opencode-usage-popover-trigger"
          role="button"
          tabIndex={0}
          onClick={togglePopover}
          onKeyDown={handleKeyDown}
        >
          {progress}
        </span>
      </DshPopover>
    </span>
  )
}
