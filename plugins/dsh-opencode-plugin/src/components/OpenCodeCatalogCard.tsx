/** 插件详情页的模型目录卡片：套餐口径、额度列、内部滚动、能力图标气泡与显隐开关。 */

import { useState } from 'react'
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
  DshTooltip,
} from '@tnnevol/dsh-semi-ui'
import type { OpenCodeCatalogEntitlement, OpenCodeModel } from '../contracts/catalog.ts'
import { OPENCODE_CONSOLE_ORIGIN } from '../contracts/identity.ts'
import type { OpenCodeTranslate } from '../client/locales.ts'
import type { OpenCodeCatalogResponse } from '../client/services/catalog-data.ts'
import { accountPlanLabelKey, estimatedRequestsText } from '../client/services/catalog-data.ts'
import {
  apiKindLabelKey,
  featureLabelKey,
  filterCatalogModels,
  formatTokenCount,
  modelFeatures,
  reasoningLevelLabelKey,
  supportedFeatureIds,
  withModelVisibility,
} from '../client/services/catalog-search.ts'
import { modelsWithToolLimit } from '../client/services/model-limits.ts'
import type { OpenCodeFeatureId } from '../client/services/catalog-search.ts'
import { modelDisplayName, modelKey } from '../contracts/identity.ts'
import { formatTimestamp } from '../client/services/format.ts'
import { errorMessage } from '../client/services/http.ts'
import type { OpenCodePreferencesStore } from '../client/services/preferences-data.ts'
import type { CatalogLoader, OpenCodeCatalogView } from './catalog-snapshot.ts'

/** 目录卡片参数。 */
export interface OpenCodeCatalogCardProps {
  readonly t: OpenCodeTranslate
  /** 目录视图；由区块统一读取，与账号卡共用同一份响应。 */
  readonly view: OpenCodeCatalogView
  /** 手动刷新入口（`force` 会打到上游）。 */
  readonly load: CatalogLoader
  readonly preferences: OpenCodePreferencesStore
  /** 当前隐藏的模型键（`plan:id`，来自偏好快照）。 */
  readonly hiddenModels: readonly string[]
  /** 偏好是否已完成首次读取；未完成时开关保持禁用。 */
  readonly preferencesLoaded: boolean
}

/** 图标统一属性：内联 SVG、`currentColor` 描边，亮暗主题随文字色反转。 */
const GLYPH_PROPS = {
  viewBox: '0 0 24 24',
  width: 14,
  height: 14,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': 'true',
  focusable: 'false',
} as const

/** 能力图标：推理（星芒）、工具（扳手）、图片、文本、免费（礼物）。 */
function FeatureGlyph({ id }: { id: OpenCodeFeatureId }): ReactNode {
  if (id === 'reasoning') {
    return (
      <svg {...GLYPH_PROPS}>
        <path d="M12 3.2 13.6 8.4 18.8 10 13.6 11.6 12 16.8 10.4 11.6 5.2 10 10.4 8.4Z" />
        <path d="M18.6 15.4 19.1 17l1.6.5-1.6.5-.5 1.6-.5-1.6-1.6-.5 1.6-.5Z" />
      </svg>
    )
  }
  if (id === 'tools') {
    return (
      <svg {...GLYPH_PROPS}>
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
      </svg>
    )
  }
  if (id === 'image') {
    return (
      <svg {...GLYPH_PROPS}>
        <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
        <circle cx="9" cy="10" r="1.6" />
        <path d="M4 17.2 8.2 13a2 2 0 0 1 2.8 0L20 20" />
      </svg>
    )
  }
  if (id === 'text') {
    return (
      <svg {...GLYPH_PROPS}>
        <path d="M5 7V5h14v2" />
        <path d="M12 5v14" />
        <path d="M9 19h6" />
      </svg>
    )
  }
  return (
    <svg {...GLYPH_PROPS}>
      <path d="M4.5 12v8.5h15V12" />
      <path d="M3 7.5h18V12H3z" />
      <path d="M12 20.5V7.5" />
      <path d="M12 7.5H8.2a2.3 2.3 0 0 1 0-4.6c3 0 3.8 4.6 3.8 4.6Z" />
      <path d="M12 7.5h3.8a2.3 2.3 0 0 0 0-4.6c-3 0-3.8 4.6-3.8 4.6Z" />
    </svg>
  )
}

