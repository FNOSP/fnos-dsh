/** Compact fnOS-authorized tree selector used by the DSH input toolbar. */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InputActions, InputState } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { DshIconFile as IconFile, DshIconFolder as IconFolder, DshTooltip as Tooltip, DshTreeSelect as TreeSelect } from '@tnnevol/dsh-semi-ui'
import { requestAuthorizedEntries, type AuthorizedEntriesResult } from '../client/services/authorized-directories-client.ts'
import { FnosColorLogo } from './FnosLogo.tsx'
import { FNOS_REFERENCE_SOURCE, type FnosInputReference, createFnosInputReference } from '../client/input-references/input-references.ts'
import { planFnosOccurrenceRemovals, reconcileFnosOperationOccurrences, type PendingFnosOccurrence, type TrackedFnosOccurrence } from '../client/input-references/input-reference-operation.ts'
import type { AuthorizedEntry } from '../contracts/authorized-directories-contract.ts'

type InputSelector = <S>(
  selector: (state: InputState) => S,
  equality?: (left: S, right: S) => boolean,
) => S

type InputProps = {
  useInput: InputSelector
  inputActions: InputActions
} & PropsLocale<'settings.dsh-fnos'>

interface TreeNode {
  key: string
  value: string
  label: ReactNode
  isLeaf: boolean
  children?: TreeNode[]
}

const EMPTY_TREE_VALUE: string[] = []

function displayName(value: string): string {
  const parts = value.split('/').filter(Boolean)
  return parts.at(-1) ?? value
}

function nodeLabel(entry: AuthorizedEntry, showFullPath = false): ReactNode {
  const name = showFullPath ? entry.semanticPath : displayName(entry.semanticPath)
  const Icon = entry.kind === 'directory' ? IconFolder : IconFile
  const content = (
    <span className="dsh-fnos-tree-node-label">
      <Icon size="small" />
      <span className="dsh-fnos-tree-node-label-text">{name}</span>
    </span>
  )
  return <Tooltip content={entry.semanticPath} showArrow mouseEnterDelay={0.5}>{content}</Tooltip>
}

function toNode(entry: AuthorizedEntry, showFullPath = false): TreeNode {
  return {
    key: entry.path,
    value: entry.path,
    label: nodeLabel(entry, showFullPath),
    isLeaf: entry.kind === 'file',
  }
}

function updateChildren(nodes: readonly TreeNode[], key: string, children: TreeNode[]): TreeNode[] {
  return nodes.map(node => {
    if (node.key === key) return { ...node, children, isLeaf: false }
    if (node.children === undefined) return node
    return { ...node, children: updateChildren(node.children, key, children) }
  })
}

/**
 * Keep every checked path so a parent and child can both be selected.
 */
function selectedPaths(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]
  const paths = [...new Set(values.flatMap(item => typeof item === 'string' && item.startsWith('/') ? [item] : []))]
  return paths
}

export type FnosAuthorizedPathPickerProps = InputProps & {
  insertReferences: (input: { draft: string, draftRev: number, occurrences?: readonly { readonly length: number }[] }, references: readonly FnosInputReference[]) => readonly FnosInputReference[]
}

/** Selection is immediate; closing the TreeSelect never discards a choice. */
export function FnosAuthorizedPathPicker({ useInput, inputActions, insertReferences, t }: FnosAuthorizedPathPickerProps) {
  const input = useInput((state: InputState) => state)
  const [treeData, setTreeData] = useState<TreeNode[]>([])
  const [desiredPaths, setDesiredPaths] = useState<string[] | undefined>()
  const entries = useRef(new Map<string, AuthorizedEntry>())
  const operationBaselineOccurrenceIds = useRef(new Set<number>())
  const insertedTreePaths = useRef(new Set<string>())
  const pendingInsertedOccurrences = useRef(new Map<string, PendingFnosOccurrence>())
  const currentOperationOccurrences = useRef(new Map<number, TrackedFnosOccurrence>())
  const pendingRemovalPaths = useRef(new Set<string>())
  const busy = input.phase === 'adjudicating' || input.phase === 'submitting'
  const value = desiredPaths ?? EMPTY_TREE_VALUE
  const applyEntries = useCallback((result: AuthorizedEntriesResult, parent?: string) => {
    for (const entry of result.entries) entries.current.set(entry.path, entry)
    const children = result.entries.map(entry => toNode(entry))
    setTreeData(current => parent === undefined
      ? result.entries.map(entry => toNode(entry, true))
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
        // The picker inserts at the end of the draft, so DSH owns the gap.
        trailingSeparator: true,
      })
    }
  }, [input.draft, input.draftRev, input.occurrences, insertReferences])

  useEffect(() => {
    if (desiredPaths === undefined) return
    // Async-loaded children may not be present in entries.current during the
    // selection event. Retry when treeData or the input snapshot changes.
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

  const handleTreeChange = useCallback((next: unknown) => {
    const nextPaths = selectedPaths(next)
    for (const path of insertedTreePaths.current) {
      if (!nextPaths.includes(path)) {
        insertedTreePaths.current.delete(path)
        pendingRemovalPaths.current.add(path)
      }
    }
    setDesiredPaths(nextPaths)
    // Commit a batch in the same event that produced it. This preserves every
    // selected path even if Semi closes the dropdown before React effects run.
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

  // Keep every selected path independent. Semi's related mode collapses
  // parent/child keys and prevents selecting both a directory and its child.
  return (
    <TreeSelect
      aria-label={t('inputPicker')}
      multiple
      checkRelation="unRelated"
      treeData={treeData}
      value={value}
      loadData={loadData}
      dropdownClassName="dsh-fnos-authorized-path-picker"
      onVisibleChange={(visible: boolean) => {
        if (visible) {
          operationBaselineOccurrenceIds.current = new Set(
            input.occurrences
              .filter(occurrence => occurrence.source === FNOS_REFERENCE_SOURCE)
              .map(occurrence => occurrence.occurrenceId),
          )
          insertedTreePaths.current.clear()
          pendingInsertedOccurrences.current.clear()
          currentOperationOccurrences.current.clear()
          pendingRemovalPaths.current.clear()
          setDesiredPaths(EMPTY_TREE_VALUE)
          return
        }
        operationBaselineOccurrenceIds.current.clear()
        insertedTreePaths.current.clear()
        pendingInsertedOccurrences.current.clear()
        currentOperationOccurrences.current.clear()
        pendingRemovalPaths.current.clear()
        setDesiredPaths(undefined)
      }}
      onChange={handleTreeChange}
      disabled={busy}
      size="small"
      borderless
      showClear={false}
      maxTagCount={0}
      dropdownMatchSelectWidth={false}
      showLine={false}
      emptyContent={t('inputPickerEmpty')}
      searchPlaceholder={t('workspaceSearchPlaceholder')}
      placeholder=""
      prefix={null}
      triggerRender={() => (
        <span
          aria-label={t('inputPicker')}
          title={t('inputPicker')}
          className={`dsh-fnos-input-picker-trigger${busy ? ' is-busy' : ''}`}
        >
          <FnosColorLogo size={17} />
        </span>
      )}
      className="dsh-fnos-input-picker"
    />
  )
}
