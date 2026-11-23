/**
 * 耗时操作的运行态（模块级单例）。
 *
 * ## 解决什么问题
 *
 * 卡片里的「正在安装 / 正在修复」原本是组件内 `useState`。飞牛设置弹框一关，
 * 右侧内容整棵卸载，状态随之丢失；重开时按钮又回到「安装」，**看起来像根本没
 * 执行过**——而宿主侧的命令可能还在跑。
 *
 * 把这类运行态提到模块级后，重挂载能从 store 读回来，界面与宿主保持一致。
 *
 * ## 为什么不是「完整的任务队列」
 *
 * 这里只记「谁在跑、跑完是什么结果」，不记进度百分比与日志正文：
 *
 * - 进度与日志已有归属（任务浮层 + 运行日志中心）；
 * - 卡片只需要知道按钮该不该转圈、上一次是成功还是失败。
 *
 * 范围扩大反而会造出第三个「日志源」，与既有两处不同步。
 *
 * ## 为什么不做超时清理
 *
 * 操作结束由调用方显式 `finish`。加超时猜测会让「卡住的任务」被误判成失败，
 * 而用户真正需要的是看到它还在跑。宿主进程重启后 store 自然重置（模块级状态），
 * 这与「安装随宿主一起没了」的事实一致。
 *
 * @module dsh-fnos/client/task-store
 */

import { useSyncExternalStore } from 'react'

/** 会占用卡片按钮的耗时操作。 */
export type TaskKind =
  /** 插件安装 / 更新（`PluginInstallInline`）。 */
  | 'plugin-install'
  /** nrm 的安装与卸载（`NpmMirrorCard`）。 */
  | 'nrm'
  /** 依赖修复（`DependencyRepairCard`）。 */
  | 'repair'
  /** agent skill 清理（`DependencyRepairCard` 内的一节）。 */
  | 'agent-skills'
  /** 插件卸载（`InstalledPluginsPanel`）。 */
  | 'plugin-remove'

/** 一次操作的终态。`undefined` 表示没有结论（还没开始、或正被新一轮覆盖）。 */
export type TaskOutcome = 'ok' | 'failed'

/** 一个任务槽。 */
export interface TaskSlot {
  /** 是否正在执行。 */
  readonly running: boolean
  /** 上一次的结论；`undefined` 表示从未跑过或已清空。 */
  readonly outcome: TaskOutcome | undefined
  /** 失败原因；仅 `outcome === 'failed'` 时有值。 */
  readonly error: string | undefined
}

/** store 快照。每次变更换新对象，供 `useSyncExternalStore` 判等。 */
export interface TaskState {
  readonly slots: Readonly<Record<TaskKind, TaskSlot>>
}

/** 空闲槽（常量复用，避免无意义的新对象）。 */
const IDLE: TaskSlot = { running: false, outcome: undefined, error: undefined }

const INITIAL: TaskState = {
  slots: { 'plugin-install': IDLE, 'plugin-remove': IDLE, nrm: IDLE, repair: IDLE, 'agent-skills': IDLE },
}

/** 任务 store 的最小面。 */
export interface TaskStore {
  /** 读取快照（同一引用直到状态变化）。 */
  readonly getSnapshot: () => TaskState
  /** 订阅变更；返回退订函数。 */
  readonly subscribe: (listener: () => void) => () => void
  /** 标记开始：清掉上一次的结论。 */
  readonly begin: (kind: TaskKind) => void
  /** 结束：记下结论。 */
  readonly finish: (kind: TaskKind, outcome: TaskOutcome, error?: string) => void
  /** 清空某一槽（用户关掉提示、或卡片主动复位时用）。 */
  readonly clear: (kind: TaskKind) => void
  /**
   * 按宿主的真实状态校准一个槽。
   *
   * store 是浏览器侧的记忆，宿主才是事实来源：宿主重启、或操作在别处完成时，
   * store 里的「正在跑」会永久挂住。卡片重挂载时调一次，以宿主为准纠正。
   * @param kind - 任务种类。
   * @param running - 宿主是否仍在执行。
   * @param outcome - 宿主给出的结论；`undefined` 表示宿主也没有结论。
   * @param error - 失败原因。
   */
  readonly reconcile: (kind: TaskKind, running: boolean, outcome: TaskOutcome | undefined, error?: string) => void
  /** 仅测试：整体重置。 */
  readonly reset: () => void
}

/**
 * 创建任务 store。
 * @returns store 句柄。
 */
export function createTaskStore(): TaskStore {
  let state = INITIAL
  const listeners = new Set<() => void>()

  const emit = (): void => {
    for (const listener of [...listeners]) listener()
  }

  const commit = (kind: TaskKind, slot: TaskSlot): void => {
    state = { slots: { ...state.slots, [kind]: slot } }
    emit()
  }

  return {
    getSnapshot: () => state,

    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },

    begin: (kind) => { commit(kind, { running: true, outcome: undefined, error: undefined }) },

    finish: (kind, outcome, error) => { commit(kind, { running: false, outcome, error }) },

    clear: (kind) => {
      if (state.slots[kind] === IDLE) return
      commit(kind, IDLE)
    },

    reconcile: (kind, running, outcome, error) => {
      const current = state.slots[kind]
      /*
        只在**确实不一致**时提交：卡片挂载时都会调一次，无变化还 emit 会给每个
        订阅者制造一次多余重渲。
      */
      if (current.running === running && current.outcome === outcome && current.error === error) return
      commit(kind, { running, outcome, error })
    },

    reset: () => {
      state = INITIAL
      emit()
    },
  }
}

/** 全局单例：卡片的运行态都记在这里，跨卸载保持。 */
export const taskStore = createTaskStore()

/**
 * 订阅一个任务槽。
 * @param kind - 任务种类。
 * @returns 该槽的当前状态。
 */
export function useTaskSlot(kind: TaskKind): TaskSlot {
  const state = useSyncExternalStore(taskStore.subscribe, taskStore.getSnapshot, taskStore.getSnapshot)
  return state.slots[kind]
}

/**
 * 用宿主状态校准某一槽。
 *
 * 只对「插件安装」有效：宿主为它维护了跨请求的状态机（`readInstallState`）。
 * 其他操作（nrm、修复）宿主不持久化状态，无法校准——它们的 store 记录就是
 * 本会话内的最佳信息。
 *
 * @param kind - 任务种类。
 * @param readHostState - 读宿主状态的函数；由调用方注入以便测试替换。
 */
export async function reconcileInstallSlot(
  kind: TaskKind,
  readHostState: () => Promise<{ running: boolean, status?: 'succeeded' | 'failed', error?: string }>,
): Promise<void> {
  try {
    const host = await readHostState()
    const outcome = host.status === undefined ? undefined : host.status === 'succeeded' ? 'ok' : 'failed'
    taskStore.reconcile(kind, host.running, outcome, host.error)
  } catch {
    /* 读不到就保持原样：界面上宁可停在「上次的状态」，也不要错乱。 */
  }
}
