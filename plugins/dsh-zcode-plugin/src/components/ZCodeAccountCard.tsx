/**
 * 插件详情页的账号卡片：OAuth 设备授权登录与账号信息。
 *
 * 这里**没有** API Key 登录入口，这是有意的产品决定：Start Plan 的模型请求
 * 只认账号身份，Key 形态没有可用路径，给出入口只会把用户引进死胡同。
 *
 * 授权期间按宿主给出的节奏轮询状态；状态一旦离开 `signing-in` 就停止。
 *
 * @module dsh-zcode/components/AccountCard
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { DshButton } from '@tnnevol/dsh-semi-ui'
import type { ZCodeAuthStatus, ZCodeLoginChallenge } from '../contracts/auth.ts'
import { ZCODE_FAMILY_LABELS, ZCODE_FAMILIES } from '../contracts/identity.ts'
import type { ZCodeFamily } from '../contracts/identity.ts'
import type { ZCodeTranslate } from '../client/locales.ts'
import {
  cancelDeviceLogin,
  readAuthStatus,
  signOutAccount,
  startDeviceLogin,
} from '../client/services/account-data.ts'
import { bumpAuthEpoch } from '../client/services/auth-events.ts'
import { errorMessage, isOriginNotTrusted } from '../client/services/http.ts'
import type { TimerService } from '../client/services/polling.ts'

type SignedInStatus = Extract<ZCodeAuthStatus, { status: 'signed-in' }>

/**
 * 复制文本到剪贴板。
 *
 * `navigator.clipboard` 在非安全上下文或受限 iframe 里不可用，因此保留
 * `execCommand` 回落——这条登录链路本身就在 iframe 里跑，不能只赌一种实现。
 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard !== undefined) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 继续走回落方案。
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.append(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  } catch {
    return false
  }
}


/** 账号卡片的内部状态机。 */
type AccountState =
  | { readonly status: 'loading' }
  | { readonly status: 'signed-out' }
  | { readonly status: 'signing-in'; readonly challenge?: ZCodeLoginChallenge }
  | { readonly status: 'signed-in'; readonly account: SignedInStatus }
  | { readonly status: 'error'; readonly message: string }

/** 账号卡片参数。 */
export interface ZCodeAccountCardProps {
  readonly t: ZCodeTranslate
  readonly timer: TimerService
}

/** 把宿主状态映射到内部状态机。 */
function toAccountState(status: ZCodeAuthStatus): AccountState {
  if (status.status === 'signed-in') return { status: 'signed-in', account: status }
  if (status.status === 'signing-in') {
    return status.challenge === undefined
      ? { status: 'signing-in' }
      : { status: 'signing-in', challenge: status.challenge }
  }
  if (status.status === 'error') return { status: 'error', message: status.message }
  return { status: 'signed-out' }
}

/** 状态行的可读标签。 */
function statusLabel(state: AccountState, t: ZCodeTranslate): string {
  if (state.status === 'signed-in') return t('accountSignedIn')
  if (state.status === 'signing-in') return t('accountSigningIn')
  if (state.status === 'error') return t('accountRequestFailed')
  if (state.status === 'loading') return t('accountLoading')
  return t('accountSignedOut')
}

/**
 * 等待授权完成时的状态刷新间隔。
 *
 * 授权码流程没有服务端轮询间隔可参考（授权在浏览器里完成，插件只等回调
 * 落库），用固定 2 秒刷新即可：太密没必要，太慢会让用户以为没反应。
 */
const AUTH_POLL_INTERVAL_MS = 2_000

/** 家族显示名。 */
function familyLabel(family: ZCodeFamily | undefined, t: ZCodeTranslate): string {
  if (family === 'zai') return t('accountFamilyZai')
  if (family === 'bigmodel') return t('accountFamilyBigmodel')
  return t('accountUnknown')
}

/** 一行「标签 + 值」。 */
function AccountFact({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <div className="dsh-zcode-fact">
      <dt className="dsh-zcode-fact-label">{label}</dt>
      <dd className="dsh-zcode-fact-value">{value}</dd>
    </div>
  )
}

/**
 * 账号卡片。
 * @returns 账号卡片元素。
 */
