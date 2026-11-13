/**
 * 账号登录对话框（fnOS 专用）。
 *
 * ## 为什么要在 DOM 层拦截官方的登录框
 *
 * 官方的登录对话框有**两个独立渲染点**，条件还不一样：
 *
 * | 渲染点 | 条件 | 文件 |
 * | --- | --- | --- |
 * | 初始引导 | 未登录就**无条件**渲染 | `AccountOnboarding.tsx` |
 * | 侧栏「更多」 | `loginVisible && !onboarding` | `AccountMenu.tsx` |
 *
 * 替换任何一个座位都会破坏另一个的前提（尤其 `onboarding` 标志：官方
 * `AccountOnboarding` 一旦不挂载，`onboarding` 恒为 false，侧栏那份反而会冒出来），
 * 而且还要复刻官方菜单。所以在 DOM 层统一处理：官方框一出现就收起它，
 * 由本组件接管。这样只有一个入口需要维护，官方菜单与引导的排版都保持原样。
 *
 * ## 为什么是「点关闭」而不是 remove 节点
 *
 * 直接 `remove()` 会让 React 的挂载状态与实际 DOM 脱节，后续状态更新可能把节点
 * 又插回来或者报错。点它自己的关闭按钮，让 React 正常卸载。
 *
 * @module dsh-fnos/account-login-dialog
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { DshModal, DshInput, DshButton, DshTooltip } from '@tnnevol/dsh-semi-ui'
import type { FnosLocaleKey } from '../client/locales.ts'
import {
  FNOS_ACCOUNT_LOGIN_CANCEL_ROUTE,
  FNOS_ACCOUNT_LOGIN_RELAY_ROUTE,
  FNOS_ACCOUNT_LOGIN_START_ROUTE,
  FNOS_ACCOUNT_LOGIN_STATE_ROUTE,
  type AccountLoginAttemptView,
  type AccountLoginRelayResult,
  type AccountLoginStartResult,
} from '../contracts/account-login-contract.ts'
import { parseCallbackInput } from '../client/account-login-callback.ts'

type Translate = (key: FnosLocaleKey) => string

/**
 * 官方登录框的标题字样。
 *
 * 官方引导与侧栏两处的标题文案不同，且都有多语言版本。认文案比认 class 稳——
 * CSS Modules 的 hash 每次构建都会变，而标题是产品文案，变动少且可枚举。
 *
 * 覆盖：开始使用 / 等待登录 / 登录 DeepSeek 账号，以及英文、德、西、法、意、
 * 日、韩、俄、葡的对应文案。
 */
const OFFICIAL_TITLES = [
  '开始使用', '等待登录', '登录 DeepSeek 账号',
  'Get started', 'Waiting for sign in', 'Sign in to DeepSeek', 'Sign in to your DeepSeek account',
  'Erste Schritte', 'Anmeldung', 'Bei DeepSeek anmelden',
  'Empezar', 'Iniciar sesión', 'Inicia sesión en DeepSeek',
  'Commencer', 'Connexion', 'Se connecter à DeepSeek',
  'Per iniziare', 'Accesso', 'Accedi a DeepSeek',
  'はじめる', 'サインイン', 'DeepSeek アカウントにサインイン',
  '시작하기', '로그인', 'DeepSeek 계정으로 로그인',
  'Начало работы', 'Вход', 'Войти в аккаунт DeepSeek',
  'Começar', 'Entrar', 'Entrar na conta DeepSeek',
]

/**
 * 官方「添加 API Key」按钮的文案。
 *
 * 用于在我们自己的对话框里代点官方那个按钮——官方引导的 API Key 业务是组件
 * 内部状态（`setApiKey(true)`），插件复刻不了，只能借它的入口。
 */
const OFFICIAL_API_KEY_LABELS = [
  '添加 API Key', '添加 API key', 'Add an API Key', 'Add an API key', 'Add API key',
  'API-Schlüssel hinzufügen', 'Añadir clave de API', 'Ajouter une clé API',
  'Aggiungi chiave API', 'API キーを追加', 'API 키 추가', 'Добавить ключ API',
]

