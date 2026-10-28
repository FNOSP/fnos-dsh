/**
 * 会话键控的选择器开关 store。
 *
 * 触发按钮在输入区工具栏（`conversation.input.left`），浮层面板在
 * `conversation.input.overlay`，两者是两个独立的槽位条目，没有父子关系，
 * 只能共享一个外部 store 来同步开关状态。
 *
 * 这里刻意不用组件内 state：两个槽位条目分别渲染，谁也拿不到对方的 ref。
 * store 按会话键控，保证 A 会话展开浮层不会让 B 会话也弹出来。
 */

import { useSyncExternalStore } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** 与 `useSyncExternalStore` 兼容的最小 store 面。 */
export interface PickerOpenStore {
  /** 读取某个会话是否展开。 */
  isOpen: (sessionId: SessionId) => boolean
  /** 订阅变更；返回退订函数。 */
  subscribe: (listener: () => void) => () => void
  /** 显式设置某个会话的展开状态。 */
  set: (sessionId: SessionId, open: boolean) => void
  /** 翻转某个会话的展开状态。 */
  toggle: (sessionId: SessionId) => void
  /** 关闭所有会话的浮层（会话销毁或全局重置时使用）。 */
  closeAll: () => void
}

/** 创建开关 store。 */
export function createPickerOpenStore(): PickerOpenStore {
  const openSessions = new Set<string>()
  const listeners = new Set<() => void>()

  const emit = (): void => {
    for (const listener of [...listeners]) listener()
  }

  return {
    isOpen: sessionId => openSessions.has(String(sessionId)),
    subscribe: listener => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: (sessionId, open) => {
      const key = String(sessionId)
      const current = openSessions.has(key)
      if (current === open) return
      if (open) openSessions.add(key)
      else openSessions.delete(key)
      emit()
    },
    toggle: (sessionId) => {
      const key = String(sessionId)
      if (openSessions.has(key)) openSessions.delete(key)
      else openSessions.add(key)
      emit()
    },
    closeAll: () => {
      if (openSessions.size === 0) return
      openSessions.clear()
      emit()
    },
  }
}

/**
 * 订阅某会话的展开状态。
 *
 * `subscribe` 的引用必须稳定：`useSyncExternalStore` 在每次渲染时比较它，
 * 传内联箭头函数会退订再订阅，导致多余的重复渲染。
 */
export function usePickerOpen(store: PickerOpenStore, sessionId: SessionId): boolean {
  const subscribe = store.subscribe
  return useSyncExternalStore(
    subscribe,
    () => store.isOpen(sessionId),
    () => store.isOpen(sessionId),
  )
}
