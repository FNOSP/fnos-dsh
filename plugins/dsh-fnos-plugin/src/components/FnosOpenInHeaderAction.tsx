/**
 * fnOS 原生文件入口：替代 DSH 官方「打开应用」分体按钮。
 *
 * 结构与交互对齐官方 `@deepseek-ai/dsh-client-ui-open-in-app` 的
 * `OpenInAppAction`：一个 28px 高的分体按钮，左半执行当前选中的文件操作
 * （只放该操作的图标，15px），右半是 chevron（11px），点击展开菜单选择。
 * 两半之间有发丝分隔线，各自有 hover 反馈，整体与头部其它控件同高。
 *
 * 为什么遮蔽官方入口：官方按钮按编译期常量表 `OPEN_IN_APP_CATALOG` 探测本机
 * 应用，Linux 上 `zed` 条目只以「PATH 里存在名为 `zed` 的可执行文件」为依据。
 * fnOS 基于 Debian 且启用 ZFS，系统自带 `/usr/sbin/zed`（ZFS Event Daemon），
 * 于是被误判为 Zed 编辑器；而图标提取要求同名 desktop 条目
 * `dev.zed.Zed.desktop`，该文件并不存在，图标路由返回 404。结果就是菜单里出现
 * 一个只有通用字形、点了也打不开编辑器的条目。该常量表不可配置，插件也没有
 * 注册接口，本仓库纪律又禁止提交上游补丁，因此在 fnOS 环境内遮蔽它。
 *
 * 菜单项由数组驱动，后续追加 fnOS 文件能力时只需增加一项并补文案。
 */

