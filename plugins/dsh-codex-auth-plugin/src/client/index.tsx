/** Browser half of the standalone Codex OAuth plugin. */

import '../styles/index.scss'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: 拉入 ui-session 对 SessionStandardProps 的合并（含 useProjection），
// 会话作用域座位的标准套件才不会是空对象。
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
// Type-only: 拉入插件管理页对 `plugins.bundle.config` 的登记契约
// （`PluginConfigViewProps`）。该包只在类型层使用，运行时不 import——
// 客户端模块表里没有它，运行时引入会直接报模块缺失。
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { CodexAuthSection } from '../components/CodexAuthSection.tsx'
import type { CodexAuthSectionProps, CodexAuthSubject } from '../components/CodexAuthSection.tsx'
import { CodexUsageStatus } from '../components/CodexUsageStatus.tsx'
import type { CodexUsageStatusInjected } from '../components/CodexUsageStatus.tsx'
import { en, zh } from './locales.ts'
import type { CodexAuthLocaleKey } from './locales.ts'
import { installSemiDshTheme } from '@tnnevol/dsh-semi-ui'
import { installCodexModelDiscoveryBridge } from './services/model-discovery.ts'

// Keep the renderer-provided slot service visible to consumers that resolve the
// renderer package through a different peer dependency path.
declare module '@deepseek-ai/cordis' {
  interface Context {
    slots: SlotRegistry
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.dsh-codex-auth': CodexAuthLocaleKey
  }
}

export const name = 'dsh-codex-auth-plugin-client'
// `remote` only exposes the namespaces whose services this fiber declares, and
// its proxy throws `cannot get property "remote.<ns>" without inject` on any
// other access. The model-discovery bridge below reads `remote.llm`, so it must
// be listed here next to the `remote.session` catalog it is bridged onto;
// otherwise the whole client fiber fails and every registration it owns — most
// visibly the `plugins.bundle.config` detail-page section — silently disappears.
// Same shape as the in-box consumer, `dsh-client-ui-settings-models`.
export const inject = ['slots', 'locale', 'connection', 'remote', 'remote.llm', 'remote.session', 'timer']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => installSemiDshTheme(), 'dsh-codex-auth-plugin: Semi DSH theme')
  const namespace = 'settings.dsh-codex-auth'
  ctx.effect(() => ctx.locale.register(namespace, { zh, en }), 'dsh-codex-auth-plugin: locale')
  const t = ctx.locale.bind(namespace) as CodexAuthSectionProps['t']
  const connection = ctx.get('connection') as ConnectionHandle
  // DSH exposes the merged Remote API on `ctx.remote`. Using `ctx.get('remote')`
  // only resolves the base service and omits namespaces such as `session`.
  const remote = ctx.remote as unknown
  ctx.effect(
    () => installCodexModelDiscoveryBridge(remote),
    'dsh-codex-auth-plugin: shared Codex model discovery',
  )
  const timer = ctx.get('timer') as CodexUsageStatusInjected['timer']
  /**
   * 配置入口挂在插件管理页的组合包详情页。
   *
   * 座位选 `plugins.detail.section` 而不是官方的 `plugins.bundle.config`：上游
   * `PackageDetail` 的固定顺序是
   *
   *   1. `plugins.bundle.config`（组合包自己的配置）
   *   2. 「包含的组件」（`RowsSection`）
   *   3. `plugins.detail.section`（本座位）
   *
   * `bundle.config` **永远**排在「包含的组件」之前，插件无法用它把内容放到
   * 组件列表下方；requirement 要求配置区呈现在组件列表之后。
   *
   * 代价是该座位是 **list**（非 keyed）：页面会给打开的每个详情页渲染它，因此
   * 组件必须自己看 `subject`——不是本插件的组合包就返回 `null`，否则这段界面
   * 会出现在别的插件详情页上（见 `CodexAuthSection` 的 subject 判定）。
   * list 座位要求 `id`，且不能声明 `inject`（owner props 由页面传入）。
   */
  ctx.slots.inject('plugins.detail.section', () => ctx.slots.register({
    name: 'plugins.detail.section',
    id: 'codex-auth',
    order: 50,
  }, (props: { subject?: CodexAuthSubject | undefined }) =>
    <CodexAuthSection t={t} connection={connection} remote={remote} subject={props.subject} />))
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: 'codex-usage',
    order: 1,
    inject: (): CodexUsageStatusInjected => ({ t, timer }),
  }, CodexUsageStatus))
}
