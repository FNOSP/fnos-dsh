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
import { DshButton, DshModal, DshSwitch } from '@tnnevol/dsh-semi-ui'
import type { FnosLocaleKey } from '../client/locales.ts'
import { fetchInstalledPlugins, removePluginByName, togglePlugin } from '../client/services/gateway-proxy-client.ts'
import { PluginInstallDialog } from './PluginInstallDialog.tsx'
import { IconifyIcon } from './IconifyIcon.tsx'
import type { InstalledPluginsSnapshot } from '../contracts/gateway-proxy-contract.ts'

type Translate = (key: FnosLocaleKey) => string

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
  /** 待确认卸载的包名；undefined 表示确认框关闭。 */
  const [removing, setRemoving] = useState<string>()
  const [error, setError] = useState<string>()

  const load = useCallback(async () => {
    try {
      setSnapshot(await fetchInstalledPlugins())
      setError(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  /** 手动刷新：重新查 registry，看上游有没有新版本。 */
  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await load()
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
  const confirmRemove = useCallback(async () => {
    const name = removing
    if (name === undefined) return
    setToggling(name)
    try {
      await removePluginByName(name)
      setRemoving(undefined)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setToggling(undefined)
    }
  }, [removing, load])

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
        <DshButton
          htmlType="button"
          size="small"
          theme="borderless"
          type="tertiary"
          loading={refreshing}
          onClick={() => { void refresh() }}
        >
          {t('refresh')}
        </DshButton>
      </div>

      {/*
        卡片而不是表格行：每张卡片承载「这个插件是什么 + 能对它做什么」。
        表格行放不下开关、更新按钮与桥梁警示，挤在一行会读不出来。
      */}
      <ul className="dsh-fnos-cards">
        {snapshot.plugins.map(plugin => {
          const disabled = plugin.enabled === false
          return (
            <li key={plugin.name} className={`dsh-fnos-card${disabled ? ' dsh-fnos-card--off' : ''}`}>
              <div className="dsh-fnos-card-head">
                {/*
                  插件名做成可点击链接：用户想看去处、文档、issue 时有个确定去处。
                  没有 repository 的插件保持纯文本——宁可不做链接，也不给死链。
                */}
                {plugin.repository === undefined ? (
                  <code className="dsh-fnos-card-name">{plugin.name}</code>
                ) : (
                  <a
                    className="dsh-fnos-card-name dsh-fnos-card-name--link"
                    href={plugin.repository}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={plugin.repository}
                  >
                    {plugin.name}
                  </a>
                )}
                <span className="dsh-fnos-card-version">{plugin.version}</span>
                {/*
                  启用开关。放在卡片右上：它是这张卡片最主要的状态。
                  内置插件也允许禁用——「禁用」不删文件、配置仍在，是安全操作。
                */}
                {/*
                  **不带 `size`**：Semi 的 Switch 默认就是药丸形；`size="small"` 会把
                  高度压到 16px、圆角随之变成近似方形，于是同一列表里两个开关看起来
                  不是一套控件（真机截图里第二张卡的开关明显更「方」）。
                */}
                {/*
                  **内置插件只展示、不可操作。**

                  `@tnnevol/dsh-fnos` 是应用与 DSH 之间的桥梁：它一旦被禁用，
                  授权目录、文件打开、网关反代、进程管理全部失效——而「启用回来」
                  这个动作正是它自己提供的功能，用户没有别的入口。

                  置灰而不是隐藏：让人看到「这里有开关、但你不能动」，比整个控件
                  消失更能说清限制的存在。
                */}
                <DshSwitch
                  checked={!disabled}
                  disabled={plugin.bundled === true || toggling === plugin.name}
                  onChange={next => { void toggleEnabled(plugin.name, next) }}
                />
              </div>

              {/* 状态徽标：不兼容 > 有更新 > 本地版本 > 已是最新。 */}
              <div className="dsh-fnos-card-badges">
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
                  /*
                    「已是最新」也用徽标而不是裸文字：它是**状态**，与「有更新」
                    「不兼容」是同一层级的信息。裸文字会让这一行看起来没对齐——
                    同行其它状态都是带底色的块。
                  */
                  <span className="dsh-fnos-installed-badge dsh-fnos-installed-badge--ok">{t('installedUpToDate')}</span>
                )}
                {plugin.bundled ? <span className="dsh-fnos-installed-badge">{t('installedPluginsBundled')}</span> : null}
                {plugin.hasClient ? null : <span className="dsh-fnos-repair-muted">{t('installedPluginsHostOnly')}</span>}
                {disabled ? <span className="dsh-fnos-installed-badge dsh-fnos-installed-badge--off">{t('pluginDisabled')}</span> : null}
              </div>

              {/*
                桥梁提示只给本插件：它是应用与 DSH 之间唯一的通道，卸载后
                授权目录、文件打开、网关反代、进程管理全部失效。
              */}
              {plugin.bundled ? (
                <p className="dsh-fnos-card-note" role="note">{t('installedBundledWarning')}</p>
              ) : null}

              <div className="dsh-fnos-card-actions">
                {plugin.updateAvailable === true ? (
                  <DshButton
                    htmlType="button"
                    size="small"
                    theme="light"
                    type="primary"
                    disabled={toggling === plugin.name}
                    onClick={() => { setInstalling(plugin.name) }}
                  >
                    {t('pluginInstallAction')}
                  </DshButton>
                ) : null}
                {/*
                  内置插件不允许卸载：它是应用的组成部分，删掉之后能力缺口无法
                  通过「重新安装插件」恢复（要重装整个应用）。
                */}
                {plugin.bundled ? null : (
                  <DshButton
                    htmlType="button"
                    size="small"
                    /*
                      `theme="light"` 给的是带浅底的样式；这里要「无背景 + 边框」，
                      用 Semi 的 outline 主题最贴近——它与卡片里的其它次要动作同一档。
                    */
                    theme="outline"
                    type="danger"
                    icon={<IconifyIcon name="lucide:trash" />}
                    disabled={toggling === plugin.name}
                    onClick={() => { setRemoving(plugin.name) }}
                  >
                    {t('uninstall')}
                  </DshButton>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      <DshModal
        visible={removing !== undefined}
        title={t('pluginRemoveTitle')}
        okText={t('confirm')}
        cancelText={t('cancel')}
        onOk={() => { void confirmRemove() }}
        onCancel={() => { setRemoving(undefined) }}
      >
        <p>{`${t('pluginRemoveConfirm')}${removing ?? ''}`}</p>
      </DshModal>

      <PluginInstallDialog
        key={installing ?? 'idle'}
        visible={installing !== undefined}
        {...(installing === undefined ? {} : { name: installing })}
        t={t}
        onClose={() => { setInstalling(undefined) }}
        onSettled={ok => { if (ok) void load() }}
      />
    </>
  )
}
