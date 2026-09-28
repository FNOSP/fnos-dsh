import { describe, expect, it, vi } from 'vitest'
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
    await expect(remote.llm.discoverModels('llm-pi-ai', { provider: 'openai-codex' })).resolves.toEqual({
      ok: true,
      value: [
        { id: 'gpt-6-astra', name: 'GPT-6-Astra' },
        { id: 'gpt-6-sol', name: 'GPT-6-Sol' },
      ],
    })
    expect(discoverModels).not.toHaveBeenCalled()
    dispose()
    await remote.llm.discoverModels('llm-pi-ai', { provider: 'openai-codex' })
    expect(discoverModels).toHaveBeenCalledTimes(1)
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
})
