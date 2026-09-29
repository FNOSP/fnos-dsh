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
import type { CodexAuthSectionProps } from '../components/CodexAuthSection.tsx'
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
export const inject = ['slots', 'locale', 'connection', 'remote', 'remote.session', 'timer']

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
   * 配置入口挂在插件管理页的组合包详情页（`plugins.bundle.config`，key 用包名），
   * 而不是设置弹框的导航分区。
   *
   * 上游 0.1.7-rc.2 的架构决策把插件配置收归侧栏「插件」页，设置弹框只保留只读
   * 插件清单；官方为社区组合包提供的接缝就是这个 slot，它**只以 `view: 'page'`
   * 渲染**在详情页的描述与组件列表之间。详情页自己绘制标题与面包屑，因此这里
   * 不再需要导航用的 `label` / `order`。
   *
   * 组件忽略可选的 `form`：本插件的配置自管理（读写走 `/plugins/.../auth/*` 与
   * settings 写入 RPC），不接 settings 命名空间表单。数据路径与迁移前完全一致。
   */
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config',
    key: '@tnnevol/dsh-codex-auth',
    inject: (): CodexAuthSectionProps => ({ t, connection, remote }),
  }, CodexAuthSection))
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: 'codex-usage',
    order: 1,
    inject: (): CodexUsageStatusInjected => ({ t, timer }),
  }, CodexUsageStatus))
}
