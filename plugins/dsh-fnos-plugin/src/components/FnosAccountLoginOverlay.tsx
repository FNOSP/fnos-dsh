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
 * 官方登录框的文案特征。
 *
 * ## 为什么不能用「开始使用」
 *
 * 官方两处文案撞车：
 *
 * | 出处 | 文案 |
 * | --- | --- |
 * | `ui-settings-account` 登录框的**标题** | 开始使用 |
 * | `ui-settings-models` 引导弹框的**描述结尾** | 配置 DeepSeek 官方模型，即可开始使用。 |
 *
 * 用「开始使用」当判据，会把**引导弹框**一起认成登录框——用户只是第一次打开
 * 应用，就被塞一个粘贴回调地址的框。所以要认登录框**独有的**文案。
 *
 * ## 可用的判据
 *
 * - 登录框描述：「登录 DeepSeek 账号，或添加 API Key，即可开始使用。」→ 认
 *   「登录 DeepSeek 账号」；
 * - 等待态：「等待登录……」→ 认「等待登录」；
 * - 短标题：「登录」（英文 Sign in）。
 *
 * 本插件自己的粘贴框文案（「完成授权后，把地址粘回来」「授权页关掉了？复制
 * 链接重新打开：」等）**不含**这些词，另有一道类名排除兜底。
 */
const SIGN_IN_MARKERS = [
  // 中文
  '登录 DeepSeek 账号', '等待登录', '登录',
  // 英文
  'Sign in to DeepSeek account', 'Waiting for sign in', 'Sign in',
  // 德文
  'Bei DeepSeek-Konto anmelden', 'Warten auf Anmeldung', 'Anmelden',
  // 西班牙文
  'Iniciar sesión en la cuenta de DeepSeek', 'Esperando el inicio de sesión', 'Iniciar sesión',
  // 法文
  'Se connecter au compte DeepSeek', 'En attente de connexion', 'Se connecter',
  // 意大利文
  "Accedi all'account DeepSeek", 'In attesa di accesso', 'Accedi',
  // 日文
  'DeepSeek アカウントにログイン', 'サインインを待っています', 'ログイン',
  // 韩文
  'DeepSeek 계정으로 로그인', '로그인 대기 중', '로그인',
  // 俄文
  'Вход в аккаунт DeepSeek', 'Ожидание входа', 'Войти',
]

/**
 * 在 `body` 的**直接子节点**里找官方登录框。
 *
 * 官方弹层由 portal 挂到 `body` 直下，所以只需要看这一层，不必递归整棵树，
 * 也不必自己维护「从 `#root` 往后数兄弟」。用 `Array.prototype.find` 而不是
 * `while` 链表遍历：越界与空节点由数组语义兜住，不会写出 `node !== null`
 * 这种容易漏改的循环条件。
 *
 * @returns 命中的官方 dialog；没有则为 undefined。
 */
function findSignInDialog(): Element | undefined {
  if (typeof document === 'undefined' || document.body === null) return undefined
  const host = [...document.body.children].find((node) => {
    /*
      先排除自己。

      **要查后代，不能只查本节点**：我们的弹框类名挂在 Semi 的
      `.semi-modal-content` 上，而 `body` 直下是外层 `.semi-modal-wrap`——
      只比本节点的 class 永远不命中，自己的框会被当成官方框。
    */
    if (node.querySelector('.dsh-fnos-account-login-modal') !== null) return false
    if (node.classList.contains('dsh-fnos-account-login-modal')) return false
    if (node.getAttribute('role') !== 'presentation') return false
    const dialog = node.querySelector('[role="dialog"]')
    if (dialog === null) return false
    const text = dialog.textContent ?? ''
    return SIGN_IN_MARKERS.some(marker => text.includes(marker))
  })
  return host?.querySelector('[role="dialog"]') ?? undefined
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
    dismissedNodeRef.current = findSignInDialog()
    setOpen(false)
  }, [])

  useEffect(() => {
    if (typeof document === 'undefined' || document.body === null) return undefined

    const sync = (): void => {
      const dialog = findSignInDialog()
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
