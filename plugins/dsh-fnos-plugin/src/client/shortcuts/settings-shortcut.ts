/**
 * `Cmd/Ctrl + ,` → 打开「飞牛 OS 设置」弹框。
 *
 * ## 为什么抢占这个组合
 *
 * fnOS 里运行时被识别为 **Web**，官方 `settings.open` 因此绑在
 * `primary + Alt + ,` 上；`primary + ,` 在 Web 运行时没有归属者，而浏览器又会
 * 把它抢去开浏览器自身的设置。于是这个组合在 fnOS 页面里是个「按了也没反应、
 * 还不属于任何人」的空位——正好给飞牛自己的设置用。
 *
 * 这与早先的实现不同：早先我们截获它后**补发带 `alt` 的事件**转交给 DSH 官方，
 * 用户按 `Ctrl+,` 打开的是 DSH 设置。既然官方设置已经有 `Ctrl+Alt+,` 这个明确
 * 入口，就让 `Ctrl+,` 归飞牛——两个设置各有一个快捷键，不再互相顶替。
 *
 * ## 与「刷新快捷键」的区别
 *
 * 刷新直接调 `window.location.reload()`，因为浏览器的刷新不可协商。设置则只翻
 * 一个 store 的开关，不碰官方命令的状态机。
 *
 * @module dsh-fnos/shortcuts/settings-shortcut
 */

import { createElement, Fragment } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DshHotKeys } from '@tnnevol/dsh-semi-ui'
import { isFnosHosted } from '../services/environment.ts'
import { configDialogStore } from '../config-dialog-store.ts'
import { isSettingsShortcut } from './settings-shortcut-matcher.ts'

export { isSettingsShortcut } from './settings-shortcut-matcher.ts'

/**
 * 安装 `Cmd/Ctrl + ,` 的拦截器。
 *
 * 判据是「fnOS 托管」而不是「在 iframe 里」：独立浏览器页面同样是 fnOS 应用，
 * 浏览器一样会把 `Ctrl/Cmd + ,` 抢去开浏览器设置，这里同样需要抢先截获。
 *
 * @returns 卸载函数。
 */
export function installFnosSettingsShortcut(): () => void {
  if (!isFnosHosted() || typeof document === 'undefined' || document.body === null) return () => {}

  /**
   * 重入保护。
   *
   * 本监听挂在 window 捕获阶段，而 `DshHotKeys` 只做 `preventDefault`、**不**
   * `stopPropagation`（已核对其实现）——不设标志位，事件会再次进入本监听，
   * 递归到栈溢出。
   */
  let handling = false

  const handleHotKey = (event: KeyboardEvent): void => {
    if (handling) return
    if (!isSettingsShortcut(event)) return
    /*
      只认「不带 alt」的那一种：带 `alt` 的组合属于 DSH 官方设置（Web 运行时
      的默认绑定就是 `primary + alt + Comma`），必须原样放行给它。
    */
    if (event.altKey) return
    event.preventDefault()
    event.stopPropagation()
    handling = true
    try {
      // 与入口按钮同一个 store：快捷键与点击打开的是同一个弹框。
      configDialogStore.set(true)
    } finally {
      handling = false
    }
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
