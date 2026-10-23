/** Browser half of the standalone OpenCode plugin. */

import '../styles/index.scss'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: 拉入 ui-session 对 SessionStandardProps 的合并（含 useProjection），
// 会话作用域座位的标准套件才不会是空对象。
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
// Type-only: 拉入插件管理页对 `plugins.detail.section` 的登记契约
// （`PluginDetailProps`）。该包只在类型层使用，运行时不 import。
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { installSemiDshTheme } from '@tnnevol/dsh-semi-ui'
import { OpenCodeSection } from '../components/OpenCodeSection.tsx'
import { OpenCodeUsageStatus } from '../components/OpenCodeUsageStatus.tsx'
import type { OpenCodeUsageStatusInjected } from '../components/OpenCodeUsageStatus.tsx'
import { en, zh } from './locales.ts'
import type { OpenCodeLocaleKey, OpenCodeTranslate } from './locales.ts'
import type { TimerService } from './services/polling.ts'
import { createPreferencesStore } from './services/preferences-data.ts'
import {
  OPENCODE_DETAIL_ID,
  OPENCODE_DETAIL_ORDER,
  OPENCODE_DETAIL_SLOT,
  OPENCODE_LOCALE_NAMESPACE,
  OPENCODE_USAGE_ID,
  OPENCODE_USAGE_ORDER,
  OPENCODE_USAGE_SLOT,
} from './services/registration.ts'
import type { OpenCodePluginSubject } from './services/registration.ts'

// Keep the renderer-provided slot service visible to consumers that resolve the
// renderer package through a different peer dependency path.
declare module '@deepseek-ai/cordis' {
  interface Context {
    slots: SlotRegistry
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.dsh-opencode': OpenCodeLocaleKey
  }
}

export const name = 'dsh-opencode-plugin-client'
/**
 * 与 Codex 插件保持同一套必需服务集合（两个插件的客户端纤维装配在同一个
 * 宿主里）。本插件的数据面是同源 HTTP 路由，运行时不读 `remote.*`；这些
 * 命名空间仍按既有约定声明，避免不同装配下 Remote 代理的可见性差异。
 */
export const inject = ['slots', 'locale', 'connection', 'remote', 'remote.llm', 'remote.session', 'timer']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => installSemiDshTheme(), 'dsh-opencode-plugin: Semi DSH theme')
  ctx.effect(() => ctx.locale.register(OPENCODE_LOCALE_NAMESPACE, { zh, en }), 'dsh-opencode-plugin: locale')
  const t = ctx.locale.bind(OPENCODE_LOCALE_NAMESPACE) as OpenCodeTranslate
  const timer = ctx.get('timer') as TimerService
  // 详情页与输入区胶囊是两个独立座位，共享同一个偏好 store：设置保存后胶囊
  // 能立即看到新的显隐策略，无需等待轮询或刷新页面。
  const preferences = createPreferencesStore()

  /**
   * 配置入口挂在插件管理页的组合包详情页。
   *
   * 座位选 `plugins.detail.section` 而不是官方的 `plugins.bundle.config`：
   * 上游 `PackageDetail` 的固定顺序是 `bundle.config` → 「包含的组件」→
   * `plugins.detail.section`，只有这个座位能出现在组件列表之后。
   *
   * 代价是该座位是 **list**（非 keyed）：页面会给打开的每个详情页渲染它，因此
   * 组件必须自己看 `subject`——不是本插件的组合包就返回 `null`（判定见
   * `isOpenCodeBundleSubject`）。list 座位要求 `id`，且不能声明 `inject`
   * （owner props 由页面传入）。
   */
  ctx.slots.inject(OPENCODE_DETAIL_SLOT, () => ctx.slots.register({
    name: OPENCODE_DETAIL_SLOT,
    id: OPENCODE_DETAIL_ID,
    order: OPENCODE_DETAIL_ORDER,
  }, (props: { subject?: OpenCodePluginSubject | undefined }) => (
    <OpenCodeSection t={t} preferences={preferences} timer={timer} subject={props.subject} />
  )))

  /**
   * 输入区右侧的用量胶囊（与 Codex / CodeBuddy 的用量图标同一座位）。
   * `inject` 在 React 之外执行，因此这里只传服务与文案，`useProjection`
   * 由渲染器作为座位标准套件提供。
   */
  ctx.slots.inject(OPENCODE_USAGE_SLOT, () => ctx.slots.register({
    name: OPENCODE_USAGE_SLOT,
    id: OPENCODE_USAGE_ID,
    order: OPENCODE_USAGE_ORDER,
    inject: (): OpenCodeUsageStatusInjected => ({ t, timer, preferences }),
  }, OpenCodeUsageStatus))
}
