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
 * ## 但主区域不该被占住
 *
 * 「飞牛 OS」的交互一直是**配置弹框**。`main` 视图挂载后立刻 `selectPanel(null)`
 * 切回会话，弹框照常打开——主区域一帧都不停留。
 *
 * 早前这里是渲染一句占位说明，结果用户关掉弹框后停在一个空白页上，还得再点一次
 * 才能回会话。现在不再有这个中间态。
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

/**
 * 「飞牛 OS」配对主视图：**挂载即打开弹框并立刻切回会话**。
 *
 * ## 为什么会有这个组件
 *
 * 侧栏那一行的点击会走 `layout.selectPanel(id)`，而它先校验 `hasMainPanel(id)`——
 * 没有配对主视图就直接抛错。所以注册行就必须注册 `main`。
 *
 * ## 为什么它不渲染任何内容
 *
 * 「飞牛 OS」一直是弹框交互，不该占住主区域。之前这里渲染了一句占位说明，结果
 * 用户关掉弹框后会停在一个空白页上，还得再点一次才能回会话。
 *
 * 现在挂载时立刻 `selectPanel(null)`（官方语义：返回会话），弹框照常打开，
 * 主区域**一帧都不停留**。占位内容只在极端情况下（切回失败）才会被看到，
 * 因此保留一句说明而不是完全空白。
 *
 * @module dsh-fnos/components/FnosPanelRow
 */



/** 主视图的参数。 */
export interface FnosPanelMainProps {
  readonly t: Translate
  /**
   * 切回会话面板。
   *
   * 由 `index.ts` 注入 `ctx.layout.selectPanel`——组件本身不直接拿 `ctx`，
   * 保持它对宿主 API 的零依赖，便于单测。
   */
  readonly selectConversation: () => void
}

/**
 * 「飞牛 OS」配对主视图：打开弹框并立即返回会话。
 * @param props - 组合后的 props。
 * @param props.t - 翻译函数。
 * @param props.selectConversation - 切回会话面板。
 * @returns 兜底说明（正常情况下用户看不到）。
 */
export function FnosPanelMain({ t, selectConversation }: FnosPanelMainProps): React.ReactNode {
  /*
    顺序很重要：先切回会话，再打开弹框。

    反过来的话，`selectPanel(null)` 可能触发一次重渲染，把刚打开的弹框状态搅乱
    （弹框挂在 `shell.overlay`，理论上不受影响，但没有理由冒这个风险）。
  */
  useEffect(() => {
    selectConversation()
    configDialogStore.set(true)
  }, [selectConversation])

  const reopen = useCallback(() => {
    selectConversation()
    configDialogStore.set(true)
  }, [selectConversation])

  return (
    <div className="dsh-fnos-panel-placeholder">
      <p>{t('configPanelOpenedInDialog')}</p>
      <button type="button" className="dsh-fnos-authorized-button dsh-fnos-authorized-button--primary" onClick={reopen}>
        {t('configMenuEntry')}
      </button>
    </div>
  )
}
