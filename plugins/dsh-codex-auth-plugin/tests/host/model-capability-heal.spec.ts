import { describe, expect, it, vi } from 'vitest'
import { healCodexModelCapabilities, planCodexCapabilityRepair } from '../../src/host/model-capability-heal.ts'

/**
 * A row exactly as the official Models page used to save it: identity only.
 *
 * This shape is what the account's 7 models were stored as. Because a
 * configured `models` array replaces the shipped baseline wholesale, every one
 * of those rows hid the route's real context window and thinking levels — the
 * models page rendered the grey `256K`/`32K` placeholders and the composer
 * offered no reasoning levels for `gpt-6-sol` / `gpt-6-luna`.
 */
const STRIPPED_ROWS = [
  { id: 'gpt-6-astra', name: 'GPT-6-Astra' },
  { id: 'gpt-6-sol', name: 'GPT-6-Sol' },
  { id: 'gpt-6-luna', name: 'GPT-6-Luna' },
]

describe('Codex model capability repair', () => {
  it('fills every capability field a stripped row is missing', () => {
    const repair = planCodexCapabilityRepair(STRIPPED_ROWS)

    expect(repair).toBeDefined()
    expect(repair!.filled).toEqual(['gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna'])
    expect(repair!.models[0]).toEqual({
      id: 'gpt-6-astra',
      name: 'GPT-6-Astra',
      contextWindow: 272_000,
      maxTokens: 128_000,
      input: ['text', 'image'],
      reasoningEfforts: { minimal: 'low', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' },
    })
    const astra = repair!.models[0] as { reasoningEfforts: Record<string, unknown> }
    // `off` is semantic: astra genuinely has no off, so the key must be absent
    // rather than present-and-null.
    expect(Object.hasOwn(astra.reasoningEfforts, 'off')).toBe(false)
    // sol offers off and sends the literal `none`.
    const sol = repair!.models[1] as { reasoningEfforts: Record<string, unknown> }
    expect(Object.hasOwn(sol.reasoningEfforts, 'off')).toBe(true)
    expect(sol.reasoningEfforts.off).toBe('none')
  })

  /**
   * The repair may only ever fill gaps. A value the user chose — including a
   * deliberately smaller window or a text-only input — is data, not a mistake,
   * and overwriting it would silently change what the user configured.
   */
  it('never overwrites values the user already set', () => {
    const repair = planCodexCapabilityRepair([{
      id: 'gpt-6-sol',
      name: 'My Sol',
      contextWindow: 100_000,
      maxTokens: 4_096,
      input: ['text'],
      reasoningEfforts: { low: 'low' },
    }])

    expect(repair).toBeUndefined()
  })

  it('preserves a partially set row and only adds what is absent', () => {
    const repair = planCodexCapabilityRepair([{
      id: 'gpt-6-sol',
      name: 'My Sol',
      contextWindow: 100_000,
    }])

    expect(repair).toBeDefined()
    expect(repair!.models[0]).toEqual({
      id: 'gpt-6-sol',
      name: 'My Sol',
      contextWindow: 100_000,
      maxTokens: 128_000,
      input: ['text', 'image'],
      reasoningEfforts: { off: 'none', minimal: 'low', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' },
    })
  })

  /**
   * User-owned list shape: adding, removing or reordering models is a
   * deliberate act, and the repair is not allowed to "helpfully" restore the
   * shipped set. Display names are user-owned too.
   */
  it('keeps the user\u2019s own selection, order and names', () => {
    const repair = planCodexCapabilityRepair([
      { id: 'gpt-5.5', name: 'Fast' },
      { id: 'gpt-6-luna', name: 'GPT-6-Luna' },
    ])

    expect(repair).toBeDefined()
    expect(repair!.models.map(row => (row as { id: string }).id)).toEqual(['gpt-5.5', 'gpt-6-luna'])
    expect(repair!.models.map(row => (row as { name: string }).name)).toEqual(['Fast', 'GPT-6-Luna'])
    expect(repair!.models).toHaveLength(2)
  })

  /**
   * An id the contract does not describe belongs to a newer account catalog.
   * Filling it with a guess would be worse than leaving it: the UI renders an
   * absent field as "unknown" rather than as a wrong number.
   */
  it('leaves models outside the shipped contract untouched', () => {
    const repair = planCodexCapabilityRepair([{ id: 'gpt-9-future', name: 'Future' }])

    expect(repair).toBeUndefined()
  })

  it('tolerates malformed rows without dropping them', () => {
    const repair = planCodexCapabilityRepair([null, 'oops', { name: 'no id' }, { id: 'gpt-6-sol' }])

    expect(repair).toBeDefined()
    expect(repair!.models.slice(0, 3)).toEqual([null, 'oops', { name: 'no id' }])
    expect(repair!.filled).toEqual(['gpt-6-sol'])
  })

  it('reports nothing to do when the value is not a row list', () => {
    expect(planCodexCapabilityRepair(undefined)).toBeUndefined()
    expect(planCodexCapabilityRepair({ id: 'gpt-6-sol' })).toBeUndefined()
  })
})

describe('Codex model capability repair through the settings service', () => {
  it('writes the filled rows back to the llm-pi-ai namespace', async () => {
    const update = vi.fn(async () => undefined)
    const settings = {
      describe: () => [{
        ns: 'llm-pi-ai',
        value: { providers: { 'openai-codex': { displayName: 'OpenAI Codex', models: STRIPPED_ROWS } } },
      }],
      update,
    }

    await expect(healCodexModelCapabilities(settings)).resolves.toEqual(['gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna'])
    expect(update).toHaveBeenCalledTimes(1)
    const [ns, patch] = update.mock.calls[0] as unknown as [string, { providers: Record<string, { models: { id: string; contextWindow: number }[] }> }]
    expect(ns).toBe('llm-pi-ai')
    // Only the models key is patched, so unrelated route fields and the rest of
    // the user's settings document survive untouched.
    expect(Object.keys(patch.providers['openai-codex']!)).toEqual(['models'])
    expect(patch.providers['openai-codex']!.models[1]).toMatchObject({
      id: 'gpt-6-sol',
      contextWindow: 272_000,
      maxTokens: 128_000,
      input: ['text', 'image'],
    })
  })

  /**
   * Idempotence matters because the repair triggers a settings write, and the
   * settings service notifies on every document update. A second run must find
   * nothing to do, or the plugin would write forever.
   */
  it('is a no-op the second time, so the write cannot echo back', async () => {
    const update = vi.fn(async () => undefined)
    const value = { providers: { 'openai-codex': { models: STRIPPED_ROWS } } }
    const settings = { describe: () => [{ ns: 'llm-pi-ai', value }], update }

    await healCodexModelCapabilities(settings)
    const afterFirst = (update.mock.calls[0] as unknown as [string, unknown])[1]
    const healed = (afterFirst as { providers: { 'openai-codex': { models: unknown } } }).providers['openai-codex'].models

    const second = { describe: () => [{ ns: 'llm-pi-ai', value: { providers: { 'openai-codex': { models: healed } } } }], update }
    await expect(healCodexModelCapabilities(second)).resolves.toEqual([])
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('does nothing when the namespace, route or model list is absent', async () => {
    const update = vi.fn()
    expect(await healCodexModelCapabilities({ describe: () => [], update })).toEqual([])
    expect(await healCodexModelCapabilities({ describe: () => [{ ns: 'other', value: {} }], update })).toEqual([])
    expect(await healCodexModelCapabilities({
      describe: () => [{ ns: 'llm-pi-ai', value: { providers: {} } }],
      update,
    })).toEqual([])
    expect(update).not.toHaveBeenCalled()
  })
})
