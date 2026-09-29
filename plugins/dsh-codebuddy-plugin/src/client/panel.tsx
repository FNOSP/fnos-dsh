/**
 * CodeBuddy 插件详情页区块（`plugins.bundle.config`）。
 *
 * 设计要点：
 *  - 数据获取、store 缓存、auto 偏好的 host 同步都封装在 {@link hooks/} 下的
 *    hook 里，按 hook 关联业务，而不再让单文件 mega-component 把这一切都包下来。
 *  - 视觉 / 纯渲染组件（`StatMetric`、`ActivityGrid`、`AccountCard` 等）拆到
 *    {@link ui/}，仅接 props，不再触碰 RPC 与 store。
 *  - 本文件组装页面状态与布局，直接使用 ui/ 导出的组件。
 *  - 共享类型放 {@link ../types/client/panel-types.d.ts}；DatePicker / echarts / 资源条等大块组件
 *    各自独立文件。
 *
 * 内容：账号管理（登录、账号卡片、积分总览、三个自动开关、完成任务与日志）与
 * Token 统计，两块纵向排列，另有「切换阈值 / 显示余额余量」偏好区。
 *
 * 原先是**全页面管理面板**（`shell.overlay` slot + `#/codebuddy/*` hash 路由 +
 * 左侧导航 + 左上返回按钮）。配置入口迁到插件管理页的组合包详情页后，外壳、
 * 路由与侧边导航全部删除：详情页自己画标题与面包屑，插件只提供内容。
 * 数据来源仍是 host 的 /codebuddy RPC。
 *
 * @module dsh-codebuddy/panel
 */

import { CodeBuddyLogo } from '../components/CodeBuddyLogo.tsx'
import type { StatsDimension, CodeBuddyDetailProps, CodeBuddyDetailSubjectProps } from '../types/client/panel'
export type { CodeBuddyDetailProps, CodeBuddyDetailSubjectProps } from '../types/client/panel'
/** 座位入口的 props 类型别名（`plugins.detail.section` 的 owner props）。 */
export type CodeBuddyDetailSectionProps = CodeBuddyDetailSubjectProps
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { useStore } from '@nanostores/react'
import {
  DshButton, DshCard, DshEmpty, DshIconArrowLeft, DshIconButton, DshIconCommand,
  DshIconElementStroked, DshIconList, DshIconRefresh, DshIconUser, DshInput, DshModal,
  DshTag, DshToast, DshTooltip,
} from '@tnnevol/dsh-semi-ui'

import { CODEBUDDY_AUTH_CHANNEL } from '../contracts/constants.ts'
import { openAuthUrl } from './external-opener.ts'
import type { ConnectionRpc, AccountsResult, GrowthRunResult } from './rpc.ts'
import { describeRpcError } from './rpc.ts'
import { classifyResources, forgetResources, recordResources, resourceHistoryStore, resourcesFrom } from './resource-history.ts'
import type { ClassifiedResource } from './resource-history.ts'
import { TokenStatsStore } from './store/token-stats.ts'
import { sortSegmentsByValueDesc } from './segment-bar.ts'
import { formatUpdatedAt } from './format-time.ts'
import { accountEpoch, subscribeAccountEpoch } from './store/account-epoch.ts'
import { DEFAULT_TOKEN_RANGE, DEFAULT_TREND_RANGE, optionsFor, rangeLabel as rangeLabelOf, type TokenRangeKey } from './token-range.ts'
import { AddAccountModal } from '../components/AddAccountModal.tsx'
import { CodeBuddySettingsPopover } from '../components/CodeBuddySettingsPopover.tsx'
import { startLoginPolling } from './login-polling.ts'

import { usePanelData, useTokenStats } from './hooks/use-panel-data.ts'
import { useAutoPrefs } from './hooks/use-auto-prefs.ts'

import { AccountCardImpl as AccountCard } from './ui/account-card.tsx'
import { AccountResourcesModalImpl as AccountResourcesModal } from './ui/account-resources-modal.tsx'
import { ActivityGridImpl as ActivityGrid } from './ui/activity-grid.tsx'
import { GrowthRunDrawer } from './ui/growth-run-drawer.tsx'
import {
  BreakdownListImpl as BreakdownList,
  SessionRankingImpl as SessionRanking,
  WorkspaceListImpl as WorkspaceList,
} from './ui/token-lists.tsx'
import { DimensionToggle } from './ui/dimension-toggle.tsx'
import { RangeToggle } from './ui/range-toggle.tsx'
import { TokenUsageChartImpl as TokenUsageChart } from './ui/token-usage-chart.tsx'
import { liveResourcesOfImpl as liveResourcesOf } from './ui/resource-row.tsx'
import {
  compact, formatCredit, PageLoading, PanelBody, PanelRefreshOverlay,
  StatMetric,
} from './ui/loading-shared.tsx'
import {
  $growthAccountInFlight, $growthRunning, hydrateGrowthRunState, isRunAllDisabled, markGrowthRunning,
} from './store/growth-run.ts'
import type { AccountCardLabels, PanelAccountRow, TokenStats, Translate } from '../types/client/panel-types'

export type { AccountCardLabels, PanelAccountRow, TokenStats, Translate }

