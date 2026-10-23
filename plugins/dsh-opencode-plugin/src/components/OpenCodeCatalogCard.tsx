/** 插件详情页的模型目录卡片：来源、刷新、搜索、能力标签与显隐开关。 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  DshButton,
  DshIconAlertCircle,
  DshIconInfoCircle,
  DshIconRefresh,
  DshIconSearch,
  DshInput,
  DshSpin,
  DshSwitch,
  DshTag,
} from '@tnnevol/dsh-semi-ui'
import type { OpenCodeModel } from '../contracts/catalog.ts'
import type { OpenCodeTranslate } from '../client/locales.ts'
import type { OpenCodeCatalogResponse } from '../client/services/catalog-data.ts'
import { readCatalog, refreshCatalog } from '../client/services/catalog-data.ts'
import {
  apiKindLabelKey,
  filterCatalogModels,
  formatTokenCount,
  reasoningLevelLabelKey,
  reasoningLevels,
  supportsImageInput,
  withModelVisibility,
} from '../client/services/catalog-search.ts'
import { formatTimestamp } from '../client/services/format.ts'
import { errorMessage } from '../client/services/http.ts'
import { autoRefreshIntervalMs, POLL_HEARTBEAT_MS, shouldPoll } from '../client/services/polling.ts'
import type { TimerService } from '../client/services/polling.ts'
import type { OpenCodePreferencesStore } from '../client/services/preferences-data.ts'

/** 目录卡片参数。 */
export interface OpenCodeCatalogCardProps {
  readonly t: OpenCodeTranslate
  readonly timer: TimerService
  readonly preferences: OpenCodePreferencesStore
  /** 当前隐藏的模型 id（来自偏好快照）。 */
  readonly hiddenModels: readonly string[]
  /** 偏好是否已完成首次读取；未完成时开关保持禁用。 */
  readonly preferencesLoaded: boolean
  /** 自动刷新间隔（分钟）。 */
  readonly refreshMinutes: number
  /** 登录代际；变化后重拉目录。 */
  readonly revision: number
}

/** 一个模型的标签集合。 */
function ModelTags({ model, t }: { model: OpenCodeModel, t: OpenCodeTranslate }): ReactNode {
  const levels = reasoningLevels(model)
  return (
    <>
      {model.deprecated === true ? <DshTag size="small" color="orange">{t('catalogDeprecatedTag')}</DshTag> : null}
      {model.disabled === true ? <DshTag size="small" color="red">{t('catalogDisabledTag')}</DshTag> : null}
      {supportsImageInput(model) ? <DshTag size="small" type="light" color="blue">{t('catalogImageInput')}</DshTag> : null}
      {levels.map(level => <DshTag key={level} size="small" type="light">{t(reasoningLevelLabelKey(level))}</DshTag>)}
      {model.reasoning && levels.length === 0 ? <DshTag size="small" type="light">{t('catalogReasoning')}</DshTag> : null}
    </>
  )
}

/**
 * 模型目录卡片。
 * @returns 目录卡片元素。
 */
