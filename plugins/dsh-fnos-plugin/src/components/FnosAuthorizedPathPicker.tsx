/**
 * fnOS 授权目录选择器的浮层面板。
 *
 * 挂在 `conversation.input.overlay`：这个槽的锚点是输入卡片内部的零高定位
 * 上下文（上游 `InputBar` 的 `overlayAnchor`），斜杠指令面板也在这里。因此
 * 面板只要像指令面板那样贴齐锚点，位置与宽度就与它一致，且宽度天然跟随卡片
 * ——不需要测量，也不写任何固定像素宽度。
 *
 * 选择语义沿用改造前的实现：父子独立勾选、勾选即插入官方结构化引用、取消
 * 勾选即移除对应引用。差异只在承载形式（下拉 → 卡片宽浮层）与关闭出口。
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InputState } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { useAnchoredMaxHeight } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  DshIconClose as IconClose,
  DshIconCopy as IconCopy,
  DshIconDelete as IconDelete,
  DshIconEdit as IconEdit,
  DshIconFile as IconFile,
  DshIconFolder as IconFolder,
  DshIconFolderOpen as IconFolderOpen,
  DshIconPlus as IconPlus,
  DshInput as Input,
  DshTooltip as Tooltip,
  DshModal as Modal,
  DshEmpty,
  DshSpin,
  DshPopconfirm as Popconfirm,
  DshToast as Toast,
  DshTree as Tree,
  DshTypography as Typography,
} from '@tnnevol/dsh-semi-ui'
import { createAuthorizedEntry, deleteAuthorizedEntry, renameAuthorizedEntry, requestAuthorizedEntries, requestPersistAuthorizedDirectories, type AuthorizedEntriesResult } from '../client/services/authorized-directories-client.ts'
import { listenFnosAppAuthResult } from '../client/services/app-auth.ts'
import { pickAuthorizedDirectory } from '../client/services/authorized-directory-picker.ts'
import { isFnosHosted } from '../client/services/environment.ts'
import { IS_FNOS_WEB_RUNTIME, SHOWS_FILE_MANAGER_ENTRY } from '../client/services/runtime-env.ts'
import { openFnosEntry } from '../client/services/file-opener.ts'
import { createTrimApp } from '../client/services/sdk.ts'
import { FnosEmptyIllustration } from './FnosEmptyIllustration.tsx'
import { FNOS_REFERENCE_SOURCE, type FnosInputReference, createFnosInputReference } from '../client/input-references/input-references.ts'
import { planFnosOccurrenceRemovals, reconcileFnosOperationOccurrences, type PendingFnosOccurrence, type TrackedFnosOccurrence } from '../client/input-references/input-reference-operation.ts'
import { displayName, selectedPaths, toTreeNode, updateChildren, type PickerTreeNode } from '../client/input-references/picker-tree.ts'
import { usePickerOpen, type PickerOpenStore } from '../client/input-references/picker-store.ts'
import type { AuthorizedCreateKind, AuthorizedEntry } from '../contracts/authorized-directories-contract.ts'

const EMPTY_TREE_VALUE: string[] = []

/**
 * 视口顶部的安全距离。
 *
 * 与上游斜杠菜单同一取值：会话头部占 76px，再留 8px 空气，面板长高时停在
 * 头部下方而不是从头部底下滑出去。
 */
const PANEL_TOP_MARGIN = 84

/** 面板设计上限高度；运行时按上方可用空间再钳制。 */
const PANEL_MAX_HEIGHT = 420

/**
 * 把右键菜单落点收进视口。
 *
 * 在靠近右下角处右键时，菜单会顶出可视区被裁掉。这里按菜单的**估算尺寸**
 * 往回收：菜单只有两项，用保守常量即可，不必等布局测量后再修正——那样首帧
 * 会先画到界外再跳回来，看起来像闪一下。
 */
/**
 * 把菜单坐标夹进视口。
 *
 * `width` / `height` 由调用方给出**实测值**——早前这里用写死的 `148 × 84` 估算，
 * 但菜单有 5 项时实际高度接近 200px，窄屏上点靠近底部的条目，菜单下半截会掉到
 * 屏幕外（移动端尤其明显，手指还得先滚一下才看得到「删除」）。
 *
 * @param x - 期望的左沿。
 * @param y - 期望的上沿。
 * @param width - 菜单实测宽度。
 * @param height - 菜单实测高度。
 * @returns 夹紧后的坐标。
 */
function clampMenuPosition(x: number, y: number, width: number, height: number): { x: number, y: number } {
  if (typeof window === 'undefined') return { x, y }
  const margin = 8
  return {
    x: Math.max(margin, Math.min(x, window.innerWidth - width - margin)),
    y: Math.max(margin, Math.min(y, window.innerHeight - height - margin)),
  }
}

/**
 * 目录名：用 Semi `Typography.Text` 的 `ellipsis` 做单行省略。
 *
 * `ellipsis.showTooltip` 的语义正是我们要的——`Typography` 内部用
 * `isOverflowed` 判断文本是否真的被截断（semi-ui `typography/base.js`：
 * `const show = noExpandText && overflowed && showTooltip`），只有溢出了才挂
 * 提示。名字放得下时不会弹气泡，也不需要我们自己量 `scrollWidth`。
 *
 * 注意 `ellipsis` 只支持纯文本 children，因此这里必须传 `string`。
 */
function nodeLabel(entry: AuthorizedEntry, showFullPath = false): ReactNode {
  const name = showFullPath ? entry.semanticPath : displayName(entry.semanticPath)
  const Icon = entry.kind === 'directory' ? IconFolder : IconFile
  return (
    <span className="dsh-fnos-tree-node-label">
      <Icon size="small" />
      <Typography.Text
        className="dsh-fnos-tree-node-label-text"
        ellipsis={{ showTooltip: true, rows: 1 }}
      >
        {name}
      </Typography.Text>
    </span>
  )
}

/** 从树里摘掉一个节点（含其子树），返回新数组。 */
function removeNode(nodes: readonly PickerTreeNode[], key: string): PickerTreeNode[] {
  return nodes.flatMap(node => {
    if (node.key === key) return []
    if (node.children === undefined) return [node]
    return [{ ...node, children: removeNode(node.children, key) }]
  })
}

/** 把删除失败的错误码翻成用户能照着处理的文案。 */
function deleteErrorMessage(error: unknown, t: (key: FnosDeleteLocaleKey) => string): string {
  const code = error instanceof Error ? error.message : ''
  switch (code) {
    case 'fnos-delete-root-forbidden': return t('deleteDialogRootForbidden')
    case 'fnos-delete-permission-denied':
    case 'fnos-path-not-authorized':
      return t('deleteDialogDenied')
    case 'fnos-delete-read-only': return t('deleteDialogReadOnly')
    case 'fnos-delete-busy':
    case 'fnos-delete-not-empty':
      return t('deleteDialogBusy')
    case 'fnos-entry-not-found': return t('deleteDialogNotFound')
    default: return t('deleteDialogFailed')
  }
}

/** 把授权失败的错误码翻成可操作文案。 */
function authorizeErrorMessage(code: string, t: (key: FnosAuthorizeLocaleKey) => string): string {
  switch (code) {
    case 'fnos-authorized-directory-permission-denied': return t('authorizeDenied')
    default: return t('authorizeFailed')
  }
}

