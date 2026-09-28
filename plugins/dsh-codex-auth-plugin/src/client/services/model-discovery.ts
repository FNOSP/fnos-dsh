/** Keep the official Models page's Codex candidate picker on the DSH catalog. */

import { CODEX_PROVIDER } from '../../contracts/provider.ts'

const CODEX_SETTINGS_NAMESPACE = 'llm-pi-ai'

interface ModelCatalogModel {
  id: string
  name: string
}

interface ModelCatalogResult {
  ok: boolean
  value?: { groups?: readonly { id: string; models: readonly ModelCatalogModel[] }[] }
}

interface DiscoveryRemote {
  llm?: { discoverModels?: (...args: unknown[]) => Promise<unknown> }
  session?: { modelCatalog?: () => Promise<ModelCatalogResult> }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
}

/**
 * Replace only Codex's configuration-page discovery with the same catalog
 * used by CodexGlobalModel. Other providers and draft endpoint discovery stay
 * on DSH's native discovery implementation.
 */
export function installCodexModelDiscoveryBridge(remote: unknown): () => void {
  const root = record(remote) as DiscoveryRemote | undefined
  const llm = root?.llm
  const original = llm?.discoverModels
  const modelCatalog = root?.session?.modelCatalog
  if (llm === undefined || typeof original !== 'function' || typeof modelCatalog !== 'function') return () => undefined

  const bridged = async (...args: unknown[]): Promise<unknown> => {
    const settingsNs = args[0]
    const request = record(args[1])
    if (settingsNs !== CODEX_SETTINGS_NAMESPACE || request?.provider !== CODEX_PROVIDER) {
      return original(...args)
    }
    const catalog = await modelCatalog()
    const group = catalog.ok ? catalog.value?.groups?.find(candidate => candidate.id === CODEX_PROVIDER) : undefined
    if (group === undefined) return original(...args)
    return {
      ok: true,
      value: group.models.map(model => ({ id: model.id, name: model.name })),
    }
  }

  llm.discoverModels = bridged
  return () => {
    if (llm.discoverModels === bridged) llm.discoverModels = original
  }
}
