/**
 * 账号登录：授权完成后的「粘贴回调地址」浮层。
 *
 * ## 它补的是官方没有的那一屏
 *
 * 官方 `SignInDialog` 自带两态：
 *
 * 1. 初始态：标题「登录 DeepSeek 账号」+「添加 API Key」/「登录」；
 * 2. 「等待登录」态：授权页已开，按钮是「复制登录链接」/「取消」。
 *
 * 两态都认 loopback 回调——在 NAS 上，浏览器会跳到**用户自己电脑**的
 * `127.0.0.1`，页面打不开，地址栏里却带着有效的 `code`。官方没有「把地址
 * 粘回来」这一步，这一屏就是本组件补的。
 *
 * ## 为什么不没收/替换官方弹框
 *
 * 官方界面本身是对的，替换它等于重画一遍、还要跟着官方改版维护。这里只在
 * 宿主进入 `waiting-browser` 时**额外**显示一个粘贴框，官方弹框照常在下面。
 *
 * @module dsh-fnos/account-login-overlay
 */

import { useCallback, useEffect, useState } from 'react'
import { FnosAccountLoginDialog } from './FnosAccountLoginDialog.tsx'
import { FNOS_ACCOUNT_LOGIN_STATE_ROUTE, type AccountLoginAttemptView } from '../contracts/account-login-contract.ts'
import type { FnosLocaleKey } from '../client/locales.ts'

type Translate = (key: FnosLocaleKey) => string

/** 轮询宿主状态的间隔。 */
const POLL_MS = 1200

/** 组件参数。 */
export interface FnosAccountLoginOverlayProps {
  /** 翻译函数。 */
  readonly t: Translate
}

/**
 * 账号登录浮层。
 *
 * @param props - 组件参数。
 * @param props.t - 翻译函数。
 * @returns 浮层元素。
 */
export function FnosAccountLoginOverlay({ t }: FnosAccountLoginOverlayProps): React.ReactNode {
  const [open, setOpen] = useState(false)

  const close = useCallback((): void => { setOpen(false) }, [])

  /*
    **由宿主状态驱动，不监听 DOM。**

    之前是「官方框一出现就收起它、换成我们的」——但官方那两屏本来就该由官方
    呈现，收起来反而要多画一遍。现在只读 `attempt.phase`：进 `waiting-browser`
    （授权页已开、等用户粘贴）就显示粘贴框，否则收起。

    轮询而不是订阅：宿主没有推 `attempt` 变化的通道给插件。
  */
  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const poll = async (): Promise<void> => {
      if (stopped) return
      try {
        const response = await fetch(FNOS_ACCOUNT_LOGIN_STATE_ROUTE, { credentials: 'same-origin' })
        const state = await response.json() as AccountLoginAttemptView | undefined
        if (!stopped) setOpen(state?.phase === 'waiting-browser' && state.authorizeUrl !== undefined)
      } catch {
        // 读失败不改变现状态：下一轮再试。
      }
      if (!stopped) timer = setTimeout(() => { void poll() }, POLL_MS)
    }

    void poll()
    return () => {
      stopped = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [])

  return <FnosAccountLoginDialog open={open} t={t} onClose={close} />
}
