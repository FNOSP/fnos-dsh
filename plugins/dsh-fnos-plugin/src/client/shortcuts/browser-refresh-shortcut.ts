/** Keep browser refresh shortcuts scoped to the embedded DSH Web document. */

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
    createElement(DshHotKeys, {
      hotKeys: [DshHotKeys.Keys.Control, DshHotKeys.Keys.R],
      preventDefault: true,
      onHotKey: handleHotKey,
      getListenerTarget: () => window as unknown as HTMLElement,
      render: null,
    }),
    createElement(DshHotKeys, {
      hotKeys: [DshHotKeys.Keys.Meta, DshHotKeys.Keys.R],
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
