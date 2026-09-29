/**
 * 插件详情页的 CodeBuddy 偏好控件。
 *
 * 从设置区块（`CodeBuddySection`）迁来的两个控件：
 *
 *  - **切换阈值**（`$autoSwitchThreshold`）——原「自动切换」开关旁边的滑杆；
 *  - **显示余额余量**（`$showUsage`）——输入框指示器的显隐开关。
 *
 * 为什么只剩这两个：设置区块整体随配置入口迁移被移除，其中登录、账号列表、
 * 三个自动开关都已由详情页的账号管理区块承载（同一份 store 与 RPC），而这两项
 * 没有别的归属——阈值只属于自动切换的展示/同步策略，显示余额余量只影响
 * composer dock 指示器，都不在任何账号操作路径上。
 *
 * 「自动切换」开关本身留在账号管理区块的头部动作区（`AutoSwitchToggle`），
 * 与迁移前一致；阈值放这里而不是挤进那一行，是因为滑杆在窄行里会被压得不可读。
 *
 * 写入语义与迁移前**逐字一致**：改阈值时若自动切换已开启才连同 `enabled` 一起
 * 推给 Host；关闭状态下只更新本地值，避免滑杆动作意外把开关打开。
 *
 * @module dsh-codebuddy/components/CodeBuddyPreferences
 */

import { useCallback } from 'react'
import { useStore } from '@nanostores/react'
import {
  DshForm,
  DshSlider,
  DshSwitch,
} from '@tnnevol/dsh-semi-ui'
import { CODEBUDDY_AUTH_CHANNEL } from '../contracts/constants.ts'
import type { ConnectionRpc } from '../client/rpc.ts'
import {
  $autoSwitch,
  $autoSwitchThreshold,
  $showUsage,
  setThreshold,
} from '../client/store/usage-prefs.ts'
import { PreferenceLabel } from './PreferenceLabel.tsx'
import type { Translate } from '../types/client/panel-types'

export interface CodeBuddyPreferencesProps {
  rpc: ConnectionRpc
  t: Translate
}

export function CodeBuddyPreferences({ rpc, t }: CodeBuddyPreferencesProps) {
  const autoSwitch = useStore($autoSwitch)
  const autoSwitchPct = useStore($autoSwitchThreshold)
  const showUsage = useStore($showUsage)

  const changeAutoSwitchThreshold = useCallback((pct: number) => {
    // 走归一化写入：Slider 可能给出小数，直接 set 会让内存与存储不一致。
    setThreshold(pct)
    // 仅在自动切换已开启时才回推给 Host：关闭状态下推 `enabled: true` 会把
    // 用户关掉的开关悄悄打开。host 在字段缺省时保留现值，因此这里只是省略。
    if (autoSwitch) {
      void rpc.call(CODEBUDDY_AUTH_CHANNEL, 'autoSwitch', { enabled: true, thresholdPct: pct })
    }
  }, [rpc, autoSwitch])

  return (
    <DshForm className="dsh-codebuddy-pref-form" labelPosition="left">
      <DshForm.Slot label={<PreferenceLabel title={t('autoSwitchPct')} description={t('autoSwitchPctDesc')} />}>
        <div className="dsh-codebuddy-pref-slider">
          <DshSlider
            value={autoSwitchPct}
            min={0}
            max={100}
            step={1}
            onChange={(value: number | [number, number]) => {
              if (typeof value === 'number') changeAutoSwitchThreshold(value)
            }}
            aria-label={t('autoSwitchPct')}
          />
          <span className="dsh-codebuddy-pref-slider-value">{autoSwitchPct}%</span>
        </div>
      </DshForm.Slot>
      <DshForm.Slot label={<PreferenceLabel title={t('showUsage')} description={t('showUsageDesc')} />}>
        <DshSwitch
          checked={showUsage}
          onChange={(checked: boolean) => { $showUsage.set(checked) }}
          aria-label={t('showUsage')}
        />
      </DshForm.Slot>
    </DshForm>
  )
}
