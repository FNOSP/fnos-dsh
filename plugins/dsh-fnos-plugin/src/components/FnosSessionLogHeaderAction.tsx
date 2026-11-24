/** fnOS Session log menu: preserve DSH computer export and add NAS export. */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconCopyOutlineRegular, IconDownloadOutlineRegular, IconEllipsisOutlineRegular, IconFolderOpenOutlineRegular, IconPaperPlaneOutlineRegular, IconRightUpOutlineRegular, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import { DshEmpty, DshIconFolder, DshModal, DshTooltip, DshTree } from '@tnnevol/dsh-semi-ui'
import { FnosEmptyIllustration } from './FnosEmptyIllustration.tsx'
import { FnosFileManagerIcon } from './FnosFileManagerIcon.tsx'
import { requestAuthorizedEntries, type AuthorizedEntriesResult } from '../client/services/authorized-directories-client.ts'
import { SHOWS_FILE_MANAGER_ENTRY } from '../client/services/runtime-env.ts'
import { exportSessionLogToNas } from '../client/services/session-log-export-client.ts'
import { copySessionMarkdown } from '../client/services/session-markdown-copy.ts'
import { openFnosFileManager } from '../client/services/file-manager.ts'
import { createTrimApp } from '../client/services/sdk.ts'
import { notifyFailure } from '../client/notify.ts'
import type { AuthorizedEntry } from '../contracts/authorized-directories-contract.ts'

/**
 * 会话工作目录的读取形状。
 *
 * 与 `FnosOpenInHeaderAction` 同一理由：`useSessions` 的 selector 参数在本插件
 * 的依赖图里解析成 `any`，与其为读一个字段引入整套会话状态类型，这里显式声明
 * 用到的那一层，保持类型检查有效。
 */
interface SessionListStateLike {
  byId: Record<string, { cwd?: string } | undefined>
}

/** 反馈入口：本仓库地址。 */
const FEEDBACK_URL = 'https://github.com/FNOSP/fnos-dsh'

type HeaderProps = PropsRuntime<'conversation.session.header.utilities'> & PropsLocale<'settings.dsh-fnos'> & {
  sessionId: SessionId
  exportToComputer: (sessionId: SessionId) => Promise<void>
}

/** 在文件管理器中打开会话工作目录；失败经 Toast 报出，不留在按钮上。 */
async function openSessionDirectoryInFileManager(cwd: string | undefined, t: HeaderProps['t']): Promise<void> {
  if (cwd === undefined || cwd === '') return
  try {
    await openFnosFileManager(cwd, () => createTrimApp())
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    notifyFailure(message.includes('fnos-open-blocked') === true
      ? t('openFileManagerBlocked')
      : t('openFileManagerFailed'))
  }
}

interface DirectoryTreeNode {
  key: string
  value: string
  label: ReactNode
  isLeaf: boolean
  children?: DirectoryTreeNode[]
}

function displayName(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts.at(-1) ?? path
}

function directoryNode(entry: AuthorizedEntry, showFullPath = false, isLeaf = false): DirectoryTreeNode {
  return {
    key: entry.path,
    value: entry.path,
    label: (
      <span className="dsh-fnos-session-log-tree-label">
        <DshIconFolder size="small" />
        <span>{showFullPath ? entry.semanticPath : displayName(entry.semanticPath)}</span>
      </span>
    ),
    isLeaf,
  }
}

function replaceChildren(nodes: readonly DirectoryTreeNode[], key: string, children: DirectoryTreeNode[]): DirectoryTreeNode[] {
  return nodes.map(node => {
    if (node.key === key) return { ...node, children, isLeaf: children.length === 0 }
    if (node.children === undefined) return node
    return { ...node, children: replaceChildren(node.children, key, children) }
  })
}

function directoryNodes(result: AuthorizedEntriesResult, showFullPath = false): DirectoryTreeNode[] {
  return result.entries
    .filter(entry => entry.kind === 'directory')
    .map(entry => directoryNode(entry, showFullPath))
}