export function ZCodeAccountCard({ t, timer }: ZCodeAccountCardProps): ReactNode {
  const [state, setState] = useState<AccountState>({ status: 'loading' })
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string>()
  const [copyFailed, setCopyFailed] = useState(false)
  /** 浏览器拦截了自动打开的标签页时给一条可读提示。 */
  const [popupBlocked, setPopupBlocked] = useState(false)
  /** 复制成功后的短反馈。 */
  const [copied, setCopied] = useState(false)
  const [family, setFamily] = useState<ZCodeFamily>('bigmodel')
  const sequenceRef = useRef(0)
  // 只在登录状态真正翻转时推进代际，避免页面首次加载就多触发一次额度/目录请求。
  const knownStatusRef = useRef(false)
  const wasSignedInRef = useRef(false)

  const applyStatus = useCallback((next: ZCodeAuthStatus): void => {
    const signedIn = next.status === 'signed-in'
    if (knownStatusRef.current && wasSignedInRef.current !== signedIn) bumpAuthEpoch()
    knownStatusRef.current = true
    wasSignedInRef.current = signedIn
    setState(toAccountState(next))
  }, [])

  const failureText = useCallback((error: unknown): string => (
    isOriginNotTrusted(error)
      ? t('accountTrustedOrigin')
      : errorMessage(error, t('accountRequestFailed'))
  ), [t])

  const refresh = useCallback(async (): Promise<void> => {
    const seq = ++sequenceRef.current
    try {
      const next = await readAuthStatus()
      if (seq !== sequenceRef.current) return
      applyStatus(next)
    } catch (error) {
      if (seq !== sequenceRef.current) return
      // 首次读取失败也要记下「已经知道过一次状态」：之后登录成功时才能推进代际。
      knownStatusRef.current = true
      setState({ status: 'error', message: failureText(error) })
    }
  }, [applyStatus, failureText])

  useEffect(() => {
    void refresh()
    return () => { sequenceRef.current += 1 }
  }, [refresh])

  const signingIn = state.status === 'signing-in'
  const delayMs = signingIn ? AUTH_POLL_INTERVAL_MS : 0
  useEffect(() => {
    if (!signingIn || delayMs <= 0) return
    return timer.interval(() => { void refresh() }, delayMs)
  }, [delayMs, refresh, signingIn, timer])

  const copyAuthorizeUrl = async (url: string): Promise<void> => {
    setCopyFailed(false)
    const ok = await copyText(url)
    setCopyFailed(!ok)
    if (!ok) return
    setCopied(true)
    window.setTimeout(() => { setCopied(false) }, 2000)
  }

  const signIn = async (): Promise<void> => {
    setBusy(true)
    setActionError(undefined)
    setCopyFailed(false)
    setPopupBlocked(false)
    /*
     * 先同步开一个占位标签页，等接口返回后再把地址写进去。
     * 不能在 await 之后才 window.open：那时已经脱离用户手势，会被弹窗拦截。
     * 不传 'noopener'（那样拿不到窗口句柄），改为事后手工清空 opener。
     */
    const pendingTab = typeof window === 'undefined' ? null : window.open('about:blank', '_blank')
    if (pendingTab === null) setPopupBlocked(true)
    else pendingTab.opener = null
    try {
      const result = await startDeviceLogin(family)
      setState({ status: 'signing-in', challenge: result.challenge })
      if (pendingTab !== null && !pendingTab.closed) {
        pendingTab.location.href = result.challenge.authorizeUrl
      }
    } catch (error) {
      // 登录没发起成功就把占位页关掉，别留一个空白标签。
      try {
        pendingTab?.close()
      } catch {
        // 关闭失败不影响报错。
      }
      setActionError(failureText(error))
    } finally {
      setBusy(false)
    }
  }

  const cancelSignIn = async (): Promise<void> => {
    setBusy(true)
    setActionError(undefined)
    try {
      applyStatus(await cancelDeviceLogin())
    } catch (error) {
      setActionError(failureText(error))
    } finally {
      setBusy(false)
    }
  }

  const signOut = async (): Promise<void> => {
    setBusy(true)
    setActionError(undefined)
    try {
      applyStatus(await signOutAccount())
    } catch (error) {
      setActionError(failureText(error))
    } finally {
      setBusy(false)
    }
  }

  const account = state.status === 'signed-in' ? state.account : undefined
  const challenge = state.status === 'signing-in' ? state.challenge : undefined

  let action: ReactNode = null
  if (state.status === 'signed-in') {
    action = (
      <DshButton
        htmlType="button"
        theme="solid"
        type="primary"
        disabled={busy}
        loading={busy}
        onClick={() => { void signOut() }}
      >
        {busy ? t('accountWorking') : t('accountSignOut')}
      </DshButton>
    )
  } else if (state.status === 'signing-in') {
    action = (
      <DshButton htmlType="button" theme="outline" type="secondary" onClick={() => { void cancelSignIn() }}>
        {t('accountCancel')}
      </DshButton>
    )
  } else if (state.status !== 'loading') {
    action = (
      <DshButton
        htmlType="button"
        theme="solid"
        type="primary"
        disabled={busy}
        loading={busy}
        onClick={() => { void signIn() }}
      >
        {busy ? t('accountWorking') : t('accountSignIn')}
      </DshButton>
    )
  }

  return (
    <section className="dsh-zcode-card" aria-labelledby="dsh-zcode-account-title">
      <header className="dsh-zcode-card-header">
        <div className="dsh-zcode-card-heading">
          <h3 id="dsh-zcode-account-title" className="dsh-zcode-card-title">{t('accountTitle')}</h3>
          <p className="dsh-zcode-card-desc">{t('accountIntro')}</p>
        </div>
        <div className="dsh-zcode-card-actions">
          <span className="dsh-zcode-status" role="status">
            <span aria-hidden="true" className={`dsh-zcode-status-dot dsh-zcode-status-dot--${state.status}`} />
            <span>{statusLabel(state, t)}</span>
          </span>
          {action}
        </div>
      </header>

      {state.status === 'error' ? <p className="dsh-zcode-error" role="alert">{state.message}</p> : null}
      {actionError === undefined ? null : <p className="dsh-zcode-error" role="alert">{actionError}</p>}

      {account === undefined ? null : (
        <dl className="dsh-zcode-facts">
          <AccountFact
            label={t('accountEmail')}
            value={account.email ?? account.name ?? account.userId ?? t('accountUnknown')}
          />
          <AccountFact label={t('accountFamily')} value={familyLabel(account.family, t)} />
          {account.userId === undefined
            ? null
            : <AccountFact label={t('accountUserId')} value={account.userId} />}
        </dl>
      )}

      {/* 未登录时可以选入口；已登录或授权中不显示，避免切换入口造成困惑。 */}
      {state.status === 'signed-in' || state.status === 'signing-in' || state.status === 'loading'
        ? null
        : (
            <div className="dsh-zcode-family">
              <div className="dsh-zcode-family-options" role="radiogroup" aria-label={t('accountFamily')}>
                {ZCODE_FAMILIES.map(option => (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={family === option}
                    className={`dsh-zcode-family-option${family === option ? ' dsh-zcode-family-option--active' : ''}`}
                    onClick={() => { setFamily(option) }}
                  >
                    {familyLabel(option, t)}
                    <span className="dsh-zcode-family-option-id">{ZCODE_FAMILY_LABELS[option]}</span>
                  </button>
                ))}
              </div>
              <p className="dsh-zcode-hint">{t('accountFamilyHint')}</p>
            </div>
          )}

      {state.status === 'signing-in' ? (
        <div className="dsh-zcode-signin">
          <p className="dsh-zcode-body">{t('accountAuthorizeHelp')}</p>
          {popupBlocked
            ? <p className="dsh-zcode-hint">{t('accountAuthorizePopupBlocked')}</p>
            : null}
          {challenge === undefined ? null : (
            <>
              {/* 两个动作同一行：按钮之间的间距由 `.dsh-zcode-signin-actions` 的 gap 控制。 */}
              <div className="dsh-zcode-signin-actions">
                <DshButton
                  htmlType="button"
                  theme="solid"
                  type="primary"
                  onClick={() => {
                    window.open(challenge.authorizeUrl, '_blank', 'noopener,noreferrer')
                  }}
                >
                  {t('accountOpenAuthorize')}
                </DshButton>
                <DshButton
                  htmlType="button"
                  theme="outline"
                  type="secondary"
                  onClick={() => { void copyAuthorizeUrl(challenge.authorizeUrl) }}
                >
                  {copied ? t('accountCodeCopied') : t('accountCopyUrl')}
                </DshButton>
              </div>
              <p className="dsh-zcode-hint">
                {t('accountAuthorizeExpires', { minutes: Math.max(1, Math.round(challenge.expiresInSeconds / 60)) })}
              </p>
              {copyFailed ? <p className="dsh-zcode-error">{t('accountCopyFailed')}</p> : null}
            </>
          )}
        </div>
      ) : null}
    </section>
  )
}