/**
 * 判断一个节点是不是官方账号登录框。
 *
 * 只认 `#root` **之后**的兄弟节点：官方弹层用 portal 挂到 `body`，排在 `#root`
 * 后面；应用自身的内容都在 `#root` 里面。
 *
 * @param node - 候选节点。
 * @returns 命中时为对应的 dialog 元素。
 */
function matchOfficialSignInDialog(node: Element): Element | undefined {
  /*
    判据（用户指定，与官方 `Modal` 的真实结构一致）：

    - 节点在 `#root` **之后**（弹层都用 portal 挂到 body，排在 `#root` 后面）；
    - 该节点 `role="presentation"` —— 这是官方 `Modal.tsx` 最外层容器的固定属性
      （`<div className={css.root} role="presentation">`）；
    - 内部 `[role="dialog"]` 的文案命中登录框标题（`等待登录` / `登录 DeepSeek 账号`
      / `开始使用` 等，九种语言）。

    排除自己的对话框：它同样挂在 `#root` 之后，但类名是 `.dsh-fnos-account-login`。
  */
  if (node.getAttribute('role') !== 'presentation') return undefined
  if (node.getAttribute('data-dsh-fnos-captured') === '1') return undefined
  if (node.querySelector('.dsh-fnos-account-login') !== null) return undefined
  const dialog = node.querySelector('[role="dialog"]')
  if (dialog === null) return undefined
  const text = dialog.textContent ?? ''
  return OFFICIAL_TITLES.some(title => text.includes(title)) ? dialog : undefined
}

/**
 * 收起官方登录框：点它自己的关闭按钮。
 *
 * @param dialog - 官方对话框元素。
 */
function dismissOfficialDialog(dialog: Element): void {
  /*
    点官方自己的关闭按钮——让 React 正常卸载，而不是 `remove()` 节点。直接删节点
    会让挂载状态与 DOM 脱节，后续状态更新可能把节点又插回来或直接报错。

    官方结构（`ui-primitives/src/Modal.tsx`）：关闭按钮在 header 里、紧随 `<h2>`
    之后，`<button aria-label={closeLabel}>`。取 dialog 内**第一个** aria-label
    按钮就是这个——而不是所有 aria-label 按钮里随便挑一个。
  */
  const close = dialog.querySelector('button[aria-label]')
  if (close instanceof HTMLElement) {
    close.click()
    return
  }
  // 兜底：headless 变体没有 header，改派 Esc（官方用 `useModalLayer` 监听）。
  dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
}

/**
 * 观察并收起官方登录框。
 *
 * 插件加载时机与官方框挂载顺序不固定：可能先有框、后有插件，也可能反过来。
 * 所以三处都要覆盖——**同步首扫**（已存在）、**微任务补扫**（React 提交时机
 * 不保证在插件注册之前完成）、**持续观察**（之后才出现的）。
 *
 * @param onCaptured - 成功收起一个官方框时回调。
 * @returns 停止观察的函数。
 */
export function watchOfficialSignInDialogs(onCaptured: (dialog: Element) => void): () => void {
  if (typeof document === 'undefined' || document.body === null) return () => undefined

  const seen = new WeakSet<Element>()
  let stopped = false

  const scan = (): void => {
    if (stopped) return
    const root = document.getElementById('root')
    // 没有 #root 时退回 body 直接子节点，避免完全失效。
    let node: Element | null = root === null ? document.body.firstElementChild : root.nextElementSibling
    while (node !== null) {
      if (!seen.has(node)) {
        const dialog = matchOfficialSignInDialog(node)
        if (dialog !== undefined) {
          seen.add(node)
          onCaptured(dialog)
          dismissOfficialDialog(dialog)
        }
      }
      node = node.nextElementSibling
    }
  }

  scan()
  queueMicrotask(scan)

  const observer = new MutationObserver(scan)
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    // 官方框是整棵子树插入的，但 `role` / `class` 可能在挂载后才补齐。
    attributes: true,
    attributeFilter: ['role', 'class', 'aria-label'],
  })

  return () => {
    stopped = true
    observer.disconnect()
  }
}

/** 对话框所处阶段。 */
type Phase = 'idle' | 'starting' | 'waiting' | 'submitting' | 'error'