/** 气泡里的勾选标记：支持用对勾，不支持用短横线。 */
function FeatureMark({ supported }: { supported: boolean }): ReactNode {
  return (
    <svg {...GLYPH_PROPS} width={13} height={13} strokeWidth={2}>
      {supported ? <path d="M20 6 9 17l-5-5" /> : <path d="M6 12h12" />}
    </svg>
  )
}

/**
 * 能力气泡：每项一行，左侧勾选标记，右侧可带思考等级明细。
 *
 * 浮层背景、圆角与阴影由共享包主题的 Tooltip 容器统一提供（`--dsw-alias-tooltip-bg`
 * 与 `--dsw-shadow-lv3`），这里只负责版式与文字层级，避免重复叠加背景。
 */
function ModelFeatureBubble({ model, t }: { model: OpenCodeModel, t: OpenCodeTranslate }): ReactNode {
  return (
    <span className="dsh-opencode-model-tip-body">
      {modelFeatures(model).map(feature => (
        <span
          key={feature.id}
          className={`dsh-opencode-model-tip-row${feature.supported ? '' : ' is-unsupported'}`}
        >
          <span className="dsh-opencode-model-tip-mark" aria-hidden="true">
            <FeatureMark supported={feature.supported} />
          </span>
          <span className="dsh-opencode-model-tip-label">{t(featureLabelKey(feature.id))}</span>
          {feature.levels === undefined ? null : (
            <span className="dsh-opencode-model-tip-detail">
              {feature.levels.map(level => t(reasoningLevelLabelKey(level))).join(' / ')}
            </span>
          )}
          {feature.id === 'free' && feature.supported ? (
            <span className="dsh-opencode-model-tip-detail">{t('catalogFreeClientOnly')}</span>
          ) : null}
          <span className="dsh-opencode-visually-hidden">
            {feature.supported ? t('catalogFeatureSupported') : t('catalogFeatureUnsupported')}
          </span>
        </span>
      ))}
      <span className="dsh-opencode-model-tip-footer">{t(apiKindLabelKey(model.api))}</span>
      <span className="dsh-opencode-model-tip-note">
        {model.plan === 'console' ? t('catalogPlanConsoleHint') : t('catalogPlanGoHint')}
      </span>
    </span>
  )
}

/**
 * 目录顶部的套餐口径说明。
 *
 * 套餐可读时给出「只显示该套餐的模型」与隐藏条数；套餐判不出来时目录按 Go
 * 口径过滤（OpenCode 的主力形态是 Go 订阅），这里说明是按 Go 展示并保留
 * 宿主给出的失败原因，用户要能看出为什么显示的是 Go 而不是自己的套餐。
 *
 * `filteredModelCount` 为 0 时不下发那行说明：「已隐藏 0 个」既没有信息量，
 * 也容易被读成过滤失败。
 */
function PlanScopeNotice({
  entitlement,
  t,
}: {
  readonly entitlement: OpenCodeCatalogEntitlement | undefined
  readonly t: OpenCodeTranslate
}): ReactNode {
  if (entitlement === undefined) return null
  const plan = entitlement.plan
  if (plan !== 'unknown') {
    const hidden = entitlement.filteredModelCount
    return (
      <div className="dsh-opencode-plan-scope" role="status">
        <DshIconInfoCircle className="dsh-opencode-notice-icon" />
        <div className="dsh-opencode-notice-body">
          <span>{t('catalogPlanScopeNotice', { plan: t(accountPlanLabelKey(plan)) })}</span>
          {typeof hidden === 'number' && hidden > 0 ? (
            <span className="dsh-opencode-muted">{t('catalogPlanScopeHidden', { count: hidden })}</span>
          ) : null}
          <span className="dsh-opencode-muted">
            <a
              className="dsh-opencode-link"
              href={`${OPENCODE_CONSOLE_ORIGIN}/models`}
              target="_blank"
              rel="noreferrer noopener"
            >
              {t('catalogConsoleLink')}
            </a>
          </span>
        </div>
      </div>
    )
  }
  const hidden = entitlement.filteredModelCount
  return (
    <div className="dsh-opencode-plan-scope" role="status">
      <DshIconInfoCircle className="dsh-opencode-notice-icon" />
      <div className="dsh-opencode-notice-body">
        <span>{t('catalogPlanScopeUnknown')}</span>
        {typeof hidden === 'number' && hidden > 0 ? (
          <span className="dsh-opencode-muted">{t('catalogPlanScopeHidden', { count: hidden })}</span>
        ) : null}
        {entitlement.error === undefined ? null : (
          <span className="dsh-opencode-muted">{entitlement.error}</span>
        )}
      </div>
    </div>
  )
}

