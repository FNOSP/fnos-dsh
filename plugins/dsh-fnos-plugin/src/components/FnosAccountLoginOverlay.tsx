/**
 * 账号登录：授权完成后的「粘贴回调地址」浮层。
 *
 * ## 它补的是官方没有的那一屏
 *
 * 官方 `SignInDialog` 自带两态：初始态（「登录 DeepSeek 账号」+ 两个按钮）与
 * 「等待登录」态（授权页已开，按钮是「复制登录链接」/「取消」）。两态都认
 * loopback 回调——在 NAS 上，浏览器会跳到**用户自己电脑**的 `127.0.0.1`，
 * 页面打不开，地址栏里却带着有效的 `code`。官方没有「把地址粘回来」这一步，
 * 这一屏就是本组件补的。
 *
 * ## 用 DOM 监听，不轮询
 *
 * 触发信号是**官方弹框自己**：它进入「等待登录」态就说明授权页已经打开、正等
 * 用户粘贴。`MutationObserver` 观察 `#root` 之后的弹层区域，命中即显示粘贴框；
 * 官方弹框消失（用户取消 / 登录完成 / 关掉页面）就收起。
 *
 * 不用轮询的原因：轮询只能靠固定间隔猜状态，既多打请求，又会在「用户刚关掉、
 * 下一轮又弹回来」这种时序上出错。DOM 变化是事件，什么时候发生就什么时候响应。
 *
 * @module dsh-fnos/account-login-overlay
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { FnosAccountLoginDialog } from './FnosAccountLoginDialog.tsx'
import { FNOS_ACCOUNT_LOGIN_STATE_ROUTE, type AccountLoginAttemptView } from '../contracts/account-login-contract.ts'
import type { FnosLocaleKey } from '../client/locales.ts'

type Translate = (key: FnosLocaleKey) => string

/**
 * 官方「等待登录」态的标题字样。
 *
 * 认文案而不是类名：CSS Modules 的 hash 每次构建都变，标题是产品文案、变动少
 * 且可枚举。覆盖官方支持的语言。
 */
const WAITING_TITLES = [
  '等待登录', 'Waiting for sign in', 'Warten auf Anmeldung', 'Esperando el inicio de sesión',
  'En attente de connexion', 'In attesa di accesso', 'サインインを待っています',
  '로그인 대기 중', 'Ожидание входа',
]

/**
 * 在 `#root` 之后的弹层里找「等待登录」那一屏。
 *
 * @returns 命中的官方 dialog；没有则为 undefined。
 */
function findWaitingDialog(): Element | undefined {
  const root = document.getElementById('root')
  let node: Element | null = root === null ? document.body.firstElementChild : root.nextElementSibling
  while (node !== null) {
    if (node.getAttribute('role') === 'presentation') {
      const dialog = node.querySelector('[role="dialog"]')
      const text = dialog?.textContent ?? ''
      if (dialog !== null && WAITING_TITLES.some(title => text.includes(title))) return dialog
    }
    node = node.nextElementSibling
  }
  return undefined
}

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
    **这次已经关过、别再弹回来。**

    存的是「关闭时那一屏官方弹框」的节点。同一个节点还在（用户只是关掉了我们的
    框、官方仍停在等待态）就不再显示；节点消失说明这一轮结束了，标记自然失效
    ——用 `WeakRef` 语义的弱引用没必要，节点被替换时引用比对会自动不相等。
  */
  const dismissedNodeRef = useRef<Element>()
  const close = useCallback((): void => {
    dismissedNodeRef.current = findWaitingDialog()
    setOpen(false)
  }, [])

  useEffect(() => {
    if (typeof document === 'undefined' || document.body === null) return undefined

    const sync = (): void => {
      const dialog = findWaitingDialog()
      if (dialog === undefined) {
        // 官方那一屏没了：这一轮结束，清掉压制标记。
        dismissedNodeRef.current = undefined
        setOpen(false)
        return
      }
      // 同一屏被用户关过：保持收起。
      setOpen(dialog !== dismissedNodeRef.current)
    }

    sync()
    queueMicrotask(sync)
    const observer = new MutationObserver(sync)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => { observer.disconnect() }
  }, [])

  return <FnosAccountLoginDialog open={open} t={t} onClose={close} />
}

/**
 * 读一次宿主的授权页地址。
 *
 * **单次读取，不是轮询**：只在 DOM 监听到「等待登录」时取一次，用来给
 * 「复制链接」按钮提供地址。失败不影响粘贴框本身。
 *
 * @returns 授权页地址；不可用时为 undefined。
 */
export async function readAuthorizeUrlOnce(): Promise<string | undefined> {
  try {
    const response = await fetch(FNOS_ACCOUNT_LOGIN_STATE_ROUTE, { credentials: 'same-origin' })
    const state = await response.json() as AccountLoginAttemptView | undefined
    return state?.authorizeUrl
  } catch {
    return undefined
  }
}
