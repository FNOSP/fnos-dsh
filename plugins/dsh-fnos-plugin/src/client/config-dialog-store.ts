/**
 * fnOS 配置弹框的开关状态（模块级单例）。
 *
 * ## 为什么需要它
 *
 * 菜单项与弹框不能是父子关系：菜单是 portaled 浮层，选中后会立即关闭并卸载整棵
 * 子树——弹框若挂在这棵子树里，`setOpen(true)` 随后就随卸载一起消失了（实测：
 * 点「飞牛 OS」后 DOM 无任何新增，也不报错，控制台也无异常）。
 *
 * 因此把弹框挂到 `shell.overlay`（官方挂 portal 弹框的槽位），菜单项只负责调用
 * `open()`。两者通过这个模块级 store 通信，与菜单的生命周期无关。
 *
 * 实现沿用仓库既有的 `useSyncExternalStore` 模式（见 `input-references/picker-store`），
 * 不引入额外的 store 依赖。
 *
 * @module dsh-fnos/client/config-dialog-store
 */

import { useSyncExternalStore } from 'react'

/** 弹框开关的最小 store 面。 */
export interface ConfigDialogStore {
  /** 读取是否打开。 */
  readonly isOpen: () => boolean
  /** 订阅变更；返回退订函数。 */
  readonly subscribe: (listener: () => void) => () => void
  /** 设置开合状态。 */
  readonly set: (open: boolean) => void
}

/** 创建开关 store。 */
export function createConfigDialogStore(): ConfigDialogStore {
  let open = false
  const listeners = new Set<() => void>()

  const emit = (): void => {
    for (const listener of [...listeners]) listener()
  }

  return {
    isOpen: () => open,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: (next) => {
      if (open === next) return
      open = next
      emit()
    },
  }
}

/** 模块级单例：菜单项与 overlay 宿主通过它通信。 */
export const configDialogStore = createConfigDialogStore()

/** 订阅弹框可见性的 hook。 */
export function useConfigDialogOpen(store: ConfigDialogStore): boolean {
  return useSyncExternalStore(store.subscribe, store.isOpen, store.isOpen)
}