function AccountsPage({
  rpc, t, notify, rosterTick, loginWaiting,
  onRename, onDelete, onAddAccount, onCheckinChange,
}: {
  rpc: ConnectionRpc
  t: Translate
  notify: (ok: boolean, text: string) => void
  rosterTick: number
  loginWaiting: boolean
  onRename: (row: PanelAccountRow) => void
  onDelete: (row: PanelAccountRow) => void
  onAddAccount: () => void
  onCheckinChange: () => void
}): ReactNode {
  // 同时依赖账号代际（accountEpoch）：设置页切换、或宿主自动切换当前账号时，
  // 面板不会重挂载（keep-alive），只有代际变化才能让它重取 —— 否则「当前账号」
  // 徽标与「设为当前账号」的可用状态会停留旧值，直到手动刷新。
  const accountVersion = useSyncExternalStore(subscribeAccountEpoch, accountEpoch, accountEpoch)
  // 依赖序列化成字符串：`[rosterTick, accountVersion]` 每次渲染都是新数组，
  // 直接当依赖会让 effect 反复重取。字符串只有值真变时才变。
  const { data, loading, reload } = usePanelData<{ accounts: PanelAccountRow[], currentId?: string }>(
    rpc, 'panelStatus', `${rosterTick}|${accountVersion}`,
  )
  const [busyId, setBusyId] = useState<string | undefined>(undefined)
  /** 「完成任务」重入标志（loading 不拦点击，必须自己挡）。 */
  const runAllGrowthRef = useRef(false)
  /**
   * 掉线账号重新登录的轮询中止句柄。
   *
   * 详情页**切走即卸载**（原面板是常驻不卸载的），因此必须在卸载时显式中止：
   * 否则轮询会继续对 `pollLogin` 发请求，落定后还会对已卸载的组件调 notify。
   */
  const reloginAbort = useRef<(() => void) | undefined>(undefined)
  useEffect(() => () => { reloginAbort.current?.(); reloginAbort.current = undefined }, [])
  /** 执行日志抽屉是否展开（点「完成任务」自动展开，也可手动开关）。 */
  const [logOpen, setLogOpen] = useState(false)
  const [resourceTarget, setResourceTarget] = useState<PanelAccountRow | undefined>(undefined)
  // 三个 auto* 偏好的展示 / 同步 host 都封装在 hook 里——这样本页与设置页同源。
  // 只用得到这两个：卡片用它们决定签到项与「设为当前」是否渲染。自动旅行
  // 没有卡片级联动，它的开关在齿轮浮层里。
  const { autoCheckin: autoCheckinOn, autoSwitch: autoSwitchOn } = useAutoPrefs(rpc)
  // 「完成任务」的运行态来自宿主（落盘 + 进程内账号锁表，见 store/growth-run.ts）：
  // 刷新页面后仍是 loading，不会因为组件 state 重置而变回可点击。
  const growthRun = useStore($growthRunning)
  const accountInFlight = useStore($growthAccountInFlight)
  /**
   * 本轮是否由**本入口**（全账号「完成任务」）触发。
   *
   * `mode: 'all'` 是这个入口独有的标记：单账号「一键完成」与单项执行都走
   * `mode: 'one'`（见 host 的 `beginGrowthRun` 调用点）。用它区分是为了让
   * `loading` 只表达「我这一轮在跑」，而把「别的账号在跑」留给 `disabled` ——
   * 两个属性各表达一件事。
   *
   * 刻意**不**附加「已有账号被登记」这类条件：`beginGrowthRun` 落盘发生在第一个
   * 账号被登记之前，加上它会让点击后的那一瞬间落到 `loading=false` + `disabled=true`，
   * 正是「点击变成直接禁用」这个被明确否决的表现。
   */
  const runAllRunning = growthRun.running === true && growthRun.mode === 'all'
  /** 任一账号在跑成长任务即禁用本入口（全账号范围不该与正在跑的一轮重叠）。 */
  const runAllDisabled = isRunAllDisabled(growthRun, accountInFlight)

  // 台账是持久化 nanostores atom，用 useStore 订阅它：
  // 台账一变就重渲染，`resourcesByAccount` 也随之重算——不再需要手工 tick。
  // （旧写法靠 `ledgerTick` state 当信号，还得为「lint 认为该依赖多余」压制
  // 告警；订阅 atom 把外部可变状态变成了 React 看得见的依赖。）
  const ledger = useStore(resourceHistoryStore)
  const rows = data?.accounts ?? []

  // 每次探测都把实时资源包并入本地台账（写持久化 store 是副作用，放 effect）。
  useEffect(() => {
    if (rows.length === 0) return
    for (const row of rows) {
      if (!row.creditOk) continue   // 查询失败的账号不写台账：实时列表为空时会把已有记录挤成「已过期」。
      recordResources(row.id, liveResourcesOf(row))
    }
  }, [rows])

  // 挂载时从宿主采纳成长任务运行态：页面刷新后宿主仍在跑时按钮保持 loading。
  useEffect(() => { void hydrateGrowthRunState(rpc) }, [rpc])

  // 每个账号的分类资源包（可使用 → 已用完 → 已过期），卡片与弹框共用。
  // 从 `ledger` 快照读取（纯函数），因此依赖完整：台账变更既触发重渲染、
  // 也让这份 useMemo 重算。lint 能校验，无需任何豁免。
  const resourcesByAccount = useMemo(() => {
    const map = new Map<string, ClassifiedResource[]>()
    for (const row of rows) {
      map.set(row.id, row.creditOk ? classifyResources(resourcesFrom(ledger, row.id), liveResourcesOf(row)) : [])
    }
    return map
  }, [rows, ledger])

  const checkinOne = async (id: string): Promise<void> => {
    setBusyId(id)
    const result = await rpc.call<{ accounts: Array<{ id: string, result?: string, error?: string }> }>(CODEBUDDY_AUTH_CHANNEL, 'checkin', { id })
    setBusyId(undefined)
    if (result.ok) {
      const row = result.value.accounts.find(item => item.id === id)
      notify(row?.result !== 'error', row?.result === 'already' ? t('checkinAlready') : row?.result === 'success' ? t('checkinDone') : row?.error ?? t('checkinFail'))
      onCheckinChange()
      reload()
    }
  }

  /**
   * 手动切换到指定账号。
   *
   * 必须走 `busyId`（与签到同一个在途标记）而不是直接发请求：重复点击会让
   * host 连续换号，最终停在哪个账号取决于网络返回顺序。原先这份守卫只存在于
   * 设置区块的切换按钮上（`loading` + `disabled`），而配置入口迁移删掉了那个
   * 组件之后，卡片菜单的「设为当前」成为唯一入口——守卫必须跟着搬过来，
   * 否则唯一的入口反而没有防重。
   *
   * 已在途时直接返回而不是排队：第二次点击表达的是同一个意图，没必要再发一次。
   */
  const switchOne = async (id: string): Promise<void> => {
    if (busyId !== undefined) return
    setBusyId(id)
    try {
      const result = await rpc.call<AccountsResult>(CODEBUDDY_AUTH_CHANNEL, 'switchAccount', { id })
      if (result.ok) { notify(true, t('switchDone')); reload() }
      else { notify(false, describeRpcError(result)) }
    } finally {
      // `finally` 而非成功分支收尾：RPC 抛错时若不清标记，卡片会永久停留在
      // 「切换中」且切换入口再也不可用。
      setBusyId(undefined)
    }
  }

  /**
   * 掉线账号重新登录：保留其环境与备注名，直接发起一次新的握手。
   *
   * 语义取自原先设置区块的 `startRelogin`（那份实现随组件删除，能力在这里
   * 恢复）：
   *
   *  - **`activate: false`**——重新登录不把该账号变成当前账号。离线账号在它
   *    下线期间可能已由别的账号接管流量，重新登录只是修复凭据，不该顺手抢回来；
   *  - 带上 `label` 与 `environment`，让新握手沿用原账号的备注名与网络环境，
   *    否则企业/自建环境的账号会在重新登录后跑到默认端点上；
   *  - 开窗走 `openAuthUrl`：Desktop 下 `window.open` 返回 `null` 但已外部打开，
   *    绝不能据此报「被拦截」。
   *
   * 登录轮询交给弹框（`AddAccountModal`）：它才知道这次登录是它发起的，也只有
   * 它能在成功后关闭自己。这里只负责发起并打开浏览器。
   */
  const reloginOne = async (row: PanelAccountRow): Promise<void> => {
    if (busyId !== undefined) return
    setBusyId(row.id)
    try {
      const result = await rpc.call<{ authUrl: string, state: string }>(CODEBUDDY_AUTH_CHANNEL, 'startLogin', {
        ...(row.nickname !== undefined ? { label: row.nickname } : {}),
        ...(row.environment !== undefined ? { environment: row.environment } : {}),
        activate: false,
      })
      if (!result.ok) {
        notify(false, describeRpcError(result))
        return
      }
      openAuthUrl(result.value.authUrl)
      /**
       * 自己轮询这次握手，而不是交给「添加账号」弹框。
       *
       * 弹框的轮询是围绕**新建账号表单**的（它成功后会关闭自己并清表单），
       * 而这里是在修复一个已存在账号的凭据：不该弹出一个带空表单的对话框，
       * 也不该在成功后把它当成"刚添加了账号"。原先设置区块的 `startRelogin`
       * 也是自己轮询、不经过弹框——收回这条语义。
       */
      reloginAbort.current?.()
      reloginAbort.current = startLoginPolling(
        rpc,
        result.value.state,
        () => { reloginAbort.current = undefined; notify(true, t('loginSucceeded')); onCheckinChange() },
        () => { reloginAbort.current = undefined; notify(false, t('timeout')) },
        (reason) => { reloginAbort.current = undefined; notify(false, `${t('loginFailed')} ${reason}`) },
      )
    } finally {
      setBusyId(undefined)
    }
  }

  /**
   * 「完成任务」：触发全账号成长任务队列。
   *
   * 进入 loading 而不直接禁用是刻意的——执行要跑几十秒，禁用态看不出「正在做事」。
   * 运行态写到共享 store 并落盘宿主，刷新页面后会从宿主恢复 loading。
   * 因为 loading 不拦点击，重入由这里的 ref 判断挡住（比读 store 快照可靠：
   * store 值要等重渲染才反映到闭包里）。
   */
  const runAllGrowth = async (): Promise<void> => {
    if (runAllGrowthRef.current || growthRun.running) return
    runAllGrowthRef.current = true
    markGrowthRunning()
    // 点「完成任务」就展开日志抽屉：执行要跑几十秒，用户需要看到进度而不是干等。
    setLogOpen(true)
    try {
      const result = await rpc.call<GrowthRunResult>(CODEBUDDY_AUTH_CHANNEL, 'growthRunAll', {})
      if (!result.ok) {
        notify(false, result.error.message)
        return
      }
      notify(true, t('growthRunDone'))
    } finally {
      runAllGrowthRef.current = false
      // 无论成功失败都以宿主状态收尾，避免按钮永久停在 loading。
      await hydrateGrowthRunState(rpc)
    }
  }

  if (loading && data === undefined) return <PageLoading variant="accounts" />
  return (
    <div className="dsh-codebuddy-panel-page">
      <PanelRefreshOverlay visible={loading} />
      {loginWaiting ? <p className="dsh-codebuddy-muted">{t('waiting')}</p> : null}
      <CreditsOverview rows={rows} t={t} />
      <div className="dsh-codebuddy-panel-section-head">
        <div className="dsh-codebuddy-accounts-head-lead">
          <div className="dsh-codebuddy-panel-section-title"><strong>{t('accountsTitle')}</strong><span>{rows.length}</span></div>
          <div className="dsh-codebuddy-accounts-head-primary">
            <DshButton size="small" theme="solid" type="primary" disabled={loginWaiting} onClick={onAddAccount}>
              {loginWaiting ? t('signingIn') : t('createUser')}
            </DshButton>
            {/* 「完成任务」紧贴「添加账号」右侧（10px 间距，见 accounts.scss）。
                颜色风格与「添加账号」一致：同为主操作，用 solid + primary，
                而不是次级动作区里的 light 按钮，否则同组两个按钮会被读成不同层级。
                禁用依据是**宿主的运行状态**（`isRunAllDisabled`）：任一账号有成长
                任务在跑就禁用这个全账号入口，刷新页面后同样成立；被禁的只是这一个
                入口——其他账号自己的「完成」「一键完成」仍可点，且会真实执行。 */}
            <DshButton
              size="small"
              theme="solid"
              type="primary"
              // loading 与 disabled 并存、各表达一件事：
              //   loading  = 本按钮触发的那轮全账号执行在跑（mode 'all' 是本入口
              //              独有的标记，单账号一键完成与单项执行用的是 mode 'one'）；
              //   disabled = 已有任何账号在跑成长任务——包括其他账号的单账号执行。
              // 用不同条件喂两个属性是必须的：Semi 的 disabled 优先级高于 loading，
              // 同一条件会只在「自己这轮」把转圈吃掉。
              loading={runAllRunning}
              disabled={rows.length === 0 || (runAllDisabled && !runAllRunning)}
              onClick={() => { void runAllGrowth() }}
            >
              {t('growthRunAll')}
            </DshButton>
          </div>
        </div>
        <div className="dsh-codebuddy-accounts-head-actions">
          {/* 三个自动开关与「显示额度余量」已收进齿轮浮层：它们是**持久化策略**，
              与这一排的账号操作（刷新/查看日志）不是一类；而且「自动切换」的阈值
              原先在上方另一个区块里，同一个策略被拆成两处。
              见 `CodeBuddySettingsPopover`。 */}
          {/* 签到已并入「完成任务」：不再单独放「一键签到」按钮，避免同一件事两个入口
              （与设置页移除两个运营周期开关同一原则）。手动签到仍可从账号卡片菜单触发。 */}
          <DshButton size="small" theme="light" icon={<DshIconRefresh />} loading={loading} onClick={reload}>{t('refresh')}</DshButton>
          {/* 「查看日志」刻意不带 loading/disabled：它只是打开抽屉看已有内容
              （上一轮结果或正在执行的轮次），任何时候都该点得动。 */}
          <DshButton
            size="small"
            theme="light"
            icon={<DshIconList />}
            onClick={() => { setLogOpen(true) }}
          >
            {t('growthLogOpen')}
          </DshButton>
          <CodeBuddySettingsPopover rpc={rpc} t={t} />
        </div>
      </div>
      {rows.length === 0 ? (
        <DshEmpty title={t('accountsEmpty')} />
      ) : (
        <div className="dsh-codebuddy-panel-cards">
          {rows.map(row => (
            <AccountCard
              key={row.id}
              row={row}
              busy={busyId === row.id}
              autoCheckin={autoCheckinOn}
              resources={resourcesByAccount.get(row.id) ?? []}
              labels={buildAccountLabels(t)}
              onCheckin={(id) => { void checkinOne(id) }}
              autoSwitch={autoSwitchOn}
              onSwitch={(id) => { void switchOne(id) }}
              onRelogin={(row_) => { void reloginOne(row_) }}
              onDelete={(row_) => { onDelete(row_) }}
              onRename={(row_) => { onRename(row_) }}
              onOpenResources={(row_) => { setResourceTarget(row_) }}
            />
          ))}
        </div>
      )}
      <AccountResourcesModal
        row={resourceTarget}
        items={resourceTarget === undefined ? [] : resourcesByAccount.get(resourceTarget.id) ?? []}
        t={t}
        rpc={rpc}
        notify={notify}
        onClose={() => { setResourceTarget(undefined) }}
        onOpenLog={() => { setLogOpen(true) }}
      />
      <GrowthRunDrawer rpc={rpc} t={t} visible={logOpen} onClose={() => { setLogOpen(false) }} />
    </div>
  )
}

