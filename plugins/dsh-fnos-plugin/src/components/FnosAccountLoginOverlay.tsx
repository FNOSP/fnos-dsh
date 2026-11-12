/**
 * 账号登录的浮层容器。
 *
 * 挂在 `shell.overlay`（官方挂 portal 弹框的槽位）。职责有两件：
 *
 * 1. **监视官方登录框**：它一出现就收起，由本插件接管（原因见
 *    `FnosAccountLoginDialog` 的模块说明）。
 * 2. **承载登录对话框**：只在「确实需要登录」时打开。
 *
 * ## 什么时候自动打开
 *
 * 只在**检测到官方登录框被收起的那一刻**打开。不做「未登录就打开」的判定——
 * 那是官方引导的逻辑，用户的 provider 配置不同，判定条件也不同
 * （`onboardingReadiness` 有五种取值）。跟着官方框走最省事：官方认为该登录了，
 * 我们就接手。
 *
 * @module dsh-fnos/account-login-overlay
 */

import { useCallback, useEffect, useState } from 'react'
import { FnosAccountLoginDialog, watchOfficialSignInDialogs } from './FnosAccountLoginDialog.tsx'
import type { FnosLocaleKey } from '../client/locales.ts'

type Translate = (key: FnosLocaleKey) => string

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

  useEffect(() => {
    // 官方框出现 → 收起它 → 打开我们的对话框。两件事必须由同一个回调触发，
    // 否则「官方收起了但我们的没打开」会留下一段无提示的空窗期。
    return watchOfficialSignInDialogs(() => { setOpen(true) })
  }, [])

  return <FnosAccountLoginDialog open={open} t={t} onClose={close} />
}
