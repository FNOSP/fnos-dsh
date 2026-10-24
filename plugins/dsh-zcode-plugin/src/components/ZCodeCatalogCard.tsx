/**
 * 插件详情页的模型目录卡片：目录列表、搜索、能力与逐模型显隐。
 *
 * 目录来自账号权益，因此每行只显示上游确实给出的能力；没有的能力不画图标，
 * 避免把「未知」显示成「不支持」。
 *
 * 卡片固定高度、内部滚动：模型数量随套餐变化，卡片不该把详情页撑长。
 *
 * @module dsh-zcode/components/CatalogCard
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  DshButton,
  DshIconAlertCircle,
  DshIconSearch,
  DshInput,
  DshSwitch,
} from '@tnnevol/dsh-semi-ui'
import type { ZCodeCatalog, ZCodeModel } from '../contracts/catalog.ts'
import type { ZCodeTranslate } from '../client/locales.ts'
import { filterModels, splitHidden } from '../client/services/catalog-search.ts'
import { readCatalog, refreshCatalog } from '../client/services/catalog-data.ts'
import type { ZCodeCatalogRouteStatus } from '../client/services/catalog-data.ts'
import { formatTokens } from '../client/services/format.ts'
import { errorMessage } from '../client/services/http.ts'
import type { TimerService } from '../client/services/polling.ts'
import type { ZCodePreferencesStore } from '../client/services/preferences-data.ts'

/** 目录卡片参数。 */
export interface ZCodeCatalogCardProps {
  readonly t: ZCodeTranslate
  readonly timer: TimerService
  readonly preferences: ZCodePreferencesStore
  readonly hiddenModels: readonly string[]
  readonly preferencesLoaded: boolean
  /** 自动刷新间隔（分钟）；0 表示关闭。 */
  readonly refreshMinutes: number
  /** 登录代际：变化时重新拉取目录。 */
  readonly revision: number
}

/** 一行能力徽标。 */
function CapabilityBadge({ label, title }: { label: string; title: string }): ReactNode {
  return (
    <span className="dsh-zcode-capability" title={title} aria-label={title}>
      {label}
    </span>
  )
}

/** 模型行。 */
function ModelRow({
  model,
  t,
  hidden,
  onToggle,
}: {
  model: ZCodeModel
  t: ZCodeTranslate
  hidden: boolean
  onToggle: (next: boolean) => void
}): ReactNode {
  return (
    <li className={`dsh-zcode-model${hidden ? ' dsh-zcode-model--hidden' : ''}`}>
      <div className="dsh-zcode-model-main">
        <span className="dsh-zcode-model-name" title={model.id}>{model.name}</span>
        <span className="dsh-zcode-model-id">{model.id}</span>
      </div>
      <div className="dsh-zcode-model-meta">
        <span className="dsh-zcode-model-capacity" title={String(model.contextWindow)}>
          {t('catalogContext', { tokens: formatTokens(model.contextWindow) })}
        </span>
        <span className="dsh-zcode-model-capacity" title={String(model.maxTokens)}>
          {t('catalogMaxOutput', { tokens: formatTokens(model.maxTokens) })}
        </span>
        {model.reasoning ? <CapabilityBadge label="R" title={t('catalogReasoning')} /> : null}
        {model.input.includes('image') ? <CapabilityBadge label="V" title={t('catalogVision')} /> : null}
        {model.tools ? <CapabilityBadge label="T" title={t('catalogTools')} /> : null}
      </div>
      <div className="dsh-zcode-model-toggle">
        <DshSwitch
          size="small"
          checked={!hidden}
          aria-label={`${hidden ? t('catalogShow') : t('catalogHide')} ${model.name}`}
          onChange={(checked: boolean) => { onToggle(!checked) }}
        />
      </div>
    </li>
  )
}

/**
 * 模型目录卡片。
 * @returns 目录卡片元素。
 */
