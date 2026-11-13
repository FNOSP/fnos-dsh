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

import { useCallback, useEffect, useRef, useState } from 'react'
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
  /*
    最近一次被收起的官方对话框。监听器在这里启动，收起动作也发生在这里，
    所以引用必须由本组件持有、再传给对话框（那边要用它代点「添加 API Key」）。

    保存时机是**收起之前**：收起之后 React 会卸载节点，`querySelector` 已经
    找不到按钮了。
  */
  const officialDialogRef = useRef<Element>()

  const close = useCallback((): void => { setOpen(false) }, [])

  useEffect(() => {
    /*
      官方框出现 → 收起它 → 打开我们的对话框。

      两件事必须由同一个回调触发，否则「官方收起了但我们的没打开」会留下一段
      无提示的空窗期，用户会以为点击没生效。
    */
    return watchOfficialSignInDialogs((dialog) => {
      officialDialogRef.current = dialog
      setOpen(true)
    })
  }, [])

  return <FnosAccountLoginDialog open={open} t={t} onClose={close} officialDialogRef={officialDialogRef} />
}
