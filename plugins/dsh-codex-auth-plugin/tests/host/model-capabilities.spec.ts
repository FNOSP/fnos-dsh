import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

/**
 * Every shipped model entry must state its own capabilities.
 *
 * A configured `models` list replaces the installed pi-ai catalog wholesale, so
 * an entry that only names an id keeps nothing but what that catalog happens to
 * describe for the id — and silently degrades to `reasoning: false`, `input:
 * ["text"]` and `contextWindow: 262144` when the id is newer than the catalog.
 * `gpt-6-sol` and `gpt-6-luna` were exactly that case (absent from the codex
 * catalog through pi-ai 0.87.0), which is why the composer offered no thinking
 * levels and the model could not take images.
 *
 * The assertions below read the patch as text, matching this suite's existing
 * convention. They are deliberate about `off`, because the same field means
 * three different things depending on how it is written:
 *
 * - omitted → pinned to `null`, i.e. the model does not offer `off`;
 * - `off: null` → left absent from pi-ai's map, i.e. `off` is offered and sends
 *   no reasoning parameter at all;
 * - `off: none` → `off` is offered and sends the literal `"none"`.
 *
 * The expectations mirror the codex catalog's own `thinkingLevelMap`, so they
 * also hold for the values pi-ai 0.87.1 added for these two models.
 */
interface ExpectedModel {
  id: string
  /** Levels the entry must declare, in escalation order. */
  levels: readonly string[]
  /** How the entry must express `off`; see the doc comment above. */
  off: 'absent' | 'null' | 'none'
}

const EXPECTED_MODELS: readonly ExpectedModel[] = [
  // Its catalog entry maps `off` to null, so the model genuinely has no off.
  { id: 'gpt-6-astra', levels: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'], off: 'absent' },
  { id: 'gpt-6-sol', levels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'], off: 'none' },
  { id: 'gpt-6-luna', levels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'], off: 'none' },
  { id: 'gpt-5.6-sol', levels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'], off: 'null' },
  { id: 'gpt-5.6-terra', levels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'], off: 'null' },
  { id: 'gpt-5.6-luna', levels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'], off: 'null' },
  // No `max`: the catalog doesn't offer it for gpt-5.5.
  { id: 'gpt-5.5', levels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'], off: 'null' },
]

const CONTEXT_WINDOW = 272000
const MAX_TOKENS = 128000

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
      const marker = block.indexOf('reasoningEfforts:')
      const header = block.slice(marker, marker + 'reasoningEfforts:'.length)
      const declaredOff = declaredLevels(block).includes('off')

      if (expected.off === 'absent') {
        // Omitting `off` is what pins it to null (unsupported) downstream.
        expect(declaredOff, `"${expected.id}" must not declare off`).toBe(false)
      } else {
        expect(declaredOff, `"${expected.id}" must declare off`).toBe(true)
      }
      expect(header, `"${expected.id}" needs a reasoningEfforts block`).toContain('reasoningEfforts:')
      if (expected.off === 'null') expect(block).toContain('off: null')
      if (expected.off === 'none') expect(block).toContain('off: none')
    }
  })

  it('ships exactly the reviewed model set', async () => {
    const patch = await readPatch()
    const ids = [...patch.matchAll(/^ {10}- id: (.+)$/gm)].map(match => match[1]!)

    expect(ids).toEqual(EXPECTED_MODELS.map(model => model.id))
  })
})
