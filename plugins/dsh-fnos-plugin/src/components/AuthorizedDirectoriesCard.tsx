/** Settings card for the fnOS shared-directory authorization list. */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { DshIconInfoCircle, DshModal, DshTooltip } from '@tnnevol/dsh-semi-ui'
import type { FnosLocaleKey } from '../client/locales.ts'
import { diagnosePickerResult, isPickerCancellation, isPickerNoSelection, logPickerSdkEvent, logPickerSdkValue } from '../client/input-references/picker-result.ts'
import { createTrimApp } from '../client/services/sdk.ts'
import {
  DirectoryRequestError,
  requestAuthorizedDirectories,
  requestPersistAuthorizedDirectories,
} from '../client/services/authorized-directories-client.ts'
import { evictInvalidAuthorizedDirectories } from '../client/services/authorized-directories-eviction.ts'
import {
  FNOS_AUTHORIZED_DIRECTORIES_DELETE_PATH,
  type AuthorizedDirectory,
} from '../contracts/authorized-directories-contract.ts'
import { FNOS_GATEWAY_PROXY_PATHS_ROUTE } from '../contracts/gateway-proxy-contract.ts'
import { isProxyPathsSaveShortcut } from '../client/shortcuts/proxy-paths-save-shortcut.ts'

type Translate = (key: FnosLocaleKey) => string

const AUTHORIZED_DIRECTORY_LOG_PREFIX = '[dsh-fnos][authorized-directories]'

function logAuthorizedDirectoryEvent(stage: string, details: Record<string, unknown>): void {
  console.info(AUTHORIZED_DIRECTORY_LOG_PREFIX, stage, details)
}

function logAuthorizedDirectoryWarning(stage: string, details: Record<string, unknown>): void {
  console.warn(AUTHORIZED_DIRECTORY_LOG_PREFIX, stage, details)
}


type LoadState =
  | { status: 'idle'; directories: AuthorizedDirectory[] }
  | { status: 'loading'; directories: AuthorizedDirectory[] }
  | { status: 'ready'; directories: AuthorizedDirectory[] }
  | { status: 'error'; directories: AuthorizedDirectory[]; code?: string }

export interface AuthorizedDirectoriesCardProps {
  t: Translate
}

/**
 * 本插件在插件管理页里的组合包名（与 package.json 的 name 一致）。
 *
 * 座位 `plugins.detail.section` 是 **list**（不按包名分派）：页面会给打开的每个
 * 详情页渲染它。因此必须自己看 `subject`，不是本插件就返回 `null`——否则这张
 * 授权目录卡片会显示在别的插件详情页上。
 */
export const FNOS_PACKAGE_NAME = '@tnnevol/dsh-fnos'

/** `plugins.detail.section` 传入的 owner props：当前打开页面的主题。 */
export interface FnosDetailSubject {
  readonly kind: string
  readonly pkg?: { readonly name?: string }
}

/**
 * 详情页区块的**座位入口**：先按 subject 过滤，再渲染真正的内容。
 *
 * @param props - owner props（`subject` 由页面给）加上本插件闭包注入的 `t`。
 * @returns 本插件的组合包详情页上渲染卡片，否则 `null`。
 */
export function AuthorizedDirectoriesDetailSection({
  t, subject,
}: AuthorizedDirectoriesCardProps & { subject?: FnosDetailSubject | undefined }) {
  if (subject === undefined) return null
  if (subject.kind !== 'bundle') return null
  if (subject.pkg?.name !== FNOS_PACKAGE_NAME) return null
  return <AuthorizedDirectoriesCard t={t} />
}


async function jsonRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const headers: HeadersInit = { accept: 'application/json' }
  if (typeof navigator === 'object' && typeof navigator.language === 'string' && navigator.language.length > 0) {
    headers['accept-language'] = navigator.language
  }
  if (body !== undefined) headers['content-type'] = 'application/json'
  const response = await fetch(path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    credentials: 'same-origin',
  })
  const value: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    const code = typeof value === 'object' && value !== null && 'error' in value && typeof value.error === 'string'
      ? value.error
      : `HTTP ${response.status}`
    throw new DirectoryRequestError(code)
  }
  return value as T
}

function errorMessage(error: unknown, t: Translate, action: 'load' | 'pick' | 'delete'): string {
  logAuthorizedDirectoryWarning('user-visible-error', {
    action,
    errorType: error instanceof Error ? error.name : typeof error,
    code: error instanceof DirectoryRequestError ? error.code : undefined,
    message: error instanceof Error ? error.message : undefined,
  })
  if (error instanceof DirectoryRequestError) {
    if (error.code === 'fnos-authorized-directory-permission-denied') return t('permissionDenied')
    if (error.code === 'remote-web-origin-not-trusted') return t('originNotTrusted')
    if (error.code === 'fnos-authorized-directory-request-failed') return t('unavailable')
  }
  if (action === 'pick') return t('pickFailed')
  if (action === 'delete') return t('deleteFailed')
  return t('loadFailed')
}