export function OpenCodeCatalogCard({
  t,
  timer,
  preferences,
  hiddenModels,
  preferencesLoaded,
  refreshMinutes,
  revision,
}: OpenCodeCatalogCardProps): ReactNode {
  const [response, setResponse] = useState<OpenCodeCatalogResponse | undefined>(undefined)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [message, setMessage] = useState<string>()
  const [refreshing, setRefreshing] = useState(false)
  const [query, setQuery] = useState('')
  const [savingVisibility, setSavingVisibility] = useState(false)
  const [visibilityError, setVisibilityError] = useState<string>()
  const sequenceRef = useRef(0)
  const loadedCatalogRef = useRef<boolean>(false)

  const load = useCallback(async (force: boolean, silent: boolean): Promise<void> => {
    const seq = ++sequenceRef.current
    if (!silent) {
      setState('loading')
      setRefreshing(force)
    }
    try {
      const next = force ? await refreshCatalog() : await readCatalog()
      if (seq !== sequenceRef.current) return
      setResponse(next)
      if (next.catalog === null) {
        loadedCatalogRef.current = false
        setState('error')
        setMessage(next.error ?? t('catalogLoadFailed'))
      } else {
        loadedCatalogRef.current = true
        setState('ready')
        // 目录可能是一份旧快照：本次刷新失败仍然要把原因展示出来。
        setMessage(next.error)
      }
    } catch (error) {
      if (seq !== sequenceRef.current) return
      setMessage(errorMessage(error, t('catalogLoadFailed')))
      setState(loadedCatalogRef.current ? 'ready' : 'error')
    } finally {
      if (seq === sequenceRef.current) setRefreshing(false)
    }
  }, [t])

  useEffect(() => {
    void load(false, false)
    return () => { sequenceRef.current += 1 }
  }, [load, revision])

  useEffect(() => {
    const intervalMs = autoRefreshIntervalMs(refreshMinutes)
    if (intervalMs <= 0) return
    let lastPolledAt = Date.now()
    const dispose = timer.interval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      if (!shouldPoll({ hidden: false, intervalMs, lastPolledAt, now: Date.now() })) return
      lastPolledAt = Date.now()
      void load(true, true)
    }, POLL_HEARTBEAT_MS)
    return dispose
  }, [load, refreshMinutes, timer])

  const catalog = response?.catalog ?? undefined
  const hiddenSet = new Set(hiddenModels)
  const models = catalog?.models ?? []
  const filtered = filterCatalogModels(models, query)
  const hiddenCount = models.filter(model => hiddenSet.has(model.id)).length
  const updatedAt = formatTimestamp(catalog?.fetchedAt)

  const toggleModel = async (model: OpenCodeModel, visible: boolean): Promise<void> => {
    setVisibilityError(undefined)
    setSavingVisibility(true)
    try {
      await preferences.save({ hiddenModels: withModelVisibility(hiddenModels, model.id, visible) })
    } catch (error) {
      setVisibilityError(errorMessage(error, t('catalogSaveFailed')))
    } finally {
      setSavingVisibility(false)
    }
  }

  return (
    <section className="dsh-opencode-card" aria-labelledby="dsh-opencode-catalog-title">
      <header className="dsh-opencode-card-header">
        <div className="dsh-opencode-card-heading">
          <h3 id="dsh-opencode-catalog-title" className="dsh-opencode-card-title">{t('catalogTitle')}</h3>
          <p className="dsh-opencode-card-desc">{t('catalogIntro')}</p>
        </div>
        <div className="dsh-opencode-card-actions">
          {catalog === undefined ? null : (
            <DshTag size="small" type="light">
              {catalog.source === 'console' ? t('catalogSourceConsole') : t('catalogSourcePublic')}
            </DshTag>
          )}
          {updatedAt === undefined ? null : <span className="dsh-opencode-muted">{t('catalogUpdatedAt', { time: updatedAt })}</span>}
          <DshButton
            htmlType="button"
            theme="borderless"
            type="tertiary"
            size="small"
            icon={<DshIconRefresh />}
            loading={refreshing}
            onClick={() => { void load(true, false) }}
          >
            {t('catalogRefresh')}
          </DshButton>
        </div>
      </header>

      {state === 'loading' ? (
        <div className="dsh-opencode-status-row" role="status">
          <DshSpin size="small" />
          <span>{t('catalogLoading')}</span>
        </div>
      ) : null}

      {state === 'error' && catalog === undefined ? (
        <div className="dsh-opencode-error-block">
          <p className="dsh-opencode-error" role="alert">{message ?? t('catalogLoadFailed')}</p>
          <DshButton
            htmlType="button"
            theme="borderless"
            type="tertiary"
            size="small"
            icon={<DshIconRefresh />}
            loading={refreshing}
            onClick={() => { void load(true, false) }}
          >
            {t('catalogRetry')}
          </DshButton>
        </div>
      ) : null}

      {state === 'ready' && message !== undefined ? (
        <div className="dsh-opencode-notice" role="status">
          <DshIconAlertCircle className="dsh-opencode-notice-icon" />
          <span>{message}</span>
        </div>
      ) : null}

      {response?.consoleError === undefined ? null : (
        <div className="dsh-opencode-notice" role="status">
          <DshIconInfoCircle className="dsh-opencode-notice-icon" />
          <span>{t('catalogConsoleError', { message: response.consoleError })}</span>
        </div>
      )}

      {catalog === undefined || catalog.warnings.length === 0 ? null : (
        <div className="dsh-opencode-notice dsh-opencode-notice--warning" role="status">
          <DshIconAlertCircle className="dsh-opencode-notice-icon" />
          <div className="dsh-opencode-notice-body">
            <span className="dsh-opencode-notice-title">{t('catalogWarnings')}</span>
            <ul className="dsh-opencode-notice-list">
              {catalog.warnings.map(warning => <li key={warning}>{warning}</li>)}
            </ul>
          </div>
        </div>
      )}

      {catalog === undefined ? null : (
        <>
          <div className="dsh-opencode-catalog-toolbar">
            <DshInput
              className="dsh-opencode-search"
              value={query}
              placeholder={t('catalogSearch')}
              aria-label={t('catalogSearch')}
              prefix={<DshIconSearch />}
              showClear
              onChange={(value: string) => { setQuery(value) }}
            />
            <span className="dsh-opencode-muted">
              {t('catalogModelCount', { count: filtered.length })}
              {hiddenCount === 0 ? '' : ` · ${t('catalogHiddenCount', { count: hiddenCount })}`}
            </span>
          </div>

          {visibilityError === undefined ? null : <p className="dsh-opencode-error" role="alert">{visibilityError}</p>}

          {filtered.length === 0 ? (
            <p className="dsh-opencode-muted">{query.trim().length === 0 ? t('catalogEmpty') : t('catalogSearchEmpty')}</p>
          ) : (
            <ul className="dsh-opencode-models">
              {filtered.map(model => {
                const hidden = hiddenSet.has(model.id)
                const disabled = model.disabled === true
                const className = [
                  'dsh-opencode-model',
                  disabled ? 'is-disabled' : '',
                  hidden && !disabled ? 'is-hidden' : '',
                ].filter(Boolean).join(' ')
                return (
                  <li className={className} key={model.id}>
                    <div className="dsh-opencode-model-main">
                      <div className="dsh-opencode-model-heading">
                        <span className="dsh-opencode-model-name">{model.name}</span>
                        {hidden && !disabled ? <DshTag size="small" type="light">{t('catalogHiddenTag')}</DshTag> : null}
                        <ModelTags model={model} t={t} />
                      </div>
                      <span className="dsh-opencode-model-id">{model.id}</span>
                      {model.description === undefined ? null : (
                        <p className="dsh-opencode-model-desc">{model.description}</p>
                      )}
                      <div className="dsh-opencode-model-facts">
                        <span className="dsh-opencode-model-fact">{t(apiKindLabelKey(model.api))}</span>
                        <span className="dsh-opencode-model-fact">{`${t('catalogContext')} ${formatTokenCount(model.contextWindow) ?? '—'}`}</span>
                        <span className="dsh-opencode-model-fact">{`${t('catalogMaxOutput')} ${formatTokenCount(model.maxTokens) ?? '—'}`}</span>
                      </div>
                    </div>
                    <div className="dsh-opencode-model-toggle">
                      <DshSwitch
                        size="small"
                        checked={!hidden}
                        disabled={!preferencesLoaded || disabled || savingVisibility}
                        aria-label={`${t('catalogVisibleSwitch')}: ${model.name}`}
                        onChange={(next: boolean) => { void toggleModel(model, next) }}
                      />
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
