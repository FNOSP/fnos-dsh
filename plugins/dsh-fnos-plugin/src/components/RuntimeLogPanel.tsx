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
import { DshSelect } from '@tnnevol/dsh-semi-ui'
import type { FnosLocaleKey } from '../client/locales.ts'
import { fetchRuntimeLogs } from '../client/services/runtime-status-client.ts'
import type { RuntimeLogEntry, RuntimeLogLevel } from '../contracts/runtime-status-contract.ts'

type Translate = (key: FnosLocaleKey) => string

/** 组件参数。 */
export interface RuntimeLogPanelProps {
  readonly t: Translate
}

/** 默认条数；用户可用输入框改。 */
const DEFAULT_LIMIT = 200

/** 轮询间隔：日志要「接近实时」，但不必每秒。 */
const INTERVAL_MS = 2000

/** 级别选项与配色。 */
const LEVELS: readonly { value: 'all' | RuntimeLogLevel, labelKey: FnosLocaleKey }[] = [
  { value: 'all', labelKey: 'runtimeLogAll' },
  { value: 'error', labelKey: 'runtimeLogError' },
  { value: 'warn', labelKey: 'runtimeLogWarn' },
  { value: 'info', labelKey: 'runtimeLogInfo' },
  { value: 'debug', labelKey: 'runtimeLogDebug' },
]

/** 时刻格式：只到秒，日志不需要毫秒。 */
function clock(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour12: false })
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
          optionList={LEVELS.map(item => ({ value: item.value, label: t(item.labelKey) }))}
        />
        <input
          className="dsh-fnos-logs-search"
          type="search"
          value={query}
          placeholder={t('runtimeLogSearch')}
          onChange={event => { setQuery(event.target.value) }}
        />
        <label className="dsh-fnos-logs-limit">
          <span>{t('runtimeLogLimit')}</span>
          <input
            type="number"
            min={1}
            max={2000}
            value={limit}
            onChange={event => {
              const next = Number(event.target.value)
              // 非法值不写回，避免输入过程中把列表清空。
              if (Number.isFinite(next) && next > 0) setLimit(Math.min(next, 2000))
            }}
          />
        </label>
        <span className="dsh-fnos-logs-count">{`${String(entries.length)} / ${String(total)}`}</span>
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