/** Render the fnOS authorization card for the plugin detail page. */
function AuthorizedDirectoriesCard({ t }: AuthorizedDirectoriesCardProps) {
  const [state, setState] = useState<LoadState>({ status: 'idle', directories: [] })
  const [busy, setBusy] = useState(false)
  const [savedProxyPaths, setSavedProxyPaths] = useState('')
  const [proxyPathsDraft, setProxyPathsDraft] = useState('')
  const [proxyMessage, setProxyMessage] = useState<string>()
  const [pendingDeletePath, setPendingDeletePath] = useState<string>()
  const [validateNotice, setValidateNotice] = useState<string>()
  /**
   * 最近一次加载到的目录列表。
   *
   * 增删后的持久化回写发生在 `await refresh()` 之后，此时组件闭包里的
   * `state` 还是旧值；用 ref 读取最新列表，避免把回写建立在过期快照上。
   */
  const directoriesRef = useRef<AuthorizedDirectory[]>([])

  const loadProxyPaths = useCallback(async (): Promise<void> => {
    try {
      const result = await jsonRequest<{ paths?: string[] }>(FNOS_GATEWAY_PROXY_PATHS_ROUTE)
      const text = Array.isArray(result.paths) ? result.paths.join('\n') : ''
      setSavedProxyPaths(text)
      setProxyPathsDraft(text)
      setProxyMessage(undefined)
    } catch { setProxyMessage(t('gatewayProxyFailed')) }
  }, [t])

  const refresh = useCallback(async (): Promise<void> => {
    logAuthorizedDirectoryEvent('refresh-start', {})
    setState(current => ({ status: 'loading', directories: current.directories }))
    try {
      const directories = await requestAuthorizedDirectories()
      logAuthorizedDirectoryEvent('refresh-success', { count: directories.length })
      // 剔除失效项（FNOS-009-10）。Host 已用无交互查询接口标注每条目录的
      // `valid`，这里只做筛选：不再逐个路径申请授权，因此不会弹确认框。
      const result = evictInvalidAuthorizedDirectories(directories)
      const notice = result.noticeKey === undefined ? undefined : t(result.noticeKey)
      const visible = result.directories
      if (result.evicted) {
        // 剔除即时生效：同步回写持久化，下次加载不再出现。
        await requestPersistAuthorizedDirectories(visible.filter(item => item.removable).map(item => item.path))
          .catch(error => logAuthorizedDirectoryWarning('evict-persist-failed', {
            message: error instanceof Error ? error.message : undefined,
          }))
      }
      setValidateNotice(notice)
      directoriesRef.current = visible
      setState({ status: 'ready', directories: visible })
    } catch (error: unknown) {
      logAuthorizedDirectoryWarning('refresh-failed', {
        errorType: error instanceof Error ? error.name : typeof error,
        code: error instanceof DirectoryRequestError ? error.code : undefined,
        message: error instanceof Error ? error.message : undefined,
      })
      setState(current => ({ status: 'error', directories: current.directories, code: errorMessage(error, t, 'load') }))
    }
  }, [t])

  /**
   * 挂载即拉取。
   *
   * 这里**不能**再依赖「被展开」：折叠已移除，这一页只有这一块内容，等待用户
   * 点一下才发请求只会让首屏空着。
   */
  useEffect(() => {
    void refresh()
    void loadProxyPaths()
  }, [loadProxyPaths, refresh])

  const saveProxyPaths = useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      const paths = proxyPathsDraft.split(/\r?\n/u).map(value => value.trim()).filter(Boolean)
      const result = await jsonRequest<{ paths: string[] }>(FNOS_GATEWAY_PROXY_PATHS_ROUTE, 'PUT', { version: 1, paths })
      const text = result.paths.join('\n')
      setSavedProxyPaths(text)
      setProxyPathsDraft(text)
      setProxyMessage(t('gatewayProxySaved'))
    } catch (error: unknown) {
      setProxyMessage(error instanceof DirectoryRequestError && error.code === 'invalid-gateway-proxy-paths' ? t('gatewayProxyInvalid') : t('gatewayProxyFailed'))
    }
    finally { setBusy(false) }
  }, [proxyPathsDraft, t])

  const handleProxyPathsKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (!isProxyPathsSaveShortcut(event)) return
    // Suppress the browser's Save-page dialog and stop the gesture from
    // reaching outer handlers (the DSH shell registers global hotkeys).
    event.preventDefault()
    event.stopPropagation()
    if (!busy && proxyPathsDraft !== savedProxyPaths) void saveProxyPaths()
  }, [busy, proxyPathsDraft, saveProxyPaths, savedProxyPaths])

  /**
   * 把当前可移除目录写进持久化记录（FNOS-009-09）。
   *
   * 只写用户自己添加的项：只读的应用共享路径由 fnOS 声明，不属于用户授权，
   * 写进去会在下次加载时变成一条无法移除的假记录。失败只记日志——持久化是
   * 增强项，不能因为写盘失败让页面报错（09-AC-03）。
   */
  const persistCurrentDirectories = useCallback(async (): Promise<void> => {
    const paths = directoriesRef.current.filter(item => item.removable).map(item => item.path)
    try {
      await requestPersistAuthorizedDirectories(paths)
    } catch (error: unknown) {
      logAuthorizedDirectoryWarning('persist-failed', {
        message: error instanceof Error ? error.message : undefined,
      })
    }
  }, [])

  const addDirectory = useCallback(async (): Promise<void> => {
    setBusy(true)
    let phase = 'createTrimApp'
    try {
      const sdk = createTrimApp()
      const params = {
        title: t('add'),
        okText: t('confirm'),
        sidebarGroup: ['myFiles', 'otherShare', 'external', 'remote', 'favorites'],
      } as const
      logPickerSdkEvent('created', {
        isWeb: sdk.isWeb,
        isStandaloneWeb: sdk.isStandaloneWeb,
        params: {
          title: params.title,
          okText: params.okText,
          sidebarGroup: params.sidebarGroup,
        },
      })

      phase = 'ready'
      await sdk.ready()
      logPickerSdkEvent('ready', { isWeb: sdk.isWeb, isStandaloneWeb: sdk.isStandaloneWeb })

      phase = 'pickSharedFile'
      const result = await sdk.pickSharedFile(params)
      const diagnosis = logPickerSdkValue('resolved', result)
      const noSelection = isPickerNoSelection(result)
      logAuthorizedDirectoryEvent('picker-decision', {
        outcome: diagnosis.outcome,
        reason: diagnosis.reason,
        code: diagnosis.code,
        status: diagnosis.status,
        noSelection,
      })
      if (diagnosis.outcome === 'cancelled' || noSelection) {
        logAuthorizedDirectoryEvent('picker-silent-cancel', { reason: noSelection ? 'empty-success-data' : diagnosis.reason })
        return
      }
      if (diagnosis.outcome !== 'success') {
        throw new DirectoryRequestError(
          diagnosis.code === 1 ? 'fnos-authorized-directory-permission-denied' : 'fnos-authorized-directory-request-failed',
          diagnosis.message ?? diagnosis.error ?? `fnOS picker returned ${diagnosis.reason}`,
        )
      }
      // 用户主动授权成功：刷新列表后把可移除项写入持久化（FNOS-009-09-AC-01）。
      await refresh()
      await persistCurrentDirectories()
    } catch (error: unknown) {
      const diagnosis = diagnosePickerResult(error)
      logPickerSdkEvent('rejected', { phase, diagnosis })
      logAuthorizedDirectoryWarning('picker-catch', {
        phase,
        outcome: diagnosis.outcome,
        reason: diagnosis.reason,
        code: diagnosis.code,
        message: diagnosis.message,
      })
      if (phase === 'pickSharedFile') {
        logAuthorizedDirectoryEvent('picker-silent-cancel', { reason: diagnosis.reason, outcome: diagnosis.outcome })
        return
      }
      if (isPickerCancellation(error)) return
      setState(current => ({ status: 'error', directories: current.directories, code: errorMessage(error, t, 'pick') }))
    } finally {
      setBusy(false)
    }
  }, [refresh, t, persistCurrentDirectories])

  const removeDirectory = useCallback(async (path: string): Promise<void> => {
    setBusy(true)
    try {
      await jsonRequest(FNOS_AUTHORIZED_DIRECTORIES_DELETE_PATH, 'POST', { path })
      await refresh()
      // 取消授权后同步持久化，避免下次加载把已移除的目录又显示出来。
      await persistCurrentDirectories()
    } catch (error: unknown) {
      setState(current => ({ status: 'error', directories: current.directories, code: errorMessage(error, t, 'delete') }))
    } finally {
      setBusy(false)
    }
  }, [refresh, t, persistCurrentDirectories])

  return (
    <div className="dsh-fnos-authorized-card">
      {/*
        * 标题与说明仍然是**标题**而不是可点击的折叠开关。
        * 曾经这里是一个 <button aria-expanded>：整块内容收在折叠面板里，用户要
        * 先点一下才看得到。但这一页只有这一块内容，折叠不承担任何信息架构作用，
        * 只多出一次点击——实机截图里第一眼看到的就是一排折叠标题而不是设置项。
        */}
      <div className="dsh-fnos-authorized-card-header">
        <span className="dsh-fnos-authorized-card-head-text">
          <span className="dsh-fnos-authorized-card-name">{t('title')}</span>
          <span className="dsh-fnos-authorized-card-description">{t('intro')}</span>
        </span>
      </div>
      <DshModal
        visible={pendingDeletePath !== undefined}
        title={t('delete')}
        content={t('deleteConfirm')}
        okText={t('confirm')}
        cancelText={t('discard')}
        onOk={() => {
          if (pendingDeletePath !== undefined) void removeDirectory(pendingDeletePath)
          setPendingDeletePath(undefined)
        }}
        onCancel={() => { setPendingDeletePath(undefined) }}
      />
      <div id="dsh-fnos-authorized-directories-body" className="dsh-fnos-authorized-card-body">
          <div className="dsh-fnos-authorized-row">
            <button type="button" className="dsh-fnos-authorized-button dsh-fnos-authorized-button--primary" disabled={busy || state.status === 'loading'} onClick={() => { void addDirectory() }}>
              {t('add')}
            </button>
             <button type="button" className="dsh-fnos-authorized-button" disabled={busy || state.status === 'loading'} onClick={() => { void refresh() }}>
              {t('refresh')}
            </button>
          </div>
          {state.status === 'loading' ? <p className="dsh-fnos-authorized-body">{t('loading')}</p> : null}
          {state.status === 'error' ? <p className="dsh-fnos-authorized-error">{state.code ?? t('loadFailed')}</p> : null}
          {validateNotice === undefined ? null : <p className="dsh-fnos-authorized-body">{validateNotice}</p>}
          {state.status !== 'loading' && state.directories.length === 0 ? <p className="dsh-fnos-authorized-body">{t('empty')}</p> : null}
          {state.directories.length > 0 ? (
            <ul className="dsh-fnos-authorized-path-list">
              {state.directories.map(directory => (
                <li key={directory.path} className="dsh-fnos-authorized-path-row">
                  <span title={directory.semanticPath} className="dsh-fnos-authorized-path">{directory.semanticPath}</span>
                  {directory.removable ? (
                    <button type="button" className="dsh-fnos-authorized-button dsh-fnos-authorized-button--danger" disabled={busy} onClick={() => { setPendingDeletePath(directory.path) }}>
                      {t('delete')}
                    </button>
                  ) : <span className="dsh-fnos-authorized-read-only">{t('sharedDirectory')}</span>}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="dsh-fnos-authorized-gateway">
            <div className="dsh-fnos-authorized-gateway-head">
              <strong className="dsh-fnos-authorized-gateway-title">{t('gatewayProxyTitle')}</strong>
              {/*
                * 说明收进 tip 图标。
                *
                * 原先是一段平铺在标题下的长句，占掉两行还挤不出信息量。`tabIndex`
                * 与 `aria-label` 是必需的：说明只存在于悬浮层时，键盘与读屏用户
                * 拿不到它——那等于把这部分用户排除在这条说明之外。
                *
                * `className` 是必需的：文案按「是什么 / 怎么写 / 举例子」分三行，
                * 浮层被 portal 到 body，只能靠这个专用类拿到 `white-space: pre-line`
                * （直接改 `.semi-tooltip-wrapper` 会波及所有提示）。
                */}
              <DshTooltip className="dsh-fnos-gateway-tip-content" content={t('gatewayProxyDescription')}>
                <span
                  className="dsh-fnos-authorized-gateway-tip"
                  tabIndex={0}
                  aria-label={t('gatewayProxyDescription')}
                >
                  <DshIconInfoCircle />
                </span>
              </DshTooltip>
            </div>
            <textarea value={proxyPathsDraft} placeholder={t('gatewayProxyPlaceholder')} className="dsh-fnos-authorized-textarea" disabled={busy} onKeyDown={handleProxyPathsKeyDown} onChange={event => { setProxyPathsDraft(event.currentTarget.value); setProxyMessage(undefined) }} />
            {proxyMessage === undefined ? null : <p className="dsh-fnos-authorized-body dsh-fnos-authorized-gateway-message">{proxyMessage}</p>}
            <div className="dsh-fnos-authorized-row dsh-fnos-authorized-row--end">
              <button type="button" className="dsh-fnos-authorized-button" disabled={busy || proxyPathsDraft === savedProxyPaths} onClick={() => { setProxyPathsDraft(savedProxyPaths); setProxyMessage(undefined) }}>{t('discard')}</button>
              <button type="button" className="dsh-fnos-authorized-button dsh-fnos-authorized-button--primary" disabled={busy || proxyPathsDraft === savedProxyPaths} onClick={() => { void saveProxyPaths() }}>{t('save')}</button>
            </div>
          </div>
      </div>
    </div>
  )
}