export function FnosSessionLogHeaderAction({ sessionId, exportToComputer, useSessions, t }: HeaderProps) {
  const [open, setOpen] = useState(false)
  const cwd = useSessions((state: SessionListStateLike) => state.byId[String(sessionId)]?.cwd)
  const [nasDialogVisible, setNasDialogVisible] = useState(false)
  const [treeData, setTreeData] = useState<DirectoryTreeNode[]>([])
  const [selectedDirectory, setSelectedDirectory] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string>()
  /** 复制动作的瞬时反馈：菜单关掉后由触发按钮的 aria-busy 与提示承载。 */
  const [copying, setCopying] = useState(false)

  useEffect(() => {
    if (!nasDialogVisible) return
    let cancelled = false
    setLoading(true)
    setError(undefined)
    void requestAuthorizedEntries().then(result => {
      if (!cancelled) setTreeData(directoryNodes(result, true))
    }).catch(() => {
      if (!cancelled) {
        setTreeData([])
        setError(t('sessionLogNasLoadFailed'))
      }
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [nasDialogVisible, t])

  const loadData = useCallback(async (node: unknown) => {
    const key = typeof node === 'object' && node !== null && 'key' in node && typeof node.key === 'string'
      ? node.key
      : undefined
    if (key === undefined) return
    try {
      const result = await requestAuthorizedEntries(key)
      setTreeData(current => replaceChildren(current, key, directoryNodes(result)))
    } catch {
      setError(t('sessionLogNasLoadFailed'))
    }
  }, [t])

  const openNasDialog = useCallback(() => {
    setSelectedDirectory(undefined)
    setError(undefined)
    setNasDialogVisible(true)
  }, [])

  const closeNasDialog = useCallback(() => {
    if (exporting) return
    setNasDialogVisible(false)
    setSelectedDirectory(undefined)
    setError(undefined)
  }, [exporting])

  const confirmNasExport = useCallback(async () => {
    if (selectedDirectory === undefined) return
    setExporting(true)
    setError(undefined)
    try {
      await exportSessionLogToNas(sessionId, selectedDirectory)
      setNasDialogVisible(false)
      setSelectedDirectory(undefined)
    } catch {
      setError(t('sessionLogNasExportFailed'))
    } finally {
      setExporting(false)
    }
  }, [selectedDirectory, sessionId, t])

  // 反馈入口指向本仓库。用新窗口打开并带 noreferrer，避免把 DSH 页面作为
  // referrer 传给外站，也让 iframe 内的点击不接管当前页。
  const openFeedbackPage = useCallback(() => {
    window.open(FEEDBACK_URL, '_blank', 'noopener,noreferrer')
  }, [])

  const nasExportEnabled = selectedDirectory !== undefined && !loading
  /*
    与官方 session-log-export 一致：菜单项自带图标，触发按钮不带文字。
    结构也对齐官方：第一项是「下载 Session 日志」，本插件额外提供的两种落点
    （电脑 / NAS）挂在它的子菜单里，而不是平铺成两个同级项；第二项是反馈。

    「导出到 NAS」需要宿主桥（走 `openFileManager` 让用户挑目录），独立浏览器
    页面里没有宿主桥，因此该子项按能力隐藏——菜单本身与「下载到电脑」照常可用。
    刷新与重启已移到侧栏底部的「飞牛 OS」下拉菜单：它们是应用级动作，不该和
    当前会话绑在一起。
  */
  const menuItems: MenuEntry[] = [
    {
      id: 'copy',
      label: t('sessionLogCopyMarkdown'),
      icon: <IconCopyOutlineRegular />,
      ...(copying ? { disabled: true } : {}),
    },
    {
      id: 'download',
      label: t('sessionLogDownload'),
      icon: <IconDownloadOutlineRegular />,
      submenu: [
        { id: 'computer', label: t('sessionLogExportComputer'), icon: <IconDownloadOutlineRegular /> },
        ...(SHOWS_FILE_MANAGER_ENTRY
          ? [{ id: 'nas', label: t('sessionLogExportNas'), icon: <IconFolderOpenOutlineRegular /> }]
          : []),
      ],
    },
    /*
      「在应用中打开」：与官方 `open-in-app` 的同名项对齐，但二级只保留
      「文件管理」。

      官方那个菜单项按编译期常量表探测本机应用，会列出 Zed、VS Code 等桌面
      程序，并使用 `openPath` 的关联打开语义；在 fnOS 上那些程序不在 NAS 上，
      列出来也点不开。fnOS 侧真正可用的落点只有一个：用 `openFileManager`
      把会话工作目录交给 NAS 的文件管理器。

      **只在 NAS 内嵌 web 显示**（`SHOWS_FILE_MANAGER_ENTRY`，即
      `isWeb && !isStandaloneWeb`）：

      - 独立浏览器页面没有宿主桥，`openFileManager` 必然失败；
      - App 端（`isWeb === false`）没有文件管理器窗口的概念，跳出去会把用户带离
        当前会话。

      早前这里用的是 `HAS_FNOS_HOST_BRIDGE`——那个常量把 App 端也算作「桥可用」，
      于是手机上也会出现这一项。`SHOWS_FILE_MANAGER_ENTRY` 就是为这类「跨应用
      跳转」准备的，与右键菜单、授权目录卡片共用同一个判据。
    */
    /*
      「在应用中打开」单独成一个单元：上下各一条分割线。

      它是一个**跳出去**的动作（把会话目录交给 NAS 文件管理器），性质与
      「复制」「下载」这类在 DSH 内完成的动作不同。用分割线把它与前后分开，
      读起来是「先做站内的三件事，再决定是否跳出去」，而不是一长串并列项。
      `MenuSeparator` 是官方菜单自带的分组分隔，样式与其它菜单一致。
    */
    ...(SHOWS_FILE_MANAGER_ENTRY
      ? [
          { type: 'separator' as const, id: 'openInApp-before' },
          {
            id: 'openInApp',
            label: t('sessionLogOpenInApp'),
            // 与官方 `open-in-app` 的 session-open-with 同一枚箭头：那个菜单项的
            // icon 是 `open-in-app.application`，未取到应用图标时回退到
            // `IconRightUpOutlineRegular`。这里直接用同一枚，视觉对齐。
            icon: <IconRightUpOutlineRegular />,
            submenu: [
              // 用 NAS 彩色的文件管理器图标：与侧栏那个「文件管理」入口同一枚，
              // 18px 是该组件文档里给的菜单行尺寸。
              { id: 'fileManager', label: t('sessionLogOpenInFileManager'), icon: <FnosFileManagerIcon size={18} /> },
            ],
          },
          { type: 'separator' as const, id: 'openInApp-after' },
        ]
      : []),
    { id: 'feedback', label: t('sessionLogFeedback'), icon: <IconPaperPlaneOutlineRegular /> },
  ]

  /**
   * 复制整段会话为 Markdown。
   *
   * 与官方同源：走 `/api/session.markdown`。功能性失败不弹窗（会打断菜单），
   * 复用菜单行文案承载结果的做法在这里不合适——复制是瞬时动作，因此只在
   * 忙碌期间禁用该行，失败时保持原标签，用户重试即可。
   */
  const copyMarkdown = useCallback(async (): Promise<void> => {
    setCopying(true)
    try {
      await copySessionMarkdown(String(sessionId))
    } finally {
      setCopying(false)
    }
  }, [sessionId])

  return (
    <>
      <Menu
        open={open}
        align="end"
        dense
        // listClassName 是官方留给 portaled 列表的唯一样式钩子：子菜单卡片也在
        // 这个列表里，只有靠它才能把「二级菜单固定向左」限制在本菜单内。
        listClassName="dsh-fnos-session-log-menu"
        items={menuItems}
        onClose={() => { setOpen(false) }}
        onSelect={(id) => {
          setOpen(false)
          if (id === 'copy') void copyMarkdown()
          else if (id === 'computer') void exportToComputer(sessionId)
          else if (id === 'nas') openNasDialog()
          else if (id === 'fileManager') void openSessionDirectoryInFileManager(cwd, t)
          else if (id === 'feedback') openFeedbackPage()
        }}
        anchor={(
          /*
            悬停提示与官方「更多操作」一致：官方那个触发器是
            `Tooltip(label, side=bottom, align=end, portal)` 包着的图标按钮。
            这里用共享半包层的 `DshTooltip` 达到同样效果。
          */
          <DshTooltip content={t('sessionLogMoreActions')} position="bottom">
            <button
              type="button"
              className="dsh-fnos-session-log-button"
              aria-label={t('sessionLogMoreActions')}
              aria-haspopup="menu"
              aria-expanded={open}
              onClick={() => { setOpen(value => !value) }}
            >
              <IconEllipsisOutlineRegular />
            </button>
          </DshTooltip>
        )}
      />
      {/*
        「导出到电脑」不再弹本插件自己的进度框。

        官方 `session-log-export` 在导出时已经弹出它自己的进度/结果提示，我们再弹
        一个就会出现两层弹框叠在一起（真机截图确认过）。导出动作与它的反馈一并
        交给官方，这里只保留菜单项本身。
      */}
      <DshModal
        visible={nasDialogVisible}
        title={t('sessionLogNasTitle')}
        okText={t('sessionLogNasConfirm')}
        cancelText={t('sessionLogNasCancel')}
        confirmLoading={exporting}
        okButtonProps={{
          type: 'primary',
          disabled: !nasExportEnabled,
        }}
        onOk={() => { void confirmNasExport() }}
        onCancel={closeNasDialog}
        width={560}
        className="dsh-fnos-nas-dialog"
      >
        <div className="dsh-fnos-session-log-dialog-body">
          {loading ? <p>{t('sessionLogNasLoading')}</p> : null}
          {error !== undefined ? <p className="dsh-fnos-session-log-error">{error}</p> : null}
          {!loading && error === undefined ? (
            <DshTree
              aria-label={t('sessionLogNasTreeLabel')}
              treeData={treeData}
              value={selectedDirectory}
              selectedKey={selectedDirectory}
              loadData={loadData}
              onSelect={(key: string, selected: boolean) => {
                if (selected) setSelectedDirectory(key)
              }}
              defaultExpandAll={false}
              className="dsh-fnos-session-log-tree"
              // 没有可用目录时给缺省组件，与面板里其它空状态一致。
              emptyContent={(
                <DshEmpty
                  className="dsh-fnos-picker-empty"
                  image={<FnosEmptyIllustration size={96} />}
                  description={t('sessionLogNasEmpty')}
                />
              )}
            />
          ) : null}
        </div>
      </DshModal>
    </>
  )
}