/** 组件参数。 */
export interface FnosAccountLoginDialogProps {
  /** 是否展现（由外部状态驱动）。 */
  readonly open: boolean
  /** 翻译函数。 */
  readonly t: Translate
  /** 关闭回调。 */
  readonly onClose: () => void
  /**
   * 最近一次被收起的官方对话框（由浮层容器持有）。
   *
   * 用 props 传入而不是组件内部 `useRef`：监听器在**浮层容器**里启动，
   * 收起官方框的动作也发生在那里。两边各存一份会出现「组件里的 ref 永远是
   * undefined」这种沉默失效。
   */
  readonly officialDialogRef: { current: Element | undefined }
}

/**
 * 账号登录对话框。
 *
 * @param props - 组件参数。
 * @param props.open - 是否展现。
 * @param props.t - 翻译函数。
 * @param props.onClose - 关闭回调。
 * @param props.officialDialogRef - 浮层持有的官方对话框引用。
 * @returns 对话框元素。
 */
export function FnosAccountLoginDialog({ open, t, onClose, officialDialogRef }: FnosAccountLoginDialogProps): React.ReactNode {
  const [phase, setPhase] = useState<Phase>('idle')
  const [pasted, setPasted] = useState('')
  const [message, setMessage] = useState<string>()
  const authorizeUrlRef = useRef<string>()
  const closedRef = useRef(false)

  /** 发起登录：拿授权地址并打开新标签页。 */
  const startSignIn = useCallback(async (): Promise<void> => {
    setPhase('starting')
    setMessage(undefined)
    /*
      先同步开一个空白页。浏览器只在**用户手势的同步栈**里允许 window.open，
      等到 fetch 回来再开会被当成弹窗拦掉（实测返回 null 且无任何报错）。
    */
    const tab = typeof window === 'undefined' ? null : window.open('about:blank', '_blank')
    try {
      const response = await fetch(FNOS_ACCOUNT_LOGIN_START_ROUTE, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
      const result = await response.json().catch(() => undefined) as AccountLoginStartResult | undefined
      if (result?.authorizeUrl === undefined) {
        tab?.close()
        setPhase('error')
        setMessage(t('accountLoginNoAuthorizeUrl'))
        return
      }
      authorizeUrlRef.current = result.authorizeUrl
      if (tab !== null) tab.location.href = result.authorizeUrl
      else window.open(result.authorizeUrl, '_blank')
      setPhase('waiting')
    } catch (error) {
      tab?.close()
      setPhase('error')
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }, [t])

  /**
   * 「添加 API Key」：走官方业务。
   *
   * 官方那条路是 `AccountOnboarding` 的 `useApiKey()` → `setApiKey(true)`，
   * 属于组件内部状态，插件无法直接设置。唯一能触发的就是点官方框里的同名按钮。
   *
   * 官方框此刻已经被我们收起了（DOM 还在，只是被点关闭后由 React 卸载），所以
   * 实际做法是：若仍能拿到官方框就点它的按钮；拿不到时退化为关闭本对话框。
   */
  const openOfficialApiKeyEditor = useCallback((): void => {
    const dialog = officialDialogRef.current
    // 官方「添加 API Key」按钮：文案匹配（多语言覆盖在 OFFICIAL_API_KEY_LABELS）。
    const target = dialog === undefined
      ? undefined
      : [...dialog.querySelectorAll('button')].find(button => {
        const label = (button.textContent ?? '').trim()
        return OFFICIAL_API_KEY_LABELS.some(item => label.includes(item))
      })
    if (target instanceof HTMLElement) {
      target.click()
      setPhase('idle')
      setPasted('')
      onClose()
      return
    }
    // 官方框已不可用：退化为关闭，让用户从设置页进入 API Key 配置。
    onClose()
  }, [onClose, officialDialogRef])

  /** 提交粘贴回来的回调地址。 */
  const submitCallback = useCallback(async (): Promise<void> => {
    const parsed = parseCallbackInput(pasted)
    if (parsed === undefined) {
      setMessage(t('accountLoginInvalidAddress'))
      return
    }
    setPhase('submitting')
    setMessage(undefined)
    try {
      const response = await fetch(FNOS_ACCOUNT_LOGIN_RELAY_ROUTE, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsed),
      })
      const result = await response.json().catch(() => undefined) as AccountLoginRelayResult & { error?: string } | undefined
      if (result?.ok === true) {
        setPhase('idle')
        setPasted('')
        onClose()
        return
      }
      setPhase('waiting')
      setMessage(t('accountLoginFailed'))
    } catch (error) {
      setPhase('waiting')
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }, [pasted, t, onClose])

  /** 关闭：同时取消宿主那次尝试，避免留下 `waiting-browser` 脏状态。 */
  const close = useCallback((): void => {
    closedRef.current = true
    void fetch(FNOS_ACCOUNT_LOGIN_CANCEL_ROUTE, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }).catch(() => undefined)
    setPhase('idle')
    setPasted('')
    setMessage(undefined)
    onClose()
  }, [onClose])

  /*
    打开时对齐宿主状态：如果已经有一轮进行中的尝试（例如页面刷新后），
    直接进「等待粘贴」而不是让用户再点一次登录——那会白白作废上一轮。
  */
  useEffect(() => {
    if (!open) return
    closedRef.current = false
    let cancelled = false
    void fetch(FNOS_ACCOUNT_LOGIN_STATE_ROUTE, { credentials: 'same-origin' })
      .then(response => response.json())
      .then((state: AccountLoginAttemptView | undefined) => {
        if (cancelled) return
        if (state?.phase === 'waiting-browser' && state.authorizeUrl !== undefined) {
          authorizeUrlRef.current = state.authorizeUrl
          setPhase('waiting')
        }
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [open])

  const waiting = phase === 'waiting' || phase === 'submitting'

  return (
    <DshModal
      visible={open}
      title={waiting ? t('accountLoginPasteTitle') : t('accountLoginTitle')}
      onCancel={close}
      footer={null}
      width={520}
    >
      <div className="dsh-fnos-account-login">
        {waiting ? (
          <>
            <p className="dsh-fnos-account-login-hint">{t('accountLoginPasteHint')}</p>
            <DshInput
              value={pasted}
              /* 端口由宿主转发时决定，这里只给形状；写死端口会与实际改写的值对不上。 */
              placeholder="http://127.0.0.1:<端口>/oauth/callback?code=…&state=…"
              onChange={(value: string) => { setPasted(value) }}
            />
          </>
        ) : (
          <p className="dsh-fnos-account-login-hint">{t('accountLoginIntro')}</p>
        )}

        {message === undefined ? null : (
          <p className="dsh-fnos-account-login-error" role="alert">{message}</p>
        )}

        <div className="dsh-fnos-account-login-actions">
          {waiting ? (
            <>
              <DshButton onClick={close}>{t('cancel')}</DshButton>
              <DshButton
                theme="solid"
                type="primary"
                loading={phase === 'submitting'}
                onClick={() => { void submitCallback() }}
              >
                {t('accountLoginAuthorize')}
              </DshButton>
            </>
          ) : (
            <>
              {/*
                「添加 API Key」**走官方业务**：官方那条路是
                `AccountOnboarding` 里的 `useApiKey()` → `setApiKey(true)` →
                切到 `DeepSeekOnboardingDialog` 的 API Key 编辑器。那是一个组件
                内部状态，插件无法直接复刻。

                所以这里不自己实现，而是去点官方框里的同名按钮——用户点我们的
                按钮等于点官方的，业务完全一致。若官方框已不在（例如被关掉了），
                退化为关闭对话框并把用户引到设置页的账号分区。
              */}
              <DshTooltip content={t('accountLoginApiKeyHint')}>
                <DshButton onClick={openOfficialApiKeyEditor}>{t('accountLoginApiKey')}</DshButton>
              </DshTooltip>
              <DshButton
                theme="solid"
                type="primary"
                loading={phase === 'starting'}
                onClick={() => { void startSignIn() }}
              >
                {t('accountLoginSignIn')}
              </DshButton>
            </>
          )}
        </div>
      </div>
    </DshModal>
  )
}
