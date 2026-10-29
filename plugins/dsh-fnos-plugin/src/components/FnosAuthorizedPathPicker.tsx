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
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InputState } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { useAnchoredMaxHeight } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  DshDropdown as Dropdown,
  DshIconClose as IconClose,
  DshIconFile as IconFile,
  DshIconFolder as IconFolder,
  DshIconPlus as IconPlus,
  DshInput as Input,
  DshModal as Modal,
  DshTooltip as Tooltip,
  DshTree as Tree,
} from '@tnnevol/dsh-semi-ui'
import { createAuthorizedEntry, requestAuthorizedEntries, type AuthorizedEntriesResult } from '../client/services/authorized-directories-client.ts'
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
 * 只在文本真的被省略时才挂气泡提示。
 *
 * 做法与上游 `ui-primitives/CommandText` 一致：量 `scrollWidth > clientWidth`，
 * 并用 `ResizeObserver` 跟随面板宽度变化重测。名字放得下时不渲染 Tooltip，
 * 避免「没截断也弹出提示」的噪音。
 */
function NodeLabelText({ text, fullPath }: { text: string, fullPath: string }) {
  const textRef = useRef<HTMLSpanElement>(null)
  const [truncated, setTruncated] = useState(false)

  useLayoutEffect(() => {
    const element = textRef.current
    if (element === null) return undefined
    const measure = (): void => { setTruncated(element.scrollWidth > element.clientWidth + 1) }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    observer?.observe(element)
    const fonts = 'fonts' in element.ownerDocument ? element.ownerDocument.fonts : undefined
    fonts?.addEventListener('loadingdone', measure)
    return () => {
      observer?.disconnect()
      fonts?.removeEventListener('loadingdone', measure)
    }
  }, [text])

  const content = <span ref={textRef} className="dsh-fnos-tree-node-label-text">{text}</span>
  return truncated
    ? <Tooltip content={fullPath} showArrow mouseEnterDelay={0.5}>{content}</Tooltip>
    : content
}

function nodeLabel(entry: AuthorizedEntry, showFullPath = false): ReactNode {
  const name = showFullPath ? entry.semanticPath : displayName(entry.semanticPath)
  const Icon = entry.kind === 'directory' ? IconFolder : IconFile
  return (
    <span className="dsh-fnos-tree-node-label">
      <Icon size="small" />
      <NodeLabelText text={name} fullPath={entry.semanticPath} />
    </span>
  )
}

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

  // 点击输入卡片之外收起。卡片内部（含面板自身与文本域）不关闭：用户点回
  // 草稿继续输入时，选择器不该被顺手关掉。与上游斜杠菜单同一策略。
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Node)) return
      if (panelRef.current?.contains(event.target) === true) return
      const card = panelRef.current?.closest('[data-composer-card]')
      if (card?.contains(event.target) === true) return
      close()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => { document.removeEventListener('pointerdown', onPointerDown, true) }
  }, [open, close])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [open, close])

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

  /** 右键命中一个目录：打开新建弹框。命中文件时不提供新建（文件下无法再建条目）。 */
  const handleContextMenu = useCallback((event: { preventDefault: () => void }, node: unknown) => {
    const key = typeof node === 'object' && node !== null && 'key' in node && typeof node.key === 'string'
      ? node.key
      : undefined
    if (key === undefined) return
    const entry = entries.current.get(key)
    if (entry !== undefined && entry.kind !== 'directory') return
    event.preventDefault()
    setCreateError(undefined)
    setCreateName('')
    setCreateTarget({ parent: key, kind: 'directory' })
  }, [])

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

  /**
   * 打开新建弹框。
   *
   * 不传 `parent` 时（工具栏按钮）落在「当前勾选的第一个目录」上；没有勾选就
   * 用第一个根目录。这样按钮与右键两条入口共用同一份提交逻辑，只有父目录
   * 来源不同。
   */
  const openCreateDialog = useCallback((kind: AuthorizedCreateKind, parent?: string) => {
    const fallback = parent
      ?? value.find(path => entries.current.get(path)?.kind === 'directory')
      ?? treeData.find(node => entries.current.get(node.key)?.kind !== 'file')?.key
    if (fallback === undefined) return
    setCreateError(undefined)
    setCreateName('')
    setCreateTarget({ parent: fallback, kind })
  }, [value, treeData])

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
        {/* 新建入口：工具栏按钮建在选中的目录（无选中则第一个根），右键可指定目录。 */}
        <Dropdown
          trigger="click"
          position="bottomRight"
          clickToHide
          render={(
            <Dropdown.Menu>
              <Dropdown.Item onClick={() => { openCreateDialog('directory') }}>{t('createFolder')}</Dropdown.Item>
              <Dropdown.Item onClick={() => { openCreateDialog('file') }}>{t('createFile')}</Dropdown.Item>
            </Dropdown.Menu>
          )}
        >
          <button
            type="button"
            className="dsh-fnos-path-panel-action"
            aria-label={t('createFolder')}
            title={t('createFolder')}
            disabled={busy}
          >
            <IconPlus size="small" />
          </button>
        </Dropdown>
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
