/**
 * 「三方插件代理」分组：自动识别的前缀 + 手动补充项。
 *
 * ## 为什么独立成一个分组
 *
 * 它原先长在「授权目录」卡片底部。两件事没有关系（一个是 NAS 目录白名单，
 * 一个是浏览器路径改写），放在一起既让授权目录那一屏变长，也让排障时找不到
 * 「代理配置在哪」。拆开后从左侧菜单直接进入。
 *
 * ## 自动区段怎么展示
 *
 * 用户要回答的问题是「**哪个插件的哪个接口被接管了**」，所以按前缀分组、把该前缀
 * 下的完整路径列出来，并用一个小柱状图对比各前缀的路由条数——一眼看得出谁贡献
 * 最多，不用逐条数。图表只是索引，明细仍以列表为准。
 *
 * 列表有最大高度（不占满剩余空间）：前缀多时靠滚动，避免把手动配置区一路挤到
 * 屏幕外，用户还得先滚过一长串只读内容才能改自己的东西。
 *
 * @module dsh-fnos/components/GatewayProxyCard
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { DshIconInfoCircle, DshTooltip, DshTabs } from '@tnnevol/dsh-semi-ui'
import { BarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import * as echartsCore from 'echarts/core'
import type { ECharts } from 'echarts/core'
import type { FnosLocaleKey } from '../client/locales.ts'
import type { GatewayAutoPathsStatus } from '../contracts/gateway-proxy-contract.ts'
import { DependencyRepairCard } from './DependencyRepairCard.tsx'
import { InstalledPluginsPanel } from './InstalledPluginsPanel.tsx'
import { PluginIndexPanel } from './PluginIndexPanel.tsx'
import {
  fetchGatewayProxyPaths,
  saveGatewayProxyPaths,
} from '../client/services/gateway-proxy-client.ts'

echartsCore.use([BarChart, GridComponent, TooltipComponent, CanvasRenderer])

type Translate = (key: FnosLocaleKey) => string

/** 组件参数。 */
export interface GatewayProxyCardProps {
  readonly t: Translate
}

/**
 * 「插件管理」分组：三个 tab —— 插件反代 / 插件安装异常 / 已安装的插件。
 *
 * ## 为什么并成 tab
 *
 * 反代、修复、已装列表三件事都属于「插件」，原先「插件安装修复」作为一个并列的
 * 一级菜单项摊在左列，让菜单显得比实际更碎，而它只服务于「装不上」这一个场景。
 * 收进同一分组的 tab 后，左列少一项、相关操作聚在一起。
 *
 * ## 为什么用 Semi 的 Tabs
 *
 * 这是标准的「同层级视图切换」，官方组件已处理好键盘导航（方向键切换、焦点跟随）
 * 与 aria 关系；自建 tab 要重新实现一遍，且容易漏掉无障碍语义。
 *
 * @param props - 组合后的 props。
 * @param props.t - 翻译函数。
 * @returns 卡片元素。
 */
