/**
 * 让官方「打开设置」快捷键在 fnOS iframe 内不被浏览器吞掉。
 *
 * 背景：DSH 的设置命令 `settings.open` 在 **Desktop** 运行时绑定 `primary + ,`
 * （`Cmd/Ctrl + ,`），在 **Web** 运行时绑定 `primary + alt + ,`。fnOS 应用跑在
 * iframe 里、运行时被识别为 Web，但用户在浏览器里按 `Ctrl/Cmd + ,` 时，该组合
 * 会先被浏览器当成「浏览器设置」处理，等不到 DSH 的快捷键适配器。
 *
 * 本模块在 **window 捕获阶段**先一步截获这两个组合，`preventDefault` 掉浏览器
 * 的默认行为，再主动派发一次等价的键盘事件给 DSH 的快捷键层，让官方命令照常
 * 触发。
 *
 * 与「刷新快捷键」的区别：刷新是直接调 `window.location.reload()`，因为浏览器
 * 的刷新不可协商；设置则必须让官方命令自己去开面板，不能由插件代劳——否则
 * 官方对「已打开则关闭」等状态判断会失效。
 */

import { createElement, Fragment } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DshHotKeys } from '@tnnevol/dsh-semi-ui'
import { isEmbeddedFnosFrame } from '../services/sdk-carrier.ts'
import { isSettingsShortcut } from './settings-shortcut-matcher.ts'

export { isSettingsShortcut } from './settings-shortcut-matcher.ts'

export function installFnosSettingsShortcut(): () => void {
  if (!isEmbeddedFnosFrame() || typeof document === 'undefined' || document.body === null) return () => {}

  /**
   * 截获后主动补发一次事件。
   *
   * 不能让这里的 handler 直接调「打开设置」的私有接口：`settings.open` 的
   * `resolve` 会判断当前是否已经有设置弹层（有则关闭），自行调用会绕过那个
   * 状态机，出现「按一次开、再按一次关不掉」。
   *
   * 补发时**必须补上 `altKey`**：fnOS 里运行时是 Web，官方 `settings.open` 的
   * 默认绑定是 `primary + alt + Comma`（只有 Desktop 才是 `primary + Comma`）。
   * 不带 `alt` 补发出来的事件两组都命中不了，表现成「浏览器不再抢、设置也不开」。
   * `preventDefault` 已在原事件上做过，补发的事件不会再走浏览器默认行为。
   */
  /**
   * 补发事件的重入保护。
   *
   * `DshHotKeys` 只做 `preventDefault`，**没有 `stopPropagation``**（已核对其
   * 实现）。而我们的监听挂在 window 捕获阶段：补发的事件会再次进入本监听，
   * 无条件递归直到栈溢出。用一个标志位让补发的事件直接放行。
   */
  let forwarding = false

  const redispatch = (event: KeyboardEvent): void => {
    const forwarded = new KeyboardEvent('keydown', {
      key: event.key,
      code: event.code,
      bubbles: true,
      cancelable: true,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      altKey: true,
      shiftKey: event.shiftKey,
    })
    // 目标是当前焦点元素：DSH 的适配器按事件目标判断区域（page / editable / terminal）。
    const target = event.target instanceof EventTarget ? event.target : document.body
    forwarding = true
    try {
      target.dispatchEvent(forwarded)
    } finally {
      forwarding = false
    }
  }

  const handleHotKey = (event: KeyboardEvent): void => {
    // 这一条事件就是我们刚补发的，放行给 DSH 自己的适配器，不再二次拦截。
    if (forwarding) return
    if (!isSettingsShortcut(event)) return
    event.preventDefault()
    event.stopPropagation()
    redispatch(event)
  }

  const mount = document.createElement('span')
  mount.setAttribute('data-dsh-fnos-settings-shortcut', '')
  mount.hidden = true
  document.body.append(mount)

  const root: Root = createRoot(mount)
  const listenerTarget = (): HTMLElement => window as unknown as HTMLElement
  root.render(createElement(
    Fragment,
    null,
    createElement(DshHotKeys, {
      hotKeys: [DshHotKeys.Keys.Control, DshHotKeys.Keys.Comma],
      preventDefault: true,
      onHotKey: handleHotKey,
      getListenerTarget: listenerTarget,
      render: null,
    }),
    createElement(DshHotKeys, {
      hotKeys: [DshHotKeys.Keys.Meta, DshHotKeys.Keys.Comma],
      preventDefault: true,
      onHotKey: handleHotKey,
      getListenerTarget: listenerTarget,
      render: null,
    }),
  ))

  return () => {
    root.unmount()
    mount.remove()
  }
}
