/**
 * 「自定义插件索引」tab：检测索引源是否配置，并提供一键开启 / 一键设置。
 *
 * ## 两个按钮的区别
 *
 * - **一键设置**：把两个推荐源补进官方插件市场的 `indexes`（只追加，不覆盖用户
 *   自己配的）。这是真正生效的动作。
 * - **一键开启**：本插件里的「推荐索引开关」——它不修改市场的配置，只决定
 *   「本页是否把推荐源视为启用」，并在未配置时引导用户去设置。这样用户可以先
 *   「开启」再决定是否真的写入，也方便回退（关掉不等于删掉用户的配置）。
 *
 * ## 为什么没有引导按钮就置灰
 *
 * 市场没装时，`indexes` 这份配置根本不存在、写了也没人读。置灰 + 一句原因
 * （去「插件安装与异常」装）比让用户点一个没反应的东西好。
 *
 * @module dsh-fnos/components/PluginIndexPanel
 */

import { useCallback, useEffect, useState } from 'react'
import { DshButton } from '@tnnevol/dsh-semi-ui'
import type { FnosLocaleKey } from '../client/locales.ts'
import {
  applyPluginIndexes,
  fetchPluginIndexStatus,
  getIndexEnabled,
  setIndexEnabled,
  type PluginIndexStatus,
} from '../client/services/plugin-index-client.ts'

type Translate = (key: FnosLocaleKey) => string

/** 组件参数。 */
export interface PluginIndexPanelProps {
  readonly t: Translate
}

/**
 * 自定义插件索引面板。
 * @param props - 组合后的 props。
 * @param props.t - 翻译函数。
 * @returns 面板元素。
 */
export function PluginIndexPanel({ t }: PluginIndexPanelProps): React.ReactNode {
  const [status, setStatus] = useState<PluginIndexStatus>()
  const [enabled, setEnabled] = useState(() => getIndexEnabled())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const load = useCallback(async () => {
    try {
      setStatus(await fetchPluginIndexStatus())
      setError(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  useEffect(() => { void load() }, [load])

  /** 一键设置：补写推荐源。 */
  const apply = useCallback(async () => {
    setBusy(true)
    setError(undefined)
    try {
      setStatus(await applyPluginIndexes())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [])

  /** 一键开启：本地开关 + 记忆。 */
  const toggle = useCallback((next: boolean) => {
    setIndexEnabled(next)
    setEnabled(next)
  }, [])

  const marketMissing = status !== undefined && !status.marketAvailable
  const allConfigured = status !== undefined && status.marketAvailable && status.missing.length === 0

  return (
    <div className="dsh-fnos-idx">
      {/* 状态行：开/关 + 一键开启。 */}
      <div className="dsh-fnos-idx-row">
        <div className="dsh-fnos-idx-row-main">
          <strong className="dsh-fnos-idx-title">{t('indexSourcesTitle')}</strong>
          <span className={`dsh-fnos-proxy-badge ${enabled ? 'dsh-fnos-proxy-badge--ok' : 'dsh-fnos-proxy-badge--warn'}`}>
            {enabled ? t('indexSourceOn') : t('indexSourceOff')}
          </span>
        </div>
        <DshButton
          htmlType="button"
          size="small"
          theme="solid"
          type="primary"
          disabled={busy}
          onClick={() => { toggle(!enabled) }}
        >
          {t('indexApplyEnable')}
        </DshButton>
      </div>

      {/* 一键设置：市场缺失时置灰并说明。 */}
      <div className="dsh-fnos-idx-row">
        <div className="dsh-fnos-idx-row-main">
          <strong className="dsh-fnos-idx-title">{t('gatewayProxyTabIndex')}</strong>
          {marketMissing ? <span className="dsh-fnos-repair-muted">{t('indexMarketMissing')}</span> : null}
          {allConfigured ? <span className="dsh-fnos-repair-muted">{t('indexAllConfigured')}</span> : null}
        </div>
        <DshButton
          htmlType="button"
          size="small"
          theme="light"
          type="primary"
          disabled={busy || marketMissing || allConfigured}
          onClick={() => { void apply() }}
        >
          {t('indexApplyConfigure')}
        </DshButton>
      </div>

      {/* 索引源清单：已配置的打勾，缺失的标出来。 */}
      <ul className="dsh-fnos-idx-list">
        {(status?.recommended ?? []).map(url => {
          const configured = status?.configured.some(item => item.trim().replace(/\/+$/u, '') === url.trim().replace(/\/+$/u, '')) ?? false
          return (
            <li key={url} className="dsh-fnos-idx-item">
              <code className="dsh-fnos-idx-url" title={url}>{url}</code>
              <span className={`dsh-fnos-idx-state ${configured ? 'dsh-fnos-idx-state--ok' : ''}`}>
                {configured ? '✓' : '—'}
              </span>
            </li>
          )
        })}
      </ul>

      {/*
        引导：告诉用户这两个源应该在官方界面的哪个位置出现。
        纯文字，不用截图——截图会随官方改版失效，而位置描述不会。
      */}
      <p className="dsh-fnos-idx-guide">{t('indexGuideText')}</p>

      {error === undefined ? null : <p className="dsh-fnos-repair-error" role="alert">{error}</p>}
    </div>
  )
}
