/** Adds an fnOS authorized-directory shortcut without replacing DSH's picker. */

import { createElement, useCallback, useState, type ElementType } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  DshDropdown as Dropdown,
  DshIconButton as IconButton,
  DshTypography as Typography,
  DshIconFolderOpen as IconFolderOpen,
} from '@tnnevol/dsh-semi-ui'
import type { AuthorizedDirectory } from '../../contracts/authorized-directories-contract.ts'
import { DirectoryRequestError, requestAuthorizedDirectories } from '../services/authorized-directories-client.ts'
import { FnosMonoLogo } from '../../components/FnosLogo.tsx'
import type { FnosLocaleKey } from '../locales.ts'

type Translate = (key: FnosLocaleKey) => string

// Semi's published React declarations can resolve against a different minor
// @types/react version than DSH. The runtime components are still the normal
// Semi components; these aliases keep that declaration mismatch at this
// integration boundary instead of weakening the rest of the plugin types.
const SemiDropdown = Dropdown as unknown as ElementType
const SemiDropdownItem = Dropdown.Item as unknown as ElementType
const SemiDropdownMenu = Dropdown.Menu as unknown as ElementType
const SemiIconButton = IconButton as unknown as ElementType
const SemiTypographyText = Typography.Text as unknown as ElementType

const SHORTCUT_ATTRIBUTE = 'data-dsh-fnos-workspace-shortcut'

function isPathControl(element: Element): element is HTMLInputElement | HTMLButtonElement {
  const label = element.getAttribute('aria-label') ?? ''
  const title = element.getAttribute('title') ?? ''
  return /编辑路径|edit path/i.test(label) || /编辑路径|edit path/i.test(title)
}

function findWorkspaceDialog(): HTMLElement | undefined {
  for (const dialog of document.querySelectorAll<HTMLElement>('[role="dialog"]')) {
    if ([...dialog.querySelectorAll('input, button')].some(isPathControl)) return dialog
  }
  return undefined
}

function findPathInput(dialog: HTMLElement): HTMLInputElement | undefined {
  return [...dialog.querySelectorAll<HTMLInputElement>('input')].find(isPathControl)
}

function findPathBar(dialog: HTMLElement): HTMLElement | undefined {
  const control = [...dialog.querySelectorAll('input, button')].find(isPathControl)
  return control?.parentElement instanceof HTMLElement ? control.parentElement : undefined
}

function setControlledInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (setter === undefined) return
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
  // Keep the editor focused. DSH cancels path editing when focus leaves the
  // dialog, so blurring here discards the value before its submit flow can
  // consume it.
  input.focus({ preventScroll: true })
}

interface PathSubmitEvent {
  key: string
  preventDefault: () => void
}

interface ReactInputProps {
  onKeyDown?: (event: PathSubmitEvent) => void
}

/**
 * Call DSH's own controlled-input submit callback after the value update has
 * rendered. A synthetic KeyboardEvent is deliberately avoided: the host
 * rejects untrusted keyboard events, while this reuses the handler already
 * attached by the official directory browser.
 */
function submitPathInput(input: HTMLInputElement): boolean {
  const propsKey = Object.getOwnPropertyNames(input).find(key => key.startsWith('__reactProps$'))
  if (propsKey === undefined) return false
  const props = (input as unknown as Record<string, unknown>)[propsKey]
  if (props === null || typeof props !== 'object') return false
  const onKeyDown = (props as ReactInputProps).onKeyDown
  if (typeof onKeyDown !== 'function') return false
  onKeyDown({ key: 'Enter', preventDefault: () => undefined })
  return true
}

/** Submit the path through DSH's original Enter navigation after React settles the input value. */
function submitAfterInputUpdate(dialog: HTMLElement): void {
  let attempts = 0
  const submit = (): void => {
    const input = findPathInput(dialog)
    if (input !== undefined && submitPathInput(input)) return
    if (++attempts < 20) requestAnimationFrame(submit)
  }
  requestAnimationFrame(submit)
}

function fillAfterOpening(dialog: HTMLElement, path: string): void {
  const input = findPathInput(dialog)
  if (input !== undefined) {
    setControlledInputValue(input, path)
    submitAfterInputUpdate(dialog)
    return
  }
  const editButton = [...dialog.querySelectorAll('button')].find(isPathControl)
  editButton?.click()
  let attempts = 0
  const fill = (): void => {
    const next = findPathInput(dialog)
    if (next !== undefined) {
      setControlledInputValue(next, path)
      submitAfterInputUpdate(dialog)
      return
    }
    if (++attempts < 20) requestAnimationFrame(fill)
  }
  requestAnimationFrame(fill)
}

interface AuthorizedDirectoryDropdownProps {
  dialog: HTMLElement
  t: Translate
}

/**
 * 目录名：省略与气泡都交给 Semi `Typography.Text` 的 `ellipsis`。
 *
 * `ellipsis.showTooltip` 的语义正是要的行为（semi-ui `typography/base.js`：
 * `const show = noExpandText && overflowed && showTooltip`）：只有文本真的被
 * 截断时才挂 tooltip，目录名放得下时不弹气泡，也不需要自己量 `scrollWidth`。
 *
 * 气泡沿用下拉浮层的既有约定：挂到 body、层级压住菜单（Dropdown 用 zIndex
 * 10000），并放在左侧。`ellipsis` 只支持纯文本 children，因此这里只接受
 * `string`。
 */
