import { describe, expect, it } from 'vitest'
import { fnosInsertionPrefix, fnosOccurrenceDetectSpan, fnosReferenceDraftText, insertFnosReferences } from '../../src/client/input-references/input-reference-actions.ts'
import { reconcileFnosOperationOccurrences, planFnosOccurrenceRemovals, type FnosRemovalIdentity, type TrackedFnosOccurrence } from '../../src/client/input-references/input-reference-operation.ts'
import { createFnosInputReference, FNOS_REFERENCE_SOURCE, fnosReferenceId } from '../../src/client/input-references/input-references.ts'
import type { Context as ClientContext } from '@deepseek-ai/cordis'

describe('fnOS reference insertion spacing', () => {
  it('adds a separator only when existing text touches the insertion point', () => {
    expect(fnosInsertionPrefix('hello')).toBe(' ')
    expect(fnosInsertionPrefix('hello ')).toBe('')
    expect(fnosInsertionPrefix('hello\n')).toBe('')
    expect(fnosInsertionPrefix('')).toBe('')
  })

  it('folds one clipboard-projection occurrence onto its detect span', () => {
    // draft 是剪贴板投影，chip 展开成 clipboardText；detect 投影里每个 chip 只占一个字符。
    const parent = '/vol4/Documents'
    const child = '/vol4/report.md'
    const clip = (p: string): string => `file://${p}`
    const parentLength = clip(parent).length
    const draft = `${clip(parent)} ${clip(child)} `
    const parentOcc = { offset: 0, length: parentLength }
    const childOcc = { offset: parentLength + 1, length: clip(child).length }
    // 第一个引用前面没有别的引用，跨度就是 [0, 2)：chip 自身 + DSH 补的分隔空格。
    expect(fnosOccurrenceDetectSpan(draft, parentOcc, [parentOcc, childOcc])).toEqual({ start: 0, end: 2 })
    // 子项前有父目录，偏移要减去父目录标签多出来的长度。
    expect(fnosOccurrenceDetectSpan(draft, childOcc, [parentOcc, childOcc])).toEqual({ start: 2, end: 4 })
  })

  it('drops the generated trailing separator only when one is actually there', () => {
    const first = 'file:///a'
    const second = 'file:///b'
    const draft = `${first} ${second}`
    const occurrences = [
      { offset: 0, length: first.length },
      { offset: first.length + 1, length: second.length },
    ]
    expect(fnosOccurrenceDetectSpan(draft, occurrences[0]!, occurrences)).toEqual({ start: 0, end: 2 })
    expect(fnosOccurrenceDetectSpan(draft, occurrences[0]!, occurrences, { removeTrailingSeparator: false }))
      .toEqual({ start: 0, end: 1 })
    // 末尾没有分隔空格时不能多吃一个字符。
    expect(fnosOccurrenceDetectSpan(first, { offset: 0, length: first.length }, []))
      .toEqual({ start: 0, end: 1 })
  })

  it('counts every earlier reference, not only fnOS-owned ones', () => {
    // 前一个 chip 属于别的来源（例如 skill），但展开后同样占据剪贴板宽度。
    const foreignText = '/skill-name'
    const targetText = 'file:///vol4/a'
    const draft = `${foreignText} ${targetText} file:///vol4/b`
    const foreign = { offset: 0, length: foreignText.length }
    const target = { offset: foreignText.length + 1, length: targetText.length }
    expect(fnosOccurrenceDetectSpan(draft, target, [foreign, target])).toEqual({ start: 2, end: 4 })
  })

  it('uses DSH reference draft text instead of the clipboard projection for offsets', () => {
    expect(fnosReferenceDraftText('Documents')).toBe('\uFFFC')
  })

  it('uses the returned insertions and DSH draft offsets for a multi-selection', () => {
    const calls: Array<{ event: string, payload: any }> = []
    const ctx = {
      sessions: {
        scope: () => ({
          bail: (_ctx: unknown, event: string, payload: any) => {
            calls.push({ event, payload })
            return true
          },
        }),
      },
    } as unknown as ClientContext
    const first = createFnosInputReference('directory', '/vol4/Documents', 'Documents')!
    const second = createFnosInputReference('file', '/vol4/report.md', 'report.md')!

    const inserted = insertFnosReferences(ctx, 'session' as never, [first, second], {
      draft: 'hello',
      draftRev: 4,
    })

    expect(inserted).toEqual([first, second])
    expect(calls.map(call => call.event)).toEqual([
      'slash/input-insert-text',
      'slash/input-insert-reference',
      'slash/input-insert-reference',
    ])
    expect(calls[1]?.payload.span).toEqual({ start: 6, end: 6, draftRev: 5 })
    expect(calls[2]?.payload.span).toEqual({ start: 8, end: 8, draftRev: 6 })
    expect(calls[1]?.payload.reference.label).toBe('Documents')
    expect(calls[2]?.payload.reference.label).toBe('report.md')
  })

  it('uses detect offsets when the draft already contains an expanded chip', () => {
    const calls: Array<{ event: string, payload: any }> = []
    const ctx = {
      sessions: {
        scope: () => ({
          bail: (_ctx: unknown, event: string, payload: any) => {
            calls.push({ event, payload })
            return true
          },
        }),
      },
    } as unknown as ClientContext
    const first = createFnosInputReference('directory', '/vol4/Documents', 'Documents')!

    const inserted = insertFnosReferences(ctx, 'session' as never, [first], {
      draft: '已有 @previous 内容',
      draftRev: 9,
      occurrences: [{ length: 9 }],
    })

    expect(inserted).toEqual([first])
    expect(calls.at(-1)?.payload.span).toEqual({ start: 8, end: 8, draftRev: 10 })
  })
})