export function ZCodeCatalogCard({
  t,
  timer,
  preferences,
  hiddenModels,
  preferencesLoaded,
  refreshMinutes,
  revision,
}: ZCodeCatalogCardProps): ReactNode {
  const [catalog, setCatalog] = useState<ZCodeCatalog | null>(null)
  const [routes, setRoutes] = useState<readonly ZCodeCatalogRouteStatus[]>([])
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [query, setQuery] = useState('')

  const load = useCallback(async (force: boolean): Promise<void> => {
    if (force) setRefreshing(true)
    try {
      const response = force ? await refreshCatalog() : await readCatalog()
      setCatalog(response.catalog)
      setRoutes(response.routes ?? [])
      setError(response.error)
    } catch (loadError) {
      setError(errorMessage(loadError, t('catalogEmpty')))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [t])

  // 登录状态翻转与首次挂载都重新拉取。
  useEffect(() => {
    void load(false)
  }, [load, revision])

  // 按偏好间隔低频刷新目录：套餐变化不需要秒级可见。
  useEffect(() => {
    if (refreshMinutes <= 0) return
    const ms = Math.max(60_000, refreshMinutes * 60_000)
    return timer.interval(() => { void load(false) }, ms)
  }, [load, refreshMinutes, timer])

  const hiddenSet = useMemo(() => new Set(hiddenModels), [hiddenModels])
  const models = useMemo(() => catalog?.models ?? [], [catalog])
  const filtered = useMemo(() => filterModels(models, query), [models, query])
  const { visible, hidden } = useMemo(() => splitHidden(filtered, hiddenSet), [filtered, hiddenSet])
  const registered = routes.length === 0 || routes.every(route => route.registered)
  const routeError = routes.find(route => !route.registered)?.error

  const toggle = useCallback((id: string, hide: boolean): void => {
    const current = new Set(preferences.getSnapshot().value.hiddenModels)
    if (hide) current.add(id)
    else current.delete(id)
    void preferences.save({ hiddenModels: [...current] }).catch(() => undefined)
  }, [preferences])

  const sourceLabel = catalog?.source === 'balance' ? t('catalogSourceBalance') : t('catalogSourceBuiltin')

  return (
    <section className="dsh-zcode-card" aria-labelledby="dsh-zcode-catalog-title">
      <header className="dsh-zcode-card-header">
        <div className="dsh-zcode-card-heading">
          <h3 id="dsh-zcode-catalog-title" className="dsh-zcode-card-title">{t('catalogTitle')}</h3>
          <p className="dsh-zcode-card-desc">{t('catalogIntro')}</p>
        </div>
        <div className="dsh-zcode-card-actions">
          <span className="dsh-zcode-source">{catalog === null ? '' : sourceLabel}</span>
          <DshButton
            htmlType="button"
            theme="borderless"
            type="tertiary"
            size="small"
            disabled={refreshing}
            loading={refreshing}
            onClick={() => { void load(true) }}
          >
            {refreshing ? t('catalogRefreshing') : t('catalogRefresh')}
          </DshButton>
        </div>
      </header>

      {registered ? null : (
        <p className="dsh-zcode-error" role="alert">
          <DshIconAlertCircle aria-hidden="true" />
          {t('catalogNotRegistered')}
          {routeError === undefined ? null : <span className="dsh-zcode-error-detail">{routeError}</span>}
        </p>
      )}
      {error === undefined ? null : <p className="dsh-zcode-error" role="alert">{error}</p>}
      {catalog === null || catalog.warnings.length === 0
        ? null
        : (
            <ul className="dsh-zcode-warnings">
              {catalog.warnings.map(warning => (
                <li key={warning} className="dsh-zcode-warning">
                  <span className="dsh-zcode-warning-tag">{t('catalogWarning')}</span>
                  {warning}
                </li>
              ))}
            </ul>
          )}

      <div className="dsh-zcode-toolbar">
        <DshInput
          prefix={<DshIconSearch aria-hidden="true" />}
          value={query}
          placeholder={t('catalogSearch')}
          aria-label={t('catalogSearch')}
          onChange={(value: string) => { setQuery(value) }}
        />
        <span className="dsh-zcode-count">
          {t('catalogCount', { count: models.length, hidden: hiddenModels.length })}
        </span>
      </div>

      {loading ? (
        <p className="dsh-zcode-body">{t('accountLoading')}</p>
      ) : models.length === 0 ? (
        <p className="dsh-zcode-body">{t('catalogEmpty')}</p>
      ) : visible.length === 0 && hidden.length === 0 ? (
        <p className="dsh-zcode-body">{t('catalogSearchEmpty')}</p>
      ) : (
        <div className="dsh-zcode-models" role="list">
          <ul className="dsh-zcode-model-list">
            {visible.map(model => (
              <ModelRow
                key={model.id}
                model={model}
                t={t}
                hidden={false}
                onToggle={next => { toggle(model.id, next) }}
              />
            ))}
            {hidden.map(model => (
              <ModelRow
                key={model.id}
                model={model}
                t={t}
                hidden
                onToggle={next => { toggle(model.id, next) }}
              />
            ))}
          </ul>
        </div>
      )}

      {preferencesLoaded ? null : <p className="dsh-zcode-hint">{t('accountLoading')}</p>}
    </section>
  )
}