/** 由翻译函数构造卡片标签集合（与具体账号无关，各卡片共用同一份文案）。 */
function buildAccountLabels(t: Translate): AccountCardLabels {
  return {
    active: t('accountActive'),
    offline: t('accountOffline'),
    checkedIn: t('checkinDone'),
    unchecked: t('checkinTodo'),
    checkin: t('checkinDo'),
    remaining: t('remaining'),
    switchLabel: t('accountSwitch'),
    switching: t('accountSwitching'),
    reloginLabel: t('accountRelogin'),
    deleteLabel: t('accountRemove'),
    renameLabel: t('renameLabel'),
    resourcesLabel: t('resourcesTitle'),
    longTerm: t('resourceLongTerm'),
    noBalanceHint: t('noBalanceHint'),
    travel: {
      untraveled: t('travelUntraveled'),
      noBuddy: t('travelNoBuddy'),
      traveling: t('travelTraveling'),
      arrivesIn: t('travelArrivesIn'),
      dailyLimit: t('travelDailyLimit'),
      reward: t('travelReward'),
    },
  }
}

/** 账号积分总览：纯按 props 计算，不发起 RPC。 */
function CreditsOverview({ rows, t }: { rows: readonly PanelAccountRow[], t: Translate }): ReactNode {
  if (rows.length === 0) return null
  const totalRemaining = rows.reduce((sum, row) => sum + row.totalRemaining, 0)
  const resourceCount = rows.reduce((sum, row) => sum + row.resources.length, 0)
  const usableCount = rows.filter(row => row.usable).length
  const offlineCount = rows.filter(row => row.expired).length
  return (
    <div className="dsh-codebuddy-credits-overview">
      <div className="dsh-codebuddy-panel-section-title">
        <strong>{t('creditTitle')}</strong>
        <span>{rows.length}</span>
      </div>
      <DshCard className="dsh-codebuddy-panel-stat-card">
        <div className="dsh-codebuddy-panel-stat-grid">
          <StatMetric icon={<DshIconElementStroked />} label={t('remaining')} value={formatCredit(totalRemaining)} />
          <StatMetric icon={<DshIconElementStroked />} label={t('creditResourceCount')} value={String(resourceCount)} />
          <StatMetric icon={<DshIconUser />} label={t('creditUsable')} value={`${usableCount}/${rows.length}`} />
          <StatMetric icon={<DshIconElementStroked />} label={t('accountOffline')} value={String(offlineCount)} />
        </div>
      </DshCard>
    </div>
  )
}

