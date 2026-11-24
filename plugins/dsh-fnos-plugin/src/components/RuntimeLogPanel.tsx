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
import { DshInput, DshInputNumber, DshSelect } from '@tnnevol/dsh-semi-ui'
import type { FnosLocaleKey } from '../client/locales.ts'
import { fetchRuntimeLogs } from '../client/services/runtime-status-client.ts'
import type { RuntimeLogEntry, RuntimeLogLevel } from '../contracts/runtime-status-contract.ts'
import dayjs from 'dayjs'

type Translate = (key: FnosLocaleKey) => string

/** 组件参数。 */
export interface RuntimeLogPanelProps {
  readonly t: Translate
}

/** 默认条数；用户可用输入框改。 */
const DEFAULT_LIMIT = 200

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
  const [total, setTotal] = useState(0)
  const [level, setLevel] = useState<'all' | RuntimeLogLevel>('all')
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(DEFAULT_LIMIT)
  const [error, setError] = useState<string>()
  const listRef = useRef<HTMLDivElement>(null)
  /** 用户是否停在顶部：只在「看最新」时自动跟随，避免打断向上翻阅。 */
  const followRef = useRef(true)

  /** 拉一次日志。 */
  const load = useCallback(async () => {
    try {
      const snapshot = await fetchRuntimeLogs({ limit, level, query })
      setEntries(snapshot.entries)
      setTotal(snapshot.total)
      setError(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [limit, level, query])

  useEffect(() => {
    void load()
    const timer = setInterval(() => { void load() }, INTERVAL_MS)
    return () => { clearInterval(timer) }
  }, [load])

  /** 新日志到达时，若用户仍在顶部就滚到顶（最新的在最上面）。 */
  useEffect(() => {
    if (followRef.current && listRef.current !== null) listRef.current.scrollTop = 0
  }, [entries])

  const onScroll = (): void => {
    const el = listRef.current
    if (el === null) return
    followRef.current = el.scrollTop <= 4
  }

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
            max={2000}
            value={limit}
            /* 不显示步进按钮：这一栏是「填个数字」，不是可微调的旋钮。 */
            hideButtons
            onChange={(value: number | string) => {
              const next = Number(value)
              // 非法值不写回，避免输入过程中把列表清空。
              if (Number.isFinite(next) && next > 0) setLimit(Math.min(next, 2000))
            }}
          />
        </label>
        {/*
          **只有在「确实被截断」时才有信息量。**

          `total` 是过滤前的缓冲总数，`entries.length` 是本次返回的条数。缓冲没超过
          `limit` 时两者必然相等，显示「36 / 36」等于什么都没说——截图里就是这样。

          改成仅当 `entries.length < total`（被 limit 或过滤截断）时才显示，格式
          仍是「显示 N / 共 M」。
        */}
        {entries.length < total ? (
          <span className="dsh-fnos-logs-count">{`${String(entries.length)} / ${String(total)}`}</span>
        ) : null}
      </div>

      {error === undefined ? null : (
        <p className="dsh-fnos-repair-error" role="alert">{`${t('runtimeLogFailed')}${error}`}</p>
      )}

      {/* 日志主体：等宽字体、单行省略、按级别着色。 */}
      <div ref={listRef} className="dsh-fnos-logs-list" onScroll={onScroll} role="log" aria-live="polite">
        {entries.length === 0 ? (
          <p className="dsh-fnos-repair-muted">{t('runtimeLogEmpty')}</p>
        ) : (
          entries.map(entry => (
            <div key={entry.seq} className={`dsh-fnos-logs-line dsh-fnos-logs-line--${entry.level}`}>
              <span className="dsh-fnos-logs-time">{clock(entry.at)}</span>
              <span className="dsh-fnos-logs-badge">{t(levelKey(entry.level))}</span>
              <span className="dsh-fnos-logs-name">{entry.name}</span>
              <span className="dsh-fnos-logs-text">{entry.text}</span>
            </div>
          ))
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
