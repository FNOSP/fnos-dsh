/** Settings card for the fnOS shared-directory authorization list. */

import { useCallback, useEffect, useRef, useState } from 'react'
import { DshModal, DshTooltip, DshTypography } from '@tnnevol/dsh-semi-ui'
import type { FnosLocaleKey } from '../client/locales.ts'
import { diagnosePickerResult, isPickerCancellation, isPickerNoSelection, logPickerSdkEvent, logPickerSdkValue } from '../client/input-references/picker-result.ts'
import { createTrimApp } from '../client/services/sdk.ts'
import { IconifyIcon } from './IconifyIcon.tsx'
import { createAuthState, listenFnosAppAuthResult, openFnosAppAuth, usesAppAuthFlow } from '../client/services/app-auth.ts'
import { openFnosFileManager } from '../client/services/file-manager.ts'
import {
  DirectoryRequestError,
  requestAuthorizedDirectories,
  requestPersistAuthorizedDirectories,
} from '../client/services/authorized-directories-client.ts'
import { evictInvalidAuthorizedDirectories } from '../client/services/authorized-directories-eviction.ts'
import { notifySuccess } from '../client/notify.ts'
import {
  FNOS_AUTHORIZED_DIRECTORIES_DELETE_PATH,
  type AuthorizedDirectory,
} from '../contracts/authorized-directories-contract.ts'

type Translate = (key: FnosLocaleKey) => string

/**
 * Semi 的 `Typography.Text`。
 *
 * `@tnnevol/dsh-semi-ui` 把整个 Typography 作为命名空间对象导出，这里只需要
 * `Text` 一个变体——解构出来用，避免每次写 `<DshTypography.Text>`。
 */