/** 一个 TokenPanel 容器：档位按钮 + 刷新 + content。
 *
 * 历史版本头部还包含日期范围选择器与 `extra` 插槽；两者都已下线——
 *  - 日期范围：面板只保留固定档位 (today / 7d / 30d)，不再让用户选区间；
 *  - `extra`：唯一使用者（维度切换）已移入排行卡片内部，见 TokenStatsPage。
 * 概览/趋势/分布/会话四个面板头部现在结构一致：标题 + 档位 + 刷新。 */
function TokenPanel({ title, hint, options, range, onRangeChange, refreshLabel, loading, onRefresh, children, t }: {
  title: string
  hint?: string
  options: readonly TokenRangeKey[]
  range: TokenRangeKey
  onRangeChange: (value: TokenRangeKey) => void
  refreshLabel: string
  loading: boolean
  onRefresh: () => void
  children: ReactNode
  t: Translate
}): ReactNode {
  return (
    <section className="dsh-codebuddy-token-section">
      <div className="dsh-codebuddy-token-panel-head">
        <div className="dsh-codebuddy-token-panel-lead">
          <div className="dsh-codebuddy-panel-section-title"><strong>{title}</strong>{hint !== undefined && hint.length > 0 ? <span>{hint}</span> : null}</div>
        </div>
        <div className="dsh-codebuddy-token-panel-actions">
          <RangeToggle
            options={options}
            range={range}
            onChange={onRangeChange}
            label={t('tokenRangeLabel')}
            format={(key) => rangeLabelOf(key, t)}
          />
          <DshIconButton size="small" theme="borderless" type="tertiary" icon={<DshIconRefresh />} loading={loading} aria-label={refreshLabel} onClick={onRefresh} />
        </div>
      </div>
      <PanelBody loading={loading}>{children}</PanelBody>
    </section>
  )
}