describe('fnOS picker operation occurrence identity', () => {
  const path = '/vol4/1000/Documents'
  const historical = { occurrenceId: 1, source: FNOS_REFERENCE_SOURCE, ref: fnosReferenceId('directory', path) }
  const current = { occurrenceId: 2, source: FNOS_REFERENCE_SOURCE, ref: fnosReferenceId('directory', path) }
  const pending = { path, ref: current.ref, trailingSeparator: true }

  it('tracks only a newly inserted occurrence even when the path already existed', () => {
    const result = reconcileFnosOperationOccurrences({
      baselineOccurrenceIds: new Set([historical.occurrenceId]),
      pendingOccurrences: new Map([[pending.ref, pending]]),
      trackedOccurrences: new Map(),
      occurrences: [historical, current],
    })
    expect([...result.trackedOccurrences]).toEqual([[2, pending]])
    expect(result.pendingOccurrences.size).toBe(0)
  })

  it('reports a current-operation deletion without treating history as its replacement', () => {
    const result = reconcileFnosOperationOccurrences({
      baselineOccurrenceIds: new Set([historical.occurrenceId]),
      pendingOccurrences: new Map(),
      trackedOccurrences: new Map([[current.occurrenceId, pending]]),
      occurrences: [historical],
    })
    expect([...result.removedPaths]).toEqual([path])
    expect(result.trackedOccurrences.size).toBe(0)
  })

  it('does not reverse-sync a removal initiated by unchecking the tree', () => {
    const result = reconcileFnosOperationOccurrences({
      baselineOccurrenceIds: new Set(),
      pendingOccurrences: new Map(),
      trackedOccurrences: new Map([[current.occurrenceId, pending]]),
      occurrences: [],
      pendingRemovalPaths: new Set([path]),
    })
    expect(result.removedPaths.size).toBe(0)
  })
})

interface Scenario {
  /** 剪贴板投影：每个引用展开成 clipboardText，DSH 插入时补一个分隔空格。 */
  draft: string
  occurrences: FnosRemovalIdentity[]
  tracked: Map<number, TrackedFnosOccurrence>
}

/** 按 勾选顺序 拼出选择树场景：每个 path 一个 chip。 */
function scenario(paths: readonly { path: string, kind: 'file' | 'directory' }[]): Scenario {
  const parts: string[] = []
  const occurrences: FnosRemovalIdentity[] = []
  const tracked = new Map<number, TrackedFnosOccurrence>()
  let offset = 0
  paths.forEach((item, index) => {
    const reference = createFnosInputReference(item.kind, item.path, item.path)!
    const occurrenceId = index + 1
    occurrences.push({
      occurrenceId,
      source: FNOS_REFERENCE_SOURCE,
      ref: reference.ref,
      offset,
      length: reference.clipboardText.length,
    })
    tracked.set(occurrenceId, { path: item.path, ref: reference.ref, trailingSeparator: true })
    parts.push(reference.clipboardText)
    offset += reference.clipboardText.length + 1
  })
  return { draft: parts.length === 0 ? '' : `${parts.join(' ')} `, occurrences, tracked }
}

/** 执行删除计划，返回仍留在输入框里的路径（即哪些 chip 真的被删掉了）。 */
function removedPathsOf(base: Scenario, uncheck: readonly string[]): string[] {
  const steps = planFnosOccurrenceRemovals({
    draft: base.draft,
    occurrences: base.occurrences,
    trackedOccurrences: base.tracked,
    pendingRemovalPaths: new Set(uncheck),
  })
  return steps.map(step => step.path)
}

