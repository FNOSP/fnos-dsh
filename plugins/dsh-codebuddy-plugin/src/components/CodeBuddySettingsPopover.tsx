/**
 * CodeBuddy 自动化与显示偏好的**单一入口**（账号区块头右上角的齿轮）。
 *
 * 为什么收进一个浮层，而不是继续摊在区块头：原先那一行混着两种性质的东西——
 *
 *  - **账号操作**：添加账号、完成任务、刷新、查看日志（作用于数据）；
 *  - **自动化策略**：自动切换、自动签到、自动旅行（持久化偏好，设置一次长期生效）。
 *
 * 更要紧的是「自动切换」的开关在区块头、而它的**阈值**却在上方另一个区块里：
 * 同一个策略的两半被拆到了两处。收进浮层后开关与阈值相邻，且区块头的控件由
 * 7 个降到 5 个——主操作与次级操作不再混在一排。
 *
 * 「显示额度余量」一并放进来：它同样只影响展示、与账号数据无关，属于同一类。
 *
 * 交互沿用本插件既有的浮层语言（`CodeBuddyUsageStatus` 的额度浮层同样是
 * `DshPopover` + `contentClassName` + 点击外部关闭），不引入新的交互范式。
 *
 * **改动即时生效，没有「确定/取消」**：这些偏好写的是持久化 store（同时同步给
 * Host），每一项独立成立，没有需要一次性提交的组合语义。加一个确认步骤只会让
 * 用户多一次点击、并制造「未保存」的假状态。
 *
 * @module dsh-codebuddy/components/CodeBuddySettingsPopover
 */

import { useCallback, useState } from 'react'
import type { ReactNode } from 'react'
import { useStore } from '@nanostores/react'
import { DshIconSetting, DshIconButton, DshPopover, DshSlider, DshSwitch } from '@tnnevol/dsh-semi-ui'
import { CODEBUDDY_AUTH_CHANNEL } from '../contracts/constants.ts'
import type { ConnectionRpc } from '../client/rpc.ts'
import {
  $autoCheckin,
  $autoSwitch,
  $autoSwitchThreshold,
  $autoTravel,
  $showUsage,
  setThreshold,
} from '../client/store/usage-prefs.ts'
import { PreferenceLabel } from './PreferenceLabel.tsx'
import type { Translate } from '../types/client/panel-types'

export interface CodeBuddySettingsPopoverProps {
  rpc: ConnectionRpc
  t: Translate
}

/** 浮层里的一行：左侧标题 + 可选说明，右侧控件。 */
function SettingRow({ label, description, control }: {
  label: string
  /** 说明文案；写成 `| undefined` 是因为本仓库开启 `exactOptionalPropertyTypes`。 */
  description?: string | undefined
  control: ReactNode
}): ReactNode {
  return (
    <div className="dsh-codebuddy-settings-row">
      {/* 复用设置表单的标签块：标题加粗、说明小字，与其它插件设置区同一视觉语言。 */}
      <PreferenceLabel title={label} description={description} />
      <div className="dsh-codebuddy-settings-control">{control}</div>
    </div>
  )
}

