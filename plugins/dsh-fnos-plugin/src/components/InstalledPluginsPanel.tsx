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
import { DshButton } from '@tnnevol/dsh-semi-ui'
import type { FnosLocaleKey } from '../client/locales.ts'
import { fetchInstalledPlugins } from '../client/services/gateway-proxy-client.ts'
import { PluginInstallDialog } from './PluginInstallDialog.tsx'
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
      {/*
        刷新：重新检测上游是否有新版本。
        放在列表上方而不是页头——它是这个列表的动作，作用域只有这一块。
      */}
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
      <ul className="dsh-fnos-installed">
      {snapshot.plugins.map(plugin => (
        <li key={plugin.name} className="dsh-fnos-installed-item">
          <div className="dsh-fnos-installed-main">
          <code className="dsh-fnos-installed-name">{plugin.name}</code>
          {/*
            本插件是飞牛应用与 DSH 之间的**桥梁**：授权目录、文件打开、网关反代、
            进程管理全靠它。卸载后应用仍能启动，但这些能力全部消失，用户会以为
            「应用坏了」。这里必须直说，而不是只标一个「内置」。
          */}
          {plugin.bundled ? (
            <span className="dsh-fnos-installed-note" role="note">
              {t('installedBundledWarning')}
            </span>
          ) : null}
          </div>
          <span className="dsh-fnos-installed-version">{plugin.version}</span>
          {/*
            更新提示有三态，且**不兼容时不提示更新**：装上去起不来比「没更新」更糟。
            不兼容单独标出来，用户才知道该去升 DSH 而不是升插件。
          */}
          {plugin.incompatible === true ? (
            <span className="dsh-fnos-installed-badge dsh-fnos-installed-badge--warn" title={JSON.stringify(plugin.requirements ?? {})}>
              {t('installedIncompatible')}
            </span>
          ) : plugin.updateAvailable === true ? (
            <>
              <span className="dsh-fnos-installed-badge dsh-fnos-installed-badge--ok">
                {`${t('installedUpdateAvailable')} ${plugin.latestVersion ?? ''}`}
              </span>
              {/*
                有更新时给一个安装入口。装的是**按 DSH 基线挑出来的版本**，不是
                registry 的 latest——latest 常要求更新的基线，装上起不来。
              */}
              <DshButton
                htmlType="button"
                size="small"
                theme="light"
                type="primary"
                onClick={() => { setInstalling(plugin.name) }}
              >
                {t('pluginInstallAction')}
              </DshButton>
            </>
          ) : plugin.latestVersion === undefined ? null : plugin.aheadOfRegistry === true ? (
            // 本地比 registry 新：开发/内测，不能说「已是最新」。
            <span className="dsh-fnos-installed-badge">{t('installedAheadOfRegistry')}</span>
          ) : (
            <span className="dsh-fnos-repair-muted">{t('installedUpToDate')}</span>
          )}
          {plugin.bundled ? <span className="dsh-fnos-installed-badge">{t('installedPluginsBundled')}</span> : null}
          {plugin.hasClient ? null : <span className="dsh-fnos-repair-muted">{t('installedPluginsHostOnly')}</span>}
        </li>
      ))}
        </ul>
      <PluginInstallDialog
        /* key 让每次安装都是新实例：日志与状态自动归零，不必在 effect 里重置。 */
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
