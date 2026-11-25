/**
 * 日志面板：级别筛选 + 搜索 + 级别配色，占满弹框剩余高度。
 *
 * ## 为什么不用现成的日志组件
 *
 * 查过本仓库的 Semi 封装（`@tnnevol/dsh-semi-ui`）：有 `DshTable`、`DshList`、
 * `DshSelect`、`DshInput`，**没有日志/终端类组件**。Semi 官方也不提供
 * 「log viewer」，第三方（如 `react-logviewer`、`ansi-to-react`）要再引入一个
 * 运行时依赖，而这份日志是纯文本 + 级别，自己排 40 行 CSS 就够——为它多背一个包
 * 不划算。
 *
 * ## 为什么占满剩余空间
 *
 * 日志的价值密度高、行数多，弹框里其它分组是表单（有固定高度），日志应该把
 * 剩下的高度全部吃掉。这里用 `flex: 1 1 auto` + 内部滚动，父级只需是 flex 列。
 *
 * @module dsh-fnos/components/RuntimeLogPanel
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { DshButton, DshIconFolder, DshInput, DshInputNumber, DshSelect } from '@tnnevol/dsh-semi-ui'
import type { FnosLocaleKey } from '../client/locales.ts'
import { fetchRuntimeLogs } from '../client/services/runtime-status-client.ts'
import { notifyFailure } from '../client/notify.ts'
import { openFnosFileManager } from '../client/services/file-manager.ts'
import { hasFnosHostBridge } from '../client/services/environment.ts'
import { createTrimApp } from '../client/services/sdk.ts'
import { RUNTIME_LOG_DEFAULT_LIMIT, RUNTIME_LOG_MAX_LIMIT, type RuntimeLogEntry, type RuntimeLogLevel } from '../contracts/runtime-status-contract.ts'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import dayjs from 'dayjs'

type Translate = (key: FnosLocaleKey) => string

/** 组件参数。 */
export interface RuntimeLogPanelProps {
  readonly t: Translate
}

/** 默认条数；用户可用输入框改。上限与服务端共用同一个契约常量。 */
const DEFAULT_LIMIT = RUNTIME_LOG_DEFAULT_LIMIT

/**
 * 可选的刷新间隔（秒）。
 *
 * `0` 表示不刷新——看历史日志时页面不该自己跳，否则用户刚滚到的位置会被新内容
 * 顶走。默认 5 秒：够「接近实时」，又不至于每秒打一次宿主。
 */
const REFRESH_OPTIONS: readonly number[] = [0, 5, 10, 30, 60]

/** 级别选项与配色。 */
const LEVELS: readonly { value: 'all' | RuntimeLogLevel, labelKey: FnosLocaleKey }[] = [
  { value: 'all', labelKey: 'runtimeLogAll' },
  { value: 'error', labelKey: 'runtimeLogError' },
  { value: 'warn', labelKey: 'runtimeLogWarn' },
  { value: 'info', labelKey: 'runtimeLogInfo' },
  { value: 'debug', labelKey: 'runtimeLogDebug' },
]

/**
 * 时间格式：完整的年月日时分秒，定长 19 字符。
 *
 * **不省略日期。** 日志跨重启、跨天都可能留着，只有 `HH:mm:ss` 时用户看不出
 * 某条是今天还是上周的——排查「刚才那次安装」时会把旧记录当成新的。
 *
 * 走 `dayjs` 而不是 `toLocaleTimeString`：后者依赖运行时的 locale 数据，不同
 * 浏览器/设备的补零与分隔符都可能不同，列宽随之跳动。
 */
function clock(at: number): string {
  return dayjs(at).format('YYYY-MM-DD HH:mm:ss')
}

/**
 * 日志面板。
 * @param props - 组合后的 props。
 * @param props.t - 翻译函数。
 * @returns 面板元素。
 */
