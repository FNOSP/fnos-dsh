/**
 * 账号登录：授权完成后的「粘贴回调地址」浮层。
 *
 * 官方 `SignInDialog` 认 loopback 回调，但在 NAS 上浏览器会跳到用户自己电脑的
 * `127.0.0.1`，页面打不开而地址栏里带着有效 `code`。官方没有「把地址粘回来」
 * 这一步，本组件补的就是它。
 *
 * 用 `MutationObserver` 监听 `body` 子节点变化，命中官方登录弹框就隐藏它并显示
 * 我们的弹框；不轮询——DOM 变化本身就是事件。
 *
@module dsh-fnos/account-login-overlay
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { FnosAccountLoginDialog } from './FnosAccountLoginDialog.tsx'
import type { FnosLocaleKey } from '../client/locales.ts'

type Translate = (key: FnosLocaleKey) => string

/**
 * 官方登录弹框标题（`role="dialog"` 的 `aria-label`）。
 *
 * 官方把 `Modal` 的 `title` 写到 `aria-label`，而登录弹框的标题随阶段变化
 * （`loginTitle` / `browserTitle` / `timeoutTitle` / `failureTitle`）。标题是
 * 弹框的身份，比正文稳定。
 *
 * 取自 `ui-settings-account/src/client/locales.ts` 的 `loginTitle` 与
 * `browserTitle`，只覆盖 DSH 实际提供的 8 个语言——没有的语言不写，编造的值
 * 永远不会命中。`timeoutTitle` / `failureTitle` 是终态，此时官方界面没有可复制
 * 的登录链接，不接管。
 */
const SIGN_IN_ARIA_LABELS = [
  // en
  'Get started', 'Waiting for sign in',
  // zh
  '开始使用', '等待登录',
  // ja
  'はじめに', 'ログインを待機中',
  // es
  'empezar', 'Esperando iniciar sesión',
  // fr
  'Commencez', 'En attente de connexion',
  // de
  'Fangen Sie an', 'Warten auf die Anmeldung',
  // ru
  'Начать', 'Ожидание входа в систему',
  // pt
  'Comece', 'Aguardando login',
]

/**
 * 找官方登录弹框。
 *
 * 选择器：`body > [role="presentation"] > [role="dialog"]`。
 *
 * @returns `dialog` 是命中的 `role="dialog"` 节点，`host` 是它的父元素
 *   （`role="presentation"`，遮罩在那一层上，隐藏要作用于它）。没有则为 undefined。
 */
function findSignInDialog(): { dialog: Element, host: Element } | undefined {
  if (typeof document === 'undefined' || document.body === null) return undefined
  const dialog = document.querySelector('body > [role="presentation"] > [role="dialog"]')
  if (dialog === null) return undefined
  const label = (dialog.getAttribute('aria-label') ?? '').trim()
  if (label === '') return undefined
  // 全等匹配：`signOut` 的取值不在名单里，无需单独排除退出登录。
  if (!SIGN_IN_ARIA_LABELS.includes(label)) return undefined
  const host = dialog.parentElement
  if (host === null) return undefined
  return { dialog, host }
}

/**
 * 关闭官方弹框：点它自己的关闭按钮，让 React 正常卸载。
 *
 * 关闭前先解除隐藏——`display: none` 的元素派发 `click` 不会触发 React 回调。
 *
 * @param found - 官方弹框的宿主与内容节点。
 * @param found.dialog - `role="dialog"` 节点，关闭按钮在其内部。
 * @param found.host - `role="presentation"` 宿主，隐藏与恢复作用于它。
 */
function dismissOfficial(found: { dialog: Element, host: Element }): void {
  showOfficial(found.host)
  // 官方 Modal 的关闭按钮是 header 内第一个带 aria-label 的 button。
  const button = found.dialog.querySelector('button[aria-label]')
  if (button instanceof HTMLElement) {
    button.click()
    return
  }
  // 兜底：headless 变体没有 header，改派 Esc（官方用 `useModalLayer` 监听）。
  found.dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
}

/** 隐藏标记：既是幂等保护，也方便在调试时识别「这一层是我们压下去的」。 */
const HIDDEN_ATTR = 'data-dsh-fnos-hidden'

/**
 * 把官方弹框压下去。
 *
 * **不改结构、只改可见性**：官方那套组件仍在正常渲染，遮罩与定位都在宿主上，
 * 所以隐藏必须作用于宿主而不是 `dialog` 本身——只藏内容会留下一层拦截点击的
 * 透明遮罩。
 *
 * @param host - 官方弹框的宿主节点。
 */
