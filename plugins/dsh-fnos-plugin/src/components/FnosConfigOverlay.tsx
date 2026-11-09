/**
 * 配置弹框的宿主：挂在 `shell.overlay`，由模块级 store 控制可见性。
 *
 * 与 `FnosConfigMenuEntry` 分开是必须的：菜单选中后会关闭并卸载整棵子树，弹框
 * 若挂在那里面，打开状态会随卸载一起丢失（实测点「飞牛 OS」后 DOM 无新增、
 * 也不报错）。`shell.overlay` 是官方挂 portal 弹框的槽位，生命周期与菜单无关。
 *
 * @module dsh-fnos/components/FnosConfigOverlay
 */

import type { FnosLocaleKey } from '../client/locales.ts'
import { configDialogStore, useConfigDialogOpen } from '../client/config-dialog-store.ts'
import { FnosConfigDialog } from './FnosConfigDialog.tsx'

type Translate = (key: FnosLocaleKey) => string

export interface FnosConfigOverlayProps {
  /** 翻译函数。 */
  readonly t: Translate
}

/**
 * 配置弹框的 overlay 宿主。
 * @param props - 组合后的 props。
 * @param props.t - 翻译函数。
 * @returns 弹框（不可见时由 Modal 自身不渲染内容）。
 */
export function FnosConfigOverlay({ t }: FnosConfigOverlayProps): React.ReactNode {
  const open = useConfigDialogOpen(configDialogStore)
  return <FnosConfigDialog visible={open} onClose={() => { configDialogStore.set(false) }} t={t} />
}

/** 供注册处复用的 store 引用。 */
export { configDialogStore }
