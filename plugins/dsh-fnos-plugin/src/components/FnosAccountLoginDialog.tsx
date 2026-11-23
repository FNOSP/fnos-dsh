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
import { DshModal, DshInput, DshButton, DshTypography } from '@tnnevol/dsh-semi-ui'
import type { FnosLocaleKey } from '../client/locales.ts'
import {
  FNOS_ACCOUNT_LOGIN_CANCEL_ROUTE,
  FNOS_ACCOUNT_LOGIN_RELAY_ROUTE,
  type AccountLoginRelayResult,
} from '../contracts/account-login-contract.ts'
import { readLoginStateOnce } from '../client/services/account-login-state.ts'
import { openExternalUrl } from '../client/services/open-url.ts'
import { parseCallbackInput } from '../client/account-login-callback.ts'

type Translate = (key: FnosLocaleKey) => string

/**
 * 提交状态。
 *
 * **显隐不由阶段决定**——`open` 由浮层容器的 DOM 监听驱动。这里只留「是否正在
 * 提交」一件事给按钮扛加载态。
 */
type Phase = 'idle' | 'submitting'

/** 组件参数。 */
export interface FnosAccountLoginDialogProps {
  /** 是否展现（由外部状态驱动）。 */
  readonly open: boolean
  /** 翻译函数。 */
  readonly t: Translate
  /** 关闭回调。 */
  readonly onClose: () => void
  /**
   * 关闭动画结束后触发。
   *
   * 用来在这个时候才去关掉被压制的官方弹框：我们的框还在淡出时就把官方节点
   * 摘掉，视觉上会闪一下（遮罩突然消失又出现）。
   */
  readonly onAfterClose?: () => void
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
export function FnosAccountLoginDialog({ open, t, onClose, onAfterClose }: FnosAccountLoginDialogProps): React.ReactNode {
  const [phase, setPhase] = useState<Phase>('idle')
  const [pasted, setPasted] = useState('')
  const [message, setMessage] = useState<string>()
  /*
    授权页地址。用 ref 而不是 state：它只在点击时读一次，不参与渲染——文案是常显
    的，不按有无地址分支。
  */
  const authorizeUrlRef = useRef<string>()
  const closedRef = useRef(false)

  /**
   * 打开授权页。
   *
   * ## 为什么点击时才取地址
   *
   * `authorizeUrl` 要等官方 `auth_init` 那次网络往返回来才有，首次打开弹框时
   * 通常还没到。但「重新打开授权页」这句是连读整句的一部分，不能因为地址没到
   * 就消失——所以文案常显，地址在点击这一刻兜底再取一次。
   *
   * 缓存优先：轮询已经拿到过就直接用，不必每次都多一次请求。
   */
  const openAuthorizePage = useCallback(async (): Promise<void> => {
    let url = authorizeUrlRef.current
    if (url === undefined || url === '') {
      const state = await readLoginStateOnce()
      url = state?.authorizeUrl
      if (url !== undefined && url !== '') authorizeUrlRef.current = url
    }
    if (url === undefined || url === '') {
      /* 宿主还没生成地址：说清楚，别让用户以为点了没反应。 */
      setMessage(t('accountLoginNoAuthorizeUrl'))
      return
    }
    setMessage(undefined)
    await openExternalUrl(url)
  }, [t])

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
      setPhase('idle')
      setMessage(t('accountLoginFailed'))
    } catch (error) {
      setPhase('idle')
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
    取授权页地址，供正文里「复制重新打开」使用。

    **显隐不由这里决定**——`open` 由浮层容器的 DOM 监听驱动。这里只负责拿到那段
    地址：宿主在授权流程推进后才写入 `authorizeUrl`，所以要等一会儿。
  */
  useEffect(() => {
    if (!open) return undefined
    closedRef.current = false
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const startedAt = Date.now()

    /*
      **间隔 400ms：地址一到就显示。**

      官方 `startSignIn()` 返回时 `phase` 还是 `initializing`，`authorizeUrl` 要等
      `auth_init` 那次网络往返回来才写入（`credentials/deepseek-account`）。这段
      通常只有几百毫秒，1.5 秒的间隔会让链接明显滞后——用户已经看到弹框，却发现
      「重新打开授权页」迟迟不出现。

      上限 90 秒：地址始终拿不到时（宿主异常）不至于无限轮询。
    */
    /**
     * 一次轮询：先看登录是否已完成，再取授权页地址。
     *
     * ## 「登录已完成」从哪知道
     *
     * 授权页在新标签页里完成时，回调先到宿主的**中转端口**
     * （`127.0.0.1:<relayPort>/oauth/callback`），宿主再转发给账号服务。因此
     * 主窗口**不需要**读那个跨域标签页的地址——实测也读不到（`SecurityError`），
     * 官方还主动 `popup.opener = null` 切断了引用。
     *
     * 只要问到 `succeeded` 就自动收尾：清空输入、关掉本弹框（官方弹框由浮层容器
     * 的 DOM 监听一并收起）。
     *
     * ## 为什么拿到地址后还要继续轮询
     *
     * 地址只是「让用户能重新打开授权页」的辅助信息；登录完成那一刻才是终点。
     * 早前拿到地址就停，导致自动验证永远不会触发。
     */
    const load = async (): Promise<void> => {
      if (cancelled) return
      const state = await readLoginStateOnce()
      if (cancelled) return
      if (state?.phase === 'succeeded') {
        setPhase('idle')
        setPasted('')
        setMessage(undefined)
        onClose()
        return
      }
      if (state?.authorizeUrl !== undefined && state.authorizeUrl !== '') {
        authorizeUrlRef.current = state.authorizeUrl
      }
      /* 超时只限制「还没拿到地址」的等待；拿到地址后继续看登录结果。 */
      if (authorizeUrlRef.current === undefined && Date.now() - startedAt > 90_000) return
      timer = setTimeout(() => { void load() }, 400)
    }

    void load()
    return () => {
      cancelled = true
      if (timer !== undefined) clearTimeout(timer)
    }
    /* `onClose` 在父级是 useCallback，引用稳定；放进依赖不会造成重挂轮询。 */
  }, [open, onClose])

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
    **只画「填写授权地址」这一屏，不画官方的登录界面。**

    官方的 `SignInDialog` 自带初始态与「等待登录」态，界面本来就是对的——多画
    一个只会跟官方抢屏幕，用户看到两个一样的框。

    这里补的是官方**没有**的那一步：授权后浏览器跳到 `127.0.0.1` 打不开，需要
    把地址粘回来。

    **显隐只看 `open`。** 早前这里还有一道按内部阶段判的门控，而阶段推进代码在
    改 DOM 驱动时被删掉了，于是那道门永远关闭，弹框一次都没渲染过——`open` 明明
    是 true。显隐的唯一依据就是 `open`。
  */
  return (
    <DshModal
      visible={open}
      onCancel={close}
      afterClose={onAfterClose}
      footer={null}
      width={480}
      centered
      maskClosable={false}
      getPopupContainer={() => document.body}
      modalContentClass="dsh-fnos-account-login-modal"
      title={t('accountLoginPasteTitle')}
    >
      <p className="dsh-fnos-account-login-desc">
        {t('accountLoginPasteHint')}{' '}
        {/*
          「重新打开授权页」**始终显示**，点击时才去取地址。

          这句是连读整句的一部分，缺失会让文案断在半句；而 `authorizeUrl` 要等
          官方 `auth_init` 回来才有（`credentials/deepseek-account`），首次打开
          弹框时通常还没到。所以不在渲染时判断有无，改为点击时兜底现取一份。
        */}
        <DshTypography.Text
          link
          underline
          onClick={(event: React.MouseEvent) => {
            event.preventDefault()
            event.stopPropagation()
            void openAuthorizePage()
          }}
        >
          {t('accountLoginReopenAction')}
        </DshTypography.Text>
        。
      </p>
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
