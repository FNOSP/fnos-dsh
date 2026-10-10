/**
 * 插件详情页的用量区块（FNOS-010-08）。
 *
 * 座位是 `plugins.detail.section`，因此整体位于「包含的组件」之后；该座位是
 * **list**（不是 keyed），页面会给每个打开的详情页渲染它，所以组件必须自己看
 * `subject`——不是本插件的组合包就返回 `null`（过滤在 `index.tsx` 的座位入口）。
 *
 * UI 承载策略（插件 UI 规范「配置项 UI 选择顺序」）：key/顺序/超时等标量配置留在
 * 官方 `Config` schema 生成的表单里；**用量区块自绘**，因为官方配置 UI 没有承载
 * 「跨账号只读实时状态」的控件（每个账号的余额、套餐用量、获取时间与失败提示需要
 * 并列呈现，数据来自后台刷新的内存快照而不是配置文档）。
 *
 * 刷新语义：后台按配置的间隔定时刷新（FNOS-010-09 的快照），区块另提供**手动刷新**
 * 入口（AC-04）——点它立即重查两个平台的用量端点，让用户不必等满一个周期。刷新中
 * 入口禁用（重复点击只会多打平台请求），失败后入口仍可见，点一次即重试。
 */
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { DshButton, DshEmpty, DshSpin, DshTag, DshTypography } from '@tnnevol/dsh-semi-ui'
import type { UsageSnapshot } from '../contracts/usage-rpc.ts'
import { groupByPlatform, latestFetchedAt, refreshButtonState } from './usage-view.ts'
import type { RefreshStatus } from './usage-view.ts'
import type { UsageLabelKey } from './usage-view.ts'
import type { UsageLocaleKey } from './locales.ts'

/** 用量区块的组件参数。 */
export interface UsageSectionProps {
  /** 本地化函数。 */
  readonly t: (key: UsageLocaleKey) => string
  /** 读取快照；失败时由组件呈现不可用提示，而不是抛错。 */
  readonly load: () => Promise<UsageSnapshot>
  /**
   * 强制重查平台用量端点并返回新快照（FNOS-010-08-AC-04）。
   *
   * 与 `load` 的区别：`load` 只读内存快照，`refresh` 会真实打到两个平台的免费
   * 查询端点。两者分开是为了让「打开页面」不产生外部请求。
   */
  readonly refresh: () => Promise<UsageSnapshot>
  /**
   * 宿主配置修订号。
   *
   * 配置变化（新增/删除账号）后快照内容就过时了；把它作为 effect 依赖，保存后的
   * 下一次渲染立即重取，用户不必等满一个后台刷新周期。
   */
  readonly revision?: number | undefined
}

/**
 * 用量区块。
 *
 * 位置：渲染在 `plugins.bundle.config` 座位里、配置表单之后。上游 `PackageDetail` 的
 * 固定顺序是「`bundle.config` → 包含的组件（`RowsSection`）→ `detail.section`」，因此
 * 想让用量排在「包含的组件」**之前**就只能落在 `bundle.config` 里——挂 `detail.section`
 * 永远排在组件列表下方。座位由组合包名 key 住，不再需要按 `subject` 过滤。
 *
 * @param props - 组件参数。
 * @param props.t - 本地化函数。
 * @param props.load - 读取用量快照；失败由组件呈现为不可用提示。
 * @param props.revision - 宿主配置修订号；变化时重取快照。
 * @returns 用量区块。
 */
export function FailoverUsageSection({ t, load, refresh, revision }: UsageSectionProps): ReactNode {
  return <UsageSectionContent t={t} load={load} refresh={refresh} revision={revision} />
}

