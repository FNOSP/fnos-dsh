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
import { DshModal, DshInput, DshButton } from '@tnnevol/dsh-semi-ui'
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
  // 已隐藏的官方框跳过，否则每轮 scan 都会重复处理同一个节点。
  if (node.getAttribute('data-dsh-fnos-hidden') === '1') return undefined
  // 自己的对话框同样挂在 `#root` 之后、同样 role=presentation，必须靠专用属性排除
  // ——**不能靠内容类名**：之前用 `.dsh-fnos-account-login`，改用官方 Modal 后那个
  // 容器类被删掉了，自我保护静默失效，结果把自己的弹框也收走了。
  if (node.querySelector('[data-dsh-fnos-account-login]') !== null) return undefined
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
function hideOfficialDialog(dialog: Element): void {
  /*
    **隐藏，不卸载。**

    最初这里是点官方关闭按钮，让 React 正常卸载——DOM 干净、看着也更好。但那样
    会断掉「添加 API Key」这条路：官方那条业务是 `AccountOnboarding` 的
    `useApiKey()` → `setApiKey(true)`，按钮随组件一起消失之后就再也点不到了。

    改为把宿主节点（`role="presentation"` 那层）设为 `display: none`：
    视觉上只剩我们的对话框，而官方节点仍然存活，用户选「添加 API Key」时
    可以点它真正的按钮，业务完全由官方执行。

    标记 `data-dsh-fnos-hidden` 用于去重——隐藏后 node 仍在 `#root` 之后，
    不标记的话每轮 scan 都会重复处理。
  */
  const host = dialog.closest('[role="presentation"]') ?? dialog.parentElement
  if (host instanceof HTMLElement) {
    host.style.display = 'none'
    host.setAttribute('data-dsh-fnos-hidden', '1')
  }
}

/**
 * 真正关闭官方登录框：点它自己的关闭按钮，让 React 正常卸载。
 *
 * 与 {@link hideOfficialDialog} 的分工：
 *
 * - **隐藏**用在拦截那一刻——官方节点必须活着，否则「添加 API Key」那条路的
 *   按钮会随组件消失，代点就断了；
 * - **关闭**用在我方对话框被关掉的时候——此时用户已经放弃了这次登录，官方框
 *   也不该继续留在 DOM 里。
 *
 * @param dialog - 官方对话框元素。
 */
