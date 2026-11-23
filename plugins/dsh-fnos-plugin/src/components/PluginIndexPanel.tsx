import { notifySuccess } from '../client/notify.ts'
/**
 * 「自定义插件索引」tab：检测索引源是否配置，并提供一键开启 / 设置。
 *
 * ## 两个按钮的区别
 *
 * - **设置**：把两个推荐源补进官方插件市场的 `indexes`（只追加，不覆盖用户
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
import { DshButton, DshImage, DshSkeleton, DshTooltip } from '@tnnevol/dsh-semi-ui'
import { SwitchWithLoading } from './SwitchWithLoading.tsx'
import { IconifyIcon } from './IconifyIcon.tsx'
import type { FnosLocaleKey } from '../client/locales.ts'
import {
  applyPluginIndexes,
  fetchPluginIndexStatus,
  setIndexEnabledRemote,
  type PluginIndexStatus,
  addIndexSourceRemote,
  removeIndexSourceRemote,
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
  /** 官方引导图读取失败：失败后整块不渲染，避免留一个破图占位。 */
  const [guideBroken, setGuideBroken] = useState(false)
  /**
   * 正在操作的那一条索引源。
   *
   * 存 URL 而不是布尔：列表里每一行各有自己的「添加/移除」，用全局布尔会让
   * 点一条时**所有行的按钮一起转圈**，看起来像整批都在变。
   */
  const [busyUrl, setBusyUrl] = useState<string>()
  /** 「设置」是整批操作（补齐全部推荐源），没有具体行，单独一个布尔。 */
  const [applying, setApplying] = useState(false)
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

  /** 设置：补写推荐源。 */
  const apply = useCallback(async () => {
    setApplying(true)
    setError(undefined)
    try {
      setStatus(await applyPluginIndexes())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setApplying(false)
    }
  }, [])

  /**
   * 移除一个索引源。
   *
   * 不做二次确认：这是「从列表里去掉一条 URL」，点错了再用「一键设置」加回来
   * 即可，不涉及删数据。危险操作才需要确认框。
   */
  /**
   * 添加一个索引源。
   *
   * 与「移除」互为逆操作：列表每一行按当前状态二选一显示，用户不必去别的入口
   * 找「怎么加回来」。
   */
  const add = useCallback(async (url: string) => {
    setBusyUrl(url)
    try {
      setStatus(await addIndexSourceRemote(url))
      notifySuccess(t('indexAdded'))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusyUrl(undefined)
    }
  }, [t])

  const remove = useCallback(async (url: string) => {
    setBusyUrl(url)
    try {
      setStatus(await removeIndexSourceRemote(url))
      notifySuccess(t('indexRemoved'))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusyUrl(undefined)
    }
  }, [t])

  /**
   * 切换：真正启用/禁用市场 bundle。
   *
   * 与「已安装的插件」页的开关走同一套逻辑（官方 `setBundleEnabled` 的同构实现），
   * 因此两处状态永远一致，不会出现「这边开、那边关」。
   */
  const toggle = useCallback(async (next: boolean) => {
    setToggling(true)
    try {
      const result = await setIndexEnabledRemote(next)
      await load()
      /*
        文案分两种：**启用**才提「重启后生效」（组合在进程启动时装配），
        **禁用**立即生效、不说重启——说了反而让用户以为没关上。
      */
      notifySuccess(result.needRestart ? t('indexToggleNeedRestart') : t('indexToggleDisabled'))
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

  /*
    **首次加载用骨架屏占位。**

    `status` 还是 `undefined` 时我们什么都不知道，早前却直接按「未开启」渲染了：
    加载慢的时候用户先看到一个**错的**「未开启」，随后跳成「已开启」，中间还空着
    一大块——正是截图里的样子。

    判据用 `status === undefined && error === undefined`：加载失败时不算 loading，
    交给下面的错误提示，不会一直转骨架。
  */
  const loading = status === undefined && error === undefined

  return (
    <div className="dsh-fnos-idx">
      {loading ? (
        <div className="dsh-fnos-idx-skeleton" aria-busy="true" aria-live="polite">
          <span className="dsh-fnos-visually-hidden">{t('loading')}</span>
          {/*
            **占位内容必须走 `placeholder` 属性，不能当 children 传。**

            Semi 的 `Skeleton` 是个容器：`children` 是**加载完成后**要显示的内容，
            占位图由 `placeholder` 单独给。早前把 `<DshSkeleton.Title>` 直接写在
            里面，它被当成 children——而 `loading` 默认为 `true` 时 children 不渲染，
            于是产出的 DOM 是空的 `<div class="semi-skeleton">`，高度 0。

            视觉上就是**一片空白**（真机实测 `rootH: 0`），正是截图里的样子。

            这里自己拼占位结构传给 `placeholder`，`active` 给 shimmer 动画。
          */}
          <DshSkeleton
            active
            placeholder={(
              <>
                {/* 开关行：左侧标题、右侧开关，与真实行同高。 */}
                <div className="dsh-fnos-idx-row dsh-fnos-idx-skeleton-row">
                  <DshSkeleton.Title className="dsh-fnos-idx-skeleton-title" />
                  <DshSkeleton.Button className="dsh-fnos-idx-skeleton-switch" />
                </div>
                {/* 索引源清单：两条，占住真实条目将要出现的位置。 */}
                {[0, 1].map(index => (
                  <div key={index} className="dsh-fnos-idx-skeleton-row">
                    <DshSkeleton.Title className="dsh-fnos-idx-skeleton-line" />
                  </div>
                ))}
              </>
            )}
          />
        </div>
      ) : null}

      {/* 状态未就绪（加载失败）时不渲染任何「未开启」之类的判断，避免给出错的结论。 */}
      {status === undefined ? null : (
      <>
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
        <SwitchWithLoading
          checked={enabled}
          loading={toggling}
          /* 有任一条正在增删时先不接受新操作，避免与设置写入交错。 */
          disabled={busyUrl !== undefined}
          onChange={next => { void toggle(next) }}
        />
      </div>

      {/*
        刷新按钮**独立成一条工具条**，与「已安装的插件」页签同一位置（右对齐、
        卡片之外）。

        它原先塞在索引源卡片里、紧挨着开关：语义上属于「工具条动作」却混进了
        「这一项的状态与开关」之间，与另一个页签的位置也不一致——用户在两个
        页签之间切换时会发现同一个按钮换了地方。

        状态来自磁盘上的 `bundles` 数组，外部改动（命令行、其它插件页）不会自动
        反映过来，所以显式刷新必须保留。
      */}
      <div className="dsh-fnos-installed-toolbar">
        <DshTooltip content={t('refresh')}>
          <button
            type="button"
            className="dsh-fnos-icon-button"
            aria-label={t('refresh')}
            disabled={busyUrl !== undefined}
            onClick={() => { void load() }}
          >
            <IconifyIcon name="lucide:refresh-cw" />
          </button>
        </DshTooltip>
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
          {/*
            与同 Tab 的「安装」「修复」**完全一致**：尺寸 default、样式 solid。

            早前这里是 `size="small"` + `theme="light"`，同一列卡片里三个按钮
            两种高度、两种观感。
          */}
          <DshButton
            htmlType="button"
            theme="solid"
            type="primary"
            loading={applying}
            disabled={applying || busyUrl !== undefined || marketMissing || allConfigured}
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
                  {/*
                    每一行按当前状态给一个动作：已配置的「移除」、未配置的「添加」。
                    两者互为逆操作，用户不必去别的入口找「怎么加回来」。
                  */}
                  {configured ? (
                    <DshButton
                      htmlType="button"
                      size="small"
                      theme="borderless"
                      type="tertiary"
                      loading={busyUrl === source.url}
                      onClick={() => { void remove(source.url) }}
                    >
                      {t('remove')}
                    </DshButton>
                  ) : (
                    <DshButton
                      htmlType="button"
                      size="small"
                      theme="light"
                      type="primary"
                      loading={busyUrl === source.url}
                      onClick={() => { void add(source.url) }}
                    >
                      {t('indexAdd')}
                    </DshButton>
                  )}
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

      </>
      )}

      {error === undefined ? null : <p className="dsh-fnos-repair-error" role="alert">{error}</p>}
    </div>
  )
}
