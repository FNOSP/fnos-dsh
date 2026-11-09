/**
 * 「更多」下拉菜单里的「飞牛 OS」入口。
 *
 * 点开此菜单项会打开 fnOS 配置弹框（左侧菜单 + 右侧主体），把原先挂在插件详情页
 * 里的两段配置收进来。详情页因此不再保留这些配置块——同一份设置只出现在一个
 * 地方，不会出现两处都能改、状态却不同步的情况。
 *
 * 承载它的槽位是 `sidebar.panellist.actions`：官方把它定义为「面板列表的更多
 * 菜单行」，且官方 entry-customization 也往这里放非面板动作（浏览其他插件 /
 * 创建你的插件），因此放一个「打开配置」的入口与该槽位的语义一致。
 *
 * @module dsh-fnos/components/FnosConfigMenuEntry
 */

import { useCallback } from 'react'
import { MenuItemButton } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FnosLocaleKey } from '../client/locales.ts'
import { configDialogStore } from '../client/config-dialog-store.ts'
import { FnosMonoLogo } from './FnosLogo.tsx'

type Translate = (key: FnosLocaleKey) => string

export interface FnosConfigMenuEntryProps {
  /** 关闭「更多」菜单（由槽位 owner 提供）。 */
  readonly onDismiss?: () => void
  /** 翻译函数（注册处经 `inject` 提供）。 */
  readonly t: Translate
}

/**
 * 「更多」菜单里的「飞牛 OS」入口。
 * @param props - 组合后的 props。
 * @param props.onDismiss - 关闭「更多」菜单（槽位 owner 提供）。
 * @param props.t - 翻译函数。
 * @returns 一行菜单项 + 配置弹框。
 */
export function FnosConfigMenuEntry({ onDismiss, t }: FnosConfigMenuEntryProps): React.ReactNode {
  const openConfig = useCallback(() => {
    // 先关菜单再开弹框：菜单是 portaled 浮层，留着会和弹框抢焦点。
    // 弹框本身挂在 shell.overlay（见 config-dialog-store 的说明），不在这棵子树里，
    // 因此菜单卸载不会连带它的可见状态。
    onDismiss?.()
    configDialogStore.set(true)
  }, [onDismiss])

  return (
    <MenuItemButton
      separatorBefore
      /*
        用项目里已有的飞牛标记，而不是通用设置齿轮：这个入口代表「飞牛 OS」这个
        整体，齿轮会把「打开的是 fnOS 设置」误读成「应用设置」。

        取 mono 版本：它用 `filter: brightness(0)` + 暗色主题反转成白色，
        亮暗主题下都读得清；彩色版本在灰底菜单行里会显脏。
      */
      icon={<FnosMonoLogo size={16} />}
      onSelect={openConfig}
    >
      {t('configMenuEntry')}
    </MenuItemButton>
  )
}
