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
    return {
      ok: true,
      value: group.models.map(model => ({ id: model.id, name: model.name })),
    }
  }

  return overrideMethod(llm, 'discoverModels', bridged) ?? (() => undefined)
}
