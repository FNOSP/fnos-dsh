/** 插件详情页的账号卡片：设备码登录、API Key 登录与账号信息。 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { DshButton, DshIconCheckCircle, DshInput, DshTypography } from '@tnnevol/dsh-semi-ui'
import type { OpenCodeAuthStatus, OpenCodeLoginChallenge } from '../contracts/auth.ts'
import type { OpenCodeCatalogEntitlement } from '../contracts/catalog.ts'
import type { OpenCodeTranslate } from '../client/locales.ts'
import { cancelDeviceLogin, readAuthStatus, signInWithApiKey, signOutAccount, startDeviceLogin } from '../client/services/account-data.ts'
import {
  closeAuthorizationPlaceholder,
  navigateAuthorizationPlaceholder,
  openAuthorizationPlaceholder,
  openAuthorizationUrl,
} from '../client/services/authorization-window.ts'
import { copyToClipboard } from '../client/services/clipboard.ts'
import { apiKeyEntryVisible } from '../client/services/account-entry.ts'
import { bumpAuthEpoch } from '../client/services/auth-events.ts'
import { accountPlanLabelKey, accountPlanSourceKey } from '../client/services/catalog-data.ts'
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
  /**
   * 账号套餐快照（由区块从 `/catalog` 响应传入）。
   *
   * 卡片自己不请求目录：套餐与目录卡必须读同一份响应，否则会出现「套餐 A、
   * 列表 B」的错位。`undefined` 表示目录还没读回来，此时不渲染套餐行。
   */
  readonly entitlement?: OpenCodeCatalogEntitlement | undefined
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

/**
 * 取第一个非空的字符串。
 *
 * 账号卡按「有值才显示该字段」渲染，因此不能把空串或纯空白当作有效值——
 * 否则会渲染出一个有标签没有内容的空行。
 *
 * @param values - 候选值，按优先级排列。
 * @returns 第一个非空值；都没有时为 undefined。
 */
