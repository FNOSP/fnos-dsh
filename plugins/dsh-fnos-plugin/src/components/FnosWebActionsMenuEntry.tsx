/**
 * 「更多」下拉菜单里的「刷新页面」与「重启服务」两行。
 *
 * ## 为什么在菜单里而不是会话头部
 *
 * 它俩原先挂在 `conversation.session.header.utilities`（会话头部工具条），
 * 后来被移除。这两个动作与「当前会话」无关——刷新是整页、重启是整个 Web 进程，
 * 放在会话头部语义不对，而且占用本就紧张的头部宽度。
 *
 * 放进「更多」菜单、紧挨「飞牛 OS」之下：它们都是「整个应用」级别的操作，
 * 与菜单里已有的面板动作同属一类。
 *
 * ## 为什么用 `MenuItemButton`
 *
 * 槽位 `sidebar.panellist.actions` 渲染的是菜单行，不是按钮组。用与「飞牛 OS」
 * 相同的 `MenuItemButton` 才能拿到一致的行高、内边距与键盘行为；塞一个
 * `DshButtonGroup` 进去会变成「菜单里嵌一排按钮」，视觉与交互都不对齐。
 *
 * @module dsh-fnos/components/FnosWebActionsMenuEntry
 */

import { useCallback, useState } from 'react'
import { MenuItemButton } from '@deepseek-ai/dsh-client-ui-primitives'
import { isEmbeddedFnosFrame } from '../client/services/sdk-carrier.ts'
import type { FnosLocaleKey } from '../client/locales.ts'
import { IconifyIcon } from './IconifyIcon.tsx'

type Translate = (key: FnosLocaleKey) => string

export interface FnosWebActionsMenuEntryProps {
  /** 关闭「更多」菜单（由槽位 owner 提供）。 */
  readonly onDismiss?: () => void
  /** 翻译函数（注册处经 `inject` 提供）。 */
  readonly t: Translate
}

/**
 * 网关控制地址。
 *
 * 应用被嵌在 fnOS 的 iframe 里，页面 `<base>` 指向 `/app/fn-deepseek-harness/`；
 * 直接用绝对路径 `/__fnos-gateway/...` 会打到宿主根而不是应用网关，因此要从
 * `<base>` 解出真实地址。
 * @param path - 以 `/` 开头的路径。
 * @returns 可直接 fetch 的地址。
 */
function gatewayControlUrl(path: string): string {
  if (typeof document === 'undefined') return path
  const base = document.querySelector('base')?.href
  if (base !== undefined) {
    try { return new URL(path.slice(1), base).toString() } catch { /* 落到下面用原路径 */ }
  }
  return path
}

/**
 * 「刷新页面」一行。
 *
 * 拆成两个组件而不是一个返回两行：槽位是**列表**，每行要独立注册才能各自排序
 * （刷新 order 91、重启 92）。一个组件返回两个节点会让它们被当成一条，顺序
 * 与后续替换都不可控。
 * @param props - 组合后的 props。
 * @param props.onDismiss - 关闭「更多」菜单（槽位 owner 提供）。
 * @param props.t - 翻译函数。
 * @returns 一行菜单项。
 */
export function FnosRefreshMenuEntry({ onDismiss, t }: FnosWebActionsMenuEntryProps): React.ReactNode {
  // 非嵌入环境（本地开发）没有网关控制端点，也不存在「重启服务」这一说。
  if (!isEmbeddedFnosFrame()) return null
  return (
    <MenuItemButton
      icon={<IconifyIcon name="lucide:refresh-cw" />}
      onSelect={() => {
        onDismiss?.()
        globalThis.location.reload()
      }}
    >
      {t('refresh')}
    </MenuItemButton>
  )
}

/**
 * 「重启服务」一行。
 * @param props - 组合后的 props。
 * @param props.onDismiss - 关闭「更多」菜单（槽位 owner 提供）。
 * @param props.t - 翻译函数。
 * @returns 一行菜单项。
 */
export function FnosRestartMenuEntry({ onDismiss, t }: FnosWebActionsMenuEntryProps): React.ReactNode {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  /**
   * 重启 Web 服务：请网关重启上游进程，随后重载页面。
   *
   * 延迟 300ms 再 reload：重启接口是异步的，立刻 reload 会打到还没起来的进程上，
   * 用户看到的是「白屏 + 报错」而不是「正在重启」。
   */
  const restart = useCallback(async (): Promise<void> => {
    setBusy(true)
    setFailed(false)
    try {
      const response = await fetch(gatewayControlUrl('/__fnos-gateway/control/web/restart'), {
        method: 'POST',
        headers: { 'x-requested-with': 'fetch' },
        credentials: 'same-origin',
      })
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
      onDismiss?.()
      globalThis.setTimeout(() => { globalThis.location.reload() }, 300)
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }, [onDismiss])

  if (!isEmbeddedFnosFrame()) return null

  const label = failed ? t('webRestartFailed') : busy ? t('webRestarting') : t('webRestart')
  return (
    <MenuItemButton
      icon={<IconifyIcon name="lucide:power" />}
      disabled={busy}
      onSelect={() => { void restart() }}
    >
      {label}
    </MenuItemButton>
  )
}
