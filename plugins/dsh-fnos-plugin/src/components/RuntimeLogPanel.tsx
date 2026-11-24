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

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { DshButton, DshIconFolder, DshInput, DshInputNumber, DshSelect } from '@tnnevol/dsh-semi-ui'
import type { FnosLocaleKey } from '../client/locales.ts'
import { fetchRuntimeLogs } from '../client/services/runtime-status-client.ts'
import { openFnosFileManager } from '../client/services/file-manager.ts'
import { hasFnosHostBridge } from '../client/services/environment.ts'
import { createTrimApp } from '../client/services/sdk.ts'
import { RUNTIME_LOG_DEFAULT_LIMIT, RUNTIME_LOG_MAX_LIMIT, type RuntimeLogEntry, type RuntimeLogLevel } from '../contracts/runtime-status-contract.ts'
import { VariableSizeList } from 'react-window'
import dayjs from 'dayjs'

type Translate = (key: FnosLocaleKey) => string

/** 组件参数。 */
export interface RuntimeLogPanelProps {
  readonly t: Translate
}

/** 默认条数；用户可用输入框改。上限与服务端共用同一个契约常量。 */
const DEFAULT_LIMIT = RUNTIME_LOG_DEFAULT_LIMIT

/** 轮询间隔：日志要「接近实时」，但不必每秒；与运行页统一为 5 秒。 */
const INTERVAL_MS = 5000

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
    **搜索范围。**

    `memory` 只查内存环形缓冲（200 条，重启即失）；`files` 连磁盘上按大小轮转的
    历史 `.log` 一起查。用户搜「上周那次安装为什么失败」时必须选后者——只查内存
    等于永远搜不到。
  */
  const [scope, setScope] = useState<'memory' | 'files'>('memory')
  const [limit, setLimit] = useState(DEFAULT_LIMIT)
  /** 日志落盘目录；宿主未接上时为空，按钮不渲染。 */
  const [logDirectory, setLogDirectory] = useState<string>()
  const [error, setError] = useState<string>()
  const listRef = useRef<HTMLDivElement>(null)
  /** 用户是否停在顶部：只在「看最新」时自动跟随，避免打断向上翻阅。 */
  const followRef = useRef(true)

  /** 拉一次日志。 */
  const load = useCallback(async () => {
    try {
      const snapshot = await fetchRuntimeLogs({ limit, level, query, scope })
      setEntries(snapshot.entries)
      setLogDirectory(snapshot.logDirectory)
      setError(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [limit, level, query, scope])

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
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [logDirectory])

  useEffect(() => {
    void load()
    const timer = setInterval(() => { void load() }, INTERVAL_MS)
    return () => { clearInterval(timer) }
  }, [load])

  /*
    **虚拟化列表的行高测量。**

    `VariableSizeList` 需要在行渲染后拿到真实高度，否则滚动条长度与位置都是错的。
    这里把每行的高度按 key 缓存，并在内容变化时清空缓存——同一条日志的正文不会变，
    但筛选后 key 集合会变。
  */
  const rowHeights = useRef(new Map<number, number>())
  const virtualRef = useRef<VariableSizeList>(null)
  /** 当前已渲染的行节点，按索引存；布局副作用读它们量真实高度。 */
  const rowRefs = useRef(new Map<number, HTMLDivElement>())

  /*
    **渲染后统一量高度。**

    逐个在 ref 回调里量不可靠：那时样式与字体可能还没稳定，量出来偏小；而且每行
    都触发一次 `resetAfterIndex` 会让列表反复重排。

    这里在每次渲染提交后扫一遍已挂载的行，只对**高度发生变化**的行回报——正常滚动
    时没有变化，不会有多余重排。
  */
  useLayoutEffect(() => {
    let changed = false
    for (const [index, node] of rowRefs.current) {
      const key = entries[index]?.seq ?? index
      const height = node.getBoundingClientRect().height
      if (height <= 0) continue
      if (rowHeights.current.get(key) === height) continue
      rowHeights.current.set(key, height)
      changed = true
    }
    if (changed) virtualRef.current?.resetAfterIndex(0, true)
  })

  const setRowHeight = useCallback((index: number, size: number): void => {
    const key = entries[index]?.seq ?? index
    if (rowHeights.current.get(key) === size) return
    rowHeights.current.set(key, size)
    /*
      **必须让列表重算这一行之后的全部偏移。**

      `VariableSizeList` 按 `rowHeight(index)` 决定每行的 `translateY`。测量偏小
      时（估算值 40 < 实际 60），下一行仍按旧值定位，于是被上一行的内容压住——
      截图中「200」与「(7ms)」叠在一起正是这个现象。

      `resetAfterIndex` 让它用新高度重算后续偏移。
    */
    virtualRef.current?.resetAfterIndex(index, true)
  }, [entries])

  const rowHeight = useCallback((index: number): number => {
    const key = entries[index]?.seq ?? index
    /* 未测量的行先按两行高度估算，量完会立刻纠正。 */
    return rowHeights.current.get(key) ?? 40
  }, [entries])

  /**
   * 列表可视高度。
   *
   * **要扣掉容器的上下 padding。** `clientHeight` 含内距，而传给
   * `VariableSizeList` 的 `height` 是内容区高度——不扣的话列表比可视区高 16px，
   * 最后一行会压到容器的下边框上。
   */
  const [listHeight, setListHeight] = useState(320)
  /** 列表内容宽度（已扣左右内距），`VariableSizeList` 需要像素值而非百分比。 */
  const [listWidth, setListWidth] = useState(0)
  useEffect(() => {
    const el = listRef.current
    if (el === null) return undefined
    const measure = (): void => {
      const cs = getComputedStyle(el)
      const padY = Number.parseFloat(cs.paddingTop) + Number.parseFloat(cs.paddingBottom)
      const padX = Number.parseFloat(cs.paddingLeft) + Number.parseFloat(cs.paddingRight)
      setListHeight(Math.max(0, el.clientHeight - padY))
      /* 宽度同理：传进去的必须是内容区像素值。 */
      setListWidth(Math.max(0, el.clientWidth - padX))
    }
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    measure()
    return () => { observer.disconnect() }
  }, [entries.length === 0])

  /** 新日志到达时，若用户仍在顶部就滚到顶（最新的在最上面）。 */
  useEffect(() => {
    if (followRef.current) virtualRef.current?.scrollToItem(0, 'start')
  }, [entries])

  const renderRow = useCallback(({ index, style }: { index: number, style: React.CSSProperties }) => {
    const entry = entries[index]
    if (entry === undefined) return null
    return (
      <div
        style={style}
        /*
          **量高度放在 `useLayoutEffect` 里，不放 ref 回调。**

          ref 回调在 React 提交阶段同步执行，此时样式与字体可能还没稳定，量出来的
          高度会偏小；用布局副作用能等到 DOM 与样式都就位之后再量。

          `overflow: hidden` 兜底：万一某次测量滞后，内容也被裁在自己这一行内，
          不会压到下一行上。
        */
        ref={(node) => {
          if (node === null) rowRefs.current.delete(index)
          else rowRefs.current.set(index, node)
        }}
        data-row-index={index}
      >
        <div className={`dsh-fnos-logs-line dsh-fnos-logs-line--${entry.level}`}>
          <span className="dsh-fnos-logs-time">{clock(entry.at)}</span>
          <span className="dsh-fnos-logs-badge">{t(levelKey(entry.level))}</span>
          <span className="dsh-fnos-logs-name">{entry.name}</span>
          <span className="dsh-fnos-logs-text">{entry.text}</span>
        </div>
      </div>
    )
  }, [entries, setRowHeight, t])

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
          搜索范围：内存 / 含磁盘历史。

          放成独立下拉而不是塞进搜索框的占位文案里——用户需要**看见**当前范围，
          否则搜不到旧日志时会以为功能坏了。
        */}
        <DshSelect
          className="dsh-fnos-logs-scope"
          size="small"
          value={scope}
          onChange={(value: string | number | (string | number)[]) => { setScope(value as 'memory' | 'files') }}
          optionList={[
            { value: 'memory', label: t('runtimeLogScopeMemory'), showTick: false },
            { value: 'files', label: t('runtimeLogScopeFiles'), showTick: false },
          ]}
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

      {error === undefined ? null : (
        <p className="dsh-fnos-repair-error" role="alert">{`${t('runtimeLogFailed')}${error}`}</p>
      )}

      {/*
        **日志主体做虚拟化。**

        条数上限 2000；不虚拟化就是 2000 个 DOM 节点常驻，展开面板时浏览器要一次性
        布局完，滚动会明显掉帧，内存也随重渲染累积。虚拟化只渲染可视区加少量缓冲。

        行高**不固定**（正文会折行），所以用 `VariableSizeList`：每行首次渲染后量出
        实际高度并缓存，滚动到未测量的行时先按估算值占位。
      */}
      <div className="dsh-fnos-logs-body">
        {entries.length === 0 ? (
          <p className="dsh-fnos-repair-muted">{t('runtimeLogEmpty')}</p>
        ) : (
          <div ref={listRef} className="dsh-fnos-logs-list" role="log" aria-live="polite">
            <VariableSizeList
              height={listHeight}
              width={listWidth}
              itemCount={entries.length}
              itemSize={rowHeight}
              itemKey={(index: number) => entries[index]?.seq ?? index}
              overscanCount={8}
            >
              {renderRow}
            </VariableSizeList>
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
