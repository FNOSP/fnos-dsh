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
import { DshButton, DshImage, DshSwitch } from '@tnnevol/dsh-semi-ui'
import type { FnosLocaleKey } from '../client/locales.ts'
import {
  applyPluginIndexes,
  fetchPluginIndexStatus,
  setIndexEnabledRemote,
  type PluginIndexStatus,
} from '../client/services/plugin-index-client.ts'

type Translate = (key: FnosLocaleKey) => string

/**
 * 官方插件市场自带的界面预览图（`docs/preview.zh.svg`），经 DSH 的
 * `detail-file` 接口读取。
 *
 * 用官方图而不是自己截图：官方改版时这张图会一起更新。
 * 相对路径交给页面的 `<base>` 解析，在 fnOS iframe 里也能命中。
 */
const OFFICIAL_INDEX_GUIDE_IMAGE = 'api/plugin-manager/detail-file?bundle=%40deepseek-ai%2Fdsh-experimental-plugin-market-bundle&document=docs%2FDETAIL.zh.md&path=preview.zh.svg'

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
  /** 切换开关时的忙碌标记。 */
  const [toggling, setToggling] = useState(false)
  /** 切换后需要重启的提示。 */
  const [restartNotice, setRestartNotice] = useState<string>()
  /** 官方引导图读取失败：失败后整块不渲染，避免留一个破图占位。 */
  const [guideBroken, setGuideBroken] = useState(false)
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

  /**
   * 切换：真正启用/禁用市场 bundle。
   *
   * 与「已安装的插件」页的开关走同一套逻辑（官方 `setBundleEnabled` 的同构实现），
   * 因此两处状态永远一致，不会出现「这边开、那边关」。
   */
  const toggle = useCallback(async (next: boolean) => {
    setToggling(true)
    setRestartNotice(undefined)
    try {
      const result = await setIndexEnabledRemote(next)
      await load()
      if (result.needRestart) setRestartNotice(t('indexToggleNeedRestart'))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setToggling(false)
    }
  }, [load, t])

  /*
    **开关就是插件本身的启用状态**（`dsh.profile.bundles` 里有没有市场 bundle）。

    早前用 localStorage 记偏好，于是出现过「bundle 明明在 bundles 数组里、开关却
    显示未开启」——界面与真实状态相反。现在读写都走同一个判据，与「已安装的插件」
    页的开关完全一致。
  */
  const enabled = status?.marketEnabled === true
  const marketMissing = status !== undefined && !status.marketEnabled
  const allConfigured = status?.marketEnabled === true && status.missing.length === 0

  return (
    <div className="dsh-fnos-idx">
      {/*
        状态行：Switch 开关而不是按钮。

        开关天然表达「一个东西的开/关」，按钮表达「执行一个动作」。这里改的是一个
        持续的状态，不是一次性动作，Switch 更贴切，也能直接看出当前是开还是关。
      */}
      <div className="dsh-fnos-idx-row">
        <div className="dsh-fnos-idx-row-main">
          <strong className="dsh-fnos-idx-title">{t('indexSourcesTitle')}</strong>
          <span className={`dsh-fnos-proxy-badge ${enabled ? 'dsh-fnos-proxy-badge--ok' : 'dsh-fnos-proxy-badge--warn'}`}>
            {enabled ? t('indexSourceOn') : t('indexSourceOff')}
          </span>
        </div>
        <DshSwitch
          size="default"
          checked={enabled}
          disabled={busy || toggling}
          onChange={next => { void toggle(next) }}
        />
      </div>

      {/*
        「一键设置」只在**开启后**显示。

        未开启时这一行是死信息：源都配齐了、按钮永远是灰的，占着一整块却没有任何
        可做的事。开关本身已经表达了「开/关」，下面的清单也照常展示配了哪些源，
        因此未开启时直接隐藏这一行，开启后再出现——它的作用就是「补齐缺失的源」，
        而这只有在用户决定启用索引之后才有意义。
      */}
      {enabled ? (
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
      ) : null}

      {enabled ? (
        <>
          {/* 索引源清单：已配置的打勾，缺失的标出来。 */}
          <ul className="dsh-fnos-idx-list">
            {(status?.sources ?? []).map(source => {
              const configured = status?.configured.some(item => item.trim().replace(/\/+$/u, '') === source.url.trim().replace(/\/+$/u, '')) ?? false
              return (
                <li key={source.url} className="dsh-fnos-idx-item">
                  <div className="dsh-fnos-idx-item-main">
                    {/*
                      标题从索引文件里读（`index.json` 的 `title`），不在代码里硬编码：
                      索引改名时这里自动跟上。读不到时退回显示 URL。
                    */}
                    {source.label === undefined ? null : <span className="dsh-fnos-idx-label">{source.label}</span>}
                    <code className="dsh-fnos-idx-url" title={source.url}>{source.url}</code>
                  </div>
                  <span className={`dsh-fnos-idx-state ${configured ? 'dsh-fnos-idx-state--ok' : ''}`}>
                    {configured ? '✓' : '—'}
                  </span>
                </li>
              )
            })}
          </ul>

          {/*
            引导：告诉用户这两个源应该在官方界面的哪个位置出现。

            图**直接引用官方插件自带的 `docs/preview.zh.svg`**（经 `detail-file` 接口），
            而不是自己截图：官方改版时那张图会一起更新，我们这边自动跟上，不需要
            每次都去重新截图替换。读不到时只显示文字说明，不留破图占位。
          */}
          <p className="dsh-fnos-idx-guide">{t('indexGuideText')}</p>
          {/*
            用 Semi 的 Image 而不是裸 <img>：自带加载态、失败兜底与主题样式。
            `preview={false}` —— 这是示意图，放大没有意义，开着反而会盖住下方的配置项。
          */}
          {guideBroken ? null : (
            <DshImage
              className="dsh-fnos-idx-guide-image"
              src={OFFICIAL_INDEX_GUIDE_IMAGE}
              alt={t('indexGuideText')}
              width="100%"
              preview={false}
              onError={() => { setGuideBroken(true) }}
            />
          )}
        </>
      ) : null}

      {restartNotice === undefined ? null : <p className="dsh-fnos-repair-muted" role="status">{restartNotice}</p>}
      {error === undefined ? null : <p className="dsh-fnos-repair-error" role="alert">{error}</p>}
    </div>
  )
}
