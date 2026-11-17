/**
 * 「已安装的插件」tab：列出 profile 里装了哪些插件。
 *
 * ## 为什么要标出「内置」
 *
 * 随 FPK 内置、由应用管理的插件与用户自己装的三方插件是两类：前者若被当成三方
 * 插件卸掉，应用会缺功能且不好恢复。列表用徽标区分，用户才知道哪些该谨慎。
 *
 * ## 为什么只读
 *
 * 卸载插件会改 profile 的依赖与 node_modules，属于「改安装环境」而不是「改配置」。
 * 这里只做清点，卸载仍走官方的插件页——那里有完整的依赖处理与回滚。
 *
 * @module dsh-fnos/components/InstalledPluginsPanel
 */

import { useCallback, useEffect, useState } from 'react'
import { DshButton, DshPopconfirm as Popconfirm, DshTooltip, DshTypography } from '@tnnevol/dsh-semi-ui'
import type { FnosLocaleKey } from '../client/locales.ts'
import { fetchInstalledPlugins, removePluginByName, togglePlugin } from '../client/services/gateway-proxy-client.ts'
import { PluginInstallInline } from './PluginInstallInline.tsx'
import { SwitchWithLoading } from './SwitchWithLoading.tsx'
import { notifyFailure, notifySuccess } from '../client/notify.ts'
import { IconifyIcon } from './IconifyIcon.tsx'
import { FNOS_PLUGIN_ASSET_ROUTE, type InstalledPluginsSnapshot } from '../contracts/gateway-proxy-contract.ts'
import { PluginArtworkDefault } from '@deepseek-ai/dsh-client-ui-primitives'

type Translate = (key: FnosLocaleKey) => string

/** Semi 的 `Typography.Text`：只取需要的变体，避免每次写 `<DshTypography.Text>`。 */
const DshTypographyText = DshTypography.Text

/**
 * 拼出插件图标的 URL。
 *
 * `icon` 是相对包目录的路径（如 `assets/logo.svg`），由插件的静态资源路由按
 * 「包名 + 相对路径」读取——不直接暴露文件系统路径。
 *
 * @param name - 包名。
 * @param icon - 包内相对路径。
 * @returns 可直接放进 `src` 的地址。
 */
function pluginIconUrl(name: string, icon: string): string {
  const query = new URLSearchParams({ name, path: icon })
  return `${FNOS_PLUGIN_ASSET_ROUTE}?${query.toString()}`
}

/** 组件参数。 */
export interface InstalledPluginsPanelProps {
  readonly t: Translate
}

/**
 * 已安装插件列表。
 * @param props - 组合后的 props。
 * @param props.t - 翻译函数。
 * @returns 面板元素。
 */
