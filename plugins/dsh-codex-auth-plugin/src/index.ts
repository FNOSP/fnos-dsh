/** Standalone ChatGPT OAuth plugin for DeepSeek Harness. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-settings'
import { registerCodexAuthRoutes, registerCodexGlobalModelRoute, registerCodexModelRefreshRoute } from './host/auth-routes.ts'
import { CodexCredentialMirror } from './host/credential-mirror.ts'
import type { CapabilityRepairSettings } from './host/model-capability-heal.ts'
import { CODEX_SETTINGS_NAMESPACE, healCodexModelCapabilities } from './host/model-capability-heal.ts'
import { CodexCredentialStore } from './host/store.ts'

/** Stable Host bundle name. */
export const name = 'dsh-codex-auth-plugin'
/** Host services required by the routes and credential mirror. */
export const inject = ['webServer', 'settings', 'credentials', 'agentDefaultModel', 'llm']

/**
 * One-shot capability repair, run once the settings entries are addressable.
 *
 * Activation order between this plugin and `llm-pi-ai` is not guaranteed, so
 * the descriptor may not exist yet on the first attempt. The retry listens for
 * the settings service's own update notification and disconnects immediately
 * after the first attempt that can see the namespace: this has to stay a
 * one-shot, because rewriting a document while the user is editing it would
 * make their save lose its revision check.
 */
function scheduleCodexCapabilityHeal(ctx: Context): void {
  let settled = false
  const attempt = (): boolean => {
    const settings = ctx.settings
    if (!settings.describe().some(row => row.ns === CODEX_SETTINGS_NAMESPACE)) return false
    settled = true
    void healCodexModelCapabilities(settings as unknown as CapabilityRepairSettings)
      .then(filled => {
        if (filled.length > 0) ctx.logger.info(`dsh-codex-auth: filled missing Codex model capabilities for ${filled.join(', ')}`)
      })
      .catch(error => {
        ctx.logger.warn('dsh-codex-auth: unable to fill Codex model capabilities', error)
      })
    return true
  }
  ctx.effect(() => {
    if (attempt()) return () => { /* nothing to detach; the repair is fire-and-forget */ }
    const off = ctx.on('settings/document-updated', () => {
      if (!settled) attempt()
    })
    return () => { off() }
  }, 'dsh-codex-auth: Codex model capability repair')
}

export function apply(ctx: Context): void {
  const store = new CodexCredentialStore()
  const mirror = new CodexCredentialMirror(ctx.credentials, store)
  const syncMirror = (): void => {
    void mirror.sync().catch(error => {
      ctx.logger.warn('dsh-codex-auth: failed to synchronize the Codex credential with dsh', error)
    })
  }
  ctx.effect(() => {
    syncMirror()
    const timer = setInterval(syncMirror, 60_000)
    return () => { clearInterval(timer) }
  }, 'dsh-codex-auth: credential mirror')
  registerCodexAuthRoutes(ctx, store, mirror)
  registerCodexModelRefreshRoute(ctx, store, { update: (ns, patch) => ctx.settings.update(ns, patch) })
  registerCodexGlobalModelRoute(ctx, ctx.agentDefaultModel, ctx.llm)
  scheduleCodexCapabilityHeal(ctx)
}

export { CodexCredentialStore } from './host/store.ts'
export { CODEX_API_KEY_ENV, CODEX_API_KEY_REF, CodexCredentialMirror } from './host/credential-mirror.ts'
export { createCodexAdapter, CODEX_STREAM_IDLE_TIMEOUT_MS } from './host/adapter.ts'
export { CodexUsageService, normalizeCodexUsagePayload } from './host/usage.ts'
export { codexAuthStatus, loginCodex, logoutCodex } from './host/auth.ts'
export type { CodexAuthStatus } from './host/auth.ts'
export {
  CODEX_AUTH_LOGIN_PATH,
  CODEX_AUTH_LOGOUT_PATH,
  CODEX_AUTH_STATUS_PATH,
  CODEX_GLOBAL_MODEL_PATH,
} from './contracts/auth-paths.ts'
export { CodexWebAuth, registerCodexAuthRoutes, trustedRequest } from './host/auth-routes.ts'
export type { CodexLoginChallenge, CodexWebAuthStatus } from './host/auth-routes.ts'