export function CodeBuddySettingsPopover({ rpc, t }: CodeBuddySettingsPopoverProps): ReactNode {
  const autoSwitch = useStore($autoSwitch)
  const autoSwitchPct = useStore($autoSwitchThreshold)
  const autoCheckin = useStore($autoCheckin)
  const autoTravel = useStore($autoTravel)
  const showUsage = useStore($showUsage)
  const [open, setOpen] = useState(false)

  /**
   * 阈值滑杆的写入。
   *
   * 与迁移前**逐字一致**：只有自动切换已开启时才连同 `enabled` 一起推给 Host。
   * 关闭状态下推 `enabled: true` 会把用户关掉的开关悄悄打开；Host 在字段缺省时
   * 保留现值，因此这里省略即可。
   */
  const changeThreshold = useCallback((pct: number) => {
    // 走归一化写入：Slider 可能给出小数，直接 set 会让内存与存储不一致。
    setThreshold(pct)
    if (autoSwitch) {
      void rpc.call(CODEBUDDY_AUTH_CHANNEL, 'autoSwitch', { enabled: true, thresholdPct: pct })
    }
  }, [rpc, autoSwitch])

  const content = (
    <div className="dsh-codebuddy-settings">
      {/* 固定高度的内滚容器：五项偏好（含三段说明文字）全展开会把浮层撑得很高，
          底部的「显示额度余量」会被推到屏幕外。这里封顶并内部滚动。
          滚动容器**嵌在有 padding 的外层之内**，滚动条因此落在内边距以内，
          不贴着浮层边缘。 */}
      <div className="dsh-codebuddy-settings-scroll">
        <div className="dsh-codebuddy-settings-group">
          <div className="dsh-codebuddy-settings-group-title">{t('settingsAutomation')}</div>
        <SettingRow
          label={t('autoSwitch')}
          description={t('autoSwitchDesc')}
          control={(
            <DshSwitch
              size="small"
              checked={autoSwitch}
              aria-label={t('autoSwitch')}
              onChange={(checked: boolean) => {
                $autoSwitch.set(checked)
                // 带上当前阈值：Host 侧两者同属一份 autoSwitch 配置，分开写会让
                // 「开关刚打开但阈值还是旧值」有一个短暂窗口。
                void rpc.call(CODEBUDDY_AUTH_CHANNEL, 'autoSwitch', { enabled: checked, thresholdPct: autoSwitchPct })
              }}
            />
          )}
        />
        {/* 阈值紧贴开关：它们是同一个策略的两半，分开摆正是这次要修的问题。
            自动切换关闭时滑杆仍可调——用户可以先设好阈值再打开开关。 */}
        <SettingRow
          label={t('autoSwitchPct')}
          description={t('autoSwitchPctDesc')}
          control={(
            <div className="dsh-codebuddy-settings-slider">
              <DshSlider
                value={autoSwitchPct}
                min={0}
                max={100}
                step={1}
                onChange={(value: number | [number, number]) => {
                  if (typeof value === 'number') changeThreshold(value)
                }}
                aria-label={t('autoSwitchPct')}
              />
              <span className="dsh-codebuddy-settings-slider-value">{autoSwitchPct}%</span>
            </div>
          )}
        />
        <SettingRow
          label={t('autoCheckin')}
          description={t('autoCheckinDesc')}
          control={(
            <DshSwitch
              size="small"
              checked={autoCheckin}
              aria-label={t('autoCheckin')}
              onChange={(checked: boolean) => {
                $autoCheckin.set(checked)
                void rpc.call(CODEBUDDY_AUTH_CHANNEL, 'autoCheckin', { enabled: checked })
              }}
            />
          )}
        />
        <SettingRow
          label={t('travelAuto')}
          description={t('travelAutoDesc')}
          control={(
            <DshSwitch
              size="small"
              checked={autoTravel}
              aria-label={t('travelAuto')}
              onChange={(checked: boolean) => {
                $autoTravel.set(checked)
                void rpc.call(CODEBUDDY_AUTH_CHANNEL, 'autoTravel', { enabled: checked })
              }}
            />
          )}
        />
        </div>

        <div className="dsh-codebuddy-settings-group">
          <div className="dsh-codebuddy-settings-group-title">{t('settingsDisplay')}</div>
          <SettingRow
            label={t('showUsage')}
            description={t('showUsageDesc')}
            control={(
              <DshSwitch
                size="small"
                checked={showUsage}
                aria-label={t('showUsage')}
                onChange={(checked: boolean) => { $showUsage.set(checked) }}
              />
            )}
          />
        </div>
      </div>
    </div>
  )

  return (
    <DshPopover
      trigger="custom"
      position="bottomRight"
      visible={open}
      onVisibleChange={setOpen}
      onClickOutSide={() => { setOpen(false) }}
      showArrow={false}
      content={content}
      contentClassName="dsh-codebuddy-settings-popover"
    >
      <DshIconButton
        size="small"
        theme="light"
        type="tertiary"
        icon={<DshIconSetting />}
        aria-label={t('settingsOpen')}
        onClick={() => { setOpen(v => !v) }}
      />
    </DshPopover>
  )
}
