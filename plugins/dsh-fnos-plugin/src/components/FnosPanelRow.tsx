/**
 * 侧栏面板列表里的「飞牛 OS」入口，以及它配对的主视图。
 *
 * ## 为什么必须成对注册
 *
 * 用户希望入口出现在「插件」「自动化任务」那一组、位于「更多」之上。那一组由
 * `sidebar.panellist` 渲染。而点击面板行会调用 `selectPanel(id)`，它先校验
 * `hasMainPanel(id)`——**没有配对的主视图就直接抛错**
 * （见 `dsh-client-ui-layout` 的 `selectPanel`）。所以注册行就必须同时注册 `main`。
 *
 * ## 但它不是一个真正的面板
 *
 * 「飞牛 OS」的交互一直是**配置弹框**，不该替换主视图。做法：
 *
 * - `main` 视图只渲染一句「设置已在弹框中打开」的占位；
 * - 该视图挂载时立即把弹框打开；
 * - 用户关掉弹框后，占位仍在那儿（而不是把他弹回会话），再次点侧栏即可重开。
 *
 * 这样位置借的是面板行的外观，行为仍是弹框。
 *
 * @module dsh-fnos/components/FnosPanelRow
 */

import { useCallback, useEffect } from 'react'
import type { FnosLocaleKey } from '../client/locales.ts'
import { configDialogStore } from '../client/config-dialog-store.ts'
import { FnosMonoLogo } from './FnosLogo.tsx'

type Translate = (key: FnosLocaleKey) => string

/**
 * 侧栏「飞牛 OS」行的图标。
 *
 * 不接收 props：`sidebar.panellist` 只从这个组件取 glyph，行本身（按钮、文案、
 * 点击）由 sidebar 渲染。
 * @returns 图标元素。
 */
export function FnosPanelRow(): React.ReactNode {
  return <FnosMonoLogo size={16} />
}

/** 主视图的参数。 */
export interface FnosPanelMainProps {
  readonly t: Translate
}

/**
 * 「飞牛 OS」配对主视图：挂载即打开配置弹框。
 * @param props - 组合后的 props。
 * @param props.t - 翻译函数。
 * @returns 占位元素。
 */
export function FnosPanelMain({ t }: FnosPanelMainProps): React.ReactNode {
  /*
    挂载时打开弹框。不能放在渲染期（React 不允许渲染期改外部状态），
    用 effect 在提交后触发。
  */
  useEffect(() => {
    configDialogStore.set(true)
  }, [])

  const reopen = useCallback(() => { configDialogStore.set(true) }, [])

  return (
    <div className="dsh-fnos-panel-placeholder">
      <p>{t('configPanelOpenedInDialog')}</p>
      <button type="button" className="dsh-fnos-authorized-button dsh-fnos-authorized-button--primary" onClick={reopen}>
        {t('configMenuEntry')}
      </button>
    </div>
  )
}
