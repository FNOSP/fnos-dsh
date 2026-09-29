/** Keep the official Models page's Codex candidate picker on the DSH catalog. */

import { codexModelCapability } from '../../contracts/model-capabilities.ts'
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

/**
 * One candidate as the official picker reads it.
 *
 * `contextWindow`, `maxTokens` and `inputModalities` are optional in the
 * underlying remote contract, but they must be **present** here: the picker's
 * `adopt()` copies exactly these into the new row, so a candidate that omits
 * them becomes a model row with no context window and no image input. The
 * Models page then shows grey `256K`/`32K` placeholders and a text-only input
 * checkbox, and — because a configured `models` list replaces the installed
 * catalog wholesale — those empty rows shadow the route's real capabilities
 * for every selector until the user clears the override by hand.
 *
 * Capabilities come from the shared contract rather than from the discovery
 * payload, because this bridge's own data source (`session.modelCatalog`)
 * publishes only `{id, name, description?, reasoning?}` — it carries no
 * capacity or modality facts at all.
 */
interface CodexModelCandidate {
  id: string
  name: string
  contextWindow?: number
  maxTokens?: number
  inputModalities?: readonly string[]
}

/** Enrich one catalog row with the capabilities DSH must keep for that model. */
export function codexCandidate(model: ModelCatalogModel): CodexModelCandidate {
  const capability = codexModelCapability(model.id)
  // An id the contract does not describe (a model newer than this plugin)
  // keeps the catalog's identity only; guessing capabilities would be worse
  // than leaving the field absent, which the UI renders as "unknown" rather
  // than as a wrong number.
  if (capability === undefined) return { id: model.id, name: model.name }
  return {
    id: model.id,
    name: model.name,
    contextWindow: capability.contextWindow,
    maxTokens: capability.maxTokens,
    inputModalities: [...capability.input],
  }
}

interface DiscoveryRemote {
  llm?: { discoverModels?: (...args: unknown[]) => Promise<unknown> }
  session?: { modelCatalog?: () => Promise<ModelCatalogResult> }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
}

/**
 * Replace `target[key]` even when the key is a getter-only accessor, returning
 * the undo or `undefined` when the override did not take.
 *
 * The Remote namespace service installs every RPC method with
 * `Object.defineProperty(service, method, { get })` — a getter and **no
 * setter**. A plain `llm.discoverModels = bridged` assignment is therefore
 * dropped without any error (the client bundle is a classic script, so it is
 * not even a strict-mode TypeError), and the bridge silently never runs while
 * the picker keeps showing the adapter's build-time snapshot. Redefining the
 * property is the only way in; the readback check makes a future upstream
 * change fail closed instead of quietly serving stale data.
 */
function overrideMethod(target: object, key: string, value: unknown): (() => void) | undefined {
  let previous: PropertyDescriptor | undefined
  try {
    previous = Object.getOwnPropertyDescriptor(target, key)
    Object.defineProperty(target, key, {
      configurable: true,
      enumerable: previous?.enumerable ?? true,
      writable: true,
      value,
    })
  } catch {
    return undefined
  }
  if (Object.getOwnPropertyDescriptor(target, key)?.value !== value) return undefined
  return () => {
    try {
      if (previous === undefined) delete (target as Record<string, unknown>)[key]
      else Object.defineProperty(target, key, previous)
    } catch {
      // The namespace service is being torn down; nothing left to restore.
    }
  }
}

/**
 * Capabilities the adapter's own listing advertises, keyed by model id.
 *
 * Read through the *original* `discoverModels` on purpose: for a provider
 * whose installed catalog is non-empty it answers from pi-ai's static table
 * without touching the network, which is the only way to keep capabilities for
 * an id newer than this plugin's contract. Any failure yields no map, so the
 * caller falls back to the contract instead of losing its candidates.
 */
async function advertisedCapabilities(
  original: (...args: unknown[]) => Promise<unknown>,
  args: readonly unknown[],
): Promise<Map<string, Omit<CodexModelCandidate, 'id' | 'name'>> | undefined> {
  let answer: unknown
  try {
    answer = await original(...args)
  } catch {
    return undefined
  }
  const value = record(answer)?.value
  if (!Array.isArray(value)) return undefined
  const found = new Map<string, Omit<CodexModelCandidate, 'id' | 'name'>>()
  for (const entry of value) {
    const model = record(entry)
    const id = model?.id
    if (typeof id !== 'string' || id.length === 0) continue
    const contextWindow = number(model?.contextWindow)
    const maxTokens = number(model?.maxTokens)
    const modalities = model?.inputModalities
    const inputModalities = Array.isArray(modalities)
      ? modalities.filter((one): one is string => typeof one === 'string')
      : undefined
    found.set(id, {
      ...(contextWindow === undefined ? {} : { contextWindow }),
      ...(maxTokens === undefined ? {} : { maxTokens }),
      ...(inputModalities === undefined || inputModalities.length === 0 ? {} : { inputModalities }),
    })
  }
  return found
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

/**
 * Replace only Codex's configuration-page discovery with the same catalog
 * used by CodexGlobalModel. Other providers and draft endpoint discovery stay
 * on DSH's native discovery implementation.
 */
export function installCodexModelDiscoveryBridge(remote: unknown): () => void {
  // `remote` is the Cordis service proxy, not a plain object: reading a
  // namespace the fibre did not declare makes the proxy **throw**
  // (`cannot get property "remote.llm" without inject`) instead of yielding
  // `undefined`. An exception here used to escape `apply`, fail the whole
  // client fibre, and take every other registration down with it — including
  // the `plugins.bundle.config` section. Treat an unresolvable namespace as
  // "bridge not applicable" and let the rest of the plugin activate.
  let llm: DiscoveryRemote['llm']
  let modelCatalog: ((...args: unknown[]) => Promise<ModelCatalogResult>) | undefined
  try {
    const root = record(remote) as DiscoveryRemote | undefined
    llm = root?.llm
    modelCatalog = root?.session?.modelCatalog
  } catch {
    return () => undefined
  }
  // Bind the original before overriding: reading it back through the patched
  // property would return the bridge and recurse.
  const original = llm?.discoverModels
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
    // Best effort: the adapter's own listing still knows the installed
    // catalog's capabilities, which covers ids newer than this plugin's
    // contract. A failure here must not cost the caller its candidate list,
    // so it only ever downgrades the enrichment.
    const advertised = await advertisedCapabilities(original, args)
    return {
      ok: true,
      value: group.models.map(model => {
        const candidate = codexCandidate(model)
        // The contract is authoritative for the models this plugin ships, so
        // it is consulted first; the adapter only extends coverage to ids the
        // contract does not describe yet.
        if (candidate.contextWindow !== undefined) return candidate
        const extra = advertised?.get(model.id)
        return extra === undefined ? candidate : { ...candidate, ...extra }
      }),
    }
  }

  return overrideMethod(llm, 'discoverModels', bridged) ?? (() => undefined)
}
