/**
 * 插件详情页的设置卡片：胶囊显隐与自动刷新间隔。
 *
 * 这两项都是**插件自己的**展示与刷新策略，不进入 DSH 的模型配置：官方
 * `Config` schema 表达不了「用量胶囊何时出现」这类交互，因此按插件 UI 规范
 * 第 2 档，用详情页自定义区块承载并持久化到插件自己的文件。
 *
 * @module dsh-zcode/components/SettingsCard
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import { DshButton, DshInputNumber, DshSelect } from '@tnnevol/dsh-semi-ui'
import {
  ZCODE_REFRESH_MINUTES,
  type ZCodePreferences,
  type ZCodeUsageVisibility,
} from '../contracts/preferences.ts'
import type { ZCodeEndpointPlan } from '../contracts/identity.ts'
import type { ZCodeTranslate } from '../client/locales.ts'
import { errorMessage } from '../client/services/http.ts'
import type { ZCodePreferencesStore } from '../client/services/preferences-data.ts'

/** 设置卡片参数。 */
export interface ZCodeSettingsCardProps {
  readonly t: ZCodeTranslate
  readonly preferences: ZCodePreferencesStore
  readonly loaded: boolean
  readonly loadError?: string | undefined
  readonly usageVisibility: ZCodeUsageVisibility
  readonly refreshMinutes: number
  readonly endpointPlan: ZCodeEndpointPlan
}

/**
 * 设置卡片。
 * @returns 设置卡片元素。
 */
export function ZCodeSettingsCard({
  t,
  preferences,
  loaded,
  loadError,
  usageVisibility,
  refreshMinutes,
  endpointPlan,
}: ZCodeSettingsCardProps): ReactNode {
  const [draftVisibility, setDraftVisibility] = useState<ZCodeUsageVisibility>(usageVisibility)
  const [draftMinutes, setDraftMinutes] = useState<number>(refreshMinutes)
  const [draftEndpoint, setDraftEndpoint] = useState<ZCodeEndpointPlan>(endpointPlan)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string>()

  const dirty = draftVisibility !== usageVisibility
    || draftMinutes !== refreshMinutes
    || draftEndpoint !== endpointPlan

  const save = async (): Promise<void> => {
    setBusy(true)
    setError(undefined)
    setSaved(false)
    try {
      const patch: Partial<ZCodePreferences> = {
        usageVisibility: draftVisibility,
        refreshMinutes: draftMinutes,
        endpointPlan: draftEndpoint,
      }
      await preferences.save(patch)
      setSaved(true)
    } catch (saveError) {
      setError(errorMessage(saveError, t('settingsFailed')))
    } finally {
      setBusy(false)
    }
  }

  const endpointOptions: readonly { value: ZCodeEndpointPlan; label: string }[] = [
    { value: 'start-plan', label: t('settingsEndpointStartPlan') },
    { value: 'ultra', label: t('settingsEndpointUltra') },
  ]

  const visibilityOptions: readonly { value: ZCodeUsageVisibility; label: string }[] = [
    { value: 'auto', label: t('settingsUsageAuto') },
    { value: 'always', label: t('settingsUsageAlways') },
    { value: 'off', label: t('settingsUsageOff') },
  ]

  return (
    <section className="dsh-zcode-card" aria-labelledby="dsh-zcode-settings-title">
      <header className="dsh-zcode-card-header">
        <div className="dsh-zcode-card-heading">
          <h3 id="dsh-zcode-settings-title" className="dsh-zcode-card-title">{t('settingsTitle')}</h3>
          <p className="dsh-zcode-card-desc">{t('settingsIntro')}</p>
        </div>
        <div className="dsh-zcode-card-actions">
          <DshButton
            htmlType="button"
            theme="solid"
            type="primary"
            size="small"
            disabled={busy || !dirty}
            loading={busy}
            onClick={() => { void save() }}
          >
            {busy ? t('settingsSaving') : t('settingsSave')}
          </DshButton>
        </div>
      </header>

      {loadError === undefined ? null : <p className="dsh-zcode-error" role="alert">{loadError}</p>}
      {error === undefined ? null : <p className="dsh-zcode-error" role="alert">{error}</p>}
      {saved && !dirty ? <p className="dsh-zcode-hint" role="status">{t('settingsSaved')}</p> : null}

      <div className="dsh-zcode-settings-grid">
        <label className="dsh-zcode-field">
          <span className="dsh-zcode-field-label">{t('settingsEndpoint')}</span>
          <DshSelect
            value={draftEndpoint}
            disabled={!loaded || busy}
            optionList={[...endpointOptions]}
            onChange={(value: unknown) => { setDraftEndpoint(value as ZCodeEndpointPlan) }}
          />
        </label>
        <label className="dsh-zcode-field">
          <span className="dsh-zcode-field-label">{t('settingsUsageVisibility')}</span>
          <DshSelect
            value={draftVisibility}
            disabled={!loaded || busy}
            optionList={[...visibilityOptions]}
            onChange={(value: unknown) => { setDraftVisibility(value as ZCodeUsageVisibility) }}
          />
        </label>
        <label className="dsh-zcode-field">
          <span className="dsh-zcode-field-label">{t('settingsRefresh')}</span>
          <DshInputNumber
            value={draftMinutes}
            min={ZCODE_REFRESH_MINUTES.min}
            max={ZCODE_REFRESH_MINUTES.max}
            step={1}
            disabled={!loaded || busy}
            onChange={(value: number | string | undefined) => {
              setDraftMinutes(typeof value === 'number' ? value : Number(value ?? 0))
            }}
          />
        </label>
      </div>
      <p className="dsh-zcode-hint">{t('settingsEndpointHint')}</p>
    </section>
  )
}
