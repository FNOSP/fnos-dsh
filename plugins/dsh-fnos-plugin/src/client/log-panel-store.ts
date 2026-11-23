/**
 * 任务日志浮层（右下角）。
 *
 * ## 为什么是独立 store 而不是组件内 state
 *
 * 浮层要能被三处驱动：任务开始时自动弹出（来自功能执行链）、侧栏吸附图标点击
 * 展开、以及浮层自身的收起与关闭。这三方互不为父子，只能靠模块级状态通信。
 * 这与仓库里 `config-dialog-store` 的做法一致。
 *
 * ## 状态为什么是四态而不是两态
 *
 * 「关掉」与「先挪开」是两种决定：
 *
 * - **收起**（`collapsed`）：用户只是想看看下面被挡住的内容，稍后还要回来；
 * - **关闭**（`hidden`）：用户这一轮不看了。
 *
 * 合成一个布尔值的话，收起后就没地方「找回来」，或者关闭后还会莫名其妙再弹出来。
 * 因此四态：`hidden` / `expanded` / `collapsed`，加上「新一轮任务」这条隐式转换。
 *
 * @module dsh-fnos/client/log-panel-store
 */

import { useSyncExternalStore } from 'react'

/** 浮层的三种可见形态。 */
export type LogPanelMode = 'hidden' | 'expanded' | 'collapsed'

/** 一次任务的执行状态。 */
export type TaskLogStatus = 'running' | 'ok' | 'failed'

/** 任务来源，用于图标与文案。 */
export type TaskLogFeature = 'install' | 'mirror' | 'repair' | 'skills'

/** 一条任务日志。 */
export interface TaskLogLine {
  /** 单调递增，用于 React key 与稳定排序。 */
  readonly seq: number
  /** 产生时刻（epoch 毫秒）。 */
  readonly at: number
  /** 级别。 */
  readonly level: 'info' | 'warn' | 'error'
  /** 正文。 */
  readonly text: string
}

/** 当前任务快照。 */
export interface TaskLogSnapshot {
  /** 本次任务的稳定身份。 */
  readonly taskId: string
  /** 来源功能。 */
  readonly feature: TaskLogFeature
  /** 给用户看的任务名（如「安装 dsh-taskboard」）。 */
  readonly title: string
  /** 执行状态。 */
  readonly status: TaskLogStatus
  /** 已产生的日志行。 */
  readonly lines: readonly TaskLogLine[]
  /** 开始时刻。 */
  readonly startedAt: number
}

/** 浮层位置（视口坐标，单位 px）。 */
export interface LogPanelPosition {
  readonly left: number
  readonly top: number
}

/** 浮层状态快照。 */
export interface LogPanelState {
  readonly mode: LogPanelMode
  readonly task: TaskLogSnapshot | undefined
  /** 用户拖动后的位置；`undefined` 表示仍在右下角默认位。 */
  readonly position: LogPanelPosition | undefined
}

/** 宿主日志服务的最小面（只用到 info / warn / error 三个方法）。 */
export interface HostLogSink {
  readonly info: (message: string) => void
  readonly warn: (message: string) => void
  readonly error: (message: string) => void
}

/**
 * 单次任务最多保留的日志行数。
 *
 * 远超界面能一次看到的量，只为「滚上去还能翻到前面几屏」；再多的历史去日志中心看。
 */
const MAX_LINES = 500

/** 浮层最小 store 面。 */
export interface LogPanelStore {
  /** 读取当前快照（同一引用直到状态变化）。 */
  readonly getSnapshot: () => LogPanelState
  /** 订阅变更；返回退订函数。 */
  readonly subscribe: (listener: () => void) => () => void
  /** 开始一次新任务：替换当前任务并展开浮层。 */
  readonly beginTask: (init: { feature: TaskLogFeature, title: string }) => string
  /**
   * 追加一行日志到当前任务。
   *
   * **同一行同时写入宿主日志服务**（见 `attachHostLogger`），因此它既出现在
   * 浮层里，也出现在运行日志中心。两处同源，不会出现「浮层有、日志中心没有」。
   */
  readonly append: (level: TaskLogLine['level'], text: string) => void
  /** 结束当前任务。 */
  readonly finish: (status: Exclude<TaskLogStatus, 'running'>) => void
  /** 收起浮层，改由侧栏图标承接。 */
  readonly collapse: () => void
  /** 展开浮层。 */
  readonly expand: () => void
  /** 关闭浮层，吸附图标一并消失。 */
  readonly close: () => void
  /** 记录拖动后的位置。 */
  readonly setPosition: (position: LogPanelPosition) => void
  /**
   * 接上宿主日志服务，把每行日志同步写进运行日志中心。
   *
   * 传 `undefined` 时断开。功能执行链在写日志前调用一次即可；插件卸载时由
   * `ctx.effect` 负责断开。不接也能工作——浮层照常显示，只是不进总日志。
   * @param logger - 宿主日志服务，或 undefined 表示断开。
   */
  readonly attachHostLogger: (logger: HostLogSink | undefined) => void
  /** 仅测试：清空状态。 */
  readonly reset: () => void
}