export function RuntimeLogPanel({ t }: RuntimeLogPanelProps): React.ReactNode {
  const [entries, setEntries] = useState<readonly RuntimeLogEntry[]>([])
  const [level, setLevel] = useState<'all' | RuntimeLogLevel>('all')
  const [query, setQuery] = useState('')
  /*
    **搜索时自动带上历史文件，不设范围开关。**

    内存缓冲只有 200 条且重启即失；磁盘上的 `.log` 按大小轮转保留。用户输入关键词
    就是为了找「现在不在屏幕上的那条」——此时只查内存等于永远搜不到，还要他先选
    一个范围开关，纯属多一步。

    没有搜索词时不读文件：全量读 5 份 ≤10 MiB 的日志没有意义，首屏也不该等它。
  */
  const hasQuery = query.trim().length > 0
  /** 自动刷新间隔（秒）；`0` 表示关闭。 */
  const [refreshSeconds, setRefreshSeconds] = useState(5)
  const [limit, setLimit] = useState(DEFAULT_LIMIT)
  /** 日志落盘目录；宿主未接上时为空，按钮不渲染。 */
  const [logDirectory, setLogDirectory] = useState<string>()
  const listRef = useRef<HTMLDivElement>(null)
  /** 用户是否停在顶部：只在「看最新」时自动跟随，避免打断向上翻阅。 */
  const followRef = useRef(true)

  /** 拉一次日志。 */
  const load = useCallback(async () => {
    try {
      const snapshot = await fetchRuntimeLogs({
        limit, level, query,
        /* 有搜索词就连磁盘历史一起查。 */
        scope: hasQuery ? 'files' : 'memory',
      })
      setEntries(snapshot.entries)
      setLogDirectory(snapshot.logDirectory)
    } catch (cause) {
      /*
        **异常走 toast，不在内容区画一行红字。**

        那行红字会把日志列表往下顶、打断滚动位置；而轮询是 5 秒一次，网络抖一下
        就闪一行红字再消失，反而像页面坏了。日志中心本身就是「读不到时看哪里」的
        地方，不该自己也变成一片报错。
      */
      notifyFailure(`${t('runtimeLogFailed')}${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }, [limit, level, query, hasQuery, t])

  /**
   * 打开日志目录（fnOS 文件管理器）。
   *
   * ## 为什么只在 iframe 里显示
   *
   * 独立浏览器页面没有宿主桥，`openFileManager` 不可用。给一个点了没反应的
   * 按钮比不给更差，所以入口按宿主桥可用性直接不渲染。
   */
  const openLogDirectory = useCallback(async (): Promise<void> => {
    /* 按钮只在目录已知时渲染，这里再守一次是为了让类型收窄。 */
    if (logDirectory === undefined) return
    try {
      await openFnosFileManager(logDirectory, () => createTrimApp())
    } catch (cause) {
      /* 与上面同理：打开失败也用 toast，不占内容区。 */
      notifyFailure(cause instanceof Error ? cause.message : String(cause))
    }
  }, [logDirectory])

  useEffect(() => {
    void load()
    /*
      间隔变化时重建定时器。`refreshSeconds === 0` 时只加载一次、不排后续——
      「不刷新」是明确的选择，不该留着空转的定时器。
    */
    if (refreshSeconds === 0) return undefined
    const timer = setInterval(() => { void load() }, refreshSeconds * 1000)
    return () => { clearInterval(timer) }
  }, [load, refreshSeconds])

  /*
    **用 `Virtuoso`，不用 `react-window`。**

    日志正文折行后行高不定；`react-window` 的 `VariableSizeList` 要靠外部测量缓存 +
    `resetAfterIndex` 手工维护位置，测量滞后一次下一行就被压住——历史上反复出现的
    「文字叠在一起」都是这个来源。

    `Virtuoso` 内置 ResizeObserver 逐项测量、自动维护偏移，正是为动态高度设计的。
    无需 `itemSize`，也无需在渲染后回报高度。
  */
  const virtuosoRef = useRef<VirtuosoHandle>(null)

  /**
   * 列表可视高度。
   *
   * **要扣掉容器的上下 padding。** `clientHeight` 含内距，而传给
   * `FixedSizeList` 的 `height` 是内容区高度——不扣的话列表比可视区高 16px，
   * 最后一行会压到容器的下边框上。
   */
  const [listHeight, setListHeight] = useState(320)
  useEffect(() => {
    const el = listRef.current
    if (el === null) return undefined
    const measure = (): void => {
      const cs = getComputedStyle(el)
      const padY = Number.parseFloat(cs.paddingTop) + Number.parseFloat(cs.paddingBottom)
      setListHeight(Math.max(0, el.clientHeight - padY))
    }
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    measure()
    return () => { observer.disconnect() }
  }, [entries.length === 0])

  /** 新日志到达时，若用户仍在顶部就滚到顶（最新的在最上面）。 */
  useEffect(() => {
    if (followRef.current) virtuosoRef.current?.scrollToIndex({ index: 0, behavior: 'auto' })
  }, [entries])

  const renderRow = useCallback((index: number) => {
    const entry = entries[index]
    if (entry === undefined) return null
    return (
      <div>
        <div className={`dsh-fnos-logs-line dsh-fnos-logs-line--${entry.level}`}>
          <span className="dsh-fnos-logs-time">{clock(entry.at)}</span>
          <span className="dsh-fnos-logs-badge">{t(levelKey(entry.level))}</span>
          <span className="dsh-fnos-logs-name">{entry.name}</span>
          <span className="dsh-fnos-logs-text">{entry.text}</span>
        </div>
      </div>
    )
  }, [entries, t])

  return (
    <section className="dsh-fnos-logs">
      {/* 工具条：级别筛选 + 搜索 + 条数，一行放下，不再加说明文案。 */}
      <div className="dsh-fnos-logs-bar">
        <DshSelect
          className="dsh-fnos-logs-level"
          size="small"
          value={level}
          onChange={(value: string | number | (string | number)[]) => { setLevel(value as 'all' | RuntimeLogLevel) }}
          /*
            **`showTick: false`——选中项不显示勾。**

            Semi 的 Option 默认 `showTick: true`，会在**每一项**前面留一个勾位（选中
            的实心、未选中的留白占位）。截图里五个级别前面全是勾，看起来像「全部
            选中」。

            这里靠背景高亮 + 主色文字表达选中，不需要勾。
          */
          optionList={LEVELS.map(item => ({ value: item.value, label: t(item.labelKey), showTick: false }))}
        />
        {/*
          刷新间隔。`0` = 不刷新——看历史日志时页面不该自己跳，否则用户刚滚到的
          位置会被新内容顶走。
        */}
        <DshSelect
          className="dsh-fnos-logs-refresh"
          size="small"
          value={String(refreshSeconds)}
          onChange={(value: string | number | (string | number)[]) => { setRefreshSeconds(Number(value)) }}
          optionList={REFRESH_OPTIONS.map(seconds => ({
            value: String(seconds),
            label: seconds === 0 ? t('runtimeLogRefreshOff') : `${String(seconds)}s`,
            showTick: false,
          }))}
        />
        <DshInput
          className="dsh-fnos-logs-search"
          size="small"
          /* 与同一行的 Select 等高；Semi 的 Input 默认尺寸比 small Select 高。 */
          value={query}
          placeholder={t('runtimeLogSearch')}
          showClear
          onChange={(value: string) => { setQuery(value) }}
        />
        <label className="dsh-fnos-logs-limit">
          <span>{t('runtimeLogLimit')}</span>
          <DshInputNumber
            className="dsh-fnos-logs-limit-input"
            size="small"
            min={1}
            max={RUNTIME_LOG_MAX_LIMIT}
            value={limit}
            /* 不显示步进按钮：这一栏是「填个数字」，不是可微调的旋钮。 */
            hideButtons
            onChange={(value: number | string) => {
              const next = Number(value)
              // 非法值不写回，避免输入过程中把列表清空。
              if (Number.isFinite(next) && next > 0) setLimit(Math.min(next, RUNTIME_LOG_MAX_LIMIT))
            }}
          />
        </label>
        {/*
          「查看日志」：在 fnOS 文件管理器里定位到落盘目录。

          **只在 NAS 的 iframe 里显示。** 用 `environment.ts` 的 `hasFnosHostBridge`
          （纯 DOM 判据，等价于 `detectFnosEnvironment() === 'embedded'`），而不是
          `host-bridge.ts` 里那个同名的宽松版本——后者把 mobile / 原生宿主也算作
          「可用」，于是手机上也会冒出这个按钮，而那边的交互是文件管理器之外的
          另一套，定位到一个绝对路径没有意义。

          独立浏览器页面同样没有宿主桥：给一个点了没反应的按钮比不给更差。
        */}
        {/*
          **不加 tooltip。** 按钮本身就有文案，tooltip 显示的仍是同一句话——
          出现时只是把已有的字遮住再重复一遍。tooltip 只用于「图标按钮」这种
          没有可见文案、需要额外说明的场景。
        */}
        {!hasFnosHostBridge() || logDirectory === undefined ? null : (
          <DshButton
            htmlType="button"
            size="small"
            theme="borderless"
            type="tertiary"
            onClick={() => { void openLogDirectory() }}
          >
            <DshIconFolder />
            {t('runtimeLogOpenDirectory')}
          </DshButton>
        )}
      </div>

      {/*
        **日志主体做虚拟化。**

        条数上限 2000；不虚拟化就是 2000 个 DOM 节点常驻，展开面板时浏览器要一次性
        布局完，滚动会明显掉帧，内存也随重渲染累积。虚拟化只渲染可视区加少量缓冲。

        行高**固定**（正文单行省略），用 `FixedSizeList`——位置计算不依赖运行时测量。
      */}
      <div className="dsh-fnos-logs-body">
        {entries.length === 0 ? (
          <p className="dsh-fnos-repair-muted">{t('runtimeLogEmpty')}</p>
        ) : (
          <div ref={listRef} className="dsh-fnos-logs-list" role="log" aria-live="polite">
            <Virtuoso
              ref={virtuosoRef}
              style={{ height: listHeight }}
              data={entries}
              itemContent={(index) => renderRow(index)}
              increaseViewportBy={200}
              computeItemKey={(index) => entries[index]?.seq ?? index}
            />
          </div>
        )}
      </div>
    </section>
  )
}

/**
 * 级别 → 文案键。
 * @param level - 级别。
 * @returns 文案键。
 */
function levelKey(level: RuntimeLogLevel): FnosLocaleKey {
  if (level === 'error') return 'runtimeLogError'
  if (level === 'warn') return 'runtimeLogWarn'
  if (level === 'info') return 'runtimeLogInfo'
  return 'runtimeLogDebug'
}
