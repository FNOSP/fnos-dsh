import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { CODEX_MODEL_CAPABILITIES } from '../../src/contracts/model-capabilities.ts'

/**
 * Every shipped model entry must state its own capabilities, and the entry and
 * the shared contract must agree exactly.
 *
 * A configured `models` list replaces the installed pi-ai catalog wholesale, so
 * an entry that only names an id keeps nothing but what that catalog happens to
 * describe for the id — and silently degrades to `reasoning: false`, `input:
 * ["text"]` and `contextWindow: 262144` when the id is newer than the catalog.
 * `gpt-6-sol` and `gpt-6-luna` were exactly that case (absent from the codex
 * catalog through pi-ai 0.87.0), which is why the composer offered no thinking
 * levels and the model could not take images.
 *
 * These values now live in two places for one reason: the patch is what DSH
 * loads, while `src/contracts/model-capabilities.ts` is what the client bridge
 * hands the Models page's candidate picker and what the capability repair fills
 * missing fields from. Two copies drift; two copies checked against each other
 * cannot drift silently, which is what the first test below enforces. The
 * remaining tests pin the contract itself to the values verified against the
 * codex catalog, so the pair cannot drift together into something wrong.
 *
 * The assertions on `off` are deliberate, because the same field means three
 * different things depending on how it is written:
 *
 * - omitted → pinned to `null`, i.e. the model does not offer `off`;
 * - `off: null` → left absent from pi-ai's map, i.e. `off` is offered and sends
 *   no reasoning parameter at all;
 * - `off: none` → `off` is offered and sends the literal `"none"`.
 */

const CONTEXT_WINDOW = 272_000
const MAX_TOKENS = 128_000

/** Levels in escalation order, as the catalog declares them per model. */
const LEVELS_WITH_MAX = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
/** `gpt-6-astra`'s catalog entry maps `off` to `null`: it genuinely has no off. */
const LEVELS_WITHOUT_OFF = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
/** The catalog does not offer `max` for gpt-5.5. */
const LEVELS_WITHOUT_MAX = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const

const EXPECTED_MODELS: readonly {
  id: string
  levels: readonly string[]
  off: 'absent' | 'null' | 'none'
}[] = [
  { id: 'gpt-6-astra', levels: LEVELS_WITHOUT_OFF, off: 'absent' },
  { id: 'gpt-6-sol', levels: LEVELS_WITH_MAX, off: 'none' },
  { id: 'gpt-6-luna', levels: LEVELS_WITH_MAX, off: 'none' },
  { id: 'gpt-5.6-sol', levels: LEVELS_WITH_MAX, off: 'null' },
  { id: 'gpt-5.6-terra', levels: LEVELS_WITH_MAX, off: 'null' },
  { id: 'gpt-5.6-luna', levels: LEVELS_WITH_MAX, off: 'null' },
  { id: 'gpt-5.5', levels: LEVELS_WITHOUT_MAX, off: 'null' },
]

/** One model entry parsed out of the patch document. */
interface ParsedEntry {
  id: string
  name: string
  contextWindow?: number
  maxTokens?: number
  input?: readonly string[]
  /** Declared level → wire value, with `null` kept as `null`. */
  reasoningEfforts?: Readonly<Record<string, string | null>>
}

async function readPatch(): Promise<string> {
  return readFile(new URL('../../cordis.patch.yml', import.meta.url), 'utf8')
}

/** The `- id: …` block for one model, up to the next model entry. */
function modelBlock(patch: string, id: string): string | undefined {
  const start = patch.indexOf(`          - id: ${id}\n`)
  if (start === -1) return undefined
  const next = patch.indexOf('\n          - id: ', start + 1)
  return next === -1 ? patch.slice(start) : patch.slice(start, next)
}

/** The level keys declared under one entry's `reasoningEfforts`. */
function declaredLevels(block: string): string[] {
  const marker = block.indexOf('reasoningEfforts:')
  if (marker === -1) return []
  const body = block.slice(marker + 'reasoningEfforts:'.length)
  const levels: string[] = []
  for (const line of body.split('\n')) {
    if (line.trim() === '') continue
    const match = /^ {14}(\w+):/.exec(line)
    if (match === null) break
    levels.push(match[1]!)
  }
  return levels
}