/**
 * 创建浮层 store。
 * @returns store 句柄。
 */
export function createLogPanelStore(): LogPanelStore {
  let state: LogPanelState = { mode: 'hidden', task: undefined, position: undefined }
  let sequence = 0
  let taskCounter = 0
  /** 宿主日志服务；未接上时浮层照常工作，只是不进总日志。 */
  let hostLogger: HostLogSink | undefined
  const listeners = new Set<() => void>()

  const emit = (): void => {
    for (const listener of [...listeners]) listener()
  }

  /** 只在真正变化时替换引用，避免无意义重渲。 */
  const commit = (next: LogPanelState): void => {
    if (next === state) return
    state = next
    emit()
  }

  /** 在不可变前提下改当前任务。 */
  const patchTask = (patch: (task: TaskLogSnapshot) => TaskLogSnapshot | undefined): void => {
    const task = state.task
    if (task === undefined) return
    const next = patch(task)
    if (next === undefined || next === task) return
    commit({ ...state, task: next })
  }

  return {
    getSnapshot: () => state,

    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },

    beginTask: ({ feature, title }) => {
      taskCounter += 1
      sequence = 0
      const taskId = `task-${String(taskCounter)}`
      /*
        新一轮任务**整体替换**当前任务，不追加、不并存。

        这正是需求里「上一轮日志被覆盖」的实现：旧任务的记录早已随行进了日志中心，
        浮层这里只是一次引用的更替，不是删除历史。
      */
      commit({
        // 无论此前是收起还是关闭，新任务都重新展开：关闭表达的是「这一轮不看了」。
        mode: 'expanded',
        task: { taskId, feature, title, status: 'running', lines: [], startedAt: Date.now() },
        position: state.position,
      })
      return taskId
    },

    append: (level, text) => {
      const task = state.task
      if (task === undefined || task.status !== 'running') return
      /*
        **同一行同时进两处**：浮层（当前任务）与运行日志中心（全量历史）。

        先写宿主日志再入缓冲：日志中心要的是「发生过什么」，不该因为浮层被关闭
        或行数超限就丢掉记录。带任务前缀便于在日志中心按功能筛出来。
      */
      hostLogger?.[level](`[${task.feature}] ${text}`)
      patchTask((current) => {
        if (current.status !== 'running') return undefined
        sequence += 1
        const line: TaskLogLine = { seq: sequence, at: Date.now(), level, text }
        const lines = [...current.lines, line]
        /* 超出上限丢最旧，与日志中心的环形缓冲同一策略。 */
        return { ...current, lines: lines.length > MAX_LINES ? lines.slice(lines.length - MAX_LINES) : lines }
      })
    },

    finish: (status) => {
      patchTask(task => task.status === 'running' ? { ...task, status } : undefined)
    },

    collapse: () => {
      if (state.mode === 'expanded') commit({ ...state, mode: 'collapsed' })
    },

    expand: () => {
      if (state.mode === 'collapsed') commit({ ...state, mode: 'expanded' })
    },

    close: () => {
      if (state.mode !== 'hidden') commit({ ...state, mode: 'hidden' })
    },

    setPosition: (position) => {
      commit({ ...state, position })
    },

    attachHostLogger: (logger) => {
      hostLogger = logger
    },

    reset: () => {
      // 保留位置：同一个会话里用户放下的地方应当被记住。
      const position = state.position
      commit({ mode: 'hidden', task: undefined, position })
    },
  }
}

/** 模块级单例：功能执行链与浮层、吸附图标通过它通信。 */
export const logPanelStore = createLogPanelStore()

/**
 * 订阅完整浮层状态。
 * @param store - store 句柄。
 * @returns 当前状态。
 */
export function useLogPanelState(store: LogPanelStore): LogPanelState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}
