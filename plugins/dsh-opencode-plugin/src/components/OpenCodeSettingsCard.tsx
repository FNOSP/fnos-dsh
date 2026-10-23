/** 插件详情页的设置卡片：胶囊显隐策略与自动刷新间隔。 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { DshButton, DshInputNumber, DshSelect, DshSpin } from '@tnnevol/dsh-semi-ui'
import { OPENCODE_REFRESH_MINUTES } from '../contracts/preferences.ts'
import type { OpenCodeUsageVisibility } from '../contracts/preferences.ts'
import type { OpenCodeTranslate } from '../client/locales.ts'
import { errorMessage } from '../client/services/http.ts'
import type { OpenCodePreferencesStore } from '../client/services/preferences-data.ts'

/** 设置卡片参数。 */
export interface OpenCodeSettingsCardProps {
  readonly t: OpenCodeTranslate
  readonly preferences: OpenCodePreferencesStore
  /** 偏好是否已完成首次读取。 */
  readonly loaded: boolean
  /** 首次读取失败的文案；有值时整卡只显示错误。 */
  readonly loadError?: string | undefined
  readonly usageVisibility: OpenCodeUsageVisibility
  readonly refreshMinutes: number
}

/** 显隐选项 → 文案键。 */
const VISIBILITY_OPTIONS: readonly { readonly value: OpenCodeUsageVisibility, readonly key: 'settingsVisibilityAuto' | 'settingsVisibilityAlways' | 'settingsVisibilityOff' }[] = [
  { value: 'auto', key: 'settingsVisibilityAuto' },
  { value: 'always', key: 'settingsVisibilityAlways' },
  { value: 'off', key: 'settingsVisibilityOff' },
]

/** 把 Select 的原始值收敛到三个合法选项；未知值按 `auto` 处理。 */
function normalizeVisibility(value: unknown): OpenCodeUsageVisibility {
  if (value === 'always') return 'always'
  if (value === 'off') return 'off'
  return 'auto'
}

/**
 * 设置卡片。
 * @returns 设置卡片元素。
 */
export function OpenCodeSettingsCard({
  t,
  preferences,
  loaded,
  loadError,
  usageVisibility,
  refreshMinutes,
}: OpenCodeSettingsCardProps): ReactNode {
  const [draftVisibility, setDraftVisibility] = useState<OpenCodeUsageVisibility>(usageVisibility)
  const [draftMinutesText, setDraftMinutesText] = useState(String(refreshMinutes))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string>()

  // 保存成功（或其它组件写入）后把草稿对齐到 store 的真实值；乐观更新先到一步，
  // 这里的赋值与草稿相同，不会打断输入。
  useEffect(() => {
    setDraftVisibility(usageVisibility)
    setDraftMinutesText(String(refreshMinutes))
  }, [refreshMinutes, usageVisibility])

  const trimmed = draftMinutesText.trim()
  const parsedMinutes = /^\d+$/u.test(trimmed) ? Number(trimmed) : Number.NaN
  const minutesValid = Number.isInteger(parsedMinutes)
    && parsedMinutes >= OPENCODE_REFRESH_MINUTES.min
    && parsedMinutes <= OPENCODE_REFRESH_MINUTES.max
  const dirty = draftVisibility !== usageVisibility || (minutesValid && parsedMinutes !== refreshMinutes)
  const canSave = loaded && minutesValid && dirty && !saving

  const save = async (): Promise<void> => {
    if (!minutesValid) return
    setSaving(true)
    setSaved(false)
    setSaveError(undefined)
    try {
      await preferences.save({ usageVisibility: draftVisibility, refreshMinutes: parsedMinutes })
      setSaved(true)
    } catch (error) {
      setSaveError(errorMessage(error, t('settingsSaveFailed')))
    } finally {
      setSaving(false)
    }
  }

  let body: ReactNode
  if (loadError !== undefined) {
    body = <p className="dsh-opencode-error" role="alert">{loadError}</p>
  } else if (!loaded) {
    body = (
      <div className="dsh-opencode-status-row" role="status">
        <DshSpin size="small" />
        <span>{t('settingsLoading')}</span>
      </div>
    )
  } else {
    body = (
      <>
        <div className="dsh-opencode-setting">
          <div className="dsh-opencode-setting-main">
            <span className="dsh-opencode-setting-label">{t('settingsUsageVisibility')}</span>
            <span className="dsh-opencode-setting-hint">{t('settingsUsageVisibilityHint')}</span>
          </div>
          <DshSelect
            className="dsh-opencode-setting-select"
            value={draftVisibility}
            disabled={saving}
            aria-label={t('settingsUsageVisibility')}
            optionList={VISIBILITY_OPTIONS.map(option => ({ value: option.value, label: t(option.key) }))}
            onChange={(value: unknown) => {
              setDraftVisibility(normalizeVisibility(value))
              setSaved(false)
              setSaveError(undefined)
            }}
          />
        </div>

        <div className="dsh-opencode-setting">
          <div className="dsh-opencode-setting-main">
            <span className="dsh-opencode-setting-label">{t('settingsRefreshMinutes')}</span>
            <span className="dsh-opencode-setting-hint">{t('settingsRefreshMinutesHint')}</span>
          </div>
          <div className="dsh-opencode-setting-control">
            <DshInputNumber
              className="dsh-opencode-setting-number"
              value={draftMinutesText}
              min={OPENCODE_REFRESH_MINUTES.min}
              max={OPENCODE_REFRESH_MINUTES.max}
              step={1}
              precision={0}
              disabled={saving}
              aria-label={t('settingsRefreshMinutes')}
              onChange={(value: number | string) => {
                setDraftMinutesText(String(value))
                setSaved(false)
                setSaveError(undefined)
              }}
            />
            <span className="dsh-opencode-setting-unit">{t('settingsMinutes')}</span>
          </div>
        </div>

        {minutesValid ? null : <p className="dsh-opencode-error">{t('settingsRefreshInvalid')}</p>}
        {saveError === undefined ? null : <p className="dsh-opencode-error" role="alert">{saveError}</p>}

        <div className="dsh-opencode-settings-actions">
          {saved ? <span className="dsh-opencode-success" role="status">{t('settingsSaved')}</span> : null}
          <DshButton
            htmlType="button"
            theme="solid"
            type="primary"
            size="small"
            disabled={!canSave}
            loading={saving}
            onClick={() => { void save() }}
          >
            {saving ? t('settingsSaving') : t('settingsSave')}
          </DshButton>
        </div>
      </>
    )
  }

  return (
    <section className="dsh-opencode-card" aria-labelledby="dsh-opencode-settings-title">
      <header className="dsh-opencode-card-header">
        <div className="dsh-opencode-card-heading">
          <h3 id="dsh-opencode-settings-title" className="dsh-opencode-card-title">{t('settingsTitle')}</h3>
          <p className="dsh-opencode-card-desc">{t('settingsIntro')}</p>
        </div>
      </header>
      {body}
    </section>
  )
}