/** Parse the seven model entries the patch declares. */
function parseEntries(patch: string): ParsedEntry[] {
  return [...patch.matchAll(/^ {10}- id: (.+)$/gm)].map((match) => {
    const block = modelBlock(patch, match[1]!)!
    const entry: ParsedEntry = {
      id: match[1]!,
      name: /^ {12}name: (.+)$/m.exec(block)![1]!,
    }
    const contextWindow = /^ {12}contextWindow: (\d+)$/m.exec(block)
    if (contextWindow !== null) entry.contextWindow = Number(contextWindow[1])
    const maxTokens = /^ {12}maxTokens: (\d+)$/m.exec(block)
    if (maxTokens !== null) entry.maxTokens = Number(maxTokens[1])
    const input = /^ {12}input: \[(.+)\]$/m.exec(block)
    if (input !== null) entry.input = input[1]!.split(',').map(value => value.trim())
    const declared = declaredLevels(block)
    if (declared.length > 0) {
      const efforts: Record<string, string | null> = {}
      for (const level of declared) {
        const wire = new RegExp(`^ {14}${level}: (.*)$`, 'm').exec(block)
        // `off:` with no value is YAML null — the "send nothing" dispatch.
        efforts[level] = wire === null || wire[1]!.trim() === 'null' ? null : wire[1]!.trim()
      }
      entry.reasoningEfforts = efforts
    }
    return entry
  })
}

describe('Codex model capability declarations', () => {
  it('declares every shipped model with its real capabilities', async () => {
    const patch = await readPatch()

    for (const expected of EXPECTED_MODELS) {
      const block = modelBlock(patch, expected.id)
      expect(block, `model "${expected.id}" is missing from the patch`).toBeDefined()
      expect(block).toContain('input: [text, image]')
      expect(block).toContain(`contextWindow: ${CONTEXT_WINDOW}`)
      expect(block).toContain(`maxTokens: ${MAX_TOKENS}`)
      expect(declaredLevels(block!), `thinking levels for "${expected.id}"`).toEqual([...expected.levels])
    }
  })

  it('expresses `off` the way each model actually treats it', async () => {
    const patch = await readPatch()

    for (const expected of EXPECTED_MODELS) {
      const block = modelBlock(patch, expected.id)!
      const declaredOff = declaredLevels(block).includes('off')

      if (expected.off === 'absent') {
        // Omitting `off` is what pins it to null (unsupported) downstream.
        expect(declaredOff, `"${expected.id}" must not declare off`).toBe(false)
      } else {
        expect(declaredOff, `"${expected.id}" must declare off`).toBe(true)
      }
      if (expected.off === 'null') expect(block).toContain('off: null')
      if (expected.off === 'none') expect(block).toContain('off: none')
    }
  })

  it('ships exactly the reviewed model set', async () => {
    const patch = await readPatch()
    const ids = [...patch.matchAll(/^ {10}- id: (.+)$/gm)].map(match => match[1]!)

    expect(ids).toEqual(EXPECTED_MODELS.map(model => model.id))
  })

  /**
   * The drift gate. The patch is what DSH loads; the contract is what the client
   * bridge advertises to the Models page's candidate picker and what the
   * capability repair fills missing fields from. Editing one without the other
   * used to be invisible — the picker would keep handing out capability-less
   * candidates while the patch looked correct. Field-by-field equality makes
   * that edit fail here instead.
   */
  it('keeps the shipped patch and the shared contract identical', async () => {
    const entries = parseEntries(await readPatch())

    expect(entries.map(entry => entry.id)).toEqual(CODEX_MODEL_CAPABILITIES.map(model => model.id))
    expect(entries).toEqual(CODEX_MODEL_CAPABILITIES.map(model => ({
      id: model.id,
      name: model.name,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      input: [...model.input],
      reasoningEfforts: { ...model.reasoningEfforts },
    })))
  })

  it('states the values the codex catalog actually reports for these models', () => {
    // Independent of the patch: the contract itself must carry the real values,
    // otherwise the drift gate above would happily agree on something wrong.
    for (const model of CODEX_MODEL_CAPABILITIES) {
      expect(model.contextWindow, `contextWindow for "${model.id}"`).toBe(CONTEXT_WINDOW)
      expect(model.maxTokens, `maxTokens for "${model.id}"`).toBe(MAX_TOKENS)
      expect([...model.input], `input for "${model.id}"`).toEqual(['text', 'image'])
    }
    for (const expected of EXPECTED_MODELS) {
      const model = CODEX_MODEL_CAPABILITIES.find(one => one.id === expected.id)!
      expect(Object.keys(model.reasoningEfforts), `levels for "${expected.id}"`).toEqual([...expected.levels])
      expect(model.reasoningEfforts.off, `off for "${expected.id}"`).toBe(
        expected.off === 'absent' ? undefined
        : expected.off === 'null' ? null
        : 'none',
      )
    }
  })
})