const PARENT = { path: '/vol4/1000/Documents', kind: 'directory' as const }
const CHILD = { path: '/vol4/1000/Documents/report.md', kind: 'file' as const }
const GRANDCHILD = { path: '/vol4/1000/Documents/2026/detail.md', kind: 'file' as const }

/**
 * FNOS-009-11 归属的 TC-001…TC-005：父子勾选必须完全解耦。
 *
 * 判定点落在 planFnosOccurrenceRemovals 上：它按「被取消勾选的路径」逐个生成
 * 原子删除步骤，未取消的引用永远不进计划，因此父子的勾选状态不可能互相牵连。
 */
describe('fnOS picker parent/child decoupling', () => {
  it('TC-001 取消父目录只移除父目录引用，子项保留', () => {
    const base = scenario([PARENT, CHILD])
    expect(removedPathsOf(base, [PARENT.path])).toEqual([PARENT.path])
  })

  it('TC-002 先选子项再选父目录，取消父目录时子项状态不变', () => {
    const base = scenario([CHILD, PARENT])
    expect(removedPathsOf(base, [PARENT.path])).toEqual([PARENT.path])
  })

  it('TC-003 取消子项不影响父目录', () => {
    const base = scenario([PARENT, CHILD])
    expect(removedPathsOf(base, [CHILD.path])).toEqual([CHILD.path])
  })

  it('TC-004 重复勾选/取消始终只影响被取消的那一项', () => {
    const base = scenario([PARENT, CHILD])
    // 同一场景反复取消父目录、再取消子项，两次都只命中自己。
    expect(removedPathsOf(base, [PARENT.path])).toEqual([PARENT.path])
    expect(removedPathsOf(base, [CHILD.path])).toEqual([CHILD.path])
    // 同时取消两项时也只删这两项，且不会重复生成步骤。
    expect(removedPathsOf(base, [PARENT.path, CHILD.path]).sort())
      .toEqual([CHILD.path, PARENT.path].sort())
  })

  it('TC-005 三层链上只移除被取消的那一层', () => {
    const base = scenario([PARENT, CHILD, GRANDCHILD])
    expect(removedPathsOf(base, [PARENT.path])).toEqual([PARENT.path])
  })

  it('每个删除步骤只覆盖一个 chip 的原子跨度，且按偏移倒序', () => {
    const base = scenario([PARENT, CHILD, GRANDCHILD])
    const steps = planFnosOccurrenceRemovals({
      draft: base.draft,
      occurrences: base.occurrences,
      trackedOccurrences: base.tracked,
      pendingRemovalPaths: new Set([PARENT.path, CHILD.path]),
    })
    expect(steps.map(step => step.path)).toEqual([CHILD.path, PARENT.path])
    // detect 投影里每个 chip 连同其后分隔空格占 2 个字符，绝不覆盖邻居的 chip。
    expect(steps.map(step => step.span)).toEqual([{ start: 2, end: 4 }, { start: 0, end: 2 }])
  })

  it('只处理本次操作跟踪到的引用，历史引用不受取消勾选影响', () => {
    const base = scenario([PARENT, CHILD])
    base.tracked.delete(1)
    expect(removedPathsOf(base, [PARENT.path])).toEqual([])
  })

  /**
   * 把计划真正套用到 detect 投影文档上，模拟 DSH 的删除语义：
   * 每次删除成功会推进修订号，CAS 不匹配即拒绝。
   */
  it('按计划删除后只剩未被取消的 chip，邻居不被吞掉', () => {
    const base = scenario([PARENT, CHILD])
    // detect 投影：每个 chip 一个原子字符，DSH 插入时补一个分隔空格。
    let detect = `${'\uFFFC'.repeat(base.occurrences.length).split('').join(' ')} `
    let rev = 7
    const steps = planFnosOccurrenceRemovals({
      draft: base.draft,
      occurrences: base.occurrences,
      trackedOccurrences: base.tracked,
      pendingRemovalPaths: new Set([PARENT.path]),
    })
    for (const step of steps) {
      // 组件逐个读取实时修订号，因此第二个删除不会被陈旧 CAS 拒绝。
      expect(step.span.end).toBeLessThanOrEqual(detect.length)
      detect = detect.slice(0, step.span.start) + detect.slice(step.span.end)
      rev += 1
    }
    // 父目录的 chip 与其分隔空格被删除，子项的原子字符原样保留。
    expect(detect).toBe('\uFFFC ')
    expect(rev).toBe(8)
    // 子项仍被跟踪，父目录已不在跟踪表里。
    expect([...base.tracked.keys()]).toEqual([1, 2])
  })
})
