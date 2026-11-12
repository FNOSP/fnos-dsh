/** fnOS Session log menu: preserve DSH computer export and add NAS export. */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconCopyOutlineRegular, IconDownloadOutlineRegular, IconEllipsisOutlineRegular, IconFolderOpenOutlineRegular, IconPaperPlaneOutlineRegular, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuItem } from '@deepseek-ai/dsh-client-ui-primitives'
import { DshIconFolder, DshModal, DshTree } from '@tnnevol/dsh-semi-ui'
import { requestAuthorizedEntries, type AuthorizedEntriesResult } from '../client/services/authorized-directories-client.ts'
import { hasFnosHostBridge } from '../client/services/environment.ts'
import { exportSessionLogToNas } from '../client/services/session-log-export-client.ts'
import { copySessionMarkdown } from '../client/services/session-markdown-copy.ts'
import type { AuthorizedEntry } from '../contracts/authorized-directories-contract.ts'

/** 反馈入口：本仓库地址。 */
const FEEDBACK_URL = 'https://github.com/FNOSP/fnos-dsh'


interface SessionLogDownloadEntry {
  open: boolean
  status: 'downloading' | 'success' | 'error'
  error: string | null
}

interface SessionLogDownloadState {
  bySession: Record<string, SessionLogDownloadEntry | undefined>
}

type SessionLogDownloadSelector = <Selected>(
  selector: (state: SessionLogDownloadState) => Selected,
  equality?: (left: Selected, right: Selected) => boolean,
) => Selected

type HeaderProps = PropsRuntime<'conversation.session.header.utilities'> & PropsLocale<'settings.dsh-fnos'> & {
  sessionId: SessionId
  exportToComputer: (sessionId: SessionId) => Promise<void>
  useSessionLogDownload: SessionLogDownloadSelector
  dismissDownload: (sessionId: SessionId) => void
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

export function FnosSessionLogHeaderAction({ sessionId, exportToComputer, useSessionLogDownload, dismissDownload, t }: HeaderProps) {
  const [open, setOpen] = useState(false)
  const [nasDialogVisible, setNasDialogVisible] = useState(false)
  const [treeData, setTreeData] = useState<DirectoryTreeNode[]>([])
  const [selectedDirectory, setSelectedDirectory] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string>()
  /** 复制动作的瞬时反馈：菜单关掉后由触发按钮的 aria-busy 与提示承载。 */
  const [copying, setCopying] = useState(false)
  const browserDownload = useSessionLogDownload(state => state.bySession[String(sessionId)])
  const browserStatus = browserDownload?.status
  const browserDialogTitle = browserStatus === 'downloading'
    ? t('sessionLogDialogPreparingTitle')
    : browserStatus === 'success' ? t('sessionLogDialogSuccessTitle') : t('sessionLogDialogErrorTitle')
  const browserDialogDescription = browserStatus === 'downloading'
    ? t('sessionLogDialogPreparingDescription')
    : browserStatus === 'success'
      ? t('sessionLogDialogSuccessDescription')
      : browserDownload?.error ?? t('sessionLogDialogCommandFailed')

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
  const menuItems: MenuItem[] = [
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
        ...(hasFnosHostBridge()
          ? [{ id: 'nas', label: t('sessionLogExportNas'), icon: <IconFolderOpenOutlineRegular /> }]
          : []),
      ],
    },
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
          else if (id === 'feedback') openFeedbackPage()
        }}
        anchor={(
          <button
            type="button"
            className="dsh-fnos-session-log-button"
            aria-label={t('sessionLog')}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => { setOpen(value => !value) }}
          >
            <IconEllipsisOutlineRegular />
          </button>
        )}
      />
      <DshModal
        visible={browserDownload?.open === true}
        title={browserDialogTitle}
        hasCancel={false}
        okText={t('sessionLogDialogClose')}
        onOk={() => { dismissDownload(sessionId) }}
        onCancel={() => { dismissDownload(sessionId) }}
        width={480}
      >
        <p>{browserDialogDescription}</p>
      </DshModal>
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
              emptyContent={t('sessionLogNasEmpty')}
            />
          ) : null}
        </div>
      </DshModal>
    </>
  )
}
