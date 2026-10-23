/** 插件详情页的账号卡片：设备码登录、API Key 登录与账号信息。 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { DshButton, DshIconCheckCircle, DshInput, DshTypography } from '@tnnevol/dsh-semi-ui'
import type { OpenCodeAuthStatus, OpenCodeLoginChallenge } from '../contracts/auth.ts'
import type { OpenCodeTranslate } from '../client/locales.ts'
import { cancelDeviceLogin, readAuthStatus, signInWithApiKey, signOutAccount, startDeviceLogin } from '../client/services/account-data.ts'
import { bumpAuthEpoch } from '../client/services/auth-events.ts'
import { formatTimestamp } from '../client/services/format.ts'
import { errorMessage, isOriginNotTrusted } from '../client/services/http.ts'
import type { TimerService } from '../client/services/polling.ts'

type SignedInStatus = Extract<OpenCodeAuthStatus, { status: 'signed-in' }>

/** 账号卡片的内部状态机。 */
type AccountState =
  | { readonly status: 'loading' }
  | { readonly status: 'signed-out' }
  | { readonly status: 'signing-in', readonly challenge?: OpenCodeLoginChallenge }
  | { readonly status: 'signed-in', readonly account: SignedInStatus }
  | { readonly status: 'error', readonly message: string }

/** 账号卡片参数。 */
export interface OpenCodeAccountCardProps {
  readonly t: OpenCodeTranslate
  readonly timer: TimerService
}