export function InstalledPluginsPanel({ t }: InstalledPluginsPanelProps): React.ReactNode {
  const [snapshot, setSnapshot] = useState<InstalledPluginsSnapshot>()
  const [refreshing, setRefreshing] = useState(false)
  /** 正在安装的包名；undefined 表示弹框关闭。 */
  const [installing, setInstalling] = useState<string>()
  /** 正在切换启用状态的包名（期间禁用该卡片的按钮，避免连点）。 */
  const [toggling, setToggling] = useState<string>()
  /** 正在卸载的包名：期间它的卸载按钮不可再点。 */
  const [removingName, setRemovingName] = useState<string>()
  const [error, setError] = useState<string>()

  /**
   * 取清单。
   *
   * `checkUpdates` 必须由调用方显式传：查更新是「每个插件一次 registry 请求」，
   * 十几个插件就是十几次网络往返，首屏带上会很慢。首屏只读本地清单，**只有用户
   * 点刷新时才联网**。
   */
  const load = useCallback(async (checkUpdates = false) => {
    try {
      setSnapshot(await fetchInstalledPlugins(checkUpdates))
      setError(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  /**
   * 手动刷新：**联网**重新查 registry，看上游有没有新版本。
   *
   * 这里必须传 `checkUpdates = true`。此前它调的是 `load()`（首屏那条不联网的
   * 路径），于是「刷新」只是把本地清单重读一遍，`updateAvailable` 永远是
   * undefined——界面上永远看不到「更新」按钮。真机用 dshmarket@1.73.15
   *（registry latest 1.73.20）复现：后端 `?updates=1` 能返回
   * `updateAvailable: true`，但点刷新按钮后界面没有任何变化。
   */
  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await load(true)
    } finally {
      setRefreshing(false)
    }
  }, [load])

  /** 切换启用状态：改 profile patch 的 disabled，不删文件。 */
  const toggleEnabled = useCallback(async (name: string, enabled: boolean) => {
    setToggling(name)
    try {
      await togglePlugin(name, enabled)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setToggling(undefined)
    }
  }, [load])

  /** 确认卸载。 */
  /**
   * 安装/更新结束：成功时刷新列表让新状态生效。
   *
   * 失败**不刷新**——列表没变，刷新只会多一次无意义的请求；错误信息已经显示在
   * 卡片内的进度条上。
   */
  const handleInstallSettled = useCallback((ok: boolean) => {
    if (ok) void load()
  }, [load])

  /**
   * 卸载一个插件。
   *
   * **返回 Promise**：Popconfirm 的 `onConfirm` 拿到 Promise 后会自己给确认按钮
   * 加 loading 并保持弹层打开——卸载要改 profile、跑 `pnpm remove`，点了就关会
   * 让用户以为瞬间完成。不要手写 `loading` / `disabled`：`disabled` 会让按钮
   * 变成灰色不可点态，看起来像坏了。
   *
   * 同时在后端有同名进程内锁：即便前端被绕过（多标签页、连点），第二次请求会
   * 拿到 409，转成「请勿重复操作」的提示。
   *
   * @param name - 包名。
   */
  const removePluginFromCard = useCallback(async (name: string): Promise<void> => {
    if (removingName === name) return
    setRemovingName(name)
    try {
      const result = await removePluginByName(name)
      await load()
      /*
        卸载已完成，但已加载的模块仍在当前进程里——没有热更新通道，必须重启 Web
        才会真正消失。不提示的话用户会以为「没卸干净」（官方 `removeBundle`
        末尾的 `publishAndReload()` 做的正是这件事）。
      */
      if (result.needRestart) notifySuccess(t('pluginRemoveNeedRestart'))
      else notifySuccess(t('pluginRemoved'))
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      // 后端并发锁的拒绝：说清「是重复操作」，而不是「卸载失败」。
      notifyFailure(message.includes('plugin-remove-in-progress') ? t('pluginRemoveInProgress') : message)
    } finally {
      setRemovingName(undefined)
    }
  }, [removingName, load, t])

  useEffect(() => { void load() }, [load])

  if (error !== undefined) {
    return <p className="dsh-fnos-repair-error" role="alert">{`${t('installedPluginsFailed')}${error}`}</p>
  }
  if (snapshot === undefined) return <p className="dsh-fnos-repair-muted">{t('installedPluginsLoading')}</p>
  if (!snapshot.available) {
    // 读不到 profile 时明说，而不是给一张空表——空表会被当成「一个都没装」。
    return <p className="dsh-fnos-repair-muted">{`${t('installedPluginsUnavailable')}${snapshot.reason ?? ''}`}</p>
  }
  if (snapshot.plugins.length === 0) {
    return <p className="dsh-fnos-repair-muted">{t('installedPluginsEmpty')}</p>
  }

  return (
    <>
      <div className="dsh-fnos-installed-toolbar">
        {/*
          图标按钮：文案移进 tooltip。刷新是工具条里的次要动作，占一个文字按钮的
          位置不值当；`aria-label` 保留，读屏软件才不会只念「按钮」。
        */}
        <DshTooltip content={t('refresh')}>
          <button
            type="button"
            className="dsh-fnos-icon-button"
            aria-label={t('refresh')}
            disabled={refreshing}
            onClick={() => { void refresh() }}
          >
            <IconifyIcon name="lucide:refresh-cw" />
          </button>
        </DshTooltip>
      </div>

      {/*
        卡片而不是表格行：每张卡片承载「这个插件是什么 + 能对它做什么」。
        表格行放不下开关、更新按钮与桥梁警示，挤在一行会读不出来。
      */}
      <ul className="dsh-fnos-cards">
        {snapshot.plugins.map(plugin => {
          /*
            **未安装的常驻卡片不是「已禁用」。**

            `enabled` 对未安装的包没有意义（它根本不在 profile 里），直接沿用
            会同时显示「已禁用」和「未安装」两个标签，语义互相打架。这里把两者
            分开：`absent` 走「未安装」，只有真的装了又被关掉才是「已禁用」。
          */
          const disabled = plugin.enabled === false && plugin.absent !== true
          return (
            <li key={plugin.name} className={`dsh-fnos-card${disabled ? ' dsh-fnos-card--off' : ''}`}>
              {/*
                **三段式布局**（对齐官方插件页的观感）：

                1. 名称 —— 独占一行，等宽字体、可点击跳仓库；
                2. 版本 + 状态徽标 —— 第二行，弱化显示；
                3. 操作行 —— 开关在左、卸载/更新在右，两端对齐。

                上一版把五个元素全挤进一行，名称被压成 `dsh-plugin-wallp…`，
                开关与按钮也失去了层级——信息看着齐，读起来却分不清哪是身份、
                哪是状态、哪是动作。
              */}
              <div className="dsh-fnos-card-title">
                {/*
                  图标在名称左侧。没有自带 icon 的插件不能留空——卡片会缺一块
                  身份标识，和旁边的插件排在一起显得参差。

                  用官方 `PluginArtworkDefault`：DSH 自己的插件市场在没有图标时
                  也是这个（`MarketIcon` 见 `ui-plugin-market/DiscoverSection.tsx`）。
                  直接复用组件而不是复制那串 SVG，官方改了图形我们跟着变。
                */}
                {plugin.icon === undefined
                  ? (
                    <span className="dsh-fnos-card-logo dsh-fnos-card-logo--default" aria-hidden="true">
                      <PluginArtworkDefault size={20} />
                    </span>
                    )
                  : (
                    <img
                      className="dsh-fnos-card-logo"
                      src={pluginIconUrl(plugin.name, plugin.icon)}
                      alt=""
                      aria-hidden="true"
                      loading="lazy"
                    />
                    )}
                {/*
                  名称用 `meta.title`（如「插件市场」），没有才退回包名。
                  单行省略交给 Typography：自带 tooltip，且只在真的被截断时提示。
                */}
                <DshTypographyText
                  className="dsh-fnos-card-name"
                  ellipsis={{ showTooltip: true }}
                  link={plugin.repository === undefined
                    ? undefined
                    : { href: plugin.repository, target: '_blank', rel: 'noopener noreferrer' }}
                >
                  {plugin.title ?? plugin.name}
                </DshTypographyText>
              </div>

              <div className="dsh-fnos-card-meta">
                <span className="dsh-fnos-card-version">{plugin.version}</span>
                {/* 状态徽标：不兼容 > 有更新 > 本地版本 > 已是最新。 */}
                {plugin.incompatible === true ? (
                  <span className="dsh-fnos-installed-badge dsh-fnos-installed-badge--warn" title={JSON.stringify(plugin.requirements ?? {})}>
                    {t('installedIncompatible')}
                  </span>
                ) : plugin.updateAvailable === true ? (
                  <span className="dsh-fnos-installed-badge dsh-fnos-installed-badge--ok">
                    {`${t('installedUpdateAvailable')} ${plugin.latestVersion ?? ''}`}
                  </span>
                ) : plugin.latestVersion === undefined ? null : plugin.aheadOfRegistry === true ? (
                  <span className="dsh-fnos-installed-badge">{t('installedAheadOfRegistry')}</span>
                ) : (
                  <span className="dsh-fnos-installed-badge dsh-fnos-installed-badge--ok">{t('installedUpToDate')}</span>
                )}
                {plugin.bundled ? <span className="dsh-fnos-installed-badge">{t('installedPluginsBundled')}</span> : null}
                {disabled ? <span className="dsh-fnos-installed-badge dsh-fnos-installed-badge--off">{t('pluginDisabled')}</span> : null}
                {plugin.hasClient ? null : <span className="dsh-fnos-repair-muted">{t('installedPluginsHostOnly')}</span>}
              </div>

              {/*
                插件说明：**最多三行，超出可展开**。

                用 Semi Typography 的 `ellipsis`（`rows: 3` + `expandable` +
                `collapsible`）而不是自己写 `-webkit-line-clamp`：它自带展开/收起
                按钮与状态管理，且只在真的超出时才出现按钮。

                取代了此前的「单行省略 + title 悬浮」——单行把大部分描述都切掉，
                而列表页的作用正是让人判断「这插件做什么」。
              */}
              {plugin.description === undefined ? null : (
                <DshTypography.Paragraph
                  className="dsh-fnos-card-description"
                  /*
                    用 Typography 自带的 `ellipsis.showTooltip`：它只在真的被截断时
                    提示，且提示样式与主题一致。此前用原生 `title`——那是浏览器自绘
                    气泡，延迟约 1 秒、位置不受控，正是用户说「气泡不符合预期」的原因。
                  */
                  ellipsis={{ rows: 3, expandable: true, collapsible: true, expandText: t('expand'), collapseText: t('collapse'), showTooltip: true }}
                >
                  {plugin.description}
                </DshTypography.Paragraph>
              )}

              {/*
                操作行：**开关在左、动作在右，两端对齐**。
                开关是「状态开关」而不是「一次动作」，放左边与其它状态信息同一侧；
                卸载/更新是动作，靠右符合从左读到右的习惯。
              */}
              <div className="dsh-fnos-card-actions">
                {/*
                  **内置插件只展示、不可操作。**

                  `@tnnevol/dsh-fnos` 是应用与 DSH 之间的桥梁：它一旦被禁用，
                  授权目录、文件打开、网关反代、进程管理全部失效——而「启用回来」
                  这个动作正是它自己提供的功能，用户没有别的入口。

                  置灰而不是隐藏：让人看到「这里有开关、但你不能动」。
                */}
                {/*
                  **未安装的常驻卡片没有开关可拨。**

                  它此刻不在 profile 里，`enabled` 没有意义；显示一个永远关着的
                  开关只会让人反复去点。替代物是右侧的「安装」按钮。
                */}
                {plugin.absent === true ? null : (
                  <SwitchWithLoading
                    checked={!disabled}
                    loading={toggling === plugin.name}
                    {...(plugin.bundled === true ? { disabled: true } : {})}
                    onChange={next => { void toggleEnabled(plugin.name, next) }}
                  />
                )}
                {plugin.absent === true ? <span className="dsh-fnos-repair-muted">{t('installedPluginsNotInstalled')}</span> : null}
                <div className="dsh-fnos-card-action-buttons">
                  {/*
                    更新是图标按钮、文案进 tip：与「卸载」同档的次要动作，
                    文字按钮会让一行里堆两个大色块。
                  */}
                  {/*
                    **常驻卡片未安装时给「安装」**：这是它们唯一的恢复入口。

                    用 `loading` 而不是 `disabled`——安装是异步的，按钮要有明确的
                    「正在装」状态（见章程「执行中只用 loading」）。
                  */}
                  {plugin.absent === true ? (
                    <DshButton
                      htmlType="button"
                      size="small"
                      theme="solid"
                      type="primary"
                      loading={installing === plugin.name}
                      onClick={() => { setInstalling(plugin.name) }}
                    >
                      {t('pluginInstallAction')}
                    </DshButton>
                  ) : null}
                  {plugin.absent === true ? null : plugin.updateAvailable === true ? (
                    <DshTooltip content={t('pluginUpdateAction')}>
                      <button
                        type="button"
                        className="dsh-fnos-icon-button"
                        aria-label={t('pluginUpdateAction')}
                        disabled={toggling === plugin.name}
                        onClick={() => { setInstalling(plugin.name) }}
                      >
                        <IconifyIcon name="lucide:download" />
                      </button>
                    </DshTooltip>
                  ) : null}
                  {/*
                    内置插件不允许卸载：它是应用的组成部分，删掉之后能力缺口无法
                    通过「重新安装插件」恢复（要重装整个应用）。
                  */}
                  {/*
                    **能不能卸载只看宿主给的 `uninstallable`。**

                    界面不再自己比对包名、也不按名单分节渲染：
                    - `bundled`（随 FPK 打包）本来就不给卸载；
                    - `@tnnevol/dsh-fnos` 由宿主标成不可卸载——卸掉会连带失去
                      「装回来」的入口；
                    - `dshmarket` 可卸载，卡片只是常驻。
                  */}
                  {plugin.bundled || plugin.uninstallable === false || plugin.absent === true ? null : (
                    /*
                      二次确认用 **Popconfirm**，不是模态弹框。

                      卸载是一个「点一个图标 → 确认」的短流程，模态弹框会把整页
                      盖住、还需要处理焦点归还；Popconfirm 贴着触发点出现，确认完
                      就地消失，与这个动作的分量相称。

                      `onConfirm` 返回 Promise 时，Popconfirm 的确认按钮自己进
                      loading 并保持弹层打开——卸载是异步的后端操作（改 profile、
                      跑 `pnpm remove`），点了就关会让用户以为瞬间完成。
                    */
                    /*
                      触发元素**只包 Popconfirm，不再套 Tooltip**。

                      实测：Tooltip 与 Popconfirm 同时包着同一个按钮时，Tooltip 的
                      hover 层抢在 Popconfirm 之前接管了指针事件，点击唤不出确认层
                      （`.semi-popconfirm` 始终不出现）。而且这里是冗余的——确认层
                      的标题已经写明「卸载「X」？」，再挂一个「卸载」气泡没有信息量。

                      `aria-label` 保留：图标按钮没有可见文字，缺了它读屏只会念
                      「按钮」。
                    */
                    <Popconfirm
                      title={t('pluginRemoveTitle').replace('{name}', plugin.name)}
                      content={t('pluginRemoveConfirm')}
                      okText={t('uninstall')}
                      cancelText={t('cancel')}
                      okButtonProps={{ type: 'danger' }}
                      position="topRight"
                      onConfirm={() => removePluginFromCard(plugin.name)}
                    >
                      <button
                        type="button"
                        className="dsh-fnos-icon-button dsh-fnos-icon-button--danger"
                        aria-label={t('uninstall')}
                        /* 正在卸载（或正在装）这个插件时不许再点。 */
                        disabled={removingName === plugin.name || installing === plugin.name}
                      >
                        <IconifyIcon name="lucide:trash" />
                      </button>
                    </Popconfirm>
                  )}
                </div>
              </div>

              {/*
                桥梁提示只给本插件：它是应用与 DSH 之间唯一的通道，卸载后
                授权目录、文件打开、网关反代、进程管理全部失效。
              */}
              {plugin.bundled ? (
                <p className="dsh-fnos-card-note" role="note">{t('installedBundledWarning')}</p>
              ) : null}

              {/*
                安装/更新进度与日志就长在卡片下方，不再弹二级弹框。
                过程可见、结果留在原地、默认折叠不占版面。
              */}
              {installing === plugin.name ? (
                <PluginInstallInline
                  name={plugin.name}
                  t={t}
                  onSettled={handleInstallSettled}
                  onDismiss={() => { setInstalling(undefined) }}
                />
              ) : null}
            </li>
          )
        })}
      </ul>
    </>
  )
}
