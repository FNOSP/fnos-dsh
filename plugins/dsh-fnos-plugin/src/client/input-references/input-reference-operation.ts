/** Current-open fnOS picker occurrence reconciliation. */

import { fnosOccurrenceDetectSpan } from './input-reference-actions.ts'
import { decodeFnosReference, FNOS_REFERENCE_SOURCE } from './input-references.ts'

export interface InputOccurrenceIdentity {
  occurrenceId: number
  source: string
  ref: string
}

export interface PendingFnosOccurrence {
  path: string
  ref: string
  trailingSeparator: boolean
}

export interface TrackedFnosOccurrence extends PendingFnosOccurrence {}

export interface FnosOperationReconcileInput {
  baselineOccurrenceIds: ReadonlySet<number>
  pendingOccurrences: ReadonlyMap<string, PendingFnosOccurrence>
  trackedOccurrences: ReadonlyMap<number, TrackedFnosOccurrence>
  occurrences: readonly InputOccurrenceIdentity[]
  pendingRemovalPaths?: ReadonlySet<string>
}

export interface FnosOperationReconcileResult {
  pendingOccurrences: Map<string, PendingFnosOccurrence>
  trackedOccurrences: Map<number, TrackedFnosOccurrence>
  removedPaths: Set<string>
}

/**
 * Match newly minted DSH occurrence IDs to this picker opening only. Historical
 * references are excluded by the baseline, including references to the same path.
 */
export function reconcileFnosOperationOccurrences({
  baselineOccurrenceIds,
  pendingOccurrences,
  trackedOccurrences,
  occurrences,
  pendingRemovalPaths = new Set(),
}: FnosOperationReconcileInput): FnosOperationReconcileResult {
  const nextPending = new Map(pendingOccurrences)
  const nextTracked = new Map(trackedOccurrences)
  const currentIds = new Set(occurrences.map(item => item.occurrenceId))

  for (const occurrence of occurrences) {
    if (occurrence.source !== FNOS_REFERENCE_SOURCE
      || baselineOccurrenceIds.has(occurrence.occurrenceId)
      || nextTracked.has(occurrence.occurrenceId)) continue
    const decoded = decodeFnosReference(occurrence.ref)
    if (decoded === undefined) continue
    const pending = [...nextPending.entries()].find(([, item]) => item.ref === occurrence.ref)
    if (pending === undefined) continue
    nextPending.delete(pending[0])
    nextTracked.set(occurrence.occurrenceId, pending[1])
  }

  const removedPaths = new Set<string>()
  for (const [occurrenceId, tracked] of nextTracked) {
    if (currentIds.has(occurrenceId)) continue
    nextTracked.delete(occurrenceId)
    if (!pendingRemovalPaths.has(tracked.path)) removedPaths.add(tracked.path)
  }

  return { pendingOccurrences: nextPending, trackedOccurrences: nextTracked, removedPaths }
}

export interface FnosRemovalIdentity extends InputOccurrenceIdentity {
  readonly offset: number
  readonly length: number
}

export interface FnosRemovalInput {
  /** 剪贴板投影的整篇草稿。 */
  draft: string
  /** 全部来源的引用，必须完整：跨度换算依赖该引用之前的所有引用。 */
  occurrences: readonly FnosRemovalIdentity[]
  trackedOccurrences: ReadonlyMap<number, TrackedFnosOccurrence>
  /** 本次用户取消勾选的路径。 */
  pendingRemovalPaths: ReadonlySet<string>
}

export interface FnosRemovalStep {
  readonly occurrenceId: number
  readonly path: string
  /** detect 投影中该引用的原子跨度。 */
  readonly span: { readonly start: number, readonly end: number }
}

/**
 * 只为「被取消勾选的路径」生成删除步骤，父子互不牵连。
 *
 * 每个步骤只覆盖一个 chip 自身的原子跨度；勾选解耦由此保证：任何不属于
 * `pendingRemovalPaths` 的引用都不会进入计划，因而不会被连带删除。
 * 步骤按偏移倒序，逐个执行时前面的跨度仍然有效。
 */
export function planFnosOccurrenceRemovals({
  draft,
  occurrences,
  trackedOccurrences,
  pendingRemovalPaths,
}: FnosRemovalInput): FnosRemovalStep[] {
  return occurrences
    .flatMap(occurrence => {
      if (occurrence.source !== FNOS_REFERENCE_SOURCE) return []
      const tracked = trackedOccurrences.get(occurrence.occurrenceId)
      if (tracked === undefined || !pendingRemovalPaths.has(tracked.path)) return []
      return [{
        occurrenceId: occurrence.occurrenceId,
        path: tracked.path,
        span: fnosOccurrenceDetectSpan(draft, occurrence, occurrences, {
          removeTrailingSeparator: tracked.trailingSeparator,
        }),
      }]
    })
    .sort((left, right) => right.span.start - left.span.start)
}