/**
 * 模型目录卡片。
 * @returns 目录卡片元素。
 */
export function OpenCodeCatalogCard({
  t,
  view,
  load,
  preferences,
  hiddenModels,
  preferencesLoaded,
}: OpenCodeCatalogCardProps): ReactNode {
  const [query, setQuery] = useState('')
  const [savingVisibility, setSavingVisibility] = useState(false)
  const [visibilityError, setVisibilityError] = useState<string>()

  const response: OpenCodeCatalogResponse | undefined = view.response
  const catalog = response?.catalog ?? undefined
  const entitlement = response?.entitlement
  const hiddenSet = new Set(hiddenModels)
  const models = catalog?.models ?? []
  const filtered = filterCatalogModels(models, query)
  const hiddenCount = models.filter(model => hiddenSet.has(modelKey(model.plan, model.id))).length
  // 上游有工具数量上限的模型：不裁剪，只在设置页提示可能的 400 原因。
  const toolLimited = modelsWithToolLimit(models)
  const updatedAt = formatTimestamp(catalog?.fetchedAt)
  // 未注册的供应商组不会出现在模型选择器：目录卡顶部给出可读警告。
  const unregisteredRoutes = (response?.routes ?? []).filter(route => !route.registered)

  const toggleModel = async (model: OpenCodeModel, visible: boolean): Promise<void> => {
    setVisibilityError(undefined)
    setSavingVisibility(true)
    try {
      await preferences.save({
        hiddenModels: withModelVisibility(hiddenModels, modelKey(model.plan, model.id), visible),
      })
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
            loading={view.refreshing}
            onClick={() => { load(true, false) }}
          >
            {t('catalogRefresh')}
          </DshButton>
        </div>
      </header>

      <PlanScopeNotice entitlement={entitlement} t={t} />

      {unregisteredRoutes.length === 0 ? null : (
        <div className="dsh-opencode-notice dsh-opencode-notice--warning" role="status">
          <DshIconAlertCircle className="dsh-opencode-notice-icon" />
          <div className="dsh-opencode-notice-body">
            <span className="dsh-opencode-notice-title">{t('catalogRouteWarningTitle')}</span>
            <ul className="dsh-opencode-notice-list">
              {unregisteredRoutes.map(route => (
                <li key={route.id}>
                  {t('catalogRouteWarningItem', {
                    name: route.name,
                    message: route.error ?? t('catalogRouteErrorUnknown'),
                  })}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {view.status === 'loading' ? (
        <div className="dsh-opencode-status-row" role="status">
          <DshSpin size="small" />
          <span>{t('catalogLoading')}</span>
        </div>
      ) : null}

      {view.status === 'error' && catalog === undefined ? (
        <div className="dsh-opencode-error-block">
          <p className="dsh-opencode-error" role="alert">{view.message ?? t('catalogLoadFailed')}</p>
          <DshButton
            htmlType="button"
            theme="borderless"
            type="tertiary"
            size="small"
            icon={<DshIconRefresh />}
            loading={view.refreshing}
            onClick={() => { load(true, false) }}
          >
            {t('catalogRetry')}
          </DshButton>
        </div>
      ) : null}

      {view.status === 'ready' && view.message !== undefined ? (
        <div className="dsh-opencode-notice" role="status">
          <DshIconAlertCircle className="dsh-opencode-notice-icon" />
          <span>{view.message}</span>
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
          {/* 免费模型里有一部分只能由官方 OpenCode 客户端调用，这里统一说明禁用原因。 */}
          {catalog.models.some(model => model.clientOnly === true) ? (
            <div className="dsh-opencode-notice" role="status">
              <DshIconInfoCircle className="dsh-opencode-notice-icon" />
              <span>{t('catalogClientOnlyNotice')}</span>
            </div>
          ) : null}
          {/* 有工具数量上限的模型不做裁剪，只在这里说明可能的 400 原因。 */}
          {toolLimited.length === 0 ? null : (
            <div className="dsh-opencode-notice" role="status">
              <DshIconInfoCircle className="dsh-opencode-notice-icon" />
              <span>
                {t('catalogToolLimitNotice', {
                  models: toolLimited.map(hit => `${hit.id}（≤ ${hit.limit}）`).join('、'),
                })}
              </span>
            </div>
          )}
          {/* 搜索与计数固定在列表上方，列表内部滚动时它们不跟着走。 */}
          <div className="dsh-opencode-catalog-controls">
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
            <p className="dsh-opencode-muted">
              {query.trim().length > 0 ? t('catalogSearchEmpty') : t('catalogEmpty')}
            </p>
          ) : (
            <div className="dsh-opencode-models-scroll">
              <ul className="dsh-opencode-models">
                {filtered.map(model => {
                  const key = modelKey(model.plan, model.id)
                  const hidden = hiddenSet.has(key)
                  // 仅官方客户端可用的免费模型与上游停用条目一样按禁用展示。
                  const disabled = model.disabled === true || model.clientOnly === true
                  const icons = supportedFeatureIds(model)
                  const featureSummary = icons.map(id => t(featureLabelKey(id))).join(' · ')
                  // 额度只在该模型属于当前套餐时才有意义；不可读时不猜。
                  const estimate = model.plan === 'go'
                    ? estimatedRequestsText(model, t('catalogEstimatedUnlimited'))
                    : undefined
                  const className = [
                    'dsh-opencode-model',
                    disabled ? 'is-disabled' : '',
                    hidden && !disabled ? 'is-hidden' : '',
                  ].filter(Boolean).join(' ')
                  return (
                    <li className={className} key={key}>
                      <div className="dsh-opencode-model-main">
                        <div className="dsh-opencode-model-heading">
                          <span className="dsh-opencode-model-name">{modelDisplayName(model.name, model.plan)}</span>
                          {disabled ? <DshTag size="small" color="red">{t('catalogDisabledTag')}</DshTag> : null}
                          {model.deprecated === true ? <DshTag size="small" color="orange">{t('catalogDeprecatedTag')}</DshTag> : null}
                          {model.clientOnly === true ? <DshTag size="small" color="grey">{t('catalogFreeClientOnly')}</DshTag> : null}
                          {icons.length === 0 ? null : (
                            <DshTooltip
                              className="dsh-opencode-model-tip"
                              content={<ModelFeatureBubble model={model} t={t} />}
                              position="top"
                              showArrow={false}
                              // 悬浮 700ms 后再弹：目录很长，鼠标扫过时不应连续弹出气泡。
                              mouseEnterDelay={0.7}
                              mouseLeaveDelay={0.1}
                            >
                              <span
                                className="dsh-opencode-model-features"
                                tabIndex={0}
                                role="img"
                                aria-label={`${t('catalogFeatures')}: ${featureSummary}`}
                              >
                                {icons.map(id => (
                                  <span key={id} className={`dsh-opencode-feature dsh-opencode-feature--${id}`}>
                                    <FeatureGlyph id={id} />
                                  </span>
                                ))}
                              </span>
                            </DshTooltip>
                          )}
                        </div>
                        <div className="dsh-opencode-model-facts">
                          <span className="dsh-opencode-model-id">{model.id}</span>
                          <span className="dsh-opencode-model-fact">{`${t('catalogContext')} ${formatTokenCount(model.contextWindow) ?? '—'}`}</span>
                          <span className="dsh-opencode-model-fact">{`${t('catalogMaxOutput')} ${formatTokenCount(model.maxTokens) ?? '—'}`}</span>
                          {estimate === undefined ? null : (
                            <span className="dsh-opencode-model-fact dsh-opencode-model-estimate">
                              {`${t('catalogEstimatedRequests')} ${estimate}`}
                            </span>
                          )}
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
            </div>
          )}
          {/* 额度口径溯源：估算表是内置快照，注明抓取日期与官方表地址。 */}
          {entitlement?.estimates === undefined ? null : (
            <p className="dsh-opencode-muted">
              {t('catalogEstimatedSource', { date: entitlement.estimates.fetchedAt })}
              {' '}
              <a
                className="dsh-opencode-link"
                href={entitlement.estimates.sourceUrl}
                target="_blank"
                rel="noreferrer noopener"
              >
                {t('catalogEstimatedSourceLink')}
              </a>
            </p>
          )}
        </>
      )}
    </section>
  )
}
