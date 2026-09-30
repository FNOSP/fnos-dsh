/** Account and model settings for the Codex Auth plugin. */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { DshButton, DshIconCheckCircle, DshTypography } from '@tnnevol/dsh-semi-ui'
import type { CodexAuthLocaleKey } from '../client/locales.ts'
import { openAuthorizationWindow } from '../client/window-opener.ts'
import { CodexGlobalModel } from './CodexGlobalModel.tsx'
import {
  CODEX_AUTH_CANCEL_PATH,
  CODEX_AUTH_LOGIN_PATH,
  CODEX_AUTH_LOGOUT_PATH,
  CODEX_AUTH_STATUS_PATH,
  CODEX_AUTH_VERIFICATION_URI,
} from '../contracts/auth-paths.ts'
import { autoSyncModels, describeAutoSyncTrigger, shouldAutoSyncModels } from '../client/services/model-auto-sync.ts'

type Translate = (key: CodexAuthLocaleKey) => string


type AccountStatus =
  (
    | { status: 'loading' }
    | { status: 'signed-out' }
    | { status: 'signing-in' }
    | { status: 'signed-in'; expiresAt?: string }
    | { status: 'error'; message: string }
    | { status: 'remote-web-origin-not-trusted' }
  )

interface LoginChallenge {
  type: 'device_code'
  userCode: string
  verificationUri: string
  intervalSeconds?: number
  expiresInSeconds?: number
}



export interface CodexAuthSectionInjected {
  t: Translate
  connection: ConnectionHandle
  remote: unknown
}

export type CodexAuthSectionProps = CodexAuthSectionInjected

/**
 * 本插件在插件管理页里的组合包名（与 package.json 的 name 一致）。
 *
 * 座位 `plugins.detail.section` 是 **list**（不按包名分派）：页面会给打开的每个
 * 详情页渲染它。因此组件必须自己看 `subject`，不是本插件就返回 `null`。
 */
export const CODEX_AUTH_PACKAGE_NAME = '@tnnevol/dsh-codex-auth'

/** `plugins.detail.section` 传入的 owner props：当前打开页面的主题。 */
export interface CodexAuthSubject {
  readonly kind: string
  readonly pkg?: { readonly name?: string }
}

class AccountRequestError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'AccountRequestError'
  }
}

async function jsonRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const headers: HeadersInit = { accept: 'application/json' }
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
    throw new AccountRequestError(code, code)
  }
  return value as T
}

function dotClass(status: AccountStatus['status']): string {
  return `dsh-codex-auth-status-dot dsh-codex-auth-status-dot--${status}`
}

/**
 * 详情页区块的**座位入口**：先按 subject 过滤，再渲染真正的内容。
 *
 * `plugins.detail.section` 是 list 座位，页面会给打开的每个详情页都渲染它；
 * 不筛选就会把这段界面显示到别的插件详情页上。
 *
 * @param props - owner props（`subject` 由页面给）加上本插件闭包注入的依赖。
 * @returns 本插件的组合包详情页上渲染内容，否则 `null`。
 */
export function CodexAuthSection({
  t, connection, remote, subject,
}: CodexAuthSectionProps & { subject?: CodexAuthSubject | undefined }) {
  if (subject === undefined) return null
  if (subject.kind !== 'bundle') return null
  if (subject.pkg?.name !== CODEX_AUTH_PACKAGE_NAME) return null
  return <CodexAuthSectionContent t={t} connection={connection} remote={remote} />
}