function menuText(text: string, color = 'var(--dsw-alias-label-tertiary)') {
  return createElement(
    SemiTypographyText,
    {
      ellipsis: {
        rows: 1,
        showTooltip: {
          opts: { position: 'left', zIndex: 10001, getPopupContainer: () => document.body },
        },
      },
      style: {
        // flex 子项默认按最小内容宽度撑开，不置 0 时省略号永不出现，
        // `showTooltip` 的溢出判定也就恒为假。
        minWidth: 0,
        maxWidth: '220px',
        color,
      },
    },
    text,
  )
}

function AuthorizedDirectoryDropdown({ dialog, t }: AuthorizedDirectoryDropdownProps) {
  const [directories, setDirectories] = useState<readonly AuthorizedDirectory[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    void requestAuthorizedDirectories().then(
      result => { setDirectories(result) },
      reason => {
        setDirectories(null)
        setError(reason instanceof DirectoryRequestError && reason.code === 'remote-web-origin-not-trusted'
          ? t('originNotTrusted')
          : t('workspaceLoadFailed'))
      },
    ).finally(() => { setLoading(false) })
  }, [t])

  const items = loading
    ? [createElement(SemiDropdownItem, { key: 'loading', disabled: true }, menuText(t('workspaceLoading')))]
    : error !== null
      ? [createElement(SemiDropdownItem, { key: 'error', disabled: true }, menuText(error))]
      : directories === null
        ? [createElement(SemiDropdownItem, { key: 'empty-state', disabled: true }, menuText(t('workspaceAuthorized')))]
        : directories.length === 0
          ? [createElement(SemiDropdownItem, { key: 'empty', disabled: true }, menuText(t('workspaceEmpty')))]
          : directories.map(directory => createElement(
            SemiDropdownItem,
            {
              key: directory.path,
              icon: createElement(IconFolderOpen, { size: 'small' }),
              // Keep DSH's path editor focused. Its card-level blur handler
              // treats focus moving into the dropdown portal as cancellation.
              onMouseDown: (event: MouseEvent) => { event.preventDefault() },
              onClick: () => { fillAfterOpening(dialog, directory.path) },
            },
            // 不挂原生 `title`：气泡只在目录名被省略时出现，放得下的名字不该再弹系统提示。
            menuText(directory.semanticPath, 'var(--dsw-alias-label-primary)'),
          ))

  const menu = createElement(SemiDropdownMenu, {
    style: {
      width: '250px',
      maxWidth: '250px',
      maxHeight: 'min(320px, calc(100vh - 32px))',
      overflowY: 'auto',
      padding: '4px',
    },
  }, items)

  return createElement(
    SemiDropdown,
    {
      trigger: 'click',
      position: 'bottomRight',
      render: menu,
      zIndex: 10000,
    },
    createElement(SemiIconButton, {
      type: 'tertiary',
      theme: 'borderless',
      size: 'small',
      iconSize: 'small',
      icon: createElement(FnosMonoLogo, { size: 16 }),
      title: t('workspaceAuthorized'),
      'aria-label': t('workspaceAuthorized'),
      onClick: load,
      style: {
        width: '24px',
        height: '24px',
        padding: 0,
        color: 'var(--dsw-alias-label-primary)',
      },
    }),
  )
}

function installButton(dialog: HTMLElement, t: Translate, roots: Set<{ mount: HTMLElement, root: Root }>): void {
  const bar = findPathBar(dialog)
  if (bar === undefined || bar.querySelector(`[${SHORTCUT_ATTRIBUTE}]`) !== null) return

  const mount = document.createElement('span')
  mount.setAttribute(SHORTCUT_ATTRIBUTE, '')
  mount.setAttribute('aria-label', t('workspaceAuthorized'))
  Object.assign(mount.style, {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: '0 0 auto',
    width: '24px',
    height: '24px',
  })
  // Keep the entry beside DSH's existing path editor, without taking over
  // the official directoryFlow slot or changing the picker footer.
  // Keep the fnOS shortcut in the left path-bar slot. Appending it caused
  // the icon to jump sides when DSH switched between the readable and edit
  // path presentations.
  bar.insertBefore(mount, bar.firstChild)
  const root = createRoot(mount)
  root.render(createElement(AuthorizedDirectoryDropdown, { dialog, t }))
  roots.add({ mount, root })
}

/** Observe DSH's native/browse picker and augment its path bar only. */
export function installWorkspaceAuthorizedShortcut(t: Translate): () => void {
  if (typeof document === 'undefined' || document.body === null || typeof MutationObserver === 'undefined') return () => undefined
  const roots = new Set<{ mount: HTMLElement, root: Root }>()
  let scheduled = false
  const scan = (): void => {
    scheduled = false
    for (const entry of roots) {
      if (!entry.mount.isConnected) {
        entry.root.unmount()
        roots.delete(entry)
      }
    }
    const dialog = findWorkspaceDialog()
    if (dialog !== undefined) installButton(dialog, t, roots)
  }
  const schedule = (): void => {
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(scan)
  }
  const observer = new MutationObserver(schedule)
  observer.observe(document.body, { childList: true, subtree: true })
  scan()
  return () => {
    observer.disconnect()
    for (const { mount, root } of roots) {
      root.unmount()
      mount.remove()
    }
    roots.clear()
  }
}
