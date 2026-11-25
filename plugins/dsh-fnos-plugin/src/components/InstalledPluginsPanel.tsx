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
import { logPanelStore } from '../client/log-panel-store.ts'
import { levelOfInstallLine } from '../client/log-line-level.ts'
import { taskStore, useTaskSlot } from '../client/task-store.ts'
import { DshButton, DshPopconfirm as Popconfirm, DshTooltip, DshTypography } from '@tnnevol/dsh-semi-ui'
import type { FnosLocaleKey } from '../client/locales.ts'
import {
  streamInstalledPluginUpdates,
  fetchInstallLog, fetchInstalledPlugins, removePluginByName, togglePlugin } from '../client/services/gateway-proxy-client.ts'
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

/**
 * 「有新版本」结果的本地缓存。
 *
 * 只管一件事：让**确认过的更新标记活过列表重载**。首屏与增删改后的重读都不联网，
 * 若不缓存，装一个插件就会把刚刷新出来的绿标冲掉。
 *
 * 存的是 `包名 → { version, latestVersion, updateAvailable, aheadOfRegistry }`。
 * `version` 是写入时的已装版本——重载时版本一变就说明装过了，缓存自然失效，不会
 * 把旧结论套到新版本上。
 */
const UPDATE_CACHE_KEY = 'dsh-fnos:plugin-updates'

/** 一个包被记住的更新状态。 */
interface RememberedUpdate {
  readonly version: string
  readonly latestVersion?: string
  readonly updateAvailable?: boolean
  readonly aheadOfRegistry?: boolean
}

/** 读缓存（解析失败或环境不允许时当作没有）。 */
function readUpdateCache(): Record<string, RememberedUpdate> {
  try {
    const raw = globalThis.localStorage?.getItem(UPDATE_CACHE_KEY)
    if (typeof raw !== 'string' || raw.length === 0) return {}
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, RememberedUpdate> : {}
  } catch {
    return {}
  }
}

/**
 * 记住一次联网检测的结果。
 *
 * 只记有意义的条目：有更新、或本地版本高于 registry。两者都不成立的（确实是最新）
 * 不必占位——重载后它们本来也显示「已是最新」，没有会丢的信息。
 *
 * @param snapshot - 刚拿到（带更新检测）的清单。
 */
function rememberUpdates(snapshot: InstalledPluginsSnapshot): void {
  try {
    const next: Record<string, RememberedUpdate> = { ...readUpdateCache() }
    for (const plugin of snapshot.plugins) {
      // 未安装的常驻卡片没有「已装版本」，记忆它没有意义。
      if (plugin.absent === true) continue
      if (plugin.updateAvailable !== true && plugin.aheadOfRegistry !== true) {
        delete next[plugin.name]
        continue
      }
      next[plugin.name] = {
        version: plugin.version,
        ...(plugin.latestVersion === undefined ? {} : { latestVersion: plugin.latestVersion }),
        updateAvailable: plugin.updateAvailable === true,
        aheadOfRegistry: plugin.aheadOfRegistry === true,
      }
    }
    globalThis.localStorage?.setItem(UPDATE_CACHE_KEY, JSON.stringify(next))
  } catch {
    // 存不进去（隐私模式、配额满）只是少了持久化，不影响当前这屏。
  }
}

/**
 * 把缓存的更新状态合回一份**不带更新信息**的清单。
 *
 * 只沿用「版本仍然一致」的条目：用户装了新版本之后，旧结论必须作废。
 *
 * @param snapshot - 刚读到的本地清单。
 * @returns 合并后的清单。
 */
