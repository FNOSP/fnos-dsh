/**
 * Host-only runtime schema for the fnOS settings entry.
 *
 * This module exists as a separate file — rather than living beside the shared
 * contract — because it imports `@deepseek-ai/schemastery` and the **client**
 * half of this plugin imports the shared contract. Keeping the schema here
 * means the browser bundle never pulls a host dependency: the client only needs
 * field names and the volatility unwrapper, both of which stay in
 * `theme-contract.ts`.
 *
 * @module dsh-fnos/schema
 */

import z from '@deepseek-ai/schemastery'
import { FNOS_AUTHORIZED_DIRECTORIES_FIELD, FNOS_GATEWAY_PROXY_PATHS_FIELD, FNOS_SYSTEM_THEME_FIELD } from './theme-contract.ts'

/**
 * Runtime schema for the `dsh-fnos` settings entry.
 *
 * DSH resolves a settings namespace through `entry.fiber.runtime.Config`, i.e.
 * a **runtime** schema exported (as a value named `Config`) by the plugin
 * module — an `interface Config` alone erases at build time and leaves every
 * `settings.update('dsh-fnos', …)` failing with `No configurable plugin entry
 * "dsh-fnos"`. Cordis only populates `runtime.Config` from an export literally
 * named `Config`, which is why the host entry re-exports this as `Config`.
 *
 * Every field is `.volatile()`: a live edit must reach the running plugin
 * without remounting it, and only volatile fields are editable through the
 * settings forms. Cordis therefore hands `apply` a stable reference per field
 * instead of a plain value, so reads go through `volatileValue()`.
 */
export const FnosSettingsSchema = z.object({
  [FNOS_SYSTEM_THEME_FIELD]: z.union(['light', 'dark']).volatile(),
  [FNOS_GATEWAY_PROXY_PATHS_FIELD]: z.array(z.string()).default([]).volatile(),
  // 默认空数组：老用户升级时该字段缺失，读取方必须能安全拿到空列表。
  [FNOS_AUTHORIZED_DIRECTORIES_FIELD]: z.array(z.string()).default([]).volatile(),
})