/** 授权提示会用到的文案键。 */
type FnosAuthorizeLocaleKey = 'authorizeDenied' | 'authorizeFailed'

/** 删除弹框会用到的文案键。 */
type FnosDeleteLocaleKey =
  | 'deleteDialogRootForbidden'
  | 'deleteDialogDenied'
  | 'deleteDialogReadOnly'
  | 'deleteDialogBusy'
  | 'deleteDialogNotFound'
  | 'deleteDialogFailed'

/** 取某个节点当前的子节点；用于把新建成功的条目并进已展开的那一层。 */
function findChildren(nodes: readonly PickerTreeNode[], key: string): PickerTreeNode[] | undefined {
  for (const node of nodes) {
    if (node.key === key) return node.children
    if (node.children === undefined) continue
    const nested = findChildren(node.children, key)
    if (nested !== undefined) return nested
  }
  return undefined
}

/** 把宿主错误码翻成用户能照着处理的文案。 */
function createErrorMessage(error: unknown, t: (key: FnosCreateLocaleKey) => string): string {
  const code = error instanceof Error ? error.message : ''
  switch (code) {
    case 'fnos-entry-exists': return t('createDialogExists')
    case 'fnos-create-permission-denied':
    case 'fnos-user-permission-denied':
    case 'authorized-directory-not-readable':
      return t('createDialogDenied')
    case 'fnos-create-no-space': return t('createDialogNoSpace')
    case 'fnos-create-read-only': return t('createDialogReadOnly')
    case 'invalid-fnos-create-request': return t('createDialogInvalid')
    default: return t('createDialogFailed')
  }
}

/** 把重命名的宿主错误码翻成用户能照着处理的文案。 */
function renameErrorMessage(error: unknown, t: (key: FnosRenameLocaleKey) => string): string {
  const code = error instanceof Error ? error.message : ''
  switch (code) {
    case 'fnos-entry-exists': return t('createDialogExists')
    case 'fnos-rename-permission-denied':
    case 'fnos-user-permission-denied':
    case 'authorized-directory-not-readable':
      return t('createDialogDenied')
    case 'fnos-rename-read-only': return t('createDialogReadOnly')
    case 'fnos-rename-root-forbidden': return t('renameDialogRootForbidden')
    case 'fnos-entry-not-found': return t('renameDialogNotFound')
    case 'fnos-rename-busy': return t('renameDialogBusy')
    case 'invalid-fnos-rename-request': return t('createDialogInvalid')
    default: return t('createDialogFailed')
  }
}

/** 取父目录路径；根目录的父级就是它自己。 */
function parentPathOf(path: string): string {
  const index = path.lastIndexOf('/')
  return index <= 0 ? '/' : path.slice(0, index)
}

/**
 * 面板里真正纵向滚动的那一层。
 *
 * `.dsh-fnos-path-panel` 只负责限高并 `overflow: hidden`；纵向滚动落在树的根元素
 * 上（`styles/index.scss` 的 `.dsh-fnos-path-panel-tree { flex: 1; overflow: auto }`），
 * 内层 `.semi-tree-option-list` 只处理横向。记错层会永远读到 `scrollTop = 0`。
 */
function treeScrollContainer(panel: HTMLElement | null): HTMLElement | null {
  if (panel === null) return null
  return panel.querySelector<HTMLElement>('.dsh-fnos-path-panel-tree')
}

/** 重命名弹框会用到的那几条文案键。 */
type FnosRenameLocaleKey =
  | 'createDialogEmpty'
  | 'createDialogExists'
  | 'createDialogDenied'
  | 'createDialogReadOnly'
  | 'createDialogInvalid'
  | 'createDialogFailed'
  | 'renameDialogRootForbidden'
  | 'renameDialogNotFound'
  | 'renameDialogBusy'

/** 新建弹框会用到的那几条文案键（避免把整个 key 联合类型铺在手写签名里）。 */
type FnosCreateLocaleKey =
  | 'createDialogEmpty'
  | 'createDialogExists'
  | 'createDialogDenied'
  | 'createDialogNoSpace'
  | 'createDialogReadOnly'
  | 'createDialogInvalid'
  | 'createDialogFailed'

export type FnosAuthorizedPathPanelProps =
  & PropsRuntime<'conversation.input.overlay'>
  & PropsLocale<'settings.dsh-fnos'>
  & {
    /** 与工具栏触发器共享的开关 store。 */
    store: PickerOpenStore
    insertReferences: (input: { draft: string, draftRev: number, occurrences?: readonly { readonly length: number }[] }, references: readonly FnosInputReference[]) => readonly FnosInputReference[]
  }