/**
 * Token 统计页：四个面板各用 `useTokenStats` 订阅同一 `TokenStatsStore`，
 * 按档位 / 日期**独立**持有状态。面板只表达「四个面板的合并视觉」，业务在
 * ui/* 与 hooks/* 中完成。
 */
function TokenStatsPage({ rpc, t }: { rpc: ConnectionRpc, t: Translate }): ReactNode {
  const [overviewRange, setOverviewRange] = useState<TokenRangeKey>(DEFAULT_TOKEN_RANGE)
  // 趋势模块没有「今天」档（按钮组 = 7d/30d/90d），默认挑一个真实可选的档（7d），
  // 避免首次进入时按钮组全灭、没有任何高亮项。
  const [trendRange, setTrendRange] = useState<TokenRangeKey>(DEFAULT_TREND_RANGE)
  const [distributionRange, setDistributionRange] = useState<TokenRangeKey>(DEFAULT_TOKEN_RANGE)
  const [sessionsRange, setSessionsRange] = useState<TokenRangeKey>(DEFAULT_TOKEN_RANGE)
  const [distributionDimension, setDistributionDimension] = useState<StatsDimension>('workspace')
  const store = useMemo(() => new TokenStatsStore(rpc), [rpc])
  const overview = useTokenStats(store, overviewRange)
  const trend = useTokenStats(store, trendRange)
  const distribution = useTokenStats(store, distributionRange)
  const sessions = useTokenStats(store, sessionsRange)

  // 刷新失败必须说出来——reload 刻意保留旧数据，失败时界面像「什么都没发生」。
  const panels = [overview, trend, distribution, sessions]
  const failureSignature = panels.map(panel => panel.error ?? '').join('|')
  const lastFailure = useRef('')
  useEffect(() => {
    if (failureSignature.replace(/\|/g, '') === '') return
    if (lastFailure.current === failureSignature) return
    lastFailure.current = failureSignature
    DshToast.warning({ content: t('tokenRefreshFailed') })
  }, [failureSignature, t])

  // 粘住最后一次有效数据：整页只在「从未有过任何数据」时才占位。
  const lastData = useRef<TokenStats | undefined>(undefined)
  if (overview.data !== undefined) lastData.current = overview.data
  const data = overview.data ?? lastData.current

  if (data === undefined && overview.initialLoading) return <PageLoading variant="tokens" />
  if (data === undefined) {
    return <div className="dsh-codebuddy-panel-page"><DshEmpty title={t('usageUnavailable')} /></div>
  }

  const hasAnyActivity = data.activity.some(item => item.calls > 0)
  if (!hasAnyActivity) {
    return (
      <div className="dsh-codebuddy-panel-page dsh-codebuddy-panel-tokens">
        <DshCard className="dsh-codebuddy-token-empty-card">
          <DshEmpty
            image={<CodeBuddyLogo size={64} />}
            title={t('tokenNoDataTitle')}
            description={t('tokenNoDataDesc')}
          >
            <div className="dsh-codebuddy-token-empty-action">
              <DshButton type="primary" theme="light" icon={<DshIconRefresh />} loading={overview.loading} onClick={overview.reload}>{t('refresh')}</DshButton>
            </div>
          </DshEmpty>
        </DshCard>
      </div>
    )
  }

  const cacheRateOf = (value: TokenStats): string => value.totals.cacheHitRate === undefined
    ? '—'
    : `${Math.round(value.totals.cacheHitRate * 100)}%`
  const SERIES = {
    input: 'var(--dcb-series-input)',
    output: 'var(--dcb-series-output)',
    cacheRead: 'var(--dcb-series-cache-read)',
  } as const
  const rangeFormat = (key: TokenRangeKey): string => rangeLabelOf(key, t)
  const refreshPanel = t('tokenRefreshPanel')
  return (
    <div className="dsh-codebuddy-panel-page dsh-codebuddy-panel-tokens">
      <div className="dsh-codebuddy-token-toolbar">
        <p className="dsh-codebuddy-token-updated">{`${t('tokenUpdatedAt')}${formatUpdatedAt(data.generatedAt)}`}</p>
      </div>
      <TokenPanel
        title={t('tokenTotal')}
        hint={`${data.totals.sessions} ${t('tokenActiveSessions')}`}
        options={optionsFor('overview')}
        range={overviewRange}
        onRangeChange={setOverviewRange}
        refreshLabel={refreshPanel}
        loading={overview.loading}
        t={t}
        onRefresh={overview.reload}
      >
        <DshCard className="dsh-codebuddy-token-overview-card">
          {overview.data === undefined ? <div className="dsh-codebuddy-token-overview-pending" />
            : (
              <>
                <div className="dsh-codebuddy-token-overview-head">
                  <div>
                    <span>{t('tokenTotal')}</span>
                    <strong>{compact(overview.data.totals.total)}</strong>
                  </div>
                  <DshTag color="green" type="light">{rangeFormat(overviewRange)}</DshTag>
                </div>
                <SegmentBar segments={[
                  { label: t('tokenInput'), value: overview.data.totals.input, color: SERIES.input },
                  { label: t('tokenOutput'), value: overview.data.totals.output, color: SERIES.output },
                  { label: t('tokenCacheRead'), value: overview.data.totals.read, color: SERIES.cacheRead },
                ]} />
                <div className="dsh-codebuddy-token-overview-stats">
                  <StatMetric icon={<DshIconArrowLeft />} label={t('tokenInput')} value={compact(overview.data.totals.input)} />
                  <StatMetric icon={<DshIconCommand />} label={t('tokenOutput')} value={compact(overview.data.totals.output)} />
                  <StatMetric icon={<DshIconElementStroked />} label={t('tokenCacheRate')} value={cacheRateOf(overview.data)} />
                  <StatMetric icon={<DshIconElementStroked />} label={t('tokenRecords')} value={compact(overview.data.totals.records)} />
                </div>
              </>
            )}
        </DshCard>
      </TokenPanel>
      <section className="dsh-codebuddy-token-section">
        <div className="dsh-codebuddy-panel-section-title"><strong>{t('tokenActivity')}</strong><span>{t('tokenDaily')}</span></div>
        <DshCard className="dsh-codebuddy-token-activity-card">
          <div className="dsh-codebuddy-token-activity-meta"><span>{t('tokenActivityRange')}</span><span>{compact(data.totals.records)} {t('tokenRecords')}</span></div>
          <ActivityGrid activity={data.activity} callSuffix={t('tokenCallSuffix')} />
          <div className="dsh-codebuddy-token-activity-scale"><span>少</span><i className="level-1" /><i className="level-2" /><i className="level-3" /><i className="level-4" /><span>多</span></div>
        </DshCard>
      </section>
      <TokenPanel
        title={t('tokenTrend')}
        hint={trend.data === undefined ? '' : `${compact(trend.data.totals.total)} Token`}
        options={optionsFor('trend')}
        range={trendRange}
        onRangeChange={setTrendRange}
        refreshLabel={refreshPanel}
        loading={trend.loading}
        t={t}
        onRefresh={trend.reload}
      >
        <DshCard className="dsh-codebuddy-panel-chart-card">
          {trend.data === undefined
            ? <div className="dsh-codebuddy-panel-chart" />
            : <TokenUsageChart days={trend.data.days} inputLabel={t('tokenInput')} outputLabel={t('tokenOutput')} cacheReadLabel={t('tokenCacheRead')} recordsLabel={t('tokenRecords')} />}
        </DshCard>
      </TokenPanel>
      <TokenPanel
        title={t('tokenDistribution')}
        options={optionsFor('other')}
        range={distributionRange}
        onRangeChange={setDistributionRange}
        refreshLabel={refreshPanel}
        loading={distribution.loading}
        t={t}
        onRefresh={distribution.reload}
      >
        <DshCard className="dsh-codebuddy-token-list-card">
          {/* 维度切换放在**排行卡片内部**：它切换的是这份列表的统计口径，与列表
              是同一个整体；放在面板头部（与时间档同排）会显得像在控制整个面板。 */}
          <div className="dsh-codebuddy-token-card-toolbar">
            <DimensionToggle dimension={distributionDimension} onChange={setDistributionDimension} t={t} />
          </div>
          {distribution.data === undefined
            ? <div className="dsh-codebuddy-token-empty" />
            : distributionDimension === 'workspace'
              ? <WorkspaceList items={distribution.data.workspaces} empty={t('tokenNoWorkspace')} />
              : <BreakdownList items={distribution.data.models} empty={t('tokenNoModel')} />}
        </DshCard>
      </TokenPanel>
      <TokenPanel
        title={t('tokenTopSessions')}
        hint={t('tokenTopTen')}
        options={optionsFor('other')}
        range={sessionsRange}
        onRangeChange={setSessionsRange}
        refreshLabel={refreshPanel}
        loading={sessions.loading}
        t={t}
        onRefresh={sessions.reload}
      >
        <DshCard className="dsh-codebuddy-token-list-card">
          {sessions.data === undefined
            ? <div className="dsh-codebuddy-token-empty" />
            : (
              <SessionRanking
                items={sessions.data.sessions}
                empty={t('tokenNoSession')}
                untitled={t('tokenSessionUntitled')}
                noWorkspace={t('tokenNoWorkspaceName')}
                callSuffix={t('tokenCallSuffix')}
              />
            )}
        </DshCard>
      </TokenPanel>
    </div>
  )
}