/** 把宿主状态映射到内部状态机。 */
function toAccountState(status: OpenCodeAuthStatus): AccountState {
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
function statusLabel(state: AccountState, t: OpenCodeTranslate): string {
  if (state.status === 'signed-in') return t('accountSignedIn')
  if (state.status === 'signing-in') return t('accountSigningIn')
  if (state.status === 'error') return t('accountRequestFailed')
  if (state.status === 'loading') return t('accountLoading')
  return t('accountSignedOut')
}

/** 设备码轮询间隔：服务端建议值，夹在 1~10 秒之间。 */
function pollDelayMs(challenge: OpenCodeLoginChallenge | undefined): number {
  const seconds = challenge?.intervalSeconds ?? 2
  if (!Number.isFinite(seconds) || seconds <= 0) return 2_000
  return Math.max(1_000, Math.min(10_000, Math.round(seconds * 1_000)))
}

/** 一行「标签 + 值」。 */
function AccountFact({ label, value }: { label: string, value: string }): ReactNode {
  return (
    <div className="dsh-opencode-fact">
      <dt className="dsh-opencode-fact-label">{label}</dt>
      <dd className="dsh-opencode-fact-value">{value}</dd>
    </div>
  )
}

/**
 * 账号卡片。
 * @returns 账号卡片元素。
 */
export function OpenCodeAccountCard({ t, timer }: OpenCodeAccountCardProps): ReactNode {
  const [state, setState] = useState<AccountState>({ status: 'loading' })
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string>()
  const [copyFailed, setCopyFailed] = useState(false)
  const [keyOpen, setKeyOpen] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [keyError, setKeyError] = useState<string>()
  const sequenceRef = useRef(0)
  // 只在登录状态真正翻转时推进代际，避免页面首次加载就多触发一次用量/目录请求。
  const knownStatusRef = useRef(false)
  const wasSignedInRef = useRef(false)

  const applyStatus = useCallback((next: OpenCodeAuthStatus): void => {
    const signedIn = next.status === 'signed-in'
    if (knownStatusRef.current && wasSignedInRef.current !== signedIn) bumpAuthEpoch()
    knownStatusRef.current = true
    wasSignedInRef.current = signedIn
    setState(toAccountState(next))
  }, [])

  const failureText = useCallback((error: unknown): string => (
    isOriginNotTrusted(error) ? t('accountTrustedOrigin') : errorMessage(error, t('accountRequestFailed'))
  ), [t])

  const refresh = useCallback(async (): Promise<void> => {
    const seq = ++sequenceRef.current
    try {
      const next = await readAuthStatus()
      if (seq !== sequenceRef.current) return
      applyStatus(next)
    } catch (error) {
      if (seq !== sequenceRef.current) return
      // 首次读取失败也要记下「已经知道过一次状态」：之后登录成功时才能推进代际，
      // 让用量与目录立即刷新。保留上一次确认过的登录状态，避免一次网络失败
      // 被误判成退出登录。
      knownStatusRef.current = true
      setState({ status: 'error', message: failureText(error) })
    }
  }, [applyStatus, failureText])

  useEffect(() => {
    void refresh()
    return () => { sequenceRef.current += 1 }
  }, [refresh])

  // 等待授权时按服务端建议的节奏轮询；状态一旦离开 signing-in 就停止。
  const signingIn = state.status === 'signing-in'
  const delayMs = signingIn ? pollDelayMs(state.challenge) : 0
  useEffect(() => {
    if (!signingIn || delayMs <= 0) return
    return timer.interval(() => { void refresh() }, delayMs)
  }, [delayMs, refresh, signingIn, timer])

  const signIn = async (): Promise<void> => {
    setBusy(true)
    setActionError(undefined)
    setCopyFailed(false)
    try {
      const challenge = await startDeviceLogin()
      setState({ status: 'signing-in', challenge })
    } catch (error) {
      setActionError(failureText(error))
    } finally {
      setBusy(false)
    }
  }

  const cancelSignIn = async (): Promise<void> => {
    setBusy(true)
    setActionError(undefined)
    setCopyFailed(false)
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
    setCopyFailed(false)
    try {
      applyStatus(await signOutAccount())
    } catch (error) {
      setActionError(failureText(error))
    } finally {
      setBusy(false)
    }
  }

  const submitKey = async (): Promise<void> => {
    const key = apiKey.trim()
    if (key.length === 0) {
      setKeyError(t('accountApiKeyRequired'))
      return
    }
    setBusy(true)
    setKeyError(undefined)
    setActionError(undefined)
    try {
      applyStatus(await signInWithApiKey(key))
      setApiKey('')
      setKeyOpen(false)
    } catch (error) {
      setKeyError(failureText(error))
    } finally {
      setBusy(false)
    }
  }

  const account = state.status === 'signed-in' ? state.account : undefined
  const challenge = state.status === 'signing-in' ? state.challenge : undefined
  const organization = account === undefined
    ? undefined
    : account.organizationName ?? account.organizationId
  const expiresAt = account === undefined
    ? undefined
    : account.method === 'key'
      ? t('accountExpiresNever')
      : formatTimestamp(account.expiresAt) ?? t('accountUnknown')

  let action: ReactNode = null
  if (state.status === 'signed-in') {
    action = (
      <DshButton htmlType="button" theme="solid" type="primary" disabled={busy} loading={busy} onClick={() => { void signOut() }}>
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
      <DshButton htmlType="button" theme="solid" type="primary" disabled={busy} loading={busy} onClick={() => { void signIn() }}>
        {busy ? t('accountWorking') : t('accountSignIn')}
      </DshButton>
    )
  }

  return (
    <section className="dsh-opencode-card" aria-labelledby="dsh-opencode-account-title">
      <header className="dsh-opencode-card-header">
        <div className="dsh-opencode-card-heading">
          <h3 id="dsh-opencode-account-title" className="dsh-opencode-card-title">{t('accountTitle')}</h3>
          <p className="dsh-opencode-card-desc">{t('accountIntro')}</p>
        </div>
        <div className="dsh-opencode-card-actions">
          <span className="dsh-opencode-status" role="status">
            <span aria-hidden="true" className={`dsh-opencode-status-dot dsh-opencode-status-dot--${state.status}`} />
            <span>{statusLabel(state, t)}</span>
          </span>
          {action}
        </div>
      </header>

      {state.status === 'error' ? <p className="dsh-opencode-error" role="alert">{state.message}</p> : null}
      {actionError === undefined ? null : <p className="dsh-opencode-error" role="alert">{actionError}</p>}

      {account === undefined ? null : (
        <dl className="dsh-opencode-facts">
          <AccountFact label={t('accountEmail')} value={account.email ?? account.accountId ?? t('accountUnknown')} />
          {organization === undefined ? null : <AccountFact label={t('accountOrganization')} value={organization} />}
          <AccountFact label={t('accountMethod')} value={account.method === 'oauth' ? t('accountMethodOauth') : t('accountMethodKey')} />
          <AccountFact label={t('accountExpiresAt')} value={expiresAt ?? t('accountUnknown')} />
        </dl>
      )}

      {state.status === 'signing-in' ? (
        <div className="dsh-opencode-signin">
          <p className="dsh-opencode-body">{t('accountCodeHelp')}</p>
          {challenge === undefined ? null : (
            <>
              <div className="dsh-opencode-signin-actions">
                <DshTypography.Text
                  className="dsh-opencode-code"
                  aria-label={t('accountCodeLabel')}
                  copyable={{
                    content: challenge.userCode,
                    copyTip: t('accountCopyCode'),
                    // 成功态用等宽勾选图标：与「已复制」文案同宽，授权码框不会跳动。
                    successTip: <DshIconCheckCircle aria-label={t('accountCodeCopied')} />,
                    onCopy: (_event: unknown, _content: unknown, result: boolean) => { setCopyFailed(!result) },
                  }}
                >
                  {challenge.userCode}
                </DshTypography.Text>
                <a
                  className="dsh-opencode-link"
                  href={challenge.verificationUri}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {t('accountOpenVerification')}
                </a>
              </div>
              {copyFailed ? <p className="dsh-opencode-error">{t('accountCodeCopyFailed')}</p> : null}
            </>
          )}
        </div>
      ) : null}

      <div className="dsh-opencode-key">
        <DshButton
          htmlType="button"
          theme="borderless"
          type="tertiary"
          size="small"
          onClick={() => {
            setKeyOpen(open => !open)
            setKeyError(undefined)
          }}
        >
          {keyOpen ? t('accountApiKeyCollapse') : t('accountApiKeyToggle')}
        </DshButton>
        {keyOpen ? (
          <div className="dsh-opencode-key-form">
            <DshInput
              mode="password"
              value={apiKey}
              disabled={busy}
              placeholder={t('accountApiKeyPlaceholder')}
              aria-label={t('accountApiKeyLabel')}
              onChange={(value: string) => { setApiKey(value) }}
            />
            <DshButton
              htmlType="button"
              theme="solid"
              type="primary"
              size="small"
              disabled={busy}
              loading={busy}
              onClick={() => { void submitKey() }}
            >
              {t('accountApiKeySubmit')}
            </DshButton>
          </div>
        ) : null}
        {keyError === undefined ? null : <p className="dsh-opencode-error" role="alert">{keyError}</p>}
      </div>
    </section>
  )
}
