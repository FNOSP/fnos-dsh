/**
 * 「更多」菜单里的「飞牛 OS」入口。
 *
 * 点它打开配置弹框（弹框本体挂在 `shell.overlay`，见 `FnosConfigOverlay`）。
 *
 * @module dsh-fnos/components/FnosConfigMenuEntry
 */

import { useCallback } from 'react'
import type { FnosLocaleKey } from '../client/locales.ts'
import { configDialogStore } from '../client/config-dialog-store.ts'
import { FnosMonoLogo } from './FnosLogo.tsx'
import { MenuItemButton } from '@deepseek-ai/dsh-client-ui-primitives'

type Translate = (key: FnosLocaleKey) => string

/** 组件参数。 */
export interface FnosConfigMenuEntryProps {
  /** 关闭「更多」菜单（槽位 owner 提供）。 */
  readonly onDismiss?: () => void
  readonly t: Translate
}

/**
 * 「更多」菜单里的「飞牛 OS」入口。
 * @param props - 组合后的 props。
 * @param props.onDismiss - 关闭菜单。
 * @param props.t - 翻译函数。
 * @returns 一行菜单项。
 */
export function FnosConfigMenuEntry({ onDismiss, t }: FnosConfigMenuEntryProps): React.ReactNode {
  const openConfig = useCallback(() => {
    // 先关菜单再开弹框：菜单是 portaled 浮层，留着会和弹框抢焦点。
    onDismiss?.()
    configDialogStore.set(true)
  }, [onDismiss])

  return (
    <MenuItemButton
      separatorBefore
      /*
        用项目里已有的飞牛标记，而不是通用设置齿轮：这个入口代表「飞牛 OS」这个
        整体，齿轮会把「打开的是 fnOS 设置」误读成「应用设置」。
      */
      icon={<FnosMonoLogo size={16} />}
      onSelect={openConfig}
    >
      {t('configMenuEntry')}
    </MenuItemButton>
  )
}
