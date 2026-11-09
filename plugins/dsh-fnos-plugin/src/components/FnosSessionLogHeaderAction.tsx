/** fnOS Session log menu: preserve DSH computer export and add NAS export. */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconCopyOutlineRegular, IconDownloadOutlineRegular, IconEllipsisOutlineRegular, IconFolderOpenOutlineRegular, IconPaperPlaneOutlineRegular, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuItem } from '@deepseek-ai/dsh-client-ui-primitives'
import { DshIconFolder, DshModal, DshTree } from '@tnnevol/dsh-semi-ui'
import { IconifyIcon } from './IconifyIcon.tsx'
import { requestAuthorizedEntries, type AuthorizedEntriesResult } from '../client/services/authorized-directories-client.ts'
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

/**
 * 网关控制接口的绝对地址。
 *
 * 相对 `<base>` 解析：DSH 在 fnOS 里跑在 iframe 中，`/__fnos-gateway/...` 需要带上
 * 宿主前缀才命中网关。
 */
function gatewayControlUrl(path: string): string {
  if (typeof document === 'undefined') return path
  const base = document.querySelector('base')?.href
  if (base !== undefined) {
    try { return new URL(path.slice(1), base).toString() } catch {}
  }
  return path
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
  const [restarting, setRestarting] = useState(false)
  const [restartFailed, setRestartFailed] = useState(false)
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
  // 与官方 session-log-export 一致：菜单项自带图标，触发按钮不带文字。
  // 结构也对齐官方：第一项是「下载 Session 日志」，本插件额外提供的两种落点
  // （电脑 / NAS）挂在它的子菜单里，而不是平铺成两个同级项；第二项是反馈。
  //
  // 刷新与重启也在这个菜单里，按用户指定排序：**刷新在最上面**（最常用、最轻，
  // 一次重载即可），**重启在反馈下面**（动作最重，需要二次确认）。两者原先常驻
  // 在侧栏底部，占掉两个按钮位——都是低频动作，收进这里更划算。
  // 重启失败时把该行文案换成失败提示：菜单里不弹窗，否则会打断用户操作，
  // 但静默失败又等于没做——所以借这一行的标签承载结果。
  // 重启用电源图标（lucide:power）：与「刷新」的循环箭头一眼可分。官方 primitives
  // 里没有电源字形，Semi 的 IconRestart 实为「跳过/重播」，语义不符。
  const restartItem: MenuItem = restarting
    ? { id: 'restart', label: t('webRestarting'), icon: <IconifyIcon name="lucide:power" />, disabled: true }
    : {
        id: 'restart',
        label: restartFailed ? t('webRestartFailed') : t('webRestart'),
        icon: <IconifyIcon name="lucide:power" />,
      }
  const menuItems: MenuItem[] = [
    {
      id: 'copy',
      label: t('sessionLogCopyMarkdown'),
      icon: <IconCopyOutlineRegular />,
      ...(copying ? { disabled: true } : {}),
    },
    { id: 'refresh', label: t('refresh'), icon: <IconifyIcon name="lucide:refresh-cw" /> },
    {
      id: 'download',
      label: t('sessionLogDownload'),
      icon: <IconDownloadOutlineRegular />,
      submenu: [
        { id: 'computer', label: t('sessionLogExportComputer'), icon: <IconDownloadOutlineRegular /> },
        { id: 'nas', label: t('sessionLogExportNas'), icon: <IconFolderOpenOutlineRegular /> },
      ],
    },
    { id: 'feedback', label: t('sessionLogFeedback'), icon: <IconPaperPlaneOutlineRegular /> },
    restartItem,
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

  const refreshPage = useCallback(() => {
    setOpen(false)
    window.location.reload()
  }, [])

  const restartWeb = useCallback(() => {
    setOpen(false)
    setRestarting(true)
    setRestartFailed(false)
    void (async () => {
      try {
        const response = await fetch(gatewayControlUrl('/__fnos-gateway/control/web/restart'), {
          method: 'POST',
          headers: { 'x-requested-with': 'fetch' },
          credentials: 'same-origin',
        })
        const value: unknown = await response.json().catch(() => undefined)
        if (!response.ok) {
          throw new Error(
            typeof value === 'object' && value !== null && 'error' in value && typeof value.error === 'string'
              ? value.error
              : `HTTP ${response.status}`,
          )
        }
        // 重启会断开当前连接，重载放在断连前，避免界面停在忙碌态。
        window.setTimeout(() => { window.location.reload() }, 300)
      } catch {
        setRestartFailed(true)
      } finally {
        setRestarting(false)
      }
    })()
  }, [])

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
          else if (id === 'refresh') refreshPage()
          else if (id === 'restart') restartWeb()
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