function mergeRememberedUpdates(snapshot: InstalledPluginsSnapshot): InstalledPluginsSnapshot {
  const remembered = readUpdateCache()
  if (Object.keys(remembered).length === 0) return snapshot
  return {
    ...snapshot,
    plugins: snapshot.plugins.map(plugin => {
      const hit = remembered[plugin.name]
      if (hit === undefined || hit.version !== plugin.version) return plugin
      return {
        ...plugin,
        ...(hit.latestVersion === undefined ? {} : { latestVersion: hit.latestVersion }),
        ...(hit.updateAvailable === undefined ? {} : { updateAvailable: hit.updateAvailable }),
        ...(hit.aheadOfRegistry === undefined ? {} : { aheadOfRegistry: hit.aheadOfRegistry }),
      }
    }),
  }
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
  /*
    **三个「正在操作谁」的状态都存在 `taskStore` 里，不用组件内 state。**

    弹框关闭会卸载整个面板，组件 state 随之消失：用户重新打开时看到一个正在
    切换的开关会「复位」、或一个正在卸载的卡片恢复可点，与宿主真实状态不一致。
    store 在模块作用域里，重开面板仍能读到。
  */
  const installTask = useTaskSlot('plugin-install')
  const toggleTask = useTaskSlot('plugin-toggle')
  const removeTask = useTaskSlot('plugin-remove')
  const installing = installTask.running ? installTask.target : undefined
  const toggling = toggleTask.running ? toggleTask.target : undefined
  const removingName = removeTask.running ? removeTask.target : undefined
  const [error, setError] = useState<string>()

  /**
   * 取清单。
   *
   * `checkUpdates` 必须由调用方显式传：查更新是「每个插件一次 registry 请求」，
   * 十几个插件就是十几次网络往返，首屏带上会很慢。首屏只读本地清单，**只有用户
   * 点刷新时才联网**。
   */
  /**
   * 把「有没有新版本」记在本地。
   *
   * ## 为什么需要持久化
   *
   * 查更新要联网，首屏不查（十几个插件就是十几次 registry 请求）。但点过刷新
   * 之后**任何一次列表重载都会把结果冲掉**——装一个插件、禁用一个插件、卸载
   * 一个插件都会重读清单，而重读不带更新信息，于是「有新版本」的绿标刚出现就
   * 消失。用户看到的是「刷新了一下，然后标记自己没了」。
   *
   * 这里把**已确认的更新结果**按包名和版本存进 `localStorage`：重载时若插件
   * 版本没变，就沿用上次的结论；版本一变（装了新版本）自然失效。用户仍可用
   * 刷新按钮重新联网核对。
   */
  const load = useCallback(async (checkUpdates = false) => {
    try {
      const next = await fetchInstalledPlugins(checkUpdates)
      if (checkUpdates) rememberUpdates(next)
      setSnapshot(checkUpdates ? next : mergeRememberedUpdates(next))
      setError(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  /**
   * 跑一次流式查更新，把每批结果合并进当前快照。
   *
   * 首屏与刷新共用：两者都是「先出本地清单、再逐批补」。区别只在刷新要显示
   * 按钮转圈。
   *
   * @returns 结束（或出错）时 resolve。
   */
  const runStream = useCallback((): { done: Promise<void>, stop: () => void } => {
    let stop: () => void = () => {}
    const done = new Promise<void>((resolve) => {
      const abort = streamInstalledPluginUpdates({
        onSnapshot: snapshot => { setSnapshot(mergeRememberedUpdates(snapshot)) },
        onUpdates: (batch) => {
          setSnapshot((previous) => {
            if (previous === undefined) return previous
            const byName = new Map(batch.map(item => [item.name, item]))
            const plugins = previous.plugins.map((plugin) => {
              const hit = byName.get(plugin.name)
              if (hit === undefined) return plugin
              return {
                ...plugin,
                ...(hit.latestVersion === undefined ? {} : { latestVersion: hit.latestVersion }),
                ...(hit.updateAvailable === undefined ? {} : { updateAvailable: hit.updateAvailable }),
                ...(hit.aheadOfRegistry === undefined ? {} : { aheadOfRegistry: hit.aheadOfRegistry }),
                ...(hit.incompatible === undefined ? {} : { incompatible: hit.incompatible }),
              }
            })
            /* 顺手记缓存：列表重载时不会把绿标冲掉。 */
            rememberUpdates({ ...previous, plugins })
            return { ...previous, plugins }
          })
        },
        onDone: () => { abort(); resolve() },
        onError: (message) => { setError(message); abort(); resolve() },
      })
      stop = abort
    })
    return { done, stop: () => { stop() } }
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
      await runStream().done
    } finally {
      setRefreshing(false)
    }
  }, [runStream])

  /** 切换启用状态：改 profile patch 的 disabled，不删文件。 */
  const toggleEnabled = useCallback(async (name: string, enabled: boolean) => {
    taskStore.begin('plugin-toggle', name)
    try {
      await togglePlugin(name, enabled)
      await load()
      taskStore.finish('plugin-toggle', 'ok')
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(message)
      taskStore.finish('plugin-toggle', 'failed', message)
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
    /*
      **卸载也走任务浮层。**

      卸载要跑 `pnpm remove` 并改 profile，失败原因（依赖被别的插件引用、权限、
      并发锁）只能从命令输出里看出来。不给日志的话，用户看到的只是一句
      「卸载失败」。
    */
    taskStore.begin('plugin-remove', name)
    logPanelStore.beginTask({ feature: 'install', title: `${t('uninstall')} ${name}` })
    /*
      **浮层只画宿主真正产出的日志。**

      宿主的卸载路径会把官方的 pnpm 输出（`ChangeResult.packageResult.output`）
      与结果写进 `install-log.txt`；这里用与安装相同的 offset 轮询取回它。

      早前这两行是前端手写的（`pnpm remove ${name}` + 「已卸载」）：用户看到的
      **永远是成功叙事**，而失败原因（依赖被引用、权限、并发锁）在命令输出里，
      界面上一个字都没有。
    */
    let offset = 0
    const drain = async (): Promise<void> => {
      const next = await fetchInstallLog(offset)
      if (next.text === '') return
      offset = next.offset
      for (const line of next.text.split('\n')) {
        if (line.trim() !== '') logPanelStore.append(levelOfInstallLine(line), line)
      }
    }
    try {
      const result = await removePluginByName(name)
      await drain()
      logPanelStore.finish('ok')
      taskStore.finish('plugin-remove', 'ok')
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
      /* 失败时更要把宿主的输出取回来——那是唯一能看到 pnpm 报错的地方。 */
      await drain().catch(() => undefined)
      logPanelStore.append('error', message)
      logPanelStore.finish('failed')
      taskStore.finish('plugin-remove', 'failed', message)
      // 后端并发锁的拒绝：说清「是重复操作」，而不是「卸载失败」。
      notifyFailure(message.includes('plugin-remove-in-progress') ? t('pluginRemoveInProgress') : message)
    }
  }, [removingName, load, t])

  useEffect(() => { void load() }, [load])

  /**
   * 首屏之后**自动**流式查一次更新。
   *
   * 先用本地清单把卡片渲染出来，再在后台查——用户不必盯着空白等 registry。
   * 每批（4 个）回来就更新对应卡片：谁先出来谁先显示，不会十几次请求攒到最后
   * 一起刷新。
   *
   * 卸载或重新进入时断开：SSE 连接留着会一直占着宿主的事件循环。
   */
  /* 卸载时断开 SSE：留着会一直占着宿主的事件循环。 */
  useEffect(() => {
    const { stop } = runStream()
    return stop
  }, [runStream])

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
          /*
            **一个插件在忙着装/卸/切开关时，整张列表的写操作都要锁住。**

            安装与卸载都会改写 profile 的 `package.json` 与 lockfile；如果此时
            另一张卡片再发起一次，两次 `pnpm` 会并发改同一份文件——轻则其中一个
            失败，重则留下半安装的 node_modules。用户看到的是「点了更新，另一个
            插件也跟着坏」。

            因此判据是「**有别**的插件在忙」，不是「这一张在忙」：自己那张卡上的
            按钮交给各自的 `loading`/`disabled`，其余的整排置灰。
          */
          const busyElsewhere =
            (installing !== undefined && installing !== plugin.name) ||
            (removingName !== undefined && removingName !== plugin.name) ||
            (toggling !== undefined && toggling !== plugin.name)
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
                    // 别的插件在装/卸/切时不许动：同一时刻只允许一个写操作。
                    {...(plugin.bundled === true || busyElsewhere ? { disabled: true } : {})}
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
                      disabled={busyElsewhere}
                      onClick={() => { taskStore.begin('plugin-install', plugin.name) }}
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
                        // 自己那张卡由 toggling 管；别的插件在忙时整排锁住。
                        disabled={toggling === plugin.name || busyElsewhere}
                        onClick={() => { taskStore.begin('plugin-install', plugin.name) }}
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
                      触发元素：**Popconfirm 包一层 span，Tooltip 与按钮在 span 里面。**

                      为什么不能直接「Popconfirm 包 Tooltip 包按钮」：Semi 的
                      Tooltip 用 `cloneElement` 把事件合并到子按钮上（见 tooltip
                      render 的 `mergeEvents`），而 Popconfirm 外层的 Popover 也
                      要对同一个按钮做一次 cloneElement。两者合到同一个节点上时，
                      后合并的 click 覆盖前者，实测只有 Tooltip 响应，确认层
                      （`.semi-popconfirm`）始终不出现。

                      中间垫一层 span 后，两个浮层各绑各的节点：Popconfirm 监听
                      span 的点击（点在按钮上会冒泡到 span），Tooltip 监听按钮的
                      悬停。两者不再争用同一个元素。

                      `aria-label` 保留：图标按钮没有可见文字，缺了读屏只会念
                      「按钮」。**不用原生 `title`**：它的提示层在浏览器侧、样式与
                      Semi 不一致，且与 Tooltip 并存会同时弹两个气泡。
                    */
                    <Popconfirm
                      title={t('pluginRemoveTitle').replace('{name}', plugin.name)}
                      content={t('pluginRemoveConfirm')}
                      okText={t('uninstall')}
                      cancelText={t('cancel')}
                      /*
                        **确认按钮不做 danger 红。**

                        红色在深色主题下是刺眼的实心块，与这个面板里其它主按钮
                        （纯黑 / 浅色主题下为深色）不属于同一套观感。沿用主按钮的
                        solid 样式，危险语义已由标题「卸载 xxx？」与内容说明表达。
                      */
                      okButtonProps={{ theme: 'solid', type: 'primary' }}
                      /* 不显示图标：Semi 默认给 Popconfirm 加一个警告三角。 */
                      icon={null}
                      position="topRight"
                      onConfirm={() => removePluginFromCard(plugin.name)}
                    >
                      <span className="dsh-fnos-icon-button-slot">
                        <DshTooltip content={t('uninstall')}>
                          <button
                            type="button"
                            className="dsh-fnos-icon-button dsh-fnos-icon-button--danger"
                            aria-label={t('uninstall')}
                            /*
                              自己正在卸载/安装时不许再点；**别的插件在忙时也不许**——
                              两次 pnpm 并发改同一份 package.json 会互相踩。
                            */
                            disabled={removingName === plugin.name || installing === plugin.name || busyElsewhere}
                          >
                            <IconifyIcon name="lucide:trash" />
                          </button>
                        </DshTooltip>
                      </span>
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
                  /* 已有版本 = 更新，否则是首次安装。标题据此不同。 */
                  isUpdate={plugin.version !== undefined && plugin.latestVersion !== undefined && plugin.updateAvailable === true}
                  t={t}
                  onSettled={handleInstallSettled}
                  onDismiss={() => { taskStore.clear('plugin-install') }}
                />
              ) : null}
            </li>
          )
        })}
      </ul>
    </>
  )
}
