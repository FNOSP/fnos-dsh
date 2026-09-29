/**
 * Repair a Codex model list that lost its capability fields.
 *
 * The official Models page writes a provider's whole `models` array into the
 * profile's patch document. That array *replaces* the shipped baseline
 * wholesale (DSH merges objects field by field but replaces arrays), so any
 * row that only carries `id`/`name` hides the route's real context window,
 * output cap and thinking levels from every selector — and the model picker
 * shows grey `256K`/`32K` placeholders while the composer offers no reasoning
 * levels. Rows like that were produced by the official candidate picker while
 * its Codex candidates carried no capabilities; the bridge that feeds it is
 * fixed, but the rows it already wrote are still in user profiles.
 *
 * This repair is deliberately **additive**:
 *
 * - it only fills a field that is *absent* — a value the user set, even a
 *   custom one, is never overwritten, so a deliberate `input: [text]` survives;
 * - it never adds, removes, renames or reorders models, so a user's own
 *   selection, order and display names are preserved;
 * - it only touches models this plugin's contract describes, so an id from a
 *   newer account catalog is left exactly as the user has it;
 * - it returns `undefined` when nothing needs filling, which makes the caller
 *   a no-op and the whole operation idempotent — the write it triggers cannot
 *   echo back into another write.
 *
 * @module dsh-codex-auth/model-capability-heal
 */

import { codexModelCapability } from '../contracts/model-capabilities.ts'
import { CODEX_PROVIDER } from '../contracts/provider.ts'

/** The settings namespace owning the Codex route. */
export const CODEX_SETTINGS_NAMESPACE = 'llm-pi-ai'

/** Capability fields the repair may fill; all other fields are user-owned. */
const FILLABLE = ['contextWindow', 'maxTokens', 'input', 'reasoningEfforts'] as const

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/** Result of planning a repair. */
export interface CodexCapabilityRepair {
  /** The repaired rows, or `undefined` when the input was not a row list. */
  models: readonly unknown[]
  /** Ids whose capabilities were filled in, for logging and evidence. */
  filled: readonly string[]
}

/**
 * Plan the capability repair for one provider's `models` array.
 *
 * @param models - the row list as stored in the settings document.
 * @returns the repaired rows plus the ids that were filled, or `undefined`
 *   when every described model already states its capabilities.
 */
export function planCodexCapabilityRepair(models: unknown): CodexCapabilityRepair | undefined {
  if (!Array.isArray(models)) return undefined
  const filled: string[] = []
  let changed = false
  const repaired = models.map((row) => {
    const model = record(row)
    const id = model?.id
    if (model === undefined || typeof id !== 'string') return row
    const capability = codexModelCapability(id)
    if (capability === undefined) return row
    const missing = FILLABLE.filter(field => model[field] === undefined)
    if (missing.length === 0) return row
    const add: Record<string, unknown> = {}
    if (model.contextWindow === undefined) add.contextWindow = capability.contextWindow
    if (model.maxTokens === undefined) add.maxTokens = capability.maxTokens
    if (model.input === undefined) add.input = [...capability.input]
    // `off` is semantic: `null` means "offer off, send no reasoning parameter",
    // so the key must be present with a null value rather than omitted.
    if (model.reasoningEfforts === undefined) add.reasoningEfforts = { ...capability.reasoningEfforts }
    changed = true
    filled.push(id)
    return { ...model, ...add }
  })
  return changed ? { models: repaired, filled } : undefined
}

/** The subset of the settings service this repair needs. */
export interface CapabilityRepairSettings {
  describe(): readonly { ns: string; value?: unknown }[]
  update(ns: string, patch: unknown): Promise<unknown>
}

/**
 * Fill in missing Codex capabilities in the stored settings document.
 *
 * A missing namespace entry, a route that states its capabilities already, or
 * any error is reported as "nothing to do": this runs at startup beside the
 * credential mirror, so it must never fail activation or block boot. The
 * failure mode it guards against is cosmetic-plus-silent (degraded selectors),
 * never data loss.
 *
 * @param settings - the Host settings service.
 * @returns the ids that were filled, empty when no write was needed.
 */
export async function healCodexModelCapabilities(
  settings: CapabilityRepairSettings,
): Promise<readonly string[]> {
  const descriptor = settings.describe().find(row => row.ns === CODEX_SETTINGS_NAMESPACE)
  const value = record(descriptor?.value)
  const providers = record(value?.providers)
  const route = record(providers?.[CODEX_PROVIDER])
  const repair = planCodexCapabilityRepair(route?.models)
  if (repair === undefined) return []
  await settings.update(CODEX_SETTINGS_NAMESPACE, {
    providers: { [CODEX_PROVIDER]: { models: repair.models } },
  })
  return repair.filled
}
