import { describe, expect, it, vi } from 'vitest'
import { CODEX_MODEL_CAPABILITIES } from '../../src/contracts/model-capabilities.ts'
import { installCodexModelDiscoveryBridge } from '../../src/client/services/model-discovery.ts'

describe('Codex model discovery bridge', () => {
  it('uses the shared DSH model catalog for the Codex provider', async () => {
    const discoverModels = vi.fn(async (_settingsNs: string, _request: unknown) => ({ ok: true as const, value: [{ id: 'old-model' }] }))
    const remote = {
      llm: { discoverModels },
      session: {
        modelCatalog: vi.fn(async () => ({
          ok: true as const,
          value: {
            groups: [{
              id: 'openai-codex',
              name: 'OpenAI Codex',
              models: [
                { id: 'gpt-6-astra', name: 'GPT-6-Astra' },
                { id: 'gpt-6-sol', name: 'GPT-6-Sol' },
              ],
            }],
          },
        })),
      },
    }

    const dispose = installCodexModelDiscoveryBridge(remote)
    const astra = CODEX_MODEL_CAPABILITIES[0]!
    const sol = CODEX_MODEL_CAPABILITIES[1]!
    expect(astra.id).toBe('gpt-6-astra')
    await expect(remote.llm.discoverModels('llm-pi-ai', { provider: 'openai-codex' })).resolves.toEqual({
      ok: true,
      value: [
        {
          id: 'gpt-6-astra',
          name: 'GPT-6-Astra',
          contextWindow: astra.contextWindow,
          maxTokens: astra.maxTokens,
          inputModalities: [...astra.input],
        },
        {
          id: 'gpt-6-sol',
          name: 'GPT-6-Sol',
          contextWindow: sol.contextWindow,
          maxTokens: sol.maxTokens,
          inputModalities: [...sol.input],
        },
      ],
    })
    // The adapter's own listing is consulted only to extend coverage beyond
    // the contract; it never decides the answer for a shipped model.
    expect(discoverModels).toHaveBeenCalledTimes(1)
    dispose()
    await remote.llm.discoverModels('llm-pi-ai', { provider: 'openai-codex' })
    expect(discoverModels).toHaveBeenCalledTimes(2)
  })

  /**
   * The candidate list is what the official picker's `adopt()` copies into a
   * new model row. A candidate that omits `inputModalities`/`contextWindow`/
   * `maxTokens` therefore becomes a row with no image input and no capacity,
   * and — because a configured `models` list replaces the installed catalog
   * wholesale — that empty row then shadows the route's real capabilities for
   * every selector until the override is cleared by hand. This is the exact
   * regression that produced the grey `256K`/`32K` placeholders.
   */
  it('returns capabilities with every candidate so added rows keep them', async () => {
    const remote = {
      llm: { discoverModels: vi.fn(async (_ns: string, _request: unknown) => ({ ok: true as const, value: [] })) },
      session: {
        modelCatalog: vi.fn(async () => ({
          ok: true as const,
          value: { groups: [{ id: 'openai-codex', name: 'OpenAI Codex', models: [{ id: 'gpt-6-luna', name: 'GPT-6-Luna' }] }] },
        })),
      },
    }

    installCodexModelDiscoveryBridge(remote)
    const answer = await remote.llm.discoverModels('llm-pi-ai', { provider: 'openai-codex' }) as {
      value: readonly Record<string, unknown>[]
    }

    expect(answer.value).toEqual([{
      id: 'gpt-6-luna',
      name: 'GPT-6-Luna',
      contextWindow: 272_000,
      maxTokens: 128_000,
      inputModalities: ['text', 'image'],
    }])
  })

  /**
   * The account catalog can carry models newer than this plugin's contract.
   * For those, the adapter's own listing is the only capability source, and it
   * must be used rather than shipping a capability-less candidate.
   */
  it('extends coverage beyond the contract from the adapter listing', async () => {
    const remote = {
      llm: {
        discoverModels: vi.fn(async (_ns: string, _request: unknown) => ({
          ok: true as const,
          value: [{ id: 'gpt-5.4', name: 'GPT-5.4', contextWindow: 400_000, maxTokens: 64_000, inputModalities: ['text', 'image'] }],
        })),
      },
      session: {
        modelCatalog: vi.fn(async () => ({
          ok: true as const,
          value: { groups: [{ id: 'openai-codex', name: 'OpenAI Codex', models: [{ id: 'gpt-5.4', name: 'GPT-5.4' }] }] },
        })),
      },
    }

    installCodexModelDiscoveryBridge(remote)
    const answer = await remote.llm.discoverModels('llm-pi-ai', { provider: 'openai-codex' }) as {
      value: readonly Record<string, unknown>[]
    }

    expect(answer.value).toEqual([{
      id: 'gpt-5.4',
      name: 'GPT-5.4',
      contextWindow: 400_000,
      maxTokens: 64_000,
      inputModalities: ['text', 'image'],
    }])
  })

  /**
   * Enrichment is best effort: a failing adapter listing must not cost the
   * caller its candidate list, because the picker treats a refusal as "no
   * models to add" and the user would silently lose the account's models.
   */
  it('still returns contract capabilities when the adapter listing fails', async () => {
    const remote = {
      llm: { discoverModels: vi.fn(async (_ns: string, _request: unknown) => { throw new Error('listing unavailable') }) },
      session: {
        modelCatalog: vi.fn(async () => ({
          ok: true as const,
          value: { groups: [{ id: 'openai-codex', name: 'OpenAI Codex', models: [{ id: 'gpt-6-astra', name: 'GPT-6-Astra' }] }] },
        })),
      },
    }

    installCodexModelDiscoveryBridge(remote)
    const answer = await remote.llm.discoverModels('llm-pi-ai', { provider: 'openai-codex' }) as {
      value: readonly Record<string, unknown>[]
    }

    expect(answer.value[0]).toMatchObject({ id: 'gpt-6-astra', contextWindow: 272_000, inputModalities: ['text', 'image'] })
  })

  it('does not intercept other providers', async () => {
    const discoverModels = vi.fn(async (_settingsNs: string, _request: unknown) => ({ ok: true as const, value: [{ id: 'other' }] }))
    const remote = {
      llm: { discoverModels },
      session: { modelCatalog: vi.fn() },
    }
    const dispose = installCodexModelDiscoveryBridge(remote)

    await expect(remote.llm.discoverModels('llm-pi-ai', { provider: 'other' })).resolves.toEqual({
      ok: true,
      value: [{ id: 'other' }],
    })
    expect(discoverModels).toHaveBeenCalledTimes(1)
    dispose()
  })

  /**
   * `remote` is a Cordis service proxy: reading an undeclared namespace throws
   * instead of returning `undefined`. That throw used to escape `apply`, fail
   * the whole client fibre, and drop every registration it owned — the plugin
   * detail page then rendered no configuration section at all. The bridge must
   * degrade to a no-op instead.
   */
  it('degrades to a no-op when a remote namespace throws without inject', () => {
    const remote = new Proxy({}, {
      get(_target, prop) {
        throw new Error(`cannot get property "remote.${String(prop)}" without inject`)
      },
    })

    expect(() => installCodexModelDiscoveryBridge(remote)).not.toThrow()
    expect(installCodexModelDiscoveryBridge(remote)).toEqual(expect.any(Function))
  })

  it('reports a disposable no-op when the catalog namespace is absent', () => {
    const dispose = installCodexModelDiscoveryBridge({ llm: { discoverModels: vi.fn() } })

    expect(dispose).toEqual(expect.any(Function))
    expect(() => dispose()).not.toThrow()
  })

  /**
   * The Remote namespace service installs each RPC method with
   * `Object.defineProperty(service, method, { get })` — a getter and no setter.
   * Assigning `llm.discoverModels = bridged` is silently dropped in that case,
   * so the bridge never ran and the model picker kept listing the adapter's
   * build-time snapshot. The override has to go through `defineProperty`.
   */
  it('overrides a getter-only discoverModels accessor', async () => {
    const original = vi.fn(async () => ({ ok: true as const, value: [{ id: 'pi-ai-snapshot' }] }))
    const llm: Record<string, unknown> = {}
    Object.defineProperty(llm, 'discoverModels', { configurable: true, enumerable: true, get: () => original })
    const modelCatalog = vi.fn(async () => ({
      ok: true as const,
      value: { groups: [{ id: 'openai-codex', name: 'OpenAI Codex', models: [{ id: 'gpt-6-astra', name: 'GPT-6-Astra' }] }] },
    }))

    const dispose = installCodexModelDiscoveryBridge({ llm, session: { modelCatalog } })

    // The getter must be replaced for real — not shadowed on a throwaway wrapper.
    expect(llm.discoverModels).not.toBe(original)
    await expect((llm.discoverModels as (...a: unknown[]) => Promise<unknown>)('llm-pi-ai', { provider: 'openai-codex' }))
      .resolves.toEqual({
        ok: true,
        value: [{
          id: 'gpt-6-astra',
          name: 'GPT-6-Astra',
          contextWindow: 272_000,
          maxTokens: 128_000,
          inputModalities: ['text', 'image'],
        }],
      })
    expect(modelCatalog).toHaveBeenCalledTimes(1)
    // The adapter is still consulted once for capability enrichment, but its
    // `pi-ai-snapshot` row must not leak into the answer.
    expect(original).toHaveBeenCalledTimes(1)

    // Other providers still reach the namespace's own implementation.
    await expect((llm.discoverModels as (...a: unknown[]) => Promise<unknown>)('llm-pi-ai', { provider: 'other' }))
      .resolves.toEqual({ ok: true, value: [{ id: 'pi-ai-snapshot' }] })
    expect(original).toHaveBeenCalledTimes(2)

    // Disposal restores the namespace accessor rather than leaving the bridge.
    dispose()
    expect(llm.discoverModels).toBe(original)
  })

  it('leaves the namespace untouched when the accessor cannot be redefined', async () => {
    const original = vi.fn()
    const llm: Record<string, unknown> = {}
    Object.defineProperty(llm, 'discoverModels', { configurable: false, get: () => original })
    const modelCatalog = vi.fn(async () => ({ ok: true as const, value: { groups: [] } }))

    const dispose = installCodexModelDiscoveryBridge({ llm, session: { modelCatalog } })

    expect(llm.discoverModels).toBe(original)
    expect(() => dispose()).not.toThrow()
    expect(modelCatalog).not.toHaveBeenCalled()
  })
})