/** Render the Codex login/logout and global-model page. */
function CodexAuthSectionContent({ t, connection, remote }: CodexAuthSectionProps) {
  if (t === undefined) throw new Error('Codex auth section requires its translation function')
  if (connection === undefined) throw new Error('Codex auth section requires the DSH connection')
  const [status, setStatus] = useState<AccountStatus>({ status: 'loading' })
  const [busy, setBusy] = useState(false)
  const [challenge, setChallenge] = useState<LoginChallenge | undefined>()
  const [copyFailed, setCopyFailed] = useState(false)
  /**
   * 本次登录打开过的授权窗口。
   *
   * 用集合而不是单个引用：`signIn()` 会自动开一个，用户还可能再点「打开授权页面」
   * 开第二个。只留最后一个引用会让先前那个变成孤儿——取消时关不掉，留下一个
   * 无人认领的登录页。
   *
   * 只用于「用户点取消时把窗口一并关掉」。**不**轮询 `closed` 判断用户是否放弃：
   * 授权成功后授权页会自行关闭，那会把刚成功的登录误判成放弃。
   */
  const authWindowsRef = useRef<Set<Window>>(new Set())
  /**
   * 登录尝试的代计数。
   *
   * 用户在 `POST /auth/login` 还在途时就点了取消，请求稍后返回会继续走
   * `setChallenge` + 跳转弹窗的后半段，把刚取消的界面又推回授权中。取消时
   * 推进代号，`signIn()` 在 await 之后比对，不一致即整体丢弃。
   */
  const loginGenerationRef = useRef(0)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const next = await jsonRequest<AccountStatus>(CODEX_AUTH_STATUS_PATH)
      setStatus(next)
      if (next.status !== 'signing-in') {
        setChallenge(undefined)
        setCopyFailed(false)
      }
    } catch (error: unknown) {
      setStatus(error instanceof AccountRequestError && error.code === 'remote-web-origin-not-trusted'
        ? { status: 'remote-web-origin-not-trusted' }
        : { status: 'error', message: error instanceof Error ? error.message : t('requestFailed') })
    }
  }, [t])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /**
   * 打开已登录页面时同步一次模型目录（FNOS-007-31-AC-02）。
   *
   * 用 ref 去重而不是 state：`refresh` 是 1 秒/5 分钟级的轮询，用 state 会多一次
   * 渲染，而且去重本身不该触发渲染。`after-sign-in` 那条路径**不**看这个标记——
   * 换账号后必须覆盖旧账号的列表。
   */
  const pageOpenSyncedRef = useRef(false)
  /**
   * 记录上一次观察到的状态，用来识别「刚变成已登录」。
   *
   * 不能只在 `signIn()` 的结尾同步：登录完成的判定走的是**轮询**（`signing-in`
   * 每秒查一次），`signIn()` 早在设备码返回时就结束了，那时状态还是 `signing-in`。
   * 因此这里看状态机的跃迁而不是某个函数的返回。
   */
  const previousStatusRef = useRef<AccountStatus['status']>('loading')
  useEffect(() => {
    const previous = previousStatusRef.current
    previousStatusRef.current = status.status
    // 只有「刚变成已登录」才算登录成功；页面重新挂载时是 loading → signed-in，
    // 那条由下面的 page-open 分支负责，这里用 previous !== 'loading' 区分。
    if (status.status !== 'signed-in' || previous === 'signed-in') return
    if (previous === 'loading') return
    const input = { signedIn: true, trigger: 'after-sign-in' as const }
    void autoSyncModels(input).then(result => {
      console.info(`[dsh-codex-auth] ${describeAutoSyncTrigger(input)}`, result)
    })
  }, [status.status])

  useEffect(() => {
    if (status.status !== 'signed-in') return
    const input = { signedIn: true, trigger: 'page-open' as const, alreadySynced: pageOpenSyncedRef.current }
    // 未发起（本会话已同步过）时不置位，保持「是否已同步」与事实一致。
    if (!shouldAutoSyncModels(input)) return
    pageOpenSyncedRef.current = true
    void autoSyncModels(input).then(result => {
      console.info(`[dsh-codex-auth] ${describeAutoSyncTrigger(input)}`, result)
    })
  }, [status.status])

  useEffect(() => {
    if (status.status !== 'signing-in') return
    const timer = window.setInterval(() => { void refresh() }, 1_000)
    return () => { window.clearInterval(timer) }
  }, [refresh, status.status])

  /**
   * 用户放弃本次授权时回收等待状态。
   *
   * 只中止这一次登录，不动已保存的凭据——所以走 cancel 端点而不是 logout。
   * `signOut()` 会连带清掉账号，用它来响应「取消」会把用户已登录的账号一起删掉。
   */
  const cancelSignIn = useCallback(async (): Promise<void> => {
    // 推进代号，作废可能仍在途的 login 请求。
    loginGenerationRef.current += 1
    // 用户点「取消」时授权窗口通常还开着，把本次登录开过的窗口**全部**关掉，
    // 别留下无人认领的登录页。已关闭的跳过（对它调 close 无意义）。
    const authWindows = [...authWindowsRef.current]
    authWindowsRef.current = new Set()
    for (const authWindow of authWindows) {
      if (!authWindow.closed) authWindow.close()
    }
    try {
      await jsonRequest<{ ok: true }>(CODEX_AUTH_CANCEL_PATH, 'POST')
    } catch {
      // 取消失败不阻塞界面：轮询会把状态收敛到宿主的真实结果。
    }
    setChallenge(undefined)
    setCopyFailed(false)
    // 取消可能发生在 login 请求在途时，那次 `signIn()` 会因为代号不符而跳过
    // 自己的 `setBusy(false)`，这里兜住，避免登录按钮一直停在禁用态。
    setBusy(false)
    await refresh()
  }, [refresh])

  const signIn = async (): Promise<void> => {
    const generation = loginGenerationRef.current + 1
    loginGenerationRef.current = generation
    /**
     * 先打开固定的授权页。**返回 `null` 不是失败**：DSH Desktop 的 Electron 壳
     * 对 http/https 调 `shell.openExternal(url)` 后一律返回 `deny`，于是这里
     * 拿到 `null`，而授权页其实已经在系统浏览器里打开了。
     *
     * 曾经把 `null` 当成「浏览器阻止了登录窗口」并在此 `return`，后果是 Desktop
     * 上授权页开着、设备码却永不请求，登录完全不可用。因此 `null` 只表示
     * 「窗口句柄不可得」——它只影响「取消时能否顺手关窗」，与登录是否继续无关。
     *
     * 刻意不置 `popup.opener = null`：授权窗口离开本页后是跨域的，此时若 opener
     * 已被切断，窗口就不再是 script-closable，`close()` 会静默失效（实测：跨域后
     * 调 close 返回 undefined 且 `closed` 仍为 false），「取消时一并关掉窗口」也就
     * 无从实现。授权地址由宿主校验过（必须 https、不带内嵌凭据），保留 opener 是
     * OAuth 弹窗的常规做法。
     *
     * 这里也刻意不带 `noopener`：它同样会让返回值恒为 `null`（与 Desktop 的
     * `null` 无法区分），并切断 opener 使跨域后无法关窗。
     */
    const popup = openAuthorizationWindow(CODEX_AUTH_VERIFICATION_URI)
    if (popup !== null) authWindowsRef.current.add(popup)
    setBusy(true)
    setStatus({ status: 'signing-in' })
    setChallenge(undefined)
    setCopyFailed(false)
    try {
      const next = await jsonRequest<LoginChallenge>(CODEX_AUTH_LOGIN_PATH, 'POST')
      // 请求期间用户已取消：丢弃这次结果，也不再跳转那个已关闭的窗口。
      // `popup` 可能为 `null`（Desktop 壳接管开窗），此时没有句柄可关。
      if (loginGenerationRef.current !== generation) {
        popup?.close()
        return
      }
      setChallenge(next)
    } catch (error: unknown) {
      // Keep the already-open OpenAI page visible when the NAS cannot obtain a
      // device code. The user can inspect/retry the network path, and an
      // explicit Cancel still closes the tracked window.
      if (loginGenerationRef.current !== generation) return
      setChallenge(undefined)
      setCopyFailed(false)
      setStatus(error instanceof AccountRequestError && error.code === 'remote-web-origin-not-trusted'
        ? { status: 'remote-web-origin-not-trusted' }
        : { status: 'error', message: error instanceof Error ? error.message : t('requestFailed') })
    } finally {
      if (loginGenerationRef.current === generation) setBusy(false)
    }
  }

  const signOut = async (): Promise<void> => {
    setBusy(true)
    try {
      await jsonRequest<{ ok: true }>(CODEX_AUTH_LOGOUT_PATH, 'POST')
      setStatus({ status: 'signed-out' })
      setChallenge(undefined)
      setCopyFailed(false)
      authWindowsRef.current = new Set()
    } catch (error: unknown) {
      setStatus({ status: 'error', message: error instanceof Error ? error.message : t('requestFailed') })
    } finally {
      setBusy(false)
    }
  }

  const label = status.status === 'signed-in'
    ? t('signedIn')
    : status.status === 'loading'
      ? t('loading')
      : status.status === 'signing-in'
        ? t('signingIn')
        : status.status === 'remote-web-origin-not-trusted'
          ? t('remoteOrigin')
          : status.status === 'error'
            ? t('requestFailed')
            : t('signedOut')

  return (
    <div className="dsh-codex-auth-section">
      <h2 className="dsh-codex-auth-section-title">{t('title')}</h2>
      <p className="dsh-codex-body dsh-codex-auth-section-desc">{t('intro')}</p>
      <div className="dsh-codex-auth-row">
        <div className="dsh-codex-auth-status" role="status">
          <span aria-hidden="true" className={dotClass(status.status)} />
          <span>{label}</span>
        </div>
        {status.status === 'loading' || status.status === 'remote-web-origin-not-trusted'
          ? null
          : status.status === 'signed-in'
            ? <DshButton htmlType="button" theme="solid" type="primary" disabled={busy} loading={busy} onClick={() => { void signOut() }}>{busy ? t('working') : t('signOut')}</DshButton>
            : status.status === 'signing-in'
              ? <DshButton htmlType="button" theme="solid" type="primary" onClick={() => { void cancelSignIn() }}>{t('cancelSignIn')}</DshButton>
              : <DshButton htmlType="button" theme="solid" type="primary" disabled={busy} loading={busy} onClick={() => { void signIn() }}>{busy ? t('working') : t('signIn')}</DshButton>}
      </div>
      {status.status === 'error' ? <p className="dsh-codex-auth-error">{status.message}</p> : null}
      {status.status === 'remote-web-origin-not-trusted' ? <p className="dsh-codex-auth-error">{t('remoteOrigin')}</p> : null}
      {status.status === 'signing-in' && challenge !== undefined ? (
        <div className="dsh-codex-auth-signing-in">
          <p className="dsh-codex-auth-body">{t('authorizationCodeHelp')}</p>
          <div className="dsh-codex-auth-signing-in-actions">
            <DshTypography.Text
              className="dsh-codex-auth-code"
              aria-label={t('authorizationCodeLabel')}
              copyable={{
                content: challenge.userCode,
                copyTip: t('copyAuthorizationCode'),
                // 成功态用等宽的勾选图标而不是「已复制」文案：两者都是 16px，
                // 切换时授权码框宽度不变，不会把右侧「打开授权页」按钮推走。
                successTip: <DshIconCheckCircle aria-label={t('authorizationCodeCopied')} />,
                onCopy: (_event: unknown, _content: unknown, result: boolean) => { setCopyFailed(!result) },
              }}
            >
              {challenge.userCode}
            </DshTypography.Text>
            <DshButton
              htmlType="button"
              theme="outline"
              type="secondary"
              size="small"
              onClick={() => {
                // 不能带 `noopener`（那会让 window.open 返回 null，拿不到窗口引用，
                // 也就无法检测用户关掉它、更无法在取消时关掉它），也不能在开窗后置
                // `opener = null`——原因同 `signIn()`：跨域窗口会因此无法被脚本关闭。
                //
                // `null` 句柄（Desktop 壳接管开窗）只是「关不掉」，不影响打开本身，
                // 因此静默跳过登记，不 `return` 掉后续逻辑。
                const opened = openAuthorizationWindow(challenge.verificationUri)
                if (opened !== null) authWindowsRef.current.add(opened)
              }}
            >
              {t('openAuthorization')}
            </DshButton>
          </div>
          {copyFailed ? <p className="dsh-codex-auth-error">{t('authorizationCodeCopyFailed')}</p> : null}
        </div>
      ) : null}
      <CodexGlobalModel connection={connection} remote={remote} t={t} />
    </div>
  )
}