/** PanelBody 等价物。 */
function SegmentBar({ segments }: { segments: Array<{ label: string, value: number, color: string }> }): ReactNode {
  // 占比最大的排在最左边：真实数据里缓存读常占 95% 以上，若它排在中间视觉重心
  // 会偏；降序后主项紧贴阅读起点，一眼可辨（相等时保持原序，避免刷新时抖动）。
  // 排序同时作用于条形与图例，两处顺序才会一致。
  const ordered = sortSegmentsByValueDesc(segments)
  const total = ordered.reduce((sum, segment) => sum + Math.max(0, segment.value), 0)
  return (
    <div className="dsh-codebuddy-panel-segment-wrap">
      <div className="dsh-codebuddy-panel-segment-bar" role="img" aria-label={ordered.map(segment => `${segment.label} ${compact(segment.value)}`).join('，')}>
        {ordered.map(segment => (
          <DshTooltip key={segment.label} content={`${segment.label}: ${compact(segment.value)}`}>
            <span
              className="dsh-codebuddy-panel-segment-slice"
              style={{
                flexGrow: total > 0 ? Math.max(0, segment.value) : 0,
                background: segment.color,
              }}
            />
          </DshTooltip>
        ))}
      </div>
      <div className="dsh-codebuddy-panel-segment-legend">
        {ordered.map(segment => <span key={segment.label}><i style={{ background: segment.color }} />{segment.label}</span>)}
      </div>
    </div>
  )
}