/** 用量区块内容：挂载时读取一次快照。 */
function UsageSectionContent({ t, load, refresh, revision }: Pick<UsageSectionProps, 't' | 'load' | 'refresh' | 'revision'>): ReactNode {
  const [state, setState] = useState<{ status: 'loading' | 'ready' | 'error', snapshot?: UsageSnapshot }>({ status: 'loading' })
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    let live = true
    void load().then(
      snapshot => { if (live) setState({ status: 'ready', snapshot }) },
      () => { if (live) setState({ status: 'error' }) },
    )
    return () => { live = false }
    // 修订号参与依赖：配置变化后立即重取，不等后台刷新周期。
  }, [load, revision])

  /** 刷新入口的状态机取值（空闲 / 刷新中）。 */
  const refreshStatus: RefreshStatus = refreshing ? 'refreshing' : 'idle'

  /** 手动刷新：重查平台端点并用新快照替换当前展示。 */
  const onRefresh = (): void => {
    if (refreshing) return
    setRefreshing(true)
    void refresh().then(
      snapshot => { setState({ status: 'ready', snapshot }) },
      // 刷新失败不改写既有展示：保留上次成功的数值，只把入口恢复为可点（可重试）。
      // 平台侧失败由快照里各账号自己的 ok/error 体现。
      () => {},
    ).finally(() => { setRefreshing(false) })
  }

  if (state.status === 'loading') {
    return (
      <section className="dsh-failover-usage" aria-busy="true">
        <header className="dsh-failover-usage__head">
          <DshTypography.Title heading={5} className="dsh-failover-usage__title">{t('sectionTitle')}</DshTypography.Title>
          <RefreshButton t={t} status={refreshStatus} onClick={onRefresh} />
        </header>
        <div className="dsh-failover-usage__loading">
          <DshSpin size="small" />
          <span>{t('loading')}</span>
        </div>
      </section>
    )
  }

  if (state.status === 'error' || state.snapshot === undefined) {
    return (
      <section className="dsh-failover-usage">
        <header className="dsh-failover-usage__head">
          <DshTypography.Title heading={5} className="dsh-failover-usage__title">{t('sectionTitle')}</DshTypography.Title>
          <RefreshButton t={t} status={refreshStatus} onClick={onRefresh} />
        </header>
        <p className="dsh-failover-usage__error" role="status">{t('unavailable')}</p>
      </section>
    )
  }

  const snapshot = state.snapshot
  const groups = groupByPlatform(snapshot.accounts)
  const fetchedAt = latestFetchedAt(snapshot.accounts)

  return (
    <section className="dsh-failover-usage">
      <header className="dsh-failover-usage__head">
        <DshTypography.Title heading={5} className="dsh-failover-usage__title">{t('sectionTitle')}</DshTypography.Title>
        <div className="dsh-failover-usage__headactions">
          {snapshot.fresh
            ? null
            : <DshTag color="orange" size="small" className="dsh-failover-usage__stale">{t('stale')}</DshTag>}
          <RefreshButton t={t} status={refreshStatus} onClick={onRefresh} />
        </div>
      </header>
      <p className="dsh-failover-usage__hint">{t('refreshHint')}</p>
      {fetchedAt === undefined ? null : (
        <p className="dsh-failover-usage__fetched">{`${t('fetchedAt')}: ${formatLocalTime(fetchedAt)}`}</p>
      )}
      <div className="dsh-failover-usage__groups">
        {groups.map(group => (
          <div className="dsh-failover-usage__group" key={group.platform}>
            <h4 className="dsh-failover-usage__groupTitle">{t(group.titleKey)}</h4>
            {group.accounts.length === 0
              ? <p className="dsh-failover-usage__empty">{t('noAccount')}</p>
              : (
                  <ul className="dsh-failover-usage__accounts">
                    {group.accounts.map(account => (
                      <li className="dsh-failover-usage__account" key={account.label}>
                        <div className="dsh-failover-usage__accountHead">
                          <span className="dsh-failover-usage__accountLabel">{account.label}</span>
                          {account.ok
                            ? null
                            : <DshTag color="red" size="small">{t('unavailable')}</DshTag>}
                        </div>
                        {account.error === undefined
                          ? (
                              <dl className="dsh-failover-usage__entries">
                                {account.entries.map(entry => (
                                  <div className="dsh-failover-usage__entry" key={entry.key}>
                                    <dt>{labelFor(t, entry.labelKey)}</dt>
                                    <dd>{entry.value}</dd>
                                  </div>
                                ))}
                              </dl>
                            )
                          : <p className="dsh-failover-usage__accountError" role="status">{account.error}</p>}
                      </li>
                    ))}
                  </ul>
                )}
          </div>
        ))}
      </div>
      {snapshot.accounts.length === 0
        ? (
            <div className="dsh-failover-usage__emptyState">
              <DshEmpty description={t('noAccount')} />
            </div>
          )
        : null}
    </section>
  )
}

/**
 * 刷新入口（FNOS-010-08-AC-04/AC-05）。
 *
 * 三种展示状态（加载、就绪、失败）都要渲染它：失败态下可见才能点一次重试，
 * 加载态下可见但禁用，用户才知道「有刷新这件事、且正在忙」。
 *
 * @param props - 入口参数。
 * @param props.t - 本地化函数。
 * @param props.status - 刷新状态机（`idle` / `refreshing`）。
 * @param props.onClick - 触发刷新。
 * @returns 刷新按钮。
 */
function RefreshButton({ t, status, onClick }: {
  readonly t: (key: UsageLocaleKey) => string
  readonly status: RefreshStatus
  readonly onClick: () => void
}): ReactNode {
  const view = refreshButtonState(status)
  return (
    <DshButton
      className="dsh-failover-usage__refresh"
      theme="borderless"
      size="small"
      disabled={view.disabled}
      loading={view.busy}
      aria-label={t(view.labelKey)}
      onClick={onClick}
    >
      {t(view.labelKey)}
    </DshButton>
  )
}

/** 用量条目的标题文本。 */
function labelFor(t: (key: UsageLocaleKey) => string, key: UsageLabelKey): string {
  return t(key)
}

/** 把 ISO 时间戳格式化成浏览器本地时间；无法解析时原样返回。 */
export function formatLocalTime(iso: string): string {
  const parsed = Date.parse(iso)
  if (Number.isNaN(parsed)) return iso
  return new Date(parsed).toLocaleString()
}