export function dismissOfficialDialog(dialog: Element): void {
  /*
    先把它放出来：隐藏态（`display: none`）的元素点不动按钮，而这正是拦截后
    的常态。放出来后立即点关闭，视觉上不会闪——两次样式变更在同一帧内完成。
  */
  const host = dialog.closest('[role="presentation"]') ?? dialog.parentElement
  if (host instanceof HTMLElement) {
    host.style.removeProperty('display')
    host.removeAttribute('data-dsh-fnos-hidden')
  }
  /*
    官方结构（`ui-primitives/src/Modal.tsx`）：关闭按钮在 header 里、紧随 `<h2>`
    之后，`<button aria-label={closeLabel}>`。取 dialog 内**第一个** aria-label
    按钮就是这个。
  */
  const button = dialog.querySelector('button[aria-label]')
  if (button instanceof HTMLElement) {
    button.click()
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
          hideOfficialDialog(dialog)
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
    if (target instanceof HTMLElement && dialog !== undefined) {
      // 官方框被我们设成 `display: none` 了，先放出来再点——隐藏元素点不动。
      const host = dialog.closest('[role="presentation"]') ?? dialog.parentElement
      if (host instanceof HTMLElement) {
        host.style.removeProperty('display')
        host.removeAttribute('data-dsh-fnos-hidden')
      }
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
  /**
   * 关闭本对话框。
   *
   * 三件事一起做：
   *
   * 1. **同时关掉官方那个弹框**——用户已经放弃这次登录，官方框不该继续留在
   *    DOM 里（拦截期间它是隐藏的，不关掉就会一直是「看不见但活着」的状态）。
   * 2. 取消宿主那次登录尝试，避免留下 `waiting-browser` 脏状态；
   * 3. 复位本地状态。
   */
  const close = useCallback((): void => {
    closedRef.current = true
    const official = officialDialogRef.current
    if (official !== undefined) dismissOfficialDialog(official)
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
  }, [onClose, officialDialogRef])

  /*
    打开时对齐宿主状态：如果已经有一轮进行中的尝试（例如页面刷新后），
    直接进「等待粘贴」而不是让用户再点一次登录——那会白白作废上一轮。
  */
  useEffect(() => {
    if (!open) return
    closedRef.current = false
    let cancelled = false
    /*
      **双向对齐**：宿主有进行中的尝试就进粘贴态，没有就回到初始态。

      早前只处理了「有」这一支、没有处理「没有」：本地 `phase` 会停留在上一次
      的 `waiting`，于是下次打开直接显示粘贴框，用户看不到「登录」按钮。宿主侧
      明明已经是 `cancelled`（实测 `{"phase":"cancelled"}`），界面却还是旧状态。
    */
    void fetch(FNOS_ACCOUNT_LOGIN_STATE_ROUTE, { credentials: 'same-origin' })
      .then(response => response.json())
      .then((state: AccountLoginAttemptView | undefined) => {
        if (cancelled) return
        if (state?.phase === 'waiting-browser' && state.authorizeUrl !== undefined) {
          authorizeUrlRef.current = state.authorizeUrl
          setPhase('waiting')
          return
        }
        // 宿主没有进行中的尝试：清掉本地残留，从初始态开始。
        authorizeUrlRef.current = undefined
        setPhase('idle')
        setPasted('')
        setMessage(undefined)
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [open])

  const waiting = phase === 'waiting' || phase === 'submitting'

  /*
    **用 Semi 的 Modal，并显式挂到 `body`。**

    为什么不用官方 `ui-primitives` 的 `Modal`：它虽然自带 portal，但在本插件里
    不保证能拿到（客户端模块表只暴露部分包），而且这里需要 Semi 的受控可见性
    与动画。改用 Semi 后，几何由本文件的 CSS 对齐到官方数值——数值出处见
    `styles/index.scss` 里 `.dsh-fnos-account-login-modal` 的注释表。

    `getPopupContainer={() => document.body}` 是必须的：Semi 默认就挂到 body，
    但某些宿主会把弹框渲染进带 `transform` / `backdrop-filter` 的容器，那时
    `position: fixed` 的包含块会变成那个容器，弹框位置与遮罩范围都会错。显式声明
    把这件事钉死，不依赖默认值。
  */
  return (
    <DshModal
      visible={open}
      onCancel={close}
      footer={null}
      width={380}
      centered
      closable
      maskClosable={false}
      getPopupContainer={() => document.body}
      modalContentClass="dsh-fnos-account-login-modal"
      title={waiting ? t('accountLoginPasteTitle') : t('accountLoginTitle')}
    >
      {/*
        正文（描述）与输入框。描述用 `-desc` 类，字号/行高/颜色对齐官方
        `Modal.module.css` 的 `.description`（14/22、label-primary）。
      */}
      <p className="dsh-fnos-account-login-desc">
        {waiting ? t('accountLoginPasteHint') : t('accountLoginIntro')}
      </p>
      {waiting ? (
        <DshInput
          value={pasted}
          /* 端口由宿主转发时决定，这里只给形状；写死端口与实际改写的值对不上。 */
          placeholder="http://127.0.0.1:<端口>/oauth/callback?code=…&state=…"
          onChange={(value: string) => { setPasted(value) }}
        />
      ) : null}
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
              「添加 API Key」**走官方业务**：官方那条路是 `AccountOnboarding` 的
              `useApiKey()` → `setApiKey(true)` → 切到 API Key 编辑器，属于组件
              内部状态，插件复刻不了。所以代点官方框里的同名按钮。
            */}
            <DshButton onClick={openOfficialApiKeyEditor}>{t('accountLoginApiKey')}</DshButton>
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
    </DshModal>
  )
}
