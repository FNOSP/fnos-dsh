/**
 * 「运行」卡片：端口 + 进程指标，用 ECharts 画成时序折线。
 *
 * ## 为什么用图表而不是文字
 *
 * 这一组数据的价值在**趋势**：CPU 是不是一直贴在 90%、内存有没有一路涨。
 * 排版成「CPU: 12.3%」这样的行，只能看到当下一个点，判断不了「正常还是异常」。
 * 折线把最近几十秒摊开，一眼能看出形状，反而比文字更快读懂。
 *
 * ## 为什么按需引入 echarts
 *
 * 全量 echarts 约 1MB，而这个卡片只用折线 + 提示框。`echarts/core` +
 * `LineChart` + canvas 渲染器是能画出同样效果的最小集合，打进插件包也只有
 * 一百多 KB。
 *
 * @module dsh-fnos/components/RuntimeStatusCard
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { DshIconInfoCircle, DshTooltip } from '@tnnevol/dsh-semi-ui'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
/*
  命名空间式导入：ECharts 的注册函数就叫 `use`，直接具名导入会被
  `react/rules-of-hooks` 当成 React Hook（"cannot be called at the top level"）。
  这是命名冲突而非真的 Hook 误用，用 `echartsCore.use(...)` 让 lint 无从误判。
*/
import * as echartsCore from 'echarts/core'
import type { ECharts } from 'echarts/core'
import type { FnosLocaleKey } from '../client/locales.ts'
import { fetchRuntimeStatus } from '../client/services/runtime-status-client.ts'
import type { RuntimeStatus } from '../contracts/runtime-status-contract.ts'
import { RuntimeProcessList } from './RuntimeProcessList.tsx'

echartsCore.use([LineChart, GridComponent, TooltipComponent, CanvasRenderer])

type Translate = (key: FnosLocaleKey) => string

/** 卡片参数。 */
export interface RuntimeStatusCardProps {
  readonly t: Translate
}

/** 折线保留的采样点数：约 60 秒（每秒一次）。 */
const POINTS = 60

/** 轮询间隔（毫秒）。 */
const INTERVAL_MS = 1000

/**
 * 一条指标的显示单位与换算。
 *
 * 换算放在这里而不是图表配置里：读数和坐标轴必须用同一个比例，否则轴上是 MB、
 * 提示框是字节，看起来像两个不同的量。
 */
interface Series {
  readonly key: 'cpu' | 'rss' | 'io' | 'net'
  readonly labelKey: FnosLocaleKey
  /** 数值换算（字节 → MB 等）。 */
  readonly scale: number
  readonly unit: string
}

const SERIES: readonly Series[] = [
  { key: 'cpu', labelKey: 'runtimeCpu', scale: 1, unit: '%' },
  { key: 'rss', labelKey: 'runtimeMemory', scale: 1024 * 1024, unit: 'MB' },
  { key: 'io', labelKey: 'runtimeDisk', scale: 1024 * 1024, unit: 'MB' },
  { key: 'net', labelKey: 'runtimeNetwork', scale: 1024 * 1024, unit: 'MB' },
]

/** 一帧采样。 */
interface Frame {
  readonly at: number
  readonly cpu?: number
  readonly rss: number
  /** 读写速率（字节/秒）；首帧无从求差，忽略。 */
  readonly io?: number
  /** 网络速率（字节/秒），收+发。 */
  readonly net?: number
}

/**
 * 把读数压成图表用的三组数列。
 * @param frames - 采样序列。
 * @returns 每条指标的数值数组。
 */
function toSeries(frames: readonly Frame[]): Record<Series['key'], (number | null)[]> {
  const pick = (key: Series['key'], scale: number): (number | null)[] => frames.map(f => {
    const raw = key === 'cpu' ? f.cpu : key === 'rss' ? f.rss : key === 'io' ? f.io : f.net
    if (raw === undefined) return null
    return Number((raw / scale).toFixed(2))
  })
  return {
    cpu: pick('cpu', 1),
    rss: pick('rss', 1024 * 1024),
    io: pick('io', 1024 * 1024),
    net: pick('net', 1024 * 1024),
  }
}

