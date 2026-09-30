/** Insert fnOS selections as structured, official DSH references. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ReferenceInsert, TokenSpan } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { FNOS_REFERENCE_SOURCE, fnosReferenceDisplayText, type FnosInputReference, type InputSnapshotForReference } from './input-references.ts'

function displayName(value: string): string {
  const parts = value.split('/').filter(Boolean)
  return parts.at(-1) ?? value
}

function referenceLabel(value: string): string {
  return displayName(value)
}

/**
 * Keep the local draft projection aligned with DSH's input machine. The
 * leading replacement character is rendered as the reference icon by DSH;
 * it is not the literal `@` text shown in the composer.
 */
export function fnosReferenceDraftText(_label: string): string {
  // DSH's detect projection treats every structured reference as one atomic
  // character. The label belongs to the chip's render/clipboard projection;
  // including it here shifts the next CAS span and drops subsequent picks.
  return '\uFFFC'
}

/**
 * 把剪贴板投影中的引用区间换算成 detect 投影跨度。
 *
 * `Occurrence.offset`/`length` 与 `input.draft` 同为剪贴板投影（chip 展开为其
 * `clipboardText`），而 DSH 的引用删除入口只接受 detect 投影（chip 占一个原子
 * 字符）。两者的差值就是排在该引用之前的每个引用多出来的标签长度，因此这里必须
 * 传入**全部**引用，不能只传 fnOS 来源的那几个。
 * 跨度默认连带 DSH 插入时补的分隔空格。
 */
export function fnosOccurrenceDetectSpan(
  draft: string,
  occurrence: { readonly offset: number, readonly length: number },
  occurrences: readonly { readonly offset: number, readonly length: number }[],
  options: { removeTrailingSeparator?: boolean } = {},
): { start: number, end: number } {
  const shift = occurrences.reduce(
    (total, item) => item.offset + item.length <= occurrence.offset ? total + Math.max(0, item.length - 1) : total,
    0,
  )
  const start = Math.max(0, occurrence.offset - shift)
  // chip 本身占 1 个原子字符，其后的分隔空格也占 1 个。
  const withSeparator = options.removeTrailingSeparator !== false
    && draft[occurrence.offset + occurrence.length] === ' '
  return { start, end: start + (withSeparator ? 2 : 1) }
}

/** Add exactly one separator only when existing text touches the insertion. */
export function fnosInsertionPrefix(draft: string, offset = draft.length): '' | ' ' {
  if (offset <= 0 || /\s/u.test(draft[offset - 1] ?? '')) return ''
  return ' '
}

/** Move the native textarea caret after React commits the inserted reference. */
export function restoreFnosInputCaret(position: number, expectedDraft: string): void {
  if (typeof document === 'undefined' || typeof requestAnimationFrame !== 'function') return
  const restore = (): void => {
    const textareas = [...document.querySelectorAll<HTMLTextAreaElement>('textarea[data-phase]:not([disabled])')]
    const textarea = textareas.find(candidate => candidate.value === expectedDraft)
      ?? textareas.find(candidate => candidate.value.length >= position)
    if (textarea === undefined) return
    const caret = Math.min(position, textarea.value.length)
    textarea.focus({ preventScroll: true })
    textarea.setSelectionRange(caret, caret)
  }
  requestAnimationFrame(() => {
    restore()
    requestAnimationFrame(restore)
  })
}

function insertText(ctx: ClientContext, sessionId: SessionId, text: string, span: TokenSpan): boolean {
  const actx = ctx.sessions.scope(sessionId)
  if (actx === undefined) return false
  return actx.bail(actx, 'slash/input-insert-text', { text, span }) === true
}

function insertReference(
  ctx: ClientContext,
  sessionId: SessionId,
  reference: FnosInputReference,
  span: TokenSpan,
): boolean {
  const actx = ctx.sessions.scope(sessionId)
  if (actx === undefined) return false
  const label = referenceLabel(reference.semanticPath)
  const value: ReferenceInsert = {
    source: FNOS_REFERENCE_SOURCE,
    ref: reference.ref,
    label,
    appearance: reference.kind === 'directory' ? 'folder' : 'file',
    clipboardText: fnosReferenceDisplayText(reference),
  }
  return actx.bail(actx, 'slash/input-insert-reference', { reference: value, span }) === true
}

/** Append selected files and folders using DSH's official chip placeholder. */
export function insertFnosReferences(
  ctx: ClientContext,
  sessionId: SessionId,
  references: readonly FnosInputReference[],
  input: InputSnapshotForReference,
): FnosInputReference[] {
  if (references.length === 0) return []

  let draft = input.draft
  // DSH's input state exposes the clipboard projection (`@label`), while
  // reference CAS spans use the detect projection (one atomic character per
  // chip). Starting at clipboard.length makes the first insertion stale as
  // soon as the draft already contains a chip.
  const expandedOccurrenceLength = input.occurrences?.reduce(
    (total, occurrence) => total + Math.max(0, occurrence.length - 1),
    0,
  ) ?? 0
  let offset = Math.max(0, draft.length - expandedOccurrenceLength)
  let draftRev = input.draftRev
  const inserted: FnosInputReference[] = []

  // The picker always appends at the end. Spacing is therefore determined by
  // the clipboard projection's final character, not by a detect offset into
  // its expanded chip labels.
  const prefix = fnosInsertionPrefix(draft, draft.length)
  if (prefix !== '') {
    const span: TokenSpan = { start: offset, end: offset, draftRev }
    if (!insertText(ctx, sessionId, prefix, span)) return []
    draft += prefix
    offset += prefix.length
    draftRev += 1
  }

  // DSH's native insertion transaction owns the trailing separator. Keep the
  // same display projection and offset math locally so the next CAS span is
  // based on the actual machine draft, not the clipboard/model projection.
  for (const reference of references) {
    const label = referenceLabel(reference.semanticPath)
    const span: TokenSpan = { start: offset, end: offset, draftRev }
    if (!insertReference(ctx, sessionId, reference, span)) break
    const displayText = fnosReferenceDraftText(label)
    // Every insertion is at the current end, so DSH owns one trailing
    // separator for each chip. This also keeps the local revision math valid
    // when the initial draft contains expanded clipboard labels.
    const gap = ' '
    draft += displayText + gap
    offset += displayText.length + gap.length
    draftRev += 1
    inserted.push(reference)
  }
  if (inserted.length > 0) restoreFnosInputCaret(draft.length, draft)
  return inserted
}