import { useCallback, useState } from 'react'
import type { ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: 拉入 ui-session 对 GlobalStandardProps/SessionStandardProps 的合并，
// `useSessions` 与 `sessionId` 才有类型（否则座位标准套件解析成空对象）。
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { IconChevronDownOutlineRegular, Menu, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuItem } from '@deepseek-ai/dsh-client-ui-primitives'
import { FnosFileManagerIcon } from './FnosFileManagerIcon.tsx'
import { HAS_FNOS_HOST_BRIDGE, IS_FNOS_STANDALONE_WEB_ENV } from '../client/services/runtime-env.ts'
import { notifyFailure } from '../client/notify.ts'
import { openFnosFileManager } from '../client/services/file-manager.ts'
import { createTrimApp } from '../client/services/sdk.ts'
import type { FnosLocaleKey } from '../client/locales.ts'

type Translate = (key: FnosLocaleKey) => string

/**
 * 从会话列表状态里取工作目录所需的最小形状。
 *
 * `useSessions` 的 selector 参数在本插件的依赖图里解析成 `any`（`ui-session`
 * 的合并只声明了 hook 本身，状态类型来自 `dsh-api-session-controller/client`，
 * 而该包不在本插件的依赖中）。与其为读一个字段而引入整套会话状态类型，这里
 * 显式声明用到的那一层，保持类型检查有效而不是退回 `any`。
 */
interface SessionListStateLike {
  byId: Record<string, { cwd?: string } | undefined>
}

export type FnosOpenInHeaderActionProps =
  PropsRuntime<'conversation.session.header.utilities'>
  & PropsLocale<'settings.dsh-fnos'>
  & { t: Translate }

/** 一次文件操作：菜单行与左半按钮共用同一条定义。 */
export interface FnosFileAction {
  readonly id: string
  /** 下拉菜单项的文案。 */
  readonly label: (t: Translate) => string
  /** 左侧主按钮 tooltip 的文案，应用名称由当前菜单项动态传入。 */
  readonly tooltip: (t: Translate, appName: string) => string
  /**
   * 该操作的图标，按需要的尺寸渲染。
   *
   * 官方在按钮里用 15px、菜单行里用 18px，这里保持同样的区分，让分体按钮
   * 与菜单的图标比例和官方一致。
   */
  readonly icon: (size: number) => ReactNode
  /** 在给定工作目录上执行。 */
  readonly run: (cwd: string) => Promise<void>
}

/**
 * 打开 NAS 文件管理器。用 `openFileManager` 而不是 `openFile`：后者按文件类型
 * 交给系统默认应用，对目录没有意义。
 */
const OPEN_FILE_MANAGER: FnosFileAction = {
  id: 'file-manager',
  label: t => t('fileManager'),
  tooltip: (t, appName) => t('openInAppTooltip').replace('{app}', appName),
  icon: size => <FnosFileManagerIcon size={size} />,
  run: cwd => openFnosFileManager(cwd, () => createTrimApp()),
}

/**
 * 当前提供的 fnOS 文件操作。左半按钮执行首项，右半菜单列出全部。
 *
 * 只放「打开文件管理器」：`trim.preview` 与 `trim.text-editor` 都按具体文件
 * 路径工作，对工作目录没有意义，需要先确定作用对象再接入。
 */
const FILE_ACTIONS: readonly FnosFileAction[] = [OPEN_FILE_MANAGER]

export function FnosOpenInHeaderAction({ sessionId, useSessions, t }: FnosOpenInHeaderActionProps) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const cwd = useSessions((state: SessionListStateLike) => state.byId[String(sessionId)]?.cwd)
  const current = OPEN_FILE_MANAGER

  const launch = useCallback((action: FnosFileAction) => {
    if (cwd === undefined || cwd === '') return
    setBusy(true)
    void action.run(cwd).then(
      () => { setBusy(false) },
      (error: unknown) => {
        setBusy(false)
        /*
          **失败用 Toast，不把错误状态画在按钮上。**

          早前把它记进 `lastErrorRef` 再把按钮切成 `data-state="error"`，于是
          按钮变成常驻的错误外观 + 一段长文案贴在 tooltip 里——截图里那个挂着的
          「无法打开 NAS 文件管理器。」就是它。错误是一次操作的瞬时结果，不该
          留在按钮这种「持续状态」的载体上；它也不会自己消失，下次成功前一直挂着。

          被弹窗拦截是可指导用户放行的具体情况，与其它失败分开说。
        */
        const message = error instanceof Error ? error.message : String(error)
        notifyFailure(message.includes('fnos-open-blocked') === true
          ? t('openFileManagerBlocked')
          : t('openFileManagerFailed'))
      },
    )
  }, [cwd, t])

  /*
    **只在有宿主桥的环境渲染：fnOS App 与 NAS web 内嵌都显示，独立 web 不显示。**

    | 环境 | 判据 | 显示 |
    | --- | --- | --- |
    | fnOS App（mobile / 原生宿主） | `isWeb === false` | 显示 |
    | NAS web 内嵌（应用中心 iframe） | `isWeb && !isStandaloneWeb` | 显示 |
    | 独立 web（浏览器直接打开） | `isWeb && isStandaloneWeb` | **不显示** |

    独立 web 里没有宿主桥，调用必然失败。曾试过退而用 `openURL` 打开 fnOS 桌面
    首页，但那是「打开了个网页」而不是「定位到这个目录」——用户点了被丢回桌面，
    还得自己再找一遍，比没有这个按钮更差。所以不渲染，而不是给一个必然失败的入口。

    判据来自 `runtime-env.ts` 的静态常量，不在这里现算：这些标志在页面生命周期
    内不变，集中定义后读代码时不必再推演两个标志的组合。
  */
  if (!HAS_FNOS_HOST_BRIDGE || IS_FNOS_STANDALONE_WEB_ENV) return null
  // 工作目录未知时打开没有意义，直接不渲染，避免给出一个必然失败的操作。
  if (cwd === undefined || cwd === '') return null

  const items: MenuItem[] = FILE_ACTIONS.map(action => ({
    id: action.id,
    label: action.label(t),
    icon: action.icon(18),
  }))
  const currentLabel = current.label(t)
  // tooltip 只描述「这个按钮做什么」；失败走 Toast，不再改写按钮外观。
  const title = current.tooltip(t, currentLabel)

  return (
    <Menu
      open={open}
      align="end"
      dense
      selection="fill"
      onClose={() => { setOpen(false) }}
      items={items}
      selectedId={current.id}
      onSelect={(id) => {
        setOpen(false)
        // 忙碌中忽略选择，避免把「选中了但没执行」的状态留在按钮上。
        if (busy) return
        const action = FILE_ACTIONS.find(entry => entry.id === id)
        if (action !== undefined) launch(action)
      }}
      anchor={(
        <div className="dsh-fnos-open-in-split">
          <Tooltip label={title} side="bottom">
            <button
              type="button"
              className="dsh-fnos-open-in-main"
              data-state={busy ? 'busy' : 'idle'}
              disabled={busy}
              aria-label={title}
              onClick={() => { launch(current) }}
            >
              <span className="dsh-fnos-open-in-icon">{current.icon(15)}</span>
            </button>
          </Tooltip>
          <button
            type="button"
            className="dsh-fnos-open-in-chevron"
            aria-expanded={open}
            aria-haspopup="menu"
            title={t('openInFnosMenu')}
            aria-label={t('openInFnosMenu')}
            onClick={() => { setOpen(value => !value) }}
          >
            <IconChevronDownOutlineRegular size={11} />
          </button>
        </div>
      )}
    />
  )
}