/** 选择器浮层：展开时渲染树，收起时渲染 null（槽位锚点保持挂载）。 */
export function FnosAuthorizedPathPanel({ useInput, inputActions, sessionId, store, insertReferences, t }: FnosAuthorizedPathPanelProps) {
  const input = useInput((state: InputState) => state)
  // 必须走 store 的订阅钩子：直接读 `store.isOpen(...)` 不会在开关变化时重渲染。
  const open = usePickerOpen(store, sessionId)
  const panelRef = useRef<HTMLDivElement>(null)
  const [treeData, setTreeData] = useState<PickerTreeNode[]>([])
  const [desiredPaths, setDesiredPaths] = useState<string[] | undefined>()
  const entries = useRef(new Map<string, AuthorizedEntry>())
  const operationBaselineOccurrenceIds = useRef(new Set<number>())
  const insertedTreePaths = useRef(new Set<string>())
  const pendingInsertedOccurrences = useRef(new Map<string, PendingFnosOccurrence>())
  const currentOperationOccurrences = useRef(new Map<number, TrackedFnosOccurrence>())
  const pendingRemovalPaths = useRef(new Set<string>())
  const busy = input.phase === 'adjudicating' || input.phase === 'submitting'
  const value = desiredPaths ?? EMPTY_TREE_VALUE
  const maxHeight = useAnchoredMaxHeight(panelRef, PANEL_MAX_HEIGHT, open, PANEL_TOP_MARGIN)

  // 新建弹框：`parent` 是右键命中的目录；`kind` 决定建文件夹还是空文件。
  const [createTarget, setCreateTarget] = useState<{ parent: string, kind: AuthorizedCreateKind } | undefined>()
  const [createName, setCreateName] = useState('')
  const [createError, setCreateError] = useState<string | undefined>()
  const [creating, setCreating] = useState(false)
  // 授权动作进行中：期间禁用授权按钮，避免并发唤起多个原生死选择器。
  const [authorizing, setAuthorizing] = useState(false)
  /**
   * 授权回调的订阅解绑函数。
   *
   * 独立浏览器页面的授权是异步的：点「新增授权」只负责打开系统授权页，结果要等
   * 回调页 `postMessage` 回来。早前面板只把状态置成 pending 就 `return`，**没有
   * 订阅回调**，于是用户授权完成后列表一直是旧的——只有设置弹框里的卡片会刷新。
   */
  const authListenerRef = useRef<(() => void) | undefined>(undefined)
  // 右键上下文菜单：命中的条目与鼠标坐标（菜单定位）。
  const [contextMenu, setContextMenu] = useState<{
    path: string
    semanticPath: string
    kind: AuthorizedCreateKind
    /**
     * 该项是否可删 / 可改名。
     *
     * 由宿主按 `readOnlyPaths` 给出：应用共享目录（`@appshare`、`@apphome`、
     * `@appdata`、`@appconf` 这些）属于框架管理的只读路径，删不得也改不得名字。
     * 对它们显示「删除」「重命名」只会得到一条失败提示。
     */
    removable: boolean
    x: number
    y: number
  } | undefined>()
  const menuRef = useRef<HTMLDivElement>(null)
  /** 树的容器：App 端长按监听挂在它上面。 */
  const treeRef = useRef<HTMLDivElement>(null)
  // 删除目标独立存一份：Popconfirm 确认时菜单可能已卸载，不能依赖 state。
  const deleteTargetRef = useRef<{ path: string, semanticPath: string } | undefined>(undefined)
  // 重命名弹框：初值是条目当前的名字（只取基线名，不把整条语义路径填进去）。
  const [renameTarget, setRenameTarget] = useState<{ path: string, semanticPath: string, kind: AuthorizedCreateKind } | undefined>()
  const [renameName, setRenameName] = useState('')
  const [renameError, setRenameError] = useState<string | undefined>()
  const [renaming, setRenaming] = useState(false)
  // 展开状态由面板持有：面板收起时子树会卸载，交给 Semi 的内部状态就丢了。
  /*
    **首次加载中。**

    面板是「开关」式复用（关闭不卸载），所以这个标记必须在每次 `open` 变 true 时
    重置为 `true`，否则第二次打开会直接显示上一次的列表——中间那段网络往返期间
    屏幕上还是旧内容，用户以为点击没生效。

    电池里存的是「是否正在拉根列表」，与 `busy`（正在判定/提交选中）不是一回事。
  */
  const [loadingRoots, setLoadingRoots] = useState(false)
  const [expandedKeys, setExpandedKeys] = useState<string[]>([])
  // 滚动位置同理：收起时记住，重新展开后还原（勾选状态不还原）。
  const scrollTopRef = useRef(0)

  const applyEntries = useCallback((result: AuthorizedEntriesResult, parent?: string) => {
    /*
      **根列表是一次整表快照，必须先把缓存清空再写入。**

      早前这里只做 `set`：`entries` 是个累加 Map，宿主那边已解除授权的目录会
      永远留在里面——表现为「在设置里取消授权了，输入区面板还能看到、还能勾选」。
      带 `parent` 的调用是「加载某个节点的子目录」，那是有意增量，不清。
    */
    if (parent === undefined) entries.current.clear()
    for (const entry of result.entries) entries.current.set(entry.path, entry)
    const children = result.entries.map(entry => toTreeNode(entry, nodeLabel(entry)))
    setTreeData(current => parent === undefined
      ? result.entries.map(entry => toTreeNode(entry, nodeLabel(entry, true)))
      : updateChildren(current, parent, children))
  }, [])

  /**
   * 拉取根列表。
   *
   * **每次面板打开都要重拉**，不能只在挂载时拉一次：面板是「开关」式复用，
   * 关闭再打开不会重新挂载。用户可能在别处（设置弹框、另一个标签页）解除了
   * 授权，只有重拉才能反映真实状态——否则列表会一直是打开过的那一份缓存。
   */
  const reloadRoots = useCallback(async (): Promise<void> => {
    setLoadingRoots(true)
    try {
      const result = await requestAuthorizedEntries()
      applyEntries(result)
    } catch {
      setTreeData([])
      entries.current.clear()
    } finally {
      // 失败也要落回 false：否则失败后面板会一直转圈，用户既看不到缺省页也点不动。
      setLoadingRoots(false)
    }
  }, [applyEntries])

  useEffect(() => {
    if (!open) return
    /*
      不需要 cancelled 标志：`reloadRoots` 内部已经把失败折成「清空」，
      迟到的结果只会写一次 state——组件卸载后 React 会忽略，不会报错。
      面板是开关式复用，这个 effect 会在每次「收起 → 再打开」时重跑一遍。
    */
    /*
      立刻置 loading：`open` 变 true 的这一帧 `treeData` 还是空的，若不先置位，
      会先渲染一帧 `emptyContent`（缺省组件）再跳到列表——正是「打开瞬间闪过
      缺省页」的来源。
    */
    setLoadingRoots(true)
    void reloadRoots()
  }, [open, reloadRoots])


  // 展开/收起的两侧状态都在这里重置：展开时清掉上一次会话级的残留，收起时
  // 放掉 `desiredPaths`，让下一次展开从空白选择开始，而不是回放旧勾选。
  //
  // 依赖只有 `open`：基线要取**展开那一刻**的 occurrence 快照，之后草稿里
  // 新增的引用都属于本次操作的产物。把 `input.occurrences` 放进依赖，会在
  // 每次插入引用后重新采一次基线，反而让「取消勾选 → 移除引用」的对账失效。
  // 输入状态经 ref 读取，不进入依赖数组。
  const occurrencesRef = useRef(input.occurrences)
  occurrencesRef.current = input.occurrences
  useEffect(() => {
    operationBaselineOccurrenceIds.current.clear()
    insertedTreePaths.current.clear()
    pendingInsertedOccurrences.current.clear()
    currentOperationOccurrences.current.clear()
    pendingRemovalPaths.current.clear()
    if (!open) {
      setDesiredPaths(undefined)
      return
    }
    operationBaselineOccurrenceIds.current = new Set(
      occurrencesRef.current
        .filter(occurrence => occurrence.source === FNOS_REFERENCE_SOURCE)
        .map(occurrence => occurrence.occurrenceId),
    )
    setDesiredPaths(EMPTY_TREE_VALUE)
  }, [open])

  /**
   * 展开/收起与滚动位置跨「收起 → 重新展开」保留。
   *
   * 面板收起时整棵子树会卸载，Semi Tree 内部的展开与滚动状态随之丢失。这两样
   * 都是「用户刚才看到哪」的上下文，重新打开还要再翻一次很烦；勾选状态则按
   * 每次操作重新开始，继续保持原先的重置行为。
   */
  useEffect(() => {
    if (!open) return
    const container = treeScrollContainer(panelRef.current)
    if (container === null) return
    // 让树先按上一次的展开状态渲染出同样的高度，再还原滚动位置。
    const frame = requestAnimationFrame(() => {
      container.scrollTop = scrollTopRef.current
    })
    const onScroll = (): void => { scrollTopRef.current = container.scrollTop }
    container.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      container.removeEventListener('scroll', onScroll)
    }
  }, [open])

  /** 记住展开状态；子树卸载后靠这份 state 还原。 */
  const handleExpand = useCallback((keys: unknown) => {
    setExpandedKeys(Array.isArray(keys) ? keys.filter((key): key is string => typeof key === 'string') : [])
  }, [])

  /** 条目消失或换了路径后，把它与它名下子树的展开记录清掉。 */
  const forgetExpandedKeys = useCallback((path: string) => {
    setExpandedKeys(keys => keys.filter(key => key !== path && !key.startsWith(`${path}/`)))
  }, [])

  const insertSelectedPaths = useCallback((paths: readonly string[]): void => {
    const pending = paths
      .filter(path => !insertedTreePaths.current.has(path))
      .map(path => ({ path, entry: entries.current.get(path) }))
      .flatMap(item => {
        if (item.entry === undefined) return []
        const reference = createFnosInputReference(item.entry.kind, item.entry.path, item.entry.semanticPath)
        return reference === undefined ? [] : [{ path: item.path, reference }]
      })
    if (pending.length === 0) return
    const inserted = insertReferences(
      { draft: input.draft, draftRev: input.draftRev, occurrences: input.occurrences },
      pending.map(item => item.reference),
    )
    const insertedRefs = new Set(inserted.map(reference => reference.ref))
    for (const item of pending) {
      if (!insertedRefs.has(item.reference.ref)) continue
      insertedTreePaths.current.add(item.path)
      pendingInsertedOccurrences.current.set(item.reference.ref, {
        path: item.path,
        ref: item.reference.ref,
        // 选择器总是在草稿末尾插入，所以尾部分隔符由 DSH 负责。
        trailingSeparator: true,
      })
    }
  }, [input.draft, input.draftRev, input.occurrences, insertReferences])

  useEffect(() => {
    if (desiredPaths === undefined) return
    // 异步加载的子节点在勾选那一刻可能还不在 entries 里；树或输入快照变化时重试。
    insertSelectedPaths(desiredPaths)
  }, [desiredPaths, insertSelectedPaths, treeData])

  useEffect(() => {
    if (desiredPaths === undefined) return
    const result = reconcileFnosOperationOccurrences({
      baselineOccurrenceIds: operationBaselineOccurrenceIds.current,
      pendingOccurrences: pendingInsertedOccurrences.current,
      trackedOccurrences: currentOperationOccurrences.current,
      occurrences: input.occurrences,
      pendingRemovalPaths: pendingRemovalPaths.current,
    })
    pendingInsertedOccurrences.current = result.pendingOccurrences
    currentOperationOccurrences.current = result.trackedOccurrences
    if (result.removedPaths.size === 0) return
    for (const path of result.removedPaths) insertedTreePaths.current.delete(path)
    setDesiredPaths(current => current?.filter(path => !result.removedPaths.has(path)))
  }, [desiredPaths, input.occurrences])

  useEffect(() => {
    const steps = planFnosOccurrenceRemovals({
      draft: input.draft,
      occurrences: input.occurrences,
      trackedOccurrences: currentOperationOccurrences.current,
      pendingRemovalPaths: pendingRemovalPaths.current,
    })
    if (steps.length === 0) return

    for (const step of steps) {
      // 逐个读取实时修订号：每次删除都会推进它，用快照里的值会让第二个引用
      // 之后的删除被 CAS 拒绝。跨度无需重算——计划按偏移倒序，删掉靠后的引用
      // 不会移动靠前引用的位置。
      const draftRev = inputActions.captureInsertion().draftRev
      // 用空文本替换这一个 chip 的原子跨度，只销毁它自己的节点；其余 chip 的
      // occurrenceId 与 occurrence 投影保持不变，父子勾选状态因此互不牵连。
      // 不能改走 setDraft：那条路径会 root.clear() 后按纯文本重建，销毁所有 chip。
      if (!inputActions.insertText('', { ...step.span, draftRev })) break
      pendingRemovalPaths.current.delete(step.path)
      currentOperationOccurrences.current.delete(step.occurrenceId)
    }
  }, [desiredPaths, input.draft, input.occurrences, inputActions])

  const close = useCallback(() => { store.set(sessionId, false) }, [store, sessionId])

  // 弹层打开期间不因「点外部」收起面板。
  //
  // Modal 由 Semi portal 到 body，`panelRef.current.contains(target)`
  // 对它们恒为 false——弹框里点一下输入框或按钮，就会被判成「点了面板外部」，
  // 连带把整个面板销毁。这些浮层自己会处理外部关闭，面板在此期间应当让路。
  //
  // **新增浮层时必须同步加进这里**：漏一个就会重现「弹框一打开、点一下就整个
  // 面板消失」。删除确认与重命名各漏过一次，症状完全相同。
  const floatingOpen = createTarget !== undefined || renameTarget !== undefined || contextMenu !== undefined

  // 点击输入卡片之外收起。卡片内部（含面板自身与文本域）不关闭：用户点回
  // 草稿继续输入时，选择器不该被顺手关掉。与上游斜杠菜单同一策略。
  useEffect(() => {
    if (!open || floatingOpen) return
    const onPointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Node)) return
      if (panelRef.current?.contains(event.target) === true) return
      const card = panelRef.current?.closest('[data-composer-card]')
      if (card?.contains(event.target) === true) return
      close()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => { document.removeEventListener('pointerdown', onPointerDown, true) }
  }, [open, floatingOpen, close])

  // Esc 同理：弹层自己处理 Esc（Modal 关闭、菜单收起），面板不能抢在它前面
  // 把自己整个关掉——那会让用户既丢了弹框也丢了面板。
  useEffect(() => {
    if (!open || floatingOpen) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [open, floatingOpen, close])

  const handleTreeChange = useCallback((next: unknown) => {
    const nextPaths = selectedPaths(next)
    for (const path of insertedTreePaths.current) {
      if (!nextPaths.includes(path)) {
        insertedTreePaths.current.delete(path)
        pendingRemovalPaths.current.add(path)
      }
    }
    setDesiredPaths(nextPaths)
    // 在同一次事件里完成提交：即使浮层随即关闭，已勾选的路径也不会丢。
    insertSelectedPaths(nextPaths)
  }, [insertSelectedPaths])

  const loadData = useCallback(async (node: unknown) => {
    const key = typeof node === 'object' && node !== null && 'key' in node && typeof node.key === 'string'
      ? node.key
      : undefined
    if (key === undefined) return
    const result = await requestAuthorizedEntries(key)
    applyEntries(result, key)
  }, [applyEntries])

  /**
   * 右键命中一个目录：在鼠标位置弹出上下文菜单。
   *
   * 命中文件时不弹菜单（文件下无法再建条目）。
   *
   * 菜单自己画、不用 Semi `Dropdown`：它的定位依赖锚点元素的
   * `getBoundingClientRect` 与容器坐标系，喂一个零尺寸锚点会被算到面板角落；
   * 而 `trigger="custom"` 下它也不注册任何外部点击关闭。这两件事都要自己接管。
   */
  /**
   * 在面板内新增一个授权目录。
   *
   * 权限必须由用户在 fnOS 主程序里确认，因此这里唤起原生选择器，而不是在面板
   * 内自由浏览文件系统。成功后两件事必须一起做：
   *
   *  1. 重新拉取根列表，让新授权的目录立刻出现在树里；
   *  2. 把当前可移除的根写入持久化——否则重装后这条授权就丢了。
   *
   * 持久化失败只提示不中断：授权本身已经在 fnOS 侧生效，不该因为写记录失败
   * 让用户以为整个操作失败了。
   */
  const authorizeDirectory = useCallback(async () => {
    if (authorizing) return
    /*
      **不在 fnOS 上就直接给反馈，不往下走。**

      授权只能由用户在 fnOS 主程序里逐级确认；本地 `dsh web` 这类环境里这条链路
      根本不存在——继续执行只会打开一个打不开的新标签页，用户看到一个空白页，
      既不知道发生了什么，也不知道该不该等。

      判据用 `isFnosHosted()`（fnOS 应用网关会给 HTML 注入
      `<base href="/app/...">`）而不是「有没有宿主桥」：**独立浏览器页面同样属于
      fnOS 应用**，只是没有桥，那条路要走 `openAppAuth` 授权页，是正常流程。

      按钮不置灰：置灰之后用户点不动也没有解释，反而更困惑；点一下给出原因更清楚。
    */
    if (!isFnosHosted()) {
      Toast.warning({ content: t('authorizeUnsupportedHere') })
      return
    }
    setAuthorizing(true)
    try {
      const outcome = await pickAuthorizedDirectory({
        title: t('authorizeDirectory'),
        okText: t('inputPickerConfirm'),
      })
      if (outcome.status === 'cancelled') return
      /*
        独立浏览器页面：授权页刚被打开，用户还没确认。这时既不是成功也不是失败，
        什么都不做——结果会通过回调页的 `postMessage` 异步回来。
        早前这里没有这一支，会直接往下走「刷新列表 + 提示授权成功」，于是用户
        什么都没点就看到「已授权」，而列表里并没有新目录。
      */
      if (outcome.status === 'authorization-pending') {
        /*
          独立浏览器页面：授权页已打开，结果会经同源回调页 `postMessage` 回来。
          在这里**立即订阅**——晚一步就可能漏掉已经到达的结果。

          早前面板只把状态置成 pending 就返回，**没有订阅**，于是用户授权完成后
          列表一直是旧的（只有设置弹框里的卡片会刷新）。
        */
        const state = outcome.state
        const off = listenFnosAppAuthResult(state, (result) => {
          /*
            结果可能是 success / cancel / error 三态。
            早前只判了「不是 error/cancel 就刷新」，于是用户点了「取消」也走刷新
            分支——虽然结果无害，但会让人误以为授权成功了。这里显式分流。
          */
          if (result.status === 'error') {
            Toast.error({ content: authorizeErrorMessage(result.error ?? '', t) })
            return
          }
          if (result.status === 'cancel') return
          void requestAuthorizedEntries().then((fresh) => {
            applyEntries(fresh)
            const paths = fresh.entries
              .filter(entry => entry.kind === 'directory')
              .map(entry => entry.path)
            /*
              与宿主动调那条路保持一致：成功要有回执，否则用户从授权页回来时
              只看到列表「悄悄多了一行」，不知道刚才那次操作到底成没成。
            */
            void requestPersistAuthorizedDirectories(paths)
              .then(() => { Toast.success({ content: t('authorizeSucceeded') }) })
              .catch(() => { Toast.warning({ content: t('authorizePersistFailed') }) })
          }).catch((error: unknown) => {
            Toast.error({ content: authorizeErrorMessage(error instanceof Error ? error.message : '', t) })
          })
        })
        // 组件卸载或下一次授权时解除上一次的订阅。
        authListenerRef.current?.()
        authListenerRef.current = off
        return
      }
      if (outcome.status === 'failed') {
        Toast.error({ content: authorizeErrorMessage(outcome.code, t) })
        return
      }
      const result = await requestAuthorizedEntries()
      applyEntries(result)
      // 只持久化用户可移除的根（当前列表里全部是根）。
      const paths = result.entries.filter(entry => entry.kind === 'directory').map(entry => entry.path)
      try {
        await requestPersistAuthorizedDirectories(paths)
      } catch {
        Toast.warning({ content: t('authorizePersistFailed') })
      }
      Toast.success({ content: t('authorizeSucceeded') })
    } catch (error: unknown) {
      const code = error instanceof Error ? error.message : ''
      Toast.error({ content: authorizeErrorMessage(code, t) })
    } finally {
      setAuthorizing(false)
    }
  }, [authorizing, applyEntries, t])

  /**
   * 右键命中一个条目：在鼠标位置弹出上下文菜单。
   *
   * 菜单项按条目类型区分：目录可新建与删除，文件只能删除（文件下无法再建
   * 条目）。删除对两者都开放，因此文件也能右键。
   *
   * 菜单自己画、不用 Semi `Dropdown`：它的定位依赖锚点元素的
   * `getBoundingClientRect` 与容器坐标系，喂一个零尺寸锚点会被算到面板角落；
   * 而 `trigger="custom"` 下它也不注册任何外部点击关闭。这两件事都要自己接管。
   *
   * 菜单还必须经 Portal 挂到 body：面板带 `backdrop-filter` 与 `overflow:
   * hidden`，会成为 `fixed` 后代的包含块——留在面板内部的话，`left/top` 就
   * 不再是视口坐标，菜单会停在面板角落。
   */
  const handleContextMenu = useCallback((event: { preventDefault: () => void, clientX?: number, clientY?: number }, node: unknown) => {
    const key = typeof node === 'object' && node !== null && 'key' in node && typeof node.key === 'string'
      ? node.key
      : undefined
    if (key === undefined) return
    const entry = entries.current.get(key)
    if (entry === undefined) return
    event.preventDefault()
    /*
      先用**保守估算**定位（宽度取下限 132，高度按最多 6 项算 240）——菜单还没
      渲染，拿不到真实尺寸。渲染完成后 `useLayoutEffect` 会用实测值再校正一次，
      所以这里的估算只影响「第一次绘制的那一帧」，不会留到最终状态。
    */
    const position = clampMenuPosition(event.clientX ?? 0, event.clientY ?? 0, 132, 240)
    deleteTargetRef.current = { path: entry.path, semanticPath: entry.semanticPath }
    setContextMenu({ path: entry.path, semanticPath: entry.semanticPath, kind: entry.kind, removable: entry.removable !== false, x: position.x, y: position.y })
  }, [])

  /*
    **App 端长按唤出同一个菜单。**

    移动端没有右键：`contextmenu` 在长按后才触发，而且各 WebView 的表现不一
    （有的完全不发）。所以自己监听 `touchstart` / `touchend` / `touchmove`，按住
    500ms 且手指没移动就认定长按。

    判据用 `IS_FNOS_WEB_RUNTIME`：只在 App（`isWeb === false`）挂这些监听。桌面
    浏览器里长按是「选中文字」，不该弹菜单。

    长按命中后 `preventDefault` 掉后续事件，避免浏览器再补一次 `contextmenu`
    或复制气泡，否则会出现两个菜单叠在一起。
  */
  useEffect(() => {
    if (IS_FNOS_WEB_RUNTIME) return
    const root = treeRef.current
    if (root === null) return

    let timer: ReturnType<typeof setTimeout> | undefined
    let startX = 0
    let startY = 0
    let fired = false

    const clear = (): void => {
      if (timer !== undefined) { clearTimeout(timer); timer = undefined }
    }

    const onTouchStart = (event: TouchEvent): void => {
      const touch = event.touches[0]
      if (touch === undefined) return
      startX = touch.clientX
      startY = touch.clientY
      fired = false
      clear()
      timer = setTimeout(() => {
        fired = true
        /*
          从触点往上找那一行的 `data-key`：Semi 的树节点把 key 放在该属性上。

          找不到就什么也不做——按住空白处不该弹菜单。
        */
        const row = (document.elementFromPoint(startX, startY) as Element | null)
          ?.closest<HTMLElement>('.semi-tree-option')
        const key = row?.getAttribute('data-key')
        const entry = key === null || key === undefined ? undefined : entries.current.get(key)
        if (entry === undefined) return
        // 同上：先用保守估算，渲染后由 useLayoutEffect 校正。
        const position = clampMenuPosition(startX, startY, 132, 240)
        deleteTargetRef.current = { path: entry.path, semanticPath: entry.semanticPath }
        setContextMenu({ path: entry.path, semanticPath: entry.semanticPath, kind: entry.kind, removable: entry.removable !== false, x: position.x, y: position.y })
      }, 500)
    }

    const onTouchMove = (event: TouchEvent): void => {
      const touch = event.touches[0]
      if (touch === undefined) return
      // 移动超过 10px 视为滚动，取消长按。
      if (Math.abs(touch.clientX - startX) > 10 || Math.abs(touch.clientY - startY) > 10) clear()
    }

    const onTouchEnd = (event: TouchEvent): void => {
      clear()
      // 长按已弹菜单：吞掉这一下，避免它又变成一次点击（选中/展开）。
      if (fired) { event.preventDefault(); fired = false }
    }

    root.addEventListener('touchstart', onTouchStart, { passive: true })
    root.addEventListener('touchmove', onTouchMove, { passive: true })
    root.addEventListener('touchend', onTouchEnd)
    return () => {
      clear()
      root.removeEventListener('touchstart', onTouchStart)
      root.removeEventListener('touchmove', onTouchMove)
      root.removeEventListener('touchend', onTouchEnd)
    }
  }, [])

  /*
    **菜单渲染后再按实测尺寸校正一次位置。**

    触点坐标来自手指或鼠标，靠近屏幕右/下边缘时按原始坐标画菜单会溢出：窄屏上
    5 项菜单接近 200px 高，点最底下的条目，菜单下半截直接掉出视口。

    这一帧的校正对移动端尤其重要——桌面鼠标一般不会点到那么靠边。用
    `useLayoutEffect` 而不是 `useEffect`：在浏览器绘制前完成，用户不会看到菜单
    先溢出再跳回来。
  */
  useLayoutEffect(() => {
    if (contextMenu === undefined) return
    const el = menuRef.current
    if (el === null) return
    const rect = el.getBoundingClientRect()
    const next = clampMenuPosition(contextMenu.x, contextMenu.y, rect.width, rect.height)
    // 只有真的需要移动时才 setState，避免无谓的二次渲染。
    if (next.x !== contextMenu.x || next.y !== contextMenu.y) {
      setContextMenu(current => (current === undefined ? current : { ...current, x: next.x, y: next.y }))
    }
  }, [contextMenu])

  // 菜单打开期间：点击菜单之外或按 Esc 收起（与系统右键菜单一致）。
  // 用捕获阶段，保证菜单项自己的 click 之前不会先被其它监听吞掉。
  useEffect(() => {
    if (contextMenu === undefined) return
    const onPointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Node)) return
      if (menuRef.current?.contains(event.target) === true) return
      // Popconfirm 的弹层由 Semi portal 到 body，不在 menuRef 内。不豁免的话，
      // 点「确定」会被判成「菜单外点击」→ 菜单卸载 → Popconfirm 一起消失，
      // onConfirm 永远不会触发。这正是「删除点了没反应」的真因。
      if (event.target instanceof Element && event.target.closest('.semi-popconfirm') !== null) return
      setContextMenu(undefined)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setContextMenu(undefined)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [contextMenu])

  /*
    卸载时解绑授权回调订阅：面板收起会卸载子树，留着订阅会让回调打在已经
    卸载的组件上（`applyEntries` 里的 setState 变成空操作，但闭包与消息监听
    一直留着）。
  */
  useEffect(() => () => {
    authListenerRef.current?.()
    authListenerRef.current = undefined
  }, [])

  /** 从上下文菜单进入新建弹框；菜单随即收起。 */
  const createFromContextMenu = useCallback((kind: AuthorizedCreateKind) => {
    const target = contextMenu
    setContextMenu(undefined)
    if (target === undefined) return
    setCreateError(undefined)
    setCreateName('')
    setCreateTarget({ parent: target.path, kind })
  }, [contextMenu])

  /**
   * 用 fnOS 自己的界面打开条目：目录交给文件管理器定位，文件交给 fnOS 的
   * 打开/预览能力。插件不复制一套浏览或预览，只负责把路径转过去。
   */
  const openFromContextMenu = useCallback(async () => {
    const target = contextMenu
    setContextMenu(undefined)
    if (target === undefined) return
    try {
      await openFnosEntry(target.path, target.kind, () => createTrimApp())
    } catch {
      Toast.error({ content: t('openEntryFailed') })
    }
  }, [contextMenu, t])

  /**
   * 复制条目的**完整绝对路径**。
   *
   * 刻意复制 `path` 而不是 `semanticPath`：用户要的是能贴进终端、脚本、SSH 命令
   * 的那种真实路径（`/vol2/...`），语义化名称（「存储空间 2/…」）只适合展示。
   *
   * 剪贴板在非安全上下文（http + 非 localhost）不可用，所以失败要明确提示，
   * 不能静默吞掉——用户会以为复制成功了。
   */
  const copyFullPath = useCallback(async () => {
    const target = contextMenu
    setContextMenu(undefined)
    if (target === undefined) return
    try {
      await globalThis.navigator.clipboard.writeText(target.path)
      Toast.success({ content: t('copyPathSucceeded') })
    } catch {
      Toast.error({ content: t('copyPathFailed') })
    }
  }, [contextMenu, t])

  /** 从上下文菜单进入重命名弹框；输入框初值取条目当前的名字。 */
  const renameFromContextMenu = useCallback(() => {
    const target = contextMenu
    setContextMenu(undefined)
    if (target === undefined) return
    setRenameError(undefined)
    setRenameName(displayName(target.semanticPath))
    setRenameTarget({ path: target.path, semanticPath: target.semanticPath, kind: target.kind })
  }, [contextMenu])

  /** 提交重命名：成功后只重取父目录那一层，其它已展开的分支保持原样。 */
  const submitRename = useCallback(async () => {
    if (renameTarget === undefined || renaming) return
    const name = renameName.trim()
    if (name.length === 0) {
      setRenameError(t('createDialogEmpty'))
      return
    }
    setRenaming(true)
    setRenameError(undefined)
    try {
      const entry = await renameAuthorizedEntry(renameTarget.path, name)
      entries.current.delete(renameTarget.path)
      entries.current.set(entry.path, entry)
      forgetExpandedKeys(renameTarget.path)
      const parent = parentPathOf(renameTarget.path)
      applyEntries(await requestAuthorizedEntries(parent), parent)
      setRenameTarget(undefined)
      setRenameName('')
    } catch (error: unknown) {
      setRenameError(renameErrorMessage(error, t))
    } finally {
      setRenaming(false)
    }
  }, [renameTarget, renameName, renaming, applyEntries, forgetExpandedKeys, t])

  /**
   * Popconfirm 确认后执行删除。
   *
   * 与旧 Modal 的差别只在于「确认」这一步由 Popconfirm 承担，删除本身与之后
   * 的本地清理完全一致。
   */
  const confirmDeleteFromContextMenu = useCallback(async () => {
    // 从 ref 取目标，而不是 `contextMenu` state。
    //
    // Popconfirm 的 `onConfirm` 触发时，与它同层的菜单节点可能已经因
    // `onCancel`/外部点击而卸载；此时闭包里的 `contextMenu` 已是 undefined，
    // 早期实现据此直接 return，删除**从未发出**——界面看起来「点了删除但没反应」。
    const target = deleteTargetRef.current
    // 这条日志是「删除到底有没有发出请求」的唯一判据：不打印说明参数/状态
    // 在进入前就断了，打印了但失败说明是宿主拒绝。
    console.info('[dsh-fnos][delete] confirm', { hasTarget: target !== undefined, path: target?.path })
    if (target === undefined) return
    deleteTargetRef.current = undefined
    setContextMenu(undefined)
    try {
      await deleteAuthorizedEntry(target.path)
      console.info('[dsh-fnos][delete] succeeded', { path: target.path })
      entries.current.delete(target.path)
      setTreeData(current => removeNode(current, target.path))
      setDesiredPaths(current => current?.filter(path => path !== target.path))
      forgetExpandedKeys(target.path)
      if (pendingInsertedOccurrences.current.size > 0) pendingRemovalPaths.current.add(target.path)
    } catch (error: unknown) {
      // 菜单已收起，用 toast 告知失败原因，不静默吞掉。
      console.warn('[dsh-fnos][delete] failed', {
        path: target.path,
        reason: error instanceof Error ? error.message : String(error),
      })
      Toast.error({ content: deleteErrorMessage(error, t) })
    }
  }, [contextMenu, forgetExpandedKeys, t])

  /** 提交新建：成功后把新条目并进当前层，避免整树重取导致已展开节点收起。 */
  const submitCreate = useCallback(async () => {
    if (createTarget === undefined || creating) return
    const name = createName.trim()
    if (name.length === 0) {
      setCreateError(t('createDialogEmpty'))
      return
    }
    setCreating(true)
    setCreateError(undefined)
    try {
      const entry = await createAuthorizedEntry(createTarget.parent, name, createTarget.kind)
      entries.current.set(entry.path, entry)
      setTreeData(current => updateChildren(
        current,
        createTarget.parent,
        [...(findChildren(current, createTarget.parent) ?? []), toTreeNode(entry, nodeLabel(entry))],
      ))
      setCreateTarget(undefined)
      setCreateName('')
    } catch (error: unknown) {
      setCreateError(createErrorMessage(error, t))
    } finally {
      setCreating(false)
    }
  }, [createTarget, createName, creating, t])

  /** Popconfirm 正文：说明删的是哪个条目，避免在树里认错行。 */
  const deleteConfirmContent = t('deleteDialogBody').replace(
    '{name}',
    displayName(contextMenu?.semanticPath ?? ''),
  )

  if (!open) return null

  return (
    <div
      ref={panelRef}
      className="dsh-fnos-path-panel"
      style={{ maxHeight }}
      role="dialog"
      aria-label={t('inputPickerTitle')}
    >
      {/* 玻璃磨砂背景层：与 DSH 指令面板同一套 material，单独一层承载
          backdrop-filter，避免把面板变成 fixed 后代的包含块。 */}
      <div aria-hidden="true" className="dsh-fnos-path-panel-material" />
      <div className="dsh-fnos-path-panel-header">
        <span className="dsh-fnos-path-panel-title">{t('inputPickerTitle')}</span>
        {/*
          授权入口：唤起 fnOS 原生选择器，用户在那里确认目录权限。

          文案改成**图标 + Tooltip**：标题行右侧的空间有限，一个「新增授权」文字
          按钮会把标题挤窄；而且它和旁边的关闭按钮是同一层级的头部动作，两个都是
          图标时才成组。说明文字放进 Tooltip，`aria-label` 保留同一个文案——
          图标按钮没有可见文字，缺了它读屏只会念「按钮」。

          用 DshTooltip 而不是原生 `title`：原生气泡是浏览器自绘的浅灰直角方块，
          与面板的玻璃磨砂浮层完全不是一套。
        */}
        <Tooltip content={t('authorizeNewDirectory')}>
          <button
            type="button"
            className="dsh-fnos-path-panel-new"
            aria-label={t('authorizeNewDirectory')}
            disabled={busy || authorizing}
            onClick={() => { void authorizeDirectory() }}
          >
            <IconPlus size="small" />
          </button>
        </Tooltip>
        <button
          type="button"
          className="dsh-fnos-path-panel-close"
          aria-label={t('inputPickerClose')}
          onClick={close}
        >
          <IconClose size="small" />
        </button>
      </div>
      {/* 容器挂 ref：App 端长按监听需要真实的 DOM 节点。 */}
      <div ref={treeRef} className="dsh-fnos-path-panel-tree-host">
      {/*
        **首次加载：居中的 loading，而不是先闪一帧缺省组件。**

        `treeData` 在拉取完成前是空数组，`Tree` 会立刻渲染 `emptyContent`——于是
        打开面板的瞬间先看到「当前没有可选择的授权文件或目录」，几十毫秒后才变成
        列表。那不是空状态，是还没加载完。

        加载中把树整体换成居中的 spinner：位置占满同一块区域，加载完成后是同位置
        替换，不跳动。
      */}
      {loadingRoots ? (
        <div className="dsh-fnos-path-panel-loading" aria-busy="true" aria-live="polite">
          <DshSpin size="middle" />
          <span className="dsh-fnos-visually-hidden">{t('loading')}</span>
        </div>
      ) : (
      <Tree
        aria-label={t('inputPickerTitle')}
        multiple
        checkRelation="unRelated"
        treeData={treeData}
        value={value}
        // 展开状态受控：面板收起时子树会卸载，交给 Semi 内部状态就丢了。
        expandedKeys={expandedKeys}
        onExpand={handleExpand}
        loadData={loadData}
        onChange={handleTreeChange}
        onContextMenu={handleContextMenu}
        disabled={busy}
        showLine={false}
        className="dsh-fnos-path-panel-tree"
        /*
          **没有数据用缺省组件，不用纯文案。**

          这是 Semi `Tree` 的 `emptyContent`，它接受 ReactNode，直接渲染在树的位置。
          原先是 `t('inputPickerEmpty')` 一行灰字——面板里其它空状态都有插画，只有
          这里是一句话，看起来像加载失败。
        */
        emptyContent={(
          <DshEmpty
            className="dsh-fnos-picker-empty"
            image={<FnosEmptyIllustration size={96} />}
            description={t('inputPickerEmpty')}
          />
        )}
      />
      )}
      </div>
      {/*
        右键上下文菜单。自己画：`position: fixed` 直接落在鼠标坐标上，与面板
        自身的滚动、偏移无关；外部点击与 Esc 的收起由上面的 effect 处理。
      */}
      {contextMenu === undefined ? null : createPortal(
        <div
          ref={menuRef}
          className="dsh-fnos-path-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          role="menu"
          aria-label={t('createFolder')}
        >
          {/*
            打开：目录交给 fnOS 文件管理器定位，文件交给 fnOS 的打开/预览能力。
            与新建/删除同为「对这一个条目做事」，因此排在菜单最前面。

            只在**宿主桥可用**时出现。独立浏览器页面里这些能力全都不存在，
            退而用 `openURL` 只能打开 fnOS 桌面首页，定位不到目标条目——用户
            点了却被丢回桌面，比没有这个入口更差。
          */}
          {SHOWS_FILE_MANAGER_ENTRY && (
            <button
              type="button"
              className="dsh-fnos-path-context-item"
              role="menuitem"
              onClick={() => { void openFromContextMenu() }}
            >
              {contextMenu.kind === 'directory' ? <IconFolderOpen size="small" /> : <IconFile size="small" />}
              {t('openEntry')}
            </button>
          )}
          {/*
            **只读项不给「重命名」「删除」。**

            应用共享目录（`@appshare` 等）由 fnOS 框架管理，宿主对它们返回
            409。与其让用户点了才看到失败提示，不如根本不展示这两项。
          */}
          {contextMenu.removable ? (
            <button
              type="button"
              className="dsh-fnos-path-context-item"
              role="menuitem"
              onClick={renameFromContextMenu}
            >
              <IconEdit size="small" />
              {t('renameEntry')}
            </button>
          ) : null}
          {/*
            **分割线只在上面真的有分组时出现。**

            它原本是无条件渲染的：只读项（应用共享目录）上既没有「重命名」也
            没有「删除」，线上方一个可点的项都没有——那根线既没有把什么分隔开，
            又靠自身的 `margin: 4px` 撑出一段多余高度。截图里菜单顶部那块空白
            就是它。

            跟随「重命名」一起出现后，菜单的上下留白与上方模块一致。
          */}
          {contextMenu.removable ? (
            <div className="dsh-fnos-path-context-separator" aria-hidden="true" />
          ) : null}
          {contextMenu.kind !== 'directory' ? null : (
            <>
              <button
                type="button"
                className="dsh-fnos-path-context-item"
                role="menuitem"
                onClick={() => { createFromContextMenu('directory') }}
              >
                <IconFolder size="small" />
                {t('createFolder')}
              </button>
              <button
                type="button"
                className="dsh-fnos-path-context-item"
                role="menuitem"
                onClick={() => { createFromContextMenu('file') }}
              >
                <IconFile size="small" />
                {t('createFile')}
              </button>
            </>
          )}
          {/*
            **复制原始路径：所有环境都有。**

            原先只在 App 端显示（理由是「移动端更需要把路径拿出来」），但桌面 web
            同样常要这份路径——贴进终端、脚本、issue。能力本身不依赖宿主桥，没有
            理由按环境隐藏。

            复制的是**真实绝对路径**（`/vol2/...`）而不是语义化名称
            （「存储空间 2/…」）：用户要的是能直接用的那串。

            位置放在删除**之前**：删除是破坏性操作，按惯例排在最后，且与上面几项
            隔着一条分隔线；把它夹在两个「新建」和「复制」中间容易误点。
          */}
          <button
            type="button"
            className="dsh-fnos-path-context-item"
            role="menuitem"
            onClick={() => { void copyFullPath() }}
          >
            <IconCopy size="small" />
            {t('copyFullPath')}
          </button>
          {/*
            删除用 Popconfirm 就地确认：比整块 Modal 轻，且不打断右键上下文。
            它的弹层由 Semi 默认 portal 到 body，不受面板 backdrop-filter 的
            包含块影响。

            同样只在可删项上出现。
          */}
          {contextMenu.removable ? (
          <Popconfirm
            /*
              **不传 `icon`：标题左侧那个黄色警告三角是 Semi 的默认图标。**

              删除这种「就地确认」的弹层本身已经有红字说明与明确的「删除」动词，
              再顶一个警告图标是重复强调；而且它把标题挤得偏离左沿，与插件里其它
              弹框（都只有纯文字标题）不一致。
            */
            icon={null}
            title={t('deleteDialogTitle')}
            content={deleteConfirmContent}
            okText={t('deleteDialogConfirm')}
            cancelText={t('createDialogCancel')}
            /*
              确定按钮**不用 danger 红**，与「新建文件夹」弹框的确认按钮同色。

              同一个面板里的确认动作应该长得一样；红色的语义是「这个按钮本身危险」，
              而这里的危险已经由标题与正文说清楚了。
            */
            okButtonProps={{ className: 'dsh-fnos-delete-confirm' }}
            position="left"
            onConfirm={() => { void confirmDeleteFromContextMenu() }}
            onCancel={() => { setContextMenu(undefined) }}
          >
            <button
              type="button"
              className="dsh-fnos-path-context-item is-danger"
              role="menuitem"
            >
              <IconDelete size="small" />
              {t('deleteEntry')}
            </button>
          </Popconfirm>
          ) : null}
        </div>,
        document.body,
      )}
      <Modal
        title={createTarget?.kind === 'file' ? t('createDialogFileTitle') : t('createDialogTitle')}
        visible={createTarget !== undefined}
        onCancel={() => { setCreateTarget(undefined) }}
        onOk={() => { void submitCreate() }}
        okText={t('createDialogConfirm')}
        cancelText={t('createDialogCancel')}
        confirmLoading={creating}
        centered
        width={454}
        className="dsh-fnos-create-dialog"
        okButtonProps={{ className: 'dsh-fnos-create-confirm' }}
        cancelButtonProps={{ className: 'dsh-fnos-create-cancel' }}
      >
        <div className="dsh-fnos-create-form">
          <label className="dsh-fnos-create-label" htmlFor="dsh-fnos-create-name">
            {createTarget?.kind === 'file' ? t('createDialogFileLabel') : t('createDialogFolderLabel')}
            <span className="dsh-fnos-create-required" aria-hidden="true">*</span>
          </label>
          <Input
            id="dsh-fnos-create-name"
            autoFocus
            // 占位文案与标题一致（fnOS 原生弹框就是这样：新建文件夹 / 新建文件）。
            placeholder={createTarget?.kind === 'file' ? t('createDialogFileTitle') : t('createDialogTitle')}
            value={createName}
            onChange={(value: string) => { setCreateName(value) }}
            onEnterPress={() => { void submitCreate() }}
            {...(createError === undefined ? {} : { validateStatus: 'error' as const })}
          />
          {/* 常驻说明行会让弹框比 fnOS 的高出一行，这里只在出错时出现；
              名称规则并进错误文案本身（见 createDialogInvalid）。 */}
          {createError === undefined ? null : <p className="dsh-fnos-create-error">{createError}</p>}
        </div>
      </Modal>
      {/* 重命名沿用同一套弹框样式与校验反馈，只是标题与初值不同。 */}
      <Modal
        title={t('renameDialogTitle')}
        visible={renameTarget !== undefined}
        onCancel={() => { setRenameTarget(undefined) }}
        onOk={() => { void submitRename() }}
        okText={t('createDialogConfirm')}
        cancelText={t('createDialogCancel')}
        confirmLoading={renaming}
        centered
        width={454}
        className="dsh-fnos-create-dialog"
        okButtonProps={{ className: 'dsh-fnos-create-confirm' }}
        cancelButtonProps={{ className: 'dsh-fnos-create-cancel' }}
      >
        <div className="dsh-fnos-create-form">
          <label className="dsh-fnos-create-label" htmlFor="dsh-fnos-rename-name">
            {renameTarget?.kind === 'file' ? t('createDialogFileLabel') : t('createDialogFolderLabel')}
            <span className="dsh-fnos-create-required" aria-hidden="true">*</span>
          </label>
          <Input
            id="dsh-fnos-rename-name"
            autoFocus
            // 清空后仍能看到原名字，便于对照着改。
            placeholder={displayName(renameTarget?.semanticPath ?? '')}
            value={renameName}
            onChange={(value: string) => { setRenameName(value) }}
            onEnterPress={() => { void submitRename() }}
            {...(renameError === undefined ? {} : { validateStatus: 'error' as const })}
          />
          {renameError === undefined ? null : <p className="dsh-fnos-create-error">{renameError}</p>}
        </div>
      </Modal>
    </div>
  )
}
