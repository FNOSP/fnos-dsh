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
  /** 授权页地址；「复制链接」用它，没有就不显示那一段。 */
  const [authorizeUrl, setAuthorizeUrl] = useState<string>()
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
      **上限按时间，不按次数。**

      真机实测：`authorizeUrl` 在 `waiting-browser` 之后约 30-40 秒才出现。早前
      按次数限制（12 次 × 800ms ≈ 10 秒），会在地址出现之前就放弃，之后再也不补，
      「复制重新打开」这段永远不显示。

      给到 90 秒、间隔 1.5 秒：既不会空转太密，也覆盖得住真实等待。拿到即停。
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
        setAuthorizeUrl(state.authorizeUrl)
      }
      /* 超时只限制「还没拿到地址」的等待；拿到地址后继续看登录结果。 */
      if (authorizeUrlRef.current === undefined && Date.now() - startedAt > 90_000) return
      timer = setTimeout(() => { void load() }, 1500)
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
      footer={null}
      width={480}
      centered
      maskClosable={false}
      getPopupContainer={() => document.body}
      modalContentClass="dsh-fnos-account-login-modal"
      title={t('accountLoginPasteTitle')}
    >
      {/*
        正文 + 可复制的授权链接，**同一段落、共用一个块**。

        原先链接单独占一行、右边挂一个「复制链接」按钮；实际上用户要复制的是
        地址本身，按钮只是多一步。改成把地址并进这句说明里、并且让文字可选：
        读说明时顺手就能选中复制。

        链接用 `user-select: all`：单击一次就整条选中，省掉拖选的麻烦；
        `word-break: break-all` 保证长地址不会撑破版心。
      */}
      {/*
        正文：说明 + 一个**可直接点按的「复制重新打开」文字**。

        用户要的是「这条授权地址能被复制走」。之前先试过单独一行的按钮，又试过
        把整条地址铺在正文里让用户自己拖选，都不如一句话里那个能点的词直接。

        这里用 Semi `Typography.Text` 的 `copyable.render`：Semi 负责写剪贴板与
        「已复制」的短暂反馈，我们只把那段文字渲染成一个可点的节点。地址本身不
        再铺在正文里——它又长又打断阅读，复制走就够了。
      */}
      <p className="dsh-fnos-account-login-desc">
        {t('accountLoginPasteHint')}{' '}
        {/*
          用 Semi 的 `Typography.Text link` 呈现，不自己写 `<a>` / `<button>`。

          `link` 的对象形式会把属性透传给 `<a>`，样式与语义都由 Semi 保证；点击
          则交给 fnOS 的 `openURL`——应用跑在网关 iframe 里，裸链接在那里取决于
          宿主实现（Web 宿主拦成新标签页、移动 WebView 可能打不开），而 `openURL`
          由平台保证一致（Web 走 `window.open`，移动端改用系统浏览器）。

          `authorizeUrl` 未就绪时 `link` 传 `false`：那句「重新打开授权页」是连读
          整句的一部分，不能整段消失。
        */}
        <DshTypography.Text
          link={authorizeUrl === undefined ? false : { href: authorizeUrl }}
          underline
          onClick={(event: React.MouseEvent) => {
            event.preventDefault()
            event.stopPropagation()
            if (authorizeUrl === undefined) return
            void openExternalUrl(authorizeUrl)
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