function hideOfficial(host: Element): void {
  if (!(host instanceof HTMLElement)) return
  if (host.getAttribute(HIDDEN_ATTR) === '1') return
  host.setAttribute(HIDDEN_ATTR, '1')
  host.style.display = 'none'
}

/**
 * 撤销隐藏。
 *
 * @param host - 官方弹框的宿主节点。
 */
function showOfficial(host: Element): void {
  if (!(host instanceof HTMLElement)) return
  if (host.getAttribute(HIDDEN_ATTR) !== '1') return
  host.removeAttribute(HIDDEN_ATTR)
  host.style.removeProperty('display')
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
  /*
    当前被我们压下去的官方宿主。关闭时**必须放出来**，否则官方框会一直停在
    `display: none`：用户已经把这次登录取消了，官方那边也该回到可操作状态。
  */
  const hiddenHostRef = useRef<Element>()
  /*
    等着在我们的关闭动画结束后再关掉的官方弹框。

    我们的 Modal 有淡出动画。若在触发关闭的同一帧就把官方节点摘掉，视觉上会
    「遮罩突然消失又出现」——先把要关的那一屏记下来，等 `afterClose` 再动手。
  */
  const pendingDismissRef = useRef<{ dialog: Element, host: Element }>()

  const close = useCallback((): void => {
    const found = findSignInDialog()
    /*
      记住「关掉的是哪一屏」：官方框卸载后 `findSignInDialog()` 会返回
      undefined，压制标记随之自然失效，不会一关闭又弹回来。
    */
    dismissedNodeRef.current = found?.dialog
    if (found !== undefined) {
      /*
        记下来，等我们的关闭动画结束再关（见 `handleAfterClose`）。

        此时**不能**同步点官方的关闭按钮：我们的框还在淡出，官方节点一摘，
        遮罩会先消失再随着卸载重新布局，看起来像闪了一下。
      */
      pendingDismissRef.current = found
    } else if (hiddenHostRef.current !== undefined) {
      // 找不到官方框但宿主还压着：至少把可见性恢复，别让它永久隐藏。
      showOfficial(hiddenHostRef.current)
    }
    hiddenHostRef.current = undefined
    setOpen(false)
  }, [])

  /**
   * 我们的弹框关闭动画结束后，把官方那一屏真正关掉。
   *
   * 留一个「看不见但活着」的弹层不关，`[role="dialog"]` 会一直挂在 `body` 下：
   * 其它按结构查找弹框的逻辑（以及我们自己下一轮的判据）都会把它当成仍在的官方
   * 登录框。
   */
  const handleAfterClose = useCallback((): void => {
    const pending = pendingDismissRef.current
    pendingDismissRef.current = undefined
    if (pending !== undefined) dismissOfficial(pending)
  }, [])

  useEffect(() => {
    if (typeof document === 'undefined' || document.body === null) return undefined

    const sync = (): void => {
      const found = findSignInDialog()
      if (found === undefined) {
        // 官方那一屏没了：这一轮结束，清掉压制标记。
        dismissedNodeRef.current = undefined
        hiddenHostRef.current = undefined
        setOpen(false)
        return
      }
      /*
        **官方框一律压下去。**

        它的初始态与「等待登录」态都跟我们的对话框讲同一件事，两个框叠在一起
        只会让用户不知道该点哪个。压制只改宿主的可见性，不动结构，官方的组件
        状态不受影响；关掉我们的框时再放出来。

        唯独用户已经关过的那一屏不再重新接管（`dismissedNodeRef`），否则点了
        关闭又弹回来。
      */
      if (found.dialog === dismissedNodeRef.current) {
        setOpen(false)
        return
      }
      hideOfficial(found.host)
      hiddenHostRef.current = found.host
      setOpen(true)
    }

    sync()
    queueMicrotask(sync)
    /*
      **只监听 `body` 的直接子节点，不下潜。**

      官方弹层由 portal 挂在 `body` 直下，所以「弹框出现 / 消失」正好是一次
      `body` 的子节点增删，这一层就够。开 `subtree` 会把弹框内部每次重渲染
      （按钮 loading、文案切换）都算成变化，回调被高频触发，而判断结果完全
      不变——`findSignInDialog()` 查的也只是这一层。
    */
    const observer = new MutationObserver(sync)
    observer.observe(document.body, { childList: true })
    return () => { observer.disconnect() }
  }, [])

  return <FnosAccountLoginDialog open={open} t={t} onClose={close} onAfterClose={handleAfterClose} />
}