/**
 * 插件详情页区块：账号管理与 Token 统计。
 *
 * 原先是全页面管理面板——`shell.overlay` 常驻 + `#/codebuddy/*` hash 路由 +
 * 左侧 `DshNav` 导航 + 左上返回按钮。现在两块内容**直接内联**在插件管理页的
 * CodeBuddy 组合包详情页里，因此：
 *
 *  - 没有 hash 归属匹配（`panel-route.ts` 已删除），也没有面包屑与返回按钮；
 *    详情页自己画标题；
 *  - 没有侧边导航：两块内容纵向分区依次呈现；Token 统计较长，故可折叠；
 *  - **没有 keep-alive**：详情页切走即卸载（原面板是"关闭仅 return null、
 *    组件不卸载"）。跨挂载要保留的状态都在模块级持久化 store 里
 *    （`usage-prefs`、`growth-run`、`token-stats`、`account-epoch`），由
 *    `useStore`/`useSyncExternalStore` 驱动，重挂载后自然恢复。
 *
 * 保留项与迁移前一致：积分总览、账号卡片（含签到与旅行状态）、三个自动开关、
 * 完成任务与一键完成、执行日志抽屉、Token 各图表。
 */
/**
 * 详情页区块的**座位入口**：先按 subject 过滤，再渲染真正的内容。
 *
 * 为什么挂在 `plugins.detail.section` 而不是 `plugins.bundle.config`：上游
 * `PackageDetail` 的固定顺序是
 *
 *   1. `plugins.bundle.config`——我们的配置区
 *   2. 「包含的组件」（`RowsSection`，即插件自己那一行）
 *   3. `plugins.detail.section`——本座位
 *
 * 也就是说 `bundle.config` **永远**在「包含的组件」之前，插件无法用它把内容
 * 放到组件列表下方。需求要的顺序是「包含的组件 → 设置字段 → 账号管理 →
 * Token 统计」，只有 `detail.section` 能满足。
 *
 * 该座位是 **list**（不是 keyed）：页面会给打开的任何详情页都渲染它，因此必须
 * 自己判断 subject——不是本插件的组合包就返回 `null`，否则这段界面会出现在
 * 别的插件页面上。
 */
export function CodeBuddyDetailSection({ rpc, t, subject }: CodeBuddyDetailSubjectProps): ReactNode {
  if (subject === undefined) return null
  if (subject.kind !== 'bundle') return null
  if (subject.pkg?.name !== CODEBUDDY_PACKAGE_NAME) return null
  return <CodeBuddyDetailContent rpc={rpc} t={t} />
}

/** 本插件在插件管理页里的组合包名（与 package.json 的 name 一致）。 */
export const CODEBUDDY_PACKAGE_NAME = '@tnnevol/dsh-codebuddy'