function firstNonEmpty(...values: readonly (string | undefined)[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value
  }
  return undefined
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
export function OpenCodeAccountCard({ t, timer, entitlement }: OpenCodeAccountCardProps): ReactNode {
  const [state, setState] = useState<AccountState>({ status: 'loading' })
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string>()
  const [copyFailed, setCopyFailed] = useState(false)
  // 授权地址复制的成功反馈与失败提示：与验证码的 copyFailed 分开，
  // 两者的补救动作不同（验证码可选中重抄，地址要显示出来才能手动复制）。
  const [urlCopied, setUrlCopied] = useState(false)
  const [urlCopyFailed, setUrlCopyFailed] = useState(false)
  // 本次登录开出的占位标签页：取消或失败时收回，避免留下空白页。
  const placeholderRef = useRef<Window | null>(null)
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
    // 已登录、或正在走设备码授权时收起并清空 API Key 输入：这条兜底入口在这两种
    // 状态下都不显示，留着展开状态会在下次未登录时突然弹出来。
    if (signedIn || next.status === 'signing-in') {
      setKeyOpen(false)
      setApiKey('')
      setKeyError(undefined)
    }
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
    // 占位页必须在任何 `await` 之前打开：那时已经脱离用户手势，浏览器会拦截弹窗。
    // Desktop 壳会 deny 掉 `about:blank`（只放行 http/https），拿到句柄为 null，
    // 后续改用直接开真实地址。
    placeholderRef.current = openAuthorizationPlaceholder()
    setBusy(true)
    setActionError(undefined)
    setCopyFailed(false)
    setUrlCopied(false)
    setUrlCopyFailed(false)
    try {
      const challenge = await startDeviceLogin()
      // 占位页不可用（Desktop 壳 deny 掉 about:blank，或用户已关掉它）时直接开
      // 真实地址：壳的开窗在原生层进行，不受浏览器的手势限制。两条路都失败
      // 也不阻断登录——设备码照常轮询，界面还有「复制授权地址」兜底。
      if (!navigateAuthorizationPlaceholder(placeholderRef.current, challenge.verificationUri)) {
        // 占位页不可用才直接开：Desktop 壳接管时拿不到句柄，取消也就无从关窗。
        openAuthorizationUrl(challenge.verificationUri)
        placeholderRef.current = null
      }
      // 句柄保留到取消/退出：用户中途关掉它没关系，close 内部已处理。
      setState({ status: 'signing-in', challenge })
    } catch (error) {
      closeAuthorizationPlaceholder(placeholderRef.current)
      placeholderRef.current = null
      setActionError(failureText(error))
    } finally {
      setBusy(false)
    }
  }

  const cancelSignIn = async (): Promise<void> => {
    setBusy(true)
    setActionError(undefined)
    setCopyFailed(false)
    closeAuthorizationPlaceholder(placeholderRef.current)
    placeholderRef.current = null
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

  const copyUrl = async (url: string): Promise<void> => {
    const ok = await copyToClipboard(url)
    setUrlCopyFailed(!ok)
    setUrlCopied(ok)
    if (ok) window.setTimeout(() => { setUrlCopied(false) }, 2000)
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
  // 值为空的字段整项不渲染：上游拿不到邮箱（API Key 登录）时显示「邮箱」加
  // 「未知」会让用户以为插件读到了什么，其实什么都没读到。
  const email = firstNonEmpty(account?.email, account?.accountId)
  const organization = firstNonEmpty(account?.organizationName, account?.organizationId)
  const expiresAt = account === undefined
    ? undefined
    : account.method === 'key'
      ? t('accountExpiresNever')
      : formatTimestamp(account.expiresAt)

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
          {email === undefined ? null : <AccountFact label={t('accountEmail')} value={email} />}
          {organization === undefined ? null : <AccountFact label={t('accountOrganization')} value={organization} />}
          <AccountFact label={t('accountMethod')} value={account.method === 'oauth' ? t('accountMethodOauth') : t('accountMethodKey')} />
          {expiresAt === undefined ? null : <AccountFact label={t('accountExpiresAt')} value={expiresAt} />}
          {/* 套餐与判定依据来自目录响应：未登录或接口不可读时 plan 为 unknown。 */}
          {entitlement === undefined ? null : (
            <>
              <AccountFact label={t('accountPlanLabel')} value={t(accountPlanLabelKey(entitlement.plan))} />
              <AccountFact
                label={t('accountPlanSourceLabel')}
                value={t(accountPlanSourceKey(entitlement.source))}
              />
            </>
          )}
        </dl>
      )}

      {/* 套餐读取失败的原因单独一行：它是账号级信息，不该被折叠进目录卡的提示里。 */}
      {entitlement?.error === undefined ? null : (
        <p className="dsh-opencode-muted" role="status">{entitlement.error}</p>
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
                <DshButton
                  htmlType="button"
                  theme="outline"
                  type="secondary"
                  size="small"
                  onClick={() => { void copyUrl(challenge.verificationUri) }}
                >
                  {urlCopied ? t('accountCodeCopied') : t('accountCopyUrl')}
                </DshButton>
              </div>
              {copyFailed ? <p className="dsh-opencode-error">{t('accountCodeCopyFailed')}</p> : null}
              {/* 地址复制失败时把地址本身显示出来：授权页没自动打开、又复制不了时，
                  用户至少能选中它手动复制——只报「复制失败」等于把人堵死。 */}
              {urlCopyFailed ? (
                <div className="dsh-opencode-url-fallback">
                  <p className="dsh-opencode-error">{t('accountCopyUrlFailed')}</p>
                  {/* 可选中：复制被拦截时用户仍能手动选中这段地址。 */}
                  <span className="dsh-opencode-url">{challenge.verificationUri}</span>
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {/* API Key 登录只在「未登录且不在授权中」时作为兜底入口：授权进行中再摆一条
          别的登录路径，会让人以为设备码流程卡住了，也会分散对设备码的注意力。 */}
      {apiKeyEntryVisible(state.status) ? (
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
      ) : null}
    </section>
  )
}
