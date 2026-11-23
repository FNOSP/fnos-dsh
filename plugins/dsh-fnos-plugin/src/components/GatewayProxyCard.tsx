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

import { useCallback, useEffect, useState } from 'react'
import { DshEmpty, DshTabs } from '@tnnevol/dsh-semi-ui'
import { FnosEmptyIllustration } from './FnosEmptyIllustration.tsx'
import type { FnosLocaleKey } from '../client/locales.ts'
import type { GatewayAutoPathsStatus } from '../contracts/gateway-proxy-contract.ts'
import { DependencyRepairCard } from './DependencyRepairCard.tsx'
import { IconifyIcon } from './IconifyIcon.tsx'
import { InstalledPluginsPanel } from './InstalledPluginsPanel.tsx'
import { PluginIndexPanel } from './PluginIndexPanel.tsx'
import { NpmMirrorCard } from './NpmMirrorCard.tsx'
import {
  fetchGatewayProxyPaths,
  saveGatewayProxyPaths,
} from '../client/services/gateway-proxy-client.ts'

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
  /** 读取配置失败（能力不可用）。与「保存失败」是两回事，见 `load`。 */
  const [loadFailed, setLoadFailed] = useState(false)

  /** 载入当前配置与自动识别状态。 */
  const load = useCallback(async () => {
    try {
      const snapshot = await fetchGatewayProxyPaths()
      const text = snapshot.paths.join('\n')
      setSaved(text)
      setDraft(text)
      setAuto(snapshot.auto)
      setLoadFailed(false)
      setMessage(undefined)
    } catch {
      /*
        **「读不到配置」和「保存失败」必须分开。**

        反代前缀依赖 fnOS 侧注入的脚本配合；没有注入时这个接口整体不可用。早前把
        它和保存失败塞进同一个 `message`，于是读取失败时仍然渲染出完整的编辑界面
        ——一个填不进内容的文本框、两个永远是灰的按钮，底下一行红字。看起来像功能
        坏了，而不是「这个环境不支持」。

        读取失败时整块换成缺省页并给出重试入口。
      */
      setLoadFailed(true)
    }
    // 不再依赖 `t`：读取失败只切状态，文案由渲染层给。
  }, [])

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

  const toggleGroup = useCallback((prefix: string) => {
    setExpandedGroups(previous => {
      const next = new Set(previous)
      if (next.has(prefix)) next.delete(prefix)
      else next.add(prefix)
      return next
    })
  }, [])

  const groups = auto?.groups ?? []
  /*
    展开的分组前缀集合。默认空集 = **全部折叠**。
    存「expanded」而不是「collapsed」：默认值就是空集，不用初始化时遍历一遍。
  */
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(() => new Set())
  const hasAuto = groups.length > 0

  /** 「插件反代」面板：自动识别 + 手动补充；能力不可用时整块换成缺省页。 */
  const proxyPanel = loadFailed ? (
    /*
      **能力不可用用缺省页，不渲染半残的编辑器。**

      反代前缀依赖 fnOS 侧注入的脚本；没有注入时读接口直接失败。此时保留编辑器会
      得到「填不进内容的文本框 + 两个永远是灰的按钮 + 一行红字」，看着像功能坏了。

      缺省页是「这里现在没有内容」的标准表达，与面板里其它空状态一致；原因放进
      description，重试放在下面——能力恢复后（注入脚本就位）点一下即可。
    */
    <DshEmpty
      className="dsh-fnos-proxy-empty"
      image={<FnosEmptyIllustration size={120} />}
      title={t('gatewayProxyUnavailableTitle')}
      description={(
        <span className="dsh-fnos-proxy-empty-desc">
          {t('gatewayProxyUnavailableHint')}
          <button type="button" className="dsh-fnos-authorized-button" onClick={() => { void load() }}>
            {t('retry')}
          </button>
        </span>
      )}
    />
  ) : (
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
          {/*
            明细列表**不限高度、随内容自增**。

            早前钉了 360px 让它自己滚，理由是「不把手动配置区顶出屏幕」。但列表
            本身就是这份配置的主要内容，砍掉一半高度等于逼用户在小窗口里翻找；
            而外层（tab 内容区）本来就是滚动容器，整页一起滚更符合阅读习惯。
          */}
          <ul className="dsh-fnos-proxy-list">
            {groups.map(group => {
              /*
                **默认全部折叠。** 展开态存进 sets：默认空集就是「全收起」。

                折叠的理由：路由条目是诊断信息，一次看十几条反而看不出重点——
                用户来这一页通常是「某个前缀有没有被接管」，标题一行就够。
              */
              const expanded = expandedGroups.has(group.prefix)
              return (
                <li key={group.prefix} className="dsh-fnos-proxy-item">
                  {/*
                    整行标题都可点：折叠控件做成只有小三角可点是最常见的可用性问题，
                    尤其这一行本身没有别的交互。
                  */}
                  <button
                    type="button"
                    className="dsh-fnos-proxy-item-head"
                    aria-expanded={expanded}
                    onClick={() => { toggleGroup(group.prefix) }}
                  >
                    <span className={`dsh-fnos-proxy-caret${expanded ? ' dsh-fnos-proxy-caret--open' : ''}`} aria-hidden="true">
                      <IconifyIcon name="lucide:chevron-right" />
                    </span>
                    <code className="dsh-fnos-proxy-prefix">{group.prefix}</code>
                    {/* 归属插件：路由表不记 owner，这里是从 loader 条目反推的。 */}
                    {group.pluginName === undefined ? null : (
                      <span className="dsh-fnos-proxy-plugin" title={group.pluginName}>{group.pluginName}</span>
                    )}
                    <span className="dsh-fnos-proxy-count">{`${String(group.routes.length)} ${t('gatewayProxyRoutesUnit')}`}</span>
                    {group.kinds.includes('upgrade') ? (
                      <span className="dsh-fnos-proxy-kind">WS</span>
                    ) : null}
                  </button>
                  {expanded ? (
                    <ul className="dsh-fnos-proxy-routes">
                      {group.routes.map(route => (
                        <li key={route}><code title={route}>{route}</code></li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              )
            })}
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
    <section className="dsh-fnos-plugins" aria-label={t('configSectionPlugins')}>

      {/*
        标题由左侧菜单承担（「插件管理」），这里不再重复一遍「三方插件 proxy」。
        一栏标题 + 一栏 tab 会形成两级标题，而它们说的是同一件事。
      */}
      {/*
        Tab 顺序：工具箱 → 已安装插件 → 反代。

        「工具箱」放排查类工具（npm 镜像、修复安装异常、自定义插件索引），是遇到
        问题时第一个要看的地方，所以排第一；「已安装插件」是日常查看；「反代」是
        配置项，改动频率最低。
      */}
      <DshTabs type="line" className="dsh-fnos-plugins-tabs">
        <DshTabs.TabPane tab={t('gatewayProxyTabToolbox')} itemKey="toolbox">
          {/*
            顺序按「排查路径」排：先看网络（npm 源），再修安装，最后是扩展来源。
          */}
          <div className="dsh-fnos-repair-tab">
            <NpmMirrorCard t={t} />
            <DependencyRepairCard t={t} />
            {/*
              自定义插件索引原先独占一个 tab，但它也是一个「工具」——用来添加
              额外的插件来源，与 npm 源、修复安装同类。合并进工具箱，位置在
              修复之后。
            */}
            <PluginIndexPanel t={t} />
          </div>
        </DshTabs.TabPane>
        <DshTabs.TabPane tab={t('gatewayProxyTabInstalled')} itemKey="installed">
          <InstalledPluginsPanel t={t} />
        </DshTabs.TabPane>
        <DshTabs.TabPane tab={t('gatewayProxyTabProxy')} itemKey="proxy">
          {proxyPanel}
        </DshTabs.TabPane>
      </DshTabs>
    </section>
  )
}
