/**
 * 保留 `F5` 在 fnOS iframe 内刷新**当前 DSH 页面**。
 *
 * ## 为什么只留 F5
 *
 * `Ctrl/Cmd + R` 已交给官方 `ctx.shortcuts.register`（见 `official-shortcuts.ts`）：
 * 它出现在 DSH 的「快捷键」面板里、可自定义、且返回 `handled` 时官方会
 * `preventDefault`，浏览器不会去刷新外层。
 *
 * 但是**一个可编辑命令在每个 profile 只能绑一个组合**，而 `F5` 没有独立归属位
 * （web 的三个 profile 都被 `Ctrl/Cmd + R` 占了）。`registerFixed` 虽然支持多个
 * 组合，却要自己比对 gesture 并调 `consume`，与这里的实现等价。
 *
 * 所以 F5 留在这条路径上，其余两个组合走官方。
 *
 * ## 只在 iframe 内注册
 *
 * 独立浏览器页面里浏览器自身的刷新就是可用的，再拦一层反而把「用户按 F5 想刷新」
 * 变成插件代劳。这条不是遗漏，是有意为之。
 */

import { createElement, Fragment } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DshHotKeys } from '@tnnevol/dsh-semi-ui'
import { isBrowserRefreshShortcut } from './browser-refresh-shortcut-matcher.ts'
import { isEmbeddedFnosFrame } from '../services/sdk-carrier.ts'

export { isBrowserRefreshShortcut } from './browser-refresh-shortcut-matcher.ts'

export function installFnosBrowserRefreshShortcut(): () => void {
  /*
    **刻意只在 iframe 内注册。** 独立浏览器页面里浏览器自身的刷新就是可用的，
    再拦一层反而把「用户按 F5 想刷新」变成插件代劳，还得自己维护与浏览器行为
    的一致性。这条不是遗漏，是有意为之。
  */
  if (!isEmbeddedFnosFrame() || typeof document === 'undefined' || document.body === null) return () => {}

  const handleHotKey = (event: KeyboardEvent): void => {
    /*
      这里只该收到 F5。`Ctrl/Cmd + R` 已由官方命令处理，若 matcher 仍认它，
      走到这里说明官方那条 `pass` 了（例如非 iframe），此时也不该由我们代劳。
    */
    if (event.key !== 'F5' && event.code !== 'F5') return
    if (!isBrowserRefreshShortcut(event)) return

    event.preventDefault()
    event.stopPropagation()
    window.location.reload()
  }

  const mount = document.createElement('span')
  mount.setAttribute('data-dsh-fnos-browser-refresh-shortcut', '')
  mount.hidden = true
  document.body.append(mount)

  const root: Root = createRoot(mount)
  root.render(createElement(
    Fragment,
    null,
    createElement(DshHotKeys, {
      hotKeys: [DshHotKeys.Keys.F5],
      preventDefault: true,
      onHotKey: handleHotKey,
      getListenerTarget: () => window as unknown as HTMLElement,
      render: null,
    }),
  ))

  return () => {
    root.unmount()
    mount.remove()
  }
}
