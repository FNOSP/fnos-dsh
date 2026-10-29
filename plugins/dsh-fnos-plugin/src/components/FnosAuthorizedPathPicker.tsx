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

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InputState } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { useAnchoredMaxHeight } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  DshIconClose as IconClose,
  DshIconDelete as IconDelete,
  DshIconFile as IconFile,
  DshIconPlus as IconPlus,
  DshIconFolder as IconFolder,
  DshInput as Input,
  DshModal as Modal,
  DshPopconfirm as Popconfirm,
  DshToast as Toast,
  DshTree as Tree,
  DshTypography as Typography,
} from '@tnnevol/dsh-semi-ui'
import { createAuthorizedEntry, deleteAuthorizedEntry, requestAuthorizedEntries, requestPersistAuthorizedDirectories, type AuthorizedEntriesResult } from '../client/services/authorized-directories-client.ts'
import { pickAuthorizedDirectory } from '../client/services/authorized-directory-picker.ts'
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
function clampMenuPosition(x: number, y: number): { x: number, y: number } {
  if (typeof window === 'undefined') return { x, y }
  const MENU_WIDTH = 148
  const MENU_HEIGHT = 84
  const margin = 8
  return {
    x: Math.max(margin, Math.min(x, window.innerWidth - MENU_WIDTH - margin)),
    y: Math.max(margin, Math.min(y, window.innerHeight - MENU_HEIGHT - margin)),
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
  // 右键上下文菜单：命中的条目与鼠标坐标（菜单定位）。
  const [contextMenu, setContextMenu] = useState<{
    path: string
    semanticPath: string
    kind: AuthorizedCreateKind
    x: number
    y: number
  } | undefined>()
  const menuRef = useRef<HTMLDivElement>(null)

  const applyEntries = useCallback((result: AuthorizedEntriesResult, parent?: string) => {
    for (const entry of result.entries) entries.current.set(entry.path, entry)
    const children = result.entries.map(entry => toTreeNode(entry, nodeLabel(entry)))
    setTreeData(current => parent === undefined
      ? result.entries.map(entry => toTreeNode(entry, nodeLabel(entry, true)))
      : updateChildren(current, parent, children))
  }, [])

  useEffect(() => {
    let cancelled = false
    void requestAuthorizedEntries().then(result => {
      if (!cancelled) applyEntries(result)
    }).catch(() => {
      if (!cancelled) setTreeData([])
    })
    return () => { cancelled = true }
  }, [applyEntries])

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
  // 面板消失」。删除确认曾漏过，症状与新建弹框那次完全相同。
  const floatingOpen = createTarget !== undefined || contextMenu !== undefined

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
    setAuthorizing(true)
    try {
      const outcome = await pickAuthorizedDirectory({
        title: t('authorizeDirectory'),
        okText: t('inputPickerConfirm'),
      })
      if (outcome.status === 'cancelled') return
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
    const position = clampMenuPosition(event.clientX ?? 0, event.clientY ?? 0)
    setContextMenu({ path: entry.path, semanticPath: entry.semanticPath, kind: entry.kind, x: position.x, y: position.y })
  }, [])

  // 菜单打开期间：点击菜单之外或按 Esc 收起（与系统右键菜单一致）。
  // 用捕获阶段，保证菜单项自己的 click 之前不会先被其它监听吞掉。
  useEffect(() => {
    if (contextMenu === undefined) return
    const onPointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Node)) return
      if (menuRef.current?.contains(event.target) === true) return
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
   * Popconfirm 确认后执行删除。
   *
   * 与旧 Modal 的差别只在于「确认」这一步由 Popconfirm 承担，删除本身与之后
   * 的本地清理完全一致。
   */
  const confirmDeleteFromContextMenu = useCallback(async () => {
    const target = contextMenu
    if (target === undefined) return
    setContextMenu(undefined)
    try {
      await deleteAuthorizedEntry(target.path)
      entries.current.delete(target.path)
      setTreeData(current => removeNode(current, target.path))
      setDesiredPaths(current => current?.filter(path => path !== target.path))
      if (pendingInsertedOccurrences.current.size > 0) pendingRemovalPaths.current.add(target.path)
    } catch (error: unknown) {
      // 菜单已收起，用 toast 告知失败原因，不静默吞掉。
      Toast.error({ content: deleteErrorMessage(error, t) })
    }
  }, [contextMenu, t])

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
      <div className="dsh-fnos-path-panel-header">
        <span className="dsh-fnos-path-panel-title">{t('inputPickerTitle')}</span>
        {/* 授权入口：唤起 fnOS 原生选择器，用户在那里确认目录权限。 */}
        <button
          type="button"
          className="dsh-fnos-path-panel-action"
          aria-label={t('authorizeDirectory')}
          title={t('authorizeDirectory')}
          disabled={busy || authorizing}
          onClick={() => { void authorizeDirectory() }}
        >
          <IconPlus size="small" />
        </button>
        <button
          type="button"
          className="dsh-fnos-path-panel-close"
          aria-label={t('inputPickerClose')}
          title={t('inputPickerClose')}
          onClick={close}
        >
          <IconClose size="small" />
        </button>
      </div>
      <Tree
        aria-label={t('inputPickerTitle')}
        multiple
        checkRelation="unRelated"
        treeData={treeData}
        value={value}
        loadData={loadData}
        onChange={handleTreeChange}
        onContextMenu={handleContextMenu}
        disabled={busy}
        showLine={false}
        className="dsh-fnos-path-panel-tree"
        emptyContent={t('inputPickerEmpty')}
      />
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
            删除用 Popconfirm 就地确认：比整块 Modal 轻，且不打断右键上下文。
            它的弹层由 Semi 默认 portal 到 body，不受面板 backdrop-filter 的
            包含块影响。
          */}
          <Popconfirm
            title={t('deleteDialogTitle')}
            content={deleteConfirmContent}
            okText={t('deleteDialogConfirm')}
            cancelText={t('createDialogCancel')}
            okButtonProps={{ type: 'danger' }}
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
        width={420}
      >
        <div className="dsh-fnos-create-form">
          <label className="dsh-fnos-create-label" htmlFor="dsh-fnos-create-name">{t('createDialogLabel')}</label>
          <Input
            id="dsh-fnos-create-name"
            autoFocus
            value={createName}
            onChange={(value: string) => { setCreateName(value) }}
            onEnterPress={() => { void submitCreate() }}
            {...(createError === undefined ? {} : { validateStatus: 'error' as const })}
          />
          <p className={createError === undefined ? 'dsh-fnos-create-hint' : 'dsh-fnos-create-error'}>
            {createError ?? t('createDialogHint')}
          </p>
        </div>
      </Modal>
    </div>
  )
}
