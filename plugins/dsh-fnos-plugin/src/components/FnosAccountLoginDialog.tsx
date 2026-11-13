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
  FNOS_ACCOUNT_LOGIN_STATE_ROUTE,
  type AccountLoginAttemptView,
  type AccountLoginRelayResult,
} from '../contracts/account-login-contract.ts'
import { parseCallbackInput } from '../client/account-login-callback.ts'

type Translate = (key: FnosLocaleKey) => string

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
}

/**
 * 账号登录对话框。
 *
 * @param props - 组件参数。
 * @param props.open - 是否展现。
 * @param props.t - 翻译函数。
 * @param props.onClose - 关闭回调。
 * @returns 对话框元素。
 */
export function FnosAccountLoginDialog({ open, t, onClose }: FnosAccountLoginDialogProps): React.ReactNode {
  const [phase, setPhase] = useState<Phase>('idle')
  const [pasted, setPasted] = useState('')
  const [message, setMessage] = useState<string>()
  const authorizeUrlRef = useRef<string>()
  const closedRef = useRef(false)

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

  /**
   * 关闭本对话框。
   *
   * 同时**取消宿主那次登录尝试**：留着会让状态一直停在 `waiting-browser`，
   * 用户下次点登录会复用这个残留尝试，白白作废一轮。
   *
   * 官方弹框由官方自己管理，这里不去碰它。
   */
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
  /*
    **只渲染「粘贴回调地址」这一屏，不画官方的登录初始态。**

    官方的 `SignInDialog` 自带初始态（标题「登录 DeepSeek 账号」+ 两个按钮）与
    「等待登录」态，界面本来就是对的——多画一个只会跟官方抢屏幕，用户看到两个
    一样的框。

    这里补的是官方**没有**的那一屏：授权后浏览器跳到 `127.0.0.1` 打不开，
    需要把地址粘回来。所以组件只在 `waiting` 时渲染。
  */
  if (!waiting) return null

  return (
    <DshModal
      visible
      onCancel={close}
      footer={null}
      width={380}
      centered
      maskClosable={false}
      getPopupContainer={() => document.body}
      modalContentClass="dsh-fnos-account-login-modal"
      title={t('accountLoginPasteTitle')}
    >
      <p className="dsh-fnos-account-login-desc">{t('accountLoginPasteHint')}</p>
      <DshInput
        value={pasted}
        /* 端口由宿主转发时决定，这里只给形状；写死端口与实际改写的值对不上。 */
        placeholder="http://127.0.0.1:<端口>/oauth/callback?code=…&state=…"
        onChange={(value: string) => { setPasted(value) }}
      />
      {message === undefined ? null : (
        <p className="dsh-fnos-account-login-error" role="alert">{message}</p>
      )}
      <div className="dsh-fnos-account-login-actions">
        <DshButton onClick={close}>{t('cancel')}</DshButton>
        <DshButton
          theme="solid"
          type="primary"
          loading={phase === 'submitting'}
          onClick={() => { void submitCallback() }}
        >
          {t('accountLoginAuthorize')}
        </DshButton>
      </div>
    </DshModal>
  )
}
