/**
 * 「更多」菜单里的刷新 / 重启两行。
 *
 * ## 为什么放这里
 *
 * 这两个动作原先作为独立按钮挂在 `sidebar.footer.action`，占据侧栏底部一条常驻
 * 空间。它们都是低频操作（刷新只是重载页面，重启是上游进程重启），常驻不划算，
 * 收进「更多」菜单后侧栏底部只留「设置」。
 *
 * 承载它们的槽位是 `sidebar.panellist.actions`——官方把它定义为「面板列表的
 * 更多菜单行」，且官方自己的 entry-customization 就往这里放了「浏览其他插件」
 * 「创建你的插件」两个**非面板动作**。因此这不是滥用：该菜单本来就是「更多操作」
 * 的位置，面板导航只是其中一类。
 *
 * ## 与面板行的区别
 *
 * 面板行是 `MenuItemButton` + 面板图标 + `onOpen(id)`；这两行是同样的
 * `MenuItemButton`，但动作是本地的（重载 / 调网关接口），不涉及面板切换。
 * 重启失败时把错误写进该行的说明位，而不是弹窗——菜单里弹窗会打断操作。
 *
 * @module dsh-fnos/components/FnosWebActionsMenu
 */

import { useCallback, useState } from 'react'
import { MenuItemButton } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FnosLocaleKey } from '../client/locales.ts'
import { isEmbeddedFnosFrame } from '../client/services/sdk-carrier.ts'

type Translate = (key: FnosLocaleKey) => string

/** 网关控制接口的绝对地址（相对 `<base>` 解析，与主应用同源）。 */
function gatewayControlUrl(path: string): string {
  if (typeof document === 'undefined') return path
  const base = document.querySelector('base')?.href
  if (base !== undefined) {
    try { return new URL(path.slice(1), base).toString() } catch {}
  }
  return path
}

/** 槽位注入的 owner props（本实现只用到关闭菜单）。 */
export interface FnosWebActionsMenuProps {
  /** 关闭「更多」菜单。 */
  readonly onDismiss?: () => void
}

/**
 * 「更多」菜单末尾的刷新 / 重启两行。
 * @param props - 组合后的 props。
 * @param props.onDismiss - 关闭菜单（槽位 owner 提供）。
 * @param props.t - 翻译函数（注册处经 `inject` 提供）。
 * @returns 两行菜单项；非 fnOS iframe 内不渲染。
 */
export function FnosWebActionsMenu({
  onDismiss,
  t,
}: FnosWebActionsMenuProps & { readonly t: Translate }): React.ReactNode {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const refresh = useCallback((): void => {
    onDismiss?.()
    window.location.reload()
  }, [onDismiss])

  const restart = useCallback((): void => {
    setBusy(true)
    setFailed(false)
    void (async () => {
      try {
        const response = await fetch(gatewayControlUrl('/__fnos-gateway/control/web/restart'), {
          method: 'POST',
          headers: { 'x-requested-with': 'fetch' },
          credentials: 'same-origin',
        })
        const value: unknown = await response.json().catch(() => undefined)
        if (!response.ok) {
          throw new Error(
            typeof value === 'object' && value !== null && 'error' in value && typeof value.error === 'string'
              ? value.error
              : `HTTP ${response.status}`,
          )
        }
        // 重启会断开当前连接，重载动作放到断连之前，避免菜单一直停在忙碌态。
        window.setTimeout(() => { window.location.reload() }, 300)
      } catch {
        setFailed(true)
      } finally {
        setBusy(false)
      }
    })()
  }, [])

  // 这两个动作只在 fnOS 应用内才有意义（网关与会话都来自宿主）。
  if (!isEmbeddedFnosFrame()) return null

  const refreshLabel = t('refresh')
  const restartLabel = failed ? t('webRestartFailed') : busy ? t('webRestarting') : t('webRestart')

  return (
    <>
      <MenuItemButton
        separatorBefore
        icon={<RefreshGlyph />}
        onSelect={refresh}
      >
        {refreshLabel}
      </MenuItemButton>
      <MenuItemButton
        disabled={busy}
        icon={<RestartGlyph />}
        onSelect={restart}
      >
        {restartLabel}
      </MenuItemButton>
    </>
  )
}

/**
 * 用内联 SVG 而不是图标库：菜单行只吃一个 16px 字形，引入整套图标库会把这些
 * 图标打进客户端产物，而无障碍与观感收益为零。两个字形与原先按钮上的图标同源
 * （刷新箭头 / 环形箭头）。
 */
function RefreshGlyph(): React.ReactNode {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M13.6 2.6v3.2h-3.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function RestartGlyph(): React.ReactNode {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3.1 6.2A5.2 5.2 0 1 1 3 9.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M2.6 2.8v3.4h3.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