function CodeBuddyDetailContent({ rpc, t }: CodeBuddyDetailProps): ReactNode {
  const notify = useCallback((ok: boolean, text: string) => {
    if (ok) DshToast.success({ content: text })
    else DshToast.warning({ content: text })
  }, [])
  const [deleteTarget, setDeleteTarget] = useState<PanelAccountRow | undefined>(undefined)
  const [renaming, setRenaming] = useState<PanelAccountRow | undefined>(undefined)
  const [renameNote, setRenameNote] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [loginWaiting, setLoginWaiting] = useState(false)
  const [rosterTick, setRosterTick] = useState(0)
  /** 让账号列表重取。useCallback 使引用稳定——它被 login 轮询的 effect 依赖，
   *  每次渲染换新函数会让那个 effect 反复重启轮询。 */
  const bumpRoster = useCallback((): void => { setRosterTick(v => v + 1) }, [])

  const doRename = async (): Promise<void> => {
    const target = renaming
    if (target === undefined) return
    setRenaming(undefined)
    const result = await rpc.call<AccountsResult>(CODEBUDDY_AUTH_CHANNEL, 'renameLabel', { id: target.id, label: renameNote })
    if (result.ok) { notify(true, t('renameDone')); bumpRoster() }
    else { notify(false, describeRpcError(result)) }
  }
  const openRename = (row: PanelAccountRow): void => { setRenaming(row); setRenameNote(row.nickname) }
  const openDelete = (row: PanelAccountRow): void => { setDeleteTarget(row) }
  const confirmDelete = async (): Promise<void> => {
    const target = deleteTarget
    setDeleteTarget(undefined)
    if (target === undefined) return
    const result = await rpc.call<AccountsResult>(CODEBUDDY_AUTH_CHANNEL, 'removeAccount', { id: target.id })
    if (result.ok) {
      forgetResources(target.id)
      notify(true, t('accountRemoved'))
      bumpRoster()
    } else { notify(false, describeRpcError(result)) }
  }

  /**
   * 弹框已发起登录：打开浏览器，并把「登录中」反映到本页（禁用添加按钮）。
   *
   * 轮询与结果提示都归弹框所有——它才知道这次登录是从它发起的，也只有它能在
   * 成功后关闭自己。这里不再重复轮询同一个 state：两处同时轮询会对
   * `pollLogin` 发双份请求，且两边各自判定落定、提示会出现两次。
   */
  const onAddLoginStart = useCallback((start: { authUrl: string, state: string }) => {
    // Desktop 的 Electron 壳对 http/https 调 `shell.openExternal` 后返回 deny，
    // `window.open` 于是得到 `null`——那是「已外部打开」，不是「被拦截」；
    // 返回值判定收在 `openAuthUrl` 内部，调用点不自行解读。
    openAuthUrl(start.authUrl)
    setLoginWaiting(true)
  }, [])
  /** 弹框侧登录落定：成功则刷新名册；提示已由弹框给出，这里不再重复。 */
  const onAddFinished = useCallback((ok: boolean) => {
    setLoginWaiting(false)
    if (ok) bumpRoster()
  }, [bumpRoster])

  return (
    <div className="dsh-codebuddy-detail">
      {/* 顺序：账号管理 → Token 统计。
          原先顶部还有一个独立的偏好区块（切换阈值 / 显示额度余量）；两者已随
          三个自动开关一起收进账号区块头的齿轮浮层——把持久化策略集中到一处，
          也让「自动切换」与它的阈值重新相邻（它们本就是同一个策略的两半）。 */}
      <section className="dsh-codebuddy-detail-section" aria-label={t('accountsTitle')}>
        <AccountsPage
          rpc={rpc}
          t={t}
          notify={notify}
          rosterTick={rosterTick}
          loginWaiting={loginWaiting}
          onRename={openRename}
          onDelete={openDelete}
          onAddAccount={() => { setAddOpen(true) }}
          onCheckinChange={bumpRoster}
        />
      </section>

      {/* Token 统计面板较多，默认展开但可折叠：详情页是纵向长列，读者常只需
          其一看。用原生 `<details>` 而不是受控 state —— 折叠是纯展示偏好，
          不需要跨挂载保留，也不该参与任何数据流。 */}
      <section className="dsh-codebuddy-detail-section" aria-label={t('tokenTitle')}>
        <details className="dsh-codebuddy-detail-collapse" open>
          <summary className="dsh-codebuddy-detail-summary">{t('tokenTitle')}</summary>
          <TokenStatsPage rpc={rpc} t={t} />
        </details>
      </section>

      <AddAccountModal
        rpc={rpc}
        t={t}
        visible={addOpen}
        onLoginStart={onAddLoginStart}
        onFinished={onAddFinished}
        onCancel={() => { setAddOpen(false) }}
      />

      <DshModal
        title={t('accountRemove')}
        visible={deleteTarget !== undefined}
        okText={t('accountRemove')}
        cancelText={t('cancel')}
        okButtonProps={{ type: 'danger', theme: 'solid' }}
        onCancel={() => { setDeleteTarget(undefined) }}
        onOk={() => { void confirmDelete() }}
      >
        <p>{t('accountRemoveConfirm')}</p>
      </DshModal>

      <DshModal
        title={t('renameLabel')}
        visible={renaming !== undefined}
        okText={t('confirm')}
        cancelText={t('cancel')}
        onCancel={() => { setRenaming(undefined) }}
        onOk={() => { void doRename() }}
      >
        <DshInput
          className="dsh-codebuddy-pref-control-wide"
          value={renameNote}
          onChange={setRenameNote}
          placeholder={t('labelPlaceholder')}
          showClear
          maxLength={30}
        />
      </DshModal>
    </div>
  )
}