/**
 * 「运行」卡片。
 * @param props - 组合后的 props。
 * @param props.t - 翻译函数。
 * @returns 卡片元素。
 */
export function RuntimeStatusCard({ t }: RuntimeStatusCardProps): React.ReactNode {
  const [status, setStatus] = useState<RuntimeStatus>()
  const [frames, setFrames] = useState<readonly Frame[]>([])
  const [error, setError] = useState<string>()
  const hostRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<ECharts>()
  /** 上一帧的累计读写字节，用来求速率；跨渲染保留，所以放 ref。 */
  const lastIoRef = useRef<{ read: number, write: number, at: number }>()
  /** 上一帧的累计网络字节，同上。 */
  const lastNetRef = useRef<{ read: number, write: number, at: number }>()

  /** 轮询：每秒取一帧。 */
  const sample = useCallback(async () => {
    try {
      const next = await fetchRuntimeStatus()
      setStatus(next)
      setError(undefined)
      const m = next.metrics
      // 读写与网络都是**累计值**，画到图上必须换成每秒增量，否则是一条单调上升的
      // 斜线，看不出「此刻在不在动」。
      const io = m.diskReadBytes !== null && m.diskWriteBytes !== null
        ? { read: m.diskReadBytes, write: m.diskWriteBytes, at: m.at }
        : undefined
      const net = m.netRxBytes !== null && m.netTxBytes !== null
        ? { read: m.netRxBytes, write: m.netTxBytes, at: m.at }
        : undefined
      const rateOf = (cur: typeof io, prev: typeof io): number | undefined => {
        if (cur === undefined || prev === undefined) return undefined
        const elapsed = (cur.at - prev.at) / 1000
        if (elapsed <= 0) return undefined
        return Math.max(0, (cur.read - prev.read + cur.write - prev.write) / elapsed)
      }
      const rate = rateOf(io, lastIoRef.current)
      const netRate = rateOf(net, lastNetRef.current)
      if (io !== undefined) lastIoRef.current = io
      if (net !== undefined) lastNetRef.current = net
      setFrames(prev => [...prev, {
        at: m.at,
        ...(m.cpuPercent === undefined ? {} : { cpu: m.cpuPercent }),
        rss: m.rssBytes,
        ...(rate === undefined ? {} : { io: rate }),
        ...(netRate === undefined ? {} : { net: netRate }),
      }].slice(-POINTS))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  useEffect(() => {
    void sample()
    const timer = setInterval(() => { void sample() }, INTERVAL_MS)
    return () => { clearInterval(timer) }
  }, [sample])

  /** 建图 + 增量更新；只创建一次实例，避免每秒重建导致闪烁。 */
  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    const chart = echartsCore.init(host, undefined, { renderer: 'canvas' })
    chartRef.current = chart
    const onResize = (): void => { chart.resize() }
    globalThis.addEventListener('resize', onResize)
    return () => {
      globalThis.removeEventListener('resize', onResize)
      chart.dispose()
      chartRef.current = undefined
    }
  }, [])

  /** 数据变化时刷新图表。 */
  useEffect(() => {
    const chart = chartRef.current
    if (chart === undefined) return
    const data = toSeries(frames)
    const axis = frames.map(f => new Date(f.at).toLocaleTimeString(undefined, { minute: '2-digit', second: '2-digit' }))
    /*
      2×2 四宫格：每格一条曲线，共用同一条时间轴（各自持有 category 轴，数据相同）。

      用百分比定位而不是像素：容器宽度随弹框自适应，写死像素在窄屏上会溢出。
      每格给足 176×88，`containLabel` 让轴标签也算进可用区，标签不会被裁。
    */
    const cell = (i: number): { left: string, top: string, width: string, height: string } => ({
      left: i % 2 === 0 ? '4%' : '52%',
      top: Math.floor(i / 2) === 0 ? '10%' : '57%',
      width: '44%',
      height: '35%',
    })
    chart.setOption({
      animation: false,
      tooltip: { trigger: 'axis', confine: true },
      xAxis: SERIES.map((_, i) => ({
        type: 'category',
        gridIndex: i,
        data: axis,
        boundaryGap: false,
        showAxisLine: false,
        // 四格都显示时间：横轴是它们共有的参照，藏起来反而难以对照。
        axisLabel: { fontSize: 9, interval: Math.max(0, Math.floor(axis.length / 4) - 1) },
        axisTick: { show: false },
      })),
      yAxis: SERIES.map((s, i) => ({
        type: 'value',
        gridIndex: i,
        name: `${t(s.labelKey)}${s.unit === '%' ? '' : ` (${s.unit})`}`,
        nameTextStyle: { fontSize: 10, align: 'left', padding: [0, 0, 2, 0] },
        nameGap: 8,
        min: 0,
        axisLabel: { fontSize: 9 },
        splitNumber: 3,
        splitLine: { lineStyle: { color: 'rgba(0,0,0,0.06)' } },
      })),
      grid: SERIES.map((_, i) => ({ ...cell(i), containLabel: true })),
      series: SERIES.map((s, i) => ({
        type: 'line',
        xAxisIndex: i,
        yAxisIndex: i,
        data: data[s.key],
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 1.4 },
        areaStyle: { opacity: 0.12 },
        connectNulls: false,
      })),
    }, { notMerge: false })
  }, [frames, t])

  const latest = frames.at(-1)
  const cards: readonly { key: FnosLocaleKey, value: string }[] = [
    { key: 'runtimeCpu', value: latest?.cpu === undefined ? '—' : `${latest.cpu.toFixed(1)}%` },
    { key: 'runtimeMemory', value: `${((latest?.rss ?? 0) / 1024 / 1024).toFixed(0)} MB` },
    { key: 'runtimeDisk', value: latest?.io === undefined ? '—' : `${(latest.io / 1024 / 1024).toFixed(2)} MB/s` },
    { key: 'runtimeNetwork', value: latest?.net === undefined ? '—' : `${(latest.net / 1024 / 1024).toFixed(2)} MB/s` },
  ]

  return (
    <section className="dsh-fnos-runtime" aria-labelledby="dsh-fnos-runtime-title">
      <header className="dsh-fnos-authorized-card-header">
        <div className="dsh-fnos-authorized-card-head-text">
          <h3 id="dsh-fnos-runtime-title" className="dsh-fnos-authorized-card-name">
            {t('runtimeTitle')}
            <DshTooltip className="dsh-fnos-gateway-tip-content" content={t('runtimeTip')}>
              <span className="dsh-fnos-authorized-gateway-tip" tabIndex={0} aria-label={t('runtimeTip')}>
                <DshIconInfoCircle />
              </span>
            </DshTooltip>
          </h3>
        </div>
      </header>

      {/* 端口：两个数直接读，不做推断。缺省时说「未知」而不是编一个默认值。 */}
      <dl className="dsh-fnos-runtime-ports">
        <div>
          <dt>{t('runtimeWebPort')}</dt>
          <dd>{status?.ports.web === undefined ? '—' : String(status.ports.web)}</dd>
        </div>
        <div>
          <dt>{t('runtimeGatewayPort')}</dt>
          <dd>{status?.ports.gateway === undefined ? '—' : String(status.ports.gateway)}</dd>
        </div>
        <div>
          <dt>{t('runtimePid')}</dt>
          <dd>{status === undefined ? '—' : String(status.pid)}</dd>
        </div>
      </dl>

      {/* 当前值只保留三个数，细节交给曲线与提示框，避免满屏描述文案。 */}
      <div className="dsh-fnos-runtime-now">
        {cards.map(c => (
          <div key={c.key} className="dsh-fnos-runtime-now-item">
            <span className="dsh-fnos-runtime-now-label">{t(c.key)}</span>
            <strong className="dsh-fnos-runtime-now-value">{c.value}</strong>
          </div>
        ))}
      </div>

      <div ref={hostRef} className="dsh-fnos-runtime-chart" role="img" aria-label={t('runtimeTitle')} />

      {error === undefined ? null : <p className="dsh-fnos-repair-error" role="alert">{`${t('runtimeFailed')}${error}`}</p>}

      {/* 进程树放在曲线下面：指标回答「忙不忙」，进程列表回答「忙在哪个进程上」。 */}
      <RuntimeProcessList
        t={t}
        processes={status?.processes ?? []}
        available={status?.processTreeAvailable ?? false}
      />
    </section>
  )
}