export function GatewayProxyCard({ t }: GatewayProxyCardProps): React.ReactNode {
  const [saved, setSaved] = useState('')
  const [draft, setDraft] = useState('')
  const [message, setMessage] = useState<string>()
  const [auto, setAuto] = useState<GatewayAutoPathsStatus>()
  const [busy, setBusy] = useState(false)
  const chartHostRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<ECharts>()

  /** 载入当前配置与自动识别状态。 */
  const load = useCallback(async () => {
    try {
      const snapshot = await fetchGatewayProxyPaths()
      const text = snapshot.paths.join('\n')
      setSaved(text)
      setDraft(text)
      setAuto(snapshot.auto)
      setMessage(undefined)
    } catch {
      setMessage(t('gatewayProxyFailed'))
    }
  }, [t])

  useEffect(() => { void load() }, [load])

  /** 保存手动项；自动项由宿主维护，这里不提交。 */
  const save = useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      const paths = draft.split(/\r?\n/u).map(value => value.trim()).filter(Boolean)
      const snapshot = await saveGatewayProxyPaths(paths)
      const text = snapshot.paths.join('\n')
      setSaved(text)
      setDraft(text)
      setAuto(snapshot.auto)
      setMessage(t('gatewayProxySaved'))
    } catch (error) {
      setMessage(error instanceof Error && error.message === 'invalid-gateway-proxy-paths' ? t('gatewayProxyInvalid') : t('gatewayProxyFailed'))
    } finally {
      setBusy(false)
    }
  }, [draft, t])

  /**
   * 文本框里的 Ctrl/Cmd+S 直接保存。
   *
   * 代理前缀是「填完就走」的短文本，用户习惯在编辑器里按保存键；不接管的话
   * 浏览器会弹出「保存网页」对话框，把刚填的内容留在半途。
   */
  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 's' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      event.stopPropagation()
      if (!busy) void save()
    }
  }, [busy, save])

  /** 建图（一次）+ 数据变化时刷新。 */
  useEffect(() => {
    const host = chartHostRef.current
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
  }, [auto])

  useEffect(() => {
    const chart = chartRef.current
    const groups = auto?.groups ?? []
    if (chart === undefined || groups.length === 0) return
    chart.setOption({
      animation: false,
      grid: { left: 8, right: 16, top: 8, bottom: 8, containLabel: true },
      tooltip: { trigger: 'axis', confine: true, axisPointer: { type: 'shadow' } },
      xAxis: { type: 'value', minInterval: 1, axisLabel: { fontSize: 10 }, splitLine: { lineStyle: { color: 'rgba(0,0,0,0.06)' } } },
      yAxis: {
        type: 'category',
        data: groups.map(group => group.prefix),
        axisLabel: { fontSize: 11, fontFamily: 'ui-monospace, Menlo, monospace' },
        axisTick: { show: false },
      },
      series: [{
        type: 'bar',
        data: groups.map(group => group.routes.length),
        barMaxWidth: 14,
        itemStyle: { borderRadius: [0, 3, 3, 0] },
        // 单位写进 tooltip：条数是计数，不加说明容易被当成字节数之类。
        tooltip: { valueFormatter: (value: unknown) => (typeof value === 'number' ? `${String(value)} ${t('gatewayProxyRoutesUnit')}` : '—') },
      }],
    }, { notMerge: true })
  }, [auto, t])

  const groups = auto?.groups ?? []
  const hasAuto = groups.length > 0

  /** 「插件反代」面板：自动识别 + 手动补充。 */
  const proxyPanel = (
    <div className="dsh-fnos-proxy-panel">
    {/*
      自动识别区。
      不可用时明确说出原因并引导手填——静默空白会让用户以为「没有插件用绝对路径」。
    */}
    <div className="dsh-fnos-proxy-section">
      <div className="dsh-fnos-proxy-section-head">
        <strong>{t('gatewayProxyAutoTitle')}</strong>
        {auto === undefined ? null : (
          <span className={`dsh-fnos-proxy-badge ${auto.available ? 'dsh-fnos-proxy-badge--ok' : 'dsh-fnos-proxy-badge--warn'}`}>
            {auto.available ? t('gatewayProxyAutoOn') : t('gatewayProxyAutoOff')}
          </span>
        )}
      </div>

      {auto !== undefined && !auto.available ? (
        <p className="dsh-fnos-repair-muted">{`${t('gatewayProxyAutoUnavailable')}${auto.reason ?? ''}`}</p>
      ) : null}

      {auto?.available === true && !hasAuto ? (
        <p className="dsh-fnos-repair-muted">{t('gatewayProxyAutoEmpty')}</p>
      ) : null}

      {hasAuto ? (
        <>
          {/* 柱状图只是索引：谁贡献的路由最多，一眼看出来。 */}
          <div ref={chartHostRef} className="dsh-fnos-proxy-chart" role="img" aria-label={t('gatewayProxyAutoTitle')} />
          {/*
            明细列表**有最大高度**：前缀多时自己滚动，不把下面的手动配置区顶出屏幕。
            用户改自己的配置时不希望先滚过一长串只读内容。
          */}
          <ul className="dsh-fnos-proxy-list">
            {groups.map(group => (
              <li key={group.prefix} className="dsh-fnos-proxy-item">
                <div className="dsh-fnos-proxy-item-head">
                  <code className="dsh-fnos-proxy-prefix">{group.prefix}</code>
                  <span className="dsh-fnos-proxy-count">{`${String(group.routes.length)} ${t('gatewayProxyRoutesUnit')}`}</span>
                  {group.kinds.includes('upgrade') ? (
                    <span className="dsh-fnos-proxy-kind">WS</span>
                  ) : null}
                </div>
                <ul className="dsh-fnos-proxy-routes">
                  {group.routes.map(route => (
                    <li key={route}><code title={route}>{route}</code></li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>

    {/* 手动补充项：语义从「必填」变为「补充」，自动识别生效时可以完全留空。 */}
    <div className="dsh-fnos-proxy-section">
      <div className="dsh-fnos-proxy-section-head">
        <strong>{t('gatewayProxyManualTitle')}</strong>
        <span className="dsh-fnos-repair-muted">{t('gatewayProxyManualHint')}</span>
      </div>
      <textarea
        value={draft}
        placeholder={t('gatewayProxyPlaceholder')}
        className="dsh-fnos-authorized-textarea"
        disabled={busy}
        onKeyDown={handleKeyDown}
        onChange={event => { setDraft(event.currentTarget.value); setMessage(undefined) }}
      />
      {message === undefined ? null : <p className="dsh-fnos-authorized-body dsh-fnos-authorized-gateway-message">{message}</p>}
      <div className="dsh-fnos-authorized-row dsh-fnos-authorized-row--end">
        <button type="button" className="dsh-fnos-authorized-button" disabled={busy || draft === saved} onClick={() => { setDraft(saved); setMessage(undefined) }}>{t('discard')}</button>
        <button type="button" className="dsh-fnos-authorized-button dsh-fnos-authorized-button--primary" disabled={busy || draft === saved} onClick={() => { void save() }}>{t('save')}</button>
      </div>
    </div>
    </div>
  )

  return (
    <section className="dsh-fnos-plugins" aria-labelledby="dsh-fnos-proxy-title">
      <header className="dsh-fnos-authorized-card-header">
        <div className="dsh-fnos-authorized-card-head-text">
          <h3 id="dsh-fnos-proxy-title" className="dsh-fnos-authorized-card-name">
            {t('gatewayProxyTitle')}
            <DshTooltip className="dsh-fnos-gateway-tip-content" content={t('gatewayProxyDescription')}>
              <span className="dsh-fnos-authorized-gateway-tip" tabIndex={0} aria-label={t('gatewayProxyDescription')}>
                <DshIconInfoCircle />
              </span>
            </DshTooltip>
          </h3>
        </div>
      </header>

      <DshTabs type="line" className="dsh-fnos-plugins-tabs">
        {/* 第一个 tab 默认选中：反代是这里最常改的东西。 */}
        <DshTabs.TabPane tab={t('gatewayProxyTabProxy')} itemKey="proxy">
          {proxyPanel}
        </DshTabs.TabPane>
        <DshTabs.TabPane tab={t('gatewayProxyTabRepair')} itemKey="repair">
          <DependencyRepairCard t={t} />
        </DshTabs.TabPane>
        <DshTabs.TabPane tab={t('gatewayProxyTabInstalled')} itemKey="installed">
          <InstalledPluginsPanel t={t} />
        </DshTabs.TabPane>
        {/* 索引放最后：它是「扩展来源」，前三项是当前已有的插件。 */}
        <DshTabs.TabPane tab={t('gatewayProxyTabIndex')} itemKey="index">
          <PluginIndexPanel t={t} />
        </DshTabs.TabPane>
      </DshTabs>
    </section>
  )
}