const DshTypographyText = DshTypography.Text

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
export function AuthorizedDirectoriesCard({ t }: AuthorizedDirectoriesCardProps) {
  const [state, setState] = useState<LoadState>({ status: 'idle', directories: [] })
  const [busy, setBusy] = useState(false)
  const [pendingDeletePath, setPendingDeletePath] = useState<string>()
  /** 正在打开哪个目录（按路径区分，避免多行同时转圈）。 */
  const [openingPath, setOpeningPath] = useState<string>()
  const [validateNotice, setValidateNotice] = useState<string>()
  /**
   * 最近一次加载到的目录列表。
   *
   * 增删后的持久化回写发生在 `await refresh()` 之后，此时组件闭包里的
   * `state` 还是旧值；用 ref 读取最新列表，避免把回写建立在过期快照上。
   */
  const directoriesRef = useRef<AuthorizedDirectory[]>([])


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
   * 在 NAS 文件管理器里打开这个目录。
   *
   * 用 `openFileManager` 而不是 `openFile`：后者按文件类型交给系统默认应用，
   * 对目录没有意义。失败时提示而不静默——iframe SDK 未就绪时调用是空操作，
   * 静默失败会让用户以为「按钮坏了」。
   *
   * @param path - 目录的原始绝对路径（不是展示用的 `semanticPath`）。
   */
  const openDirectory = useCallback(async (path: string): Promise<void> => {
    setOpeningPath(path)
    try {
      await openFnosFileManager(path, () => createTrimApp())
      setValidateNotice(undefined)
    } catch (error) {
      setValidateNotice(error instanceof Error && error.message !== '' ? error.message : t('openDirectoryFailed'))
    } finally {
      setOpeningPath(undefined)
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
  }, [refresh])




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

  /**
   * 授权回调的订阅解绑函数。
   *
   * 独立浏览器页面里没有宿子弹窗：`pickSharedFile` 的分支不可用，取而代之是
   * 打开系统授权页，结果通过回调页的 `postMessage` 异步返回。订阅在**发起授权
   * 的那一刻**建立（见 `addDirectory`），这里只保存解绑函数以便复用与卸载清理。
   */
  const authListenerRef = useRef<(() => void) | undefined>(undefined)


  /* 卸载时解绑授权回调订阅：留着会让回调打在已卸载的组件上。 */
  useEffect(() => () => {
    authListenerRef.current?.()
    authListenerRef.current = undefined
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

      /*
        独立浏览器页面没有宿主桥：`pickSharedFile` 只会抛
        `Host bridge is not available outside iframe or app runtime`。
        改走官方给的路子——打开系统授权页，用户在那里确认目录，结果经回调页
        异步返回（监听在下方 `usesAppAuthFlow()` 分支里当场建立）。
      */
      if (usesAppAuthFlow()) {
        phase = 'openAppAuth'
        const state = createAuthState()
        /*
          **在这里直接订阅，而不是「存进 ref 再等 effect」。**

          踩过的坑：早前把 `state` 存进 `useRef` 就返回，指望一个依赖它的
          `useEffect` 去装监听。但 ref 变化**不触发重渲染**，那个 effect 永远
          不会重跑——监听自始至终没装上，于是用户授权完成后列表一直是旧的。

          订阅放在这里也符合时序：授权页已经打开，结果随时可能回来。
        */
        authListenerRef.current?.()
        authListenerRef.current = listenFnosAppAuthResult(state, (result) => {
          authListenerRef.current?.()
          authListenerRef.current = undefined
          if (result.status === 'error') {
            setValidateNotice(result.error === 'access_denied' ? t('permissionDenied') : t('pickFailed'))
            return
          }
          if (result.status === 'cancel') return
          setValidateNotice(undefined)
          /*
            结果到了：重新拉一次列表，新授权的目录立刻出现。

            与宿主动调那条路一样给成功回执——用户从授权页切回来时，如果列表
            只是「悄悄多了一行」，他无法确认这次操作是否真的生效。
          */
          void refresh()
            .then(() => persistCurrentDirectories())
            .then(() => { notifySuccess(t('authorizeSucceeded')) })
            .catch(() => undefined)
        })

        const url = await openFnosAppAuth(
          (method, authParams, options) => sdk.openAppAuth(method, authParams, options),
          state,
        )
        logAuthorizedDirectoryEvent('app-auth-opened', { opened: url !== undefined })
        return
      }

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
        // 只有官方契约的 `access_denied` 才算权限问题。`code === 1` 在部分
        // fnOS 版本里也用于普通取消失败，硬判权限会给出误导性文案。
        throw new DirectoryRequestError(
          diagnosis.error === 'access_denied'
            ? 'fnos-authorized-directory-permission-denied'
            : 'fnos-authorized-directory-request-failed',
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

  /**
   * 取消一个目录的授权。
   *
   * **这是一个异步的后端操作**：撤销 ACL、重拉列表、回写持久化三步都要等。
   * 因此调用方（确认弹框）必须等它结束再关闭弹层，而不是点了就关——否则用户
   * 看到的界面与真实状态对不上，还会以为操作没生效而反复点击。
   *
   * @param path - 目录的原始绝对路径。
   * @returns 操作完成（成功或失败）时 resolve；失败已转成可见错误。
   */
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

  /** 取消授权进行中：弹层不关闭、按钮显示 loading。 */
  const [deletePending, setDeletePending] = useState(false)

  /**
   * 确认取消授权：等后端真正结束再关闭弹层。
   *
   * 用 state 而不是直接 await 在 `onOk` 里，是因为 Semi 的 `onOk` 不消费返回值，
   * 关闭时机必须由 `visible` 自己控制。
   */
  const confirmDelete = useCallback(async (): Promise<void> => {
    const path = pendingDeletePath
    if (path === undefined || deletePending) return
    setDeletePending(true)
    try {
      await removeDirectory(path)
    } finally {
      setDeletePending(false)
      setPendingDeletePath(undefined)
    }
  }, [deletePending, pendingDeletePath, removeDirectory])

  return (
    <div className="dsh-fnos-authorized-card">
      {/*
        * 标题与说明仍然是**标题**而不是可点击的折叠开关。
        * 曾经这里是一个 <button aria-expanded>：整块内容收在折叠面板里，用户要
        * 先点一下才看得到。但这一页只有这一块内容，折叠不承担任何信息架构作用，
        * 只多出一次点击——实机截图里第一眼看到的就是一排折叠标题而不是设置项。
        */}
      {/*
        **不再渲染标题行**。

        分组名「授权目录」已经写在左侧菜单里，这里再写一遍「fnos」/「授权目录」
        是同一信息的重复，还占掉一行高度、把首屏的目录列表往下推——实机截图里
        第一眼看到的是这行标题而不是要操作的目录。

        下方 `.dsh-fnos-authorized-card-body` 自带 `border-top` 作为与面板顶部分隔
        的那条线；移除标题后它直接贴到面板的 16px 上内边距之下，间距仍然成立。
      */}
      {/*
        取消授权是**异步**的（撤销 ACL → 重拉列表 → 回写持久化）。因此：

        - 点「确认」后**不立即关闭**弹层，按钮进入 loading；
        - 等 `removeDirectory` 真正结束再关；
        - loading 期间不允许再次提交，也不允许用取消/关闭打断。

        早前是「点了就关」：弹层瞬间消失，而后台还在跑。用户看不到进度，
        容易以为没生效而重复点击；失败时错误也只落在列表上，与「已取消」的
        观感冲突。
      */}
      <DshModal
        visible={pendingDeletePath !== undefined}
        title={t('delete')}
        content={t('deleteConfirm')}
        okText={t('confirmAction')}
        cancelText={t('discard')}
        confirmLoading={deletePending}
        okButtonProps={{ loading: deletePending, disabled: deletePending }}
        cancelButtonProps={{ disabled: deletePending }}
        closeOnEsc={!deletePending}
        maskClosable={!deletePending}
        onOk={() => { void confirmDelete() }}
        onCancel={() => { if (!deletePending) setPendingDeletePath(undefined) }}
      />
      <div id="dsh-fnos-authorized-directories-body" className="dsh-fnos-authorized-card-body">
          <div className="dsh-fnos-authorized-row">
            {/*
              两个动作改成**纯图标按钮**：文案移进 tooltip。

              原因是它们在列表上方各占一大块宽度，而整行只有这两个动作——文字按钮
              让上方留白比下面的目录行还重。图标 + 悬浮提示既保住可读性，又把视觉
              重心还给目录列表。

              `aria-label` 必须留：图标按钮没有可见文本，没有它读屏软件只会念「按钮」。
            */}
            <DshTooltip content={t('add')}>
              <button
                type="button"
                className="dsh-fnos-icon-button"
                aria-label={t('add')}
                disabled={busy || state.status === 'loading'}
                onClick={() => { void addDirectory() }}
              >
                <IconifyIcon name="lucide:folder-plus" />
              </button>
            </DshTooltip>
            <DshTooltip content={t('refresh')}>
              <button
                type="button"
                className="dsh-fnos-icon-button"
                aria-label={t('refresh')}
                disabled={busy || state.status === 'loading'}
                onClick={() => { void refresh() }}
              >
                <IconifyIcon name="lucide:refresh-cw" />
              </button>
            </DshTooltip>
          </div>
          {state.status === 'loading' ? <p className="dsh-fnos-authorized-body">{t('loading')}</p> : null}
          {state.status === 'error' ? <p className="dsh-fnos-authorized-error">{state.code ?? t('loadFailed')}</p> : null}
          {validateNotice === undefined ? null : <p className="dsh-fnos-authorized-body">{validateNotice}</p>}
          {state.status !== 'loading' && state.directories.length === 0 ? <p className="dsh-fnos-authorized-body">{t('empty')}</p> : null}
          {state.directories.length > 0 ? (
            <ul className="dsh-fnos-authorized-path-list">
              {state.directories.map(directory => (
                <li key={directory.path} className="dsh-fnos-authorized-path-row">
                  {/*
                    路径用 Semi 的 Typography ellipsis，而不是自己写 `text-overflow`。

                    与命令行那处同理：自带 tooltip、只在真的被截断时才提示、跟随主题。
                    路径很容易长到超出卡片宽度（`存储空间 2/@apphome/fn-deepseek-harness`
                    这类），自写省略号只有原生 `title`——延迟约 1 秒、样式不受控。
                  */}
                  <DshTypographyText
                    className="dsh-fnos-authorized-path"
                    ellipsis={{ showTooltip: true }}
                  >
                    {directory.semanticPath}
                  </DshTypographyText>
                  {/*
                    「打开」对每个目录都有意义——包括只读的应用共享目录：用户想确认
                    目录里到底有什么，不该被「不能取消授权」顺带禁掉浏览。
                  */}
                  <button
                    type="button"
                    className="dsh-fnos-authorized-button dsh-fnos-authorized-button--open"
                    disabled={busy || openingPath === directory.path}
                    onClick={() => { void openDirectory(directory.path) }}
                  >
                    {t('open')}
                  </button>
                  {directory.removable ? (
                    <button type="button" className="dsh-fnos-authorized-button dsh-fnos-authorized-button--danger" disabled={busy} onClick={() => { setPendingDeletePath(directory.path) }}>
                      {t('delete')}
                    </button>
                  ) : <span className="dsh-fnos-authorized-read-only">{t('sharedDirectory')}</span>}
                </li>
              ))}
            </ul>
          ) : null}
      </div>
    </div>
  )
}
