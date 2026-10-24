/** ZCode 插件的浏览器半侧。 */

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
import { ZCodeSection } from '../components/ZCodeSection.tsx'
import { ZCodeUsageStatus } from '../components/ZCodeUsageStatus.tsx'
import type { ZCodeUsageStatusInjected } from '../components/ZCodeUsageStatus.tsx'
import { en, zh } from './locales.ts'
import type { ZCodeLocaleKey, ZCodeTranslate } from './locales.ts'
import type { TimerService } from './services/polling.ts'
import { createPreferencesStore } from './services/preferences-data.ts'
import {
  ZCODE_DETAIL_ID,
  ZCODE_DETAIL_ORDER,
  ZCODE_DETAIL_SLOT,
  ZCODE_LOCALE_NAMESPACE,
  ZCODE_USAGE_ID,
  ZCODE_USAGE_ORDER,
  ZCODE_USAGE_SLOT,
} from './services/registration.ts'
import type { ZCodePluginSubject } from './services/registration.ts'

// Keep the renderer-provided slot service visible to consumers that resolve the
// renderer package through a different peer dependency path.
declare module '@deepseek-ai/cordis' {
  interface Context {
    slots: SlotRegistry
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.dsh-zcode': ZCodeLocaleKey
  }
}

export const name = 'dsh-zcode-plugin-client'
/**
 * 与 Codex / OpenCode 插件保持同一套必需服务集合。本插件的数据面是同源 HTTP
 * 路由，运行时不读 `remote.*`；这些命名空间仍按既有约定声明，避免不同装配下
 * Remote 代理的可见性差异。
 */
export const inject = ['slots', 'locale', 'connection', 'remote', 'remote.llm', 'remote.session', 'timer']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => installSemiDshTheme(), 'dsh-zcode-plugin: Semi DSH theme')
  ctx.effect(
    () => ctx.locale.register(ZCODE_LOCALE_NAMESPACE, { zh, en }),
    'dsh-zcode-plugin: locale',
  )
  const t = ctx.locale.bind(ZCODE_LOCALE_NAMESPACE) as ZCodeTranslate
  const timer = ctx.get('timer') as TimerService
  // 详情页与输入区胶囊是两个独立座位，共享同一个偏好 store：设置保存后胶囊
  // 能立即看到新的显隐策略，无需等待轮询或刷新页面。
  const preferences = createPreferencesStore()

  /**
   * 配置入口挂在插件管理页的组合包详情页。
   *
   * 座位选 `plugins.detail.section`：上游 `PackageDetail` 的固定顺序是
   * `bundle.config` → 「包含的组件」→ `plugins.detail.section`，只有这个座位
   * 能出现在组件列表之后。
   *
   * 代价是该座位是 **list**（非 keyed）：页面会给打开的每个详情页渲染它，因此
   * 组件必须自己看 `subject`——不是本插件的组合包就返回 `null`。
   */
  ctx.slots.inject(ZCODE_DETAIL_SLOT, () => ctx.slots.register({
    name: ZCODE_DETAIL_SLOT,
    id: ZCODE_DETAIL_ID,
    order: ZCODE_DETAIL_ORDER,
  }, (props: { subject?: ZCodePluginSubject | undefined }) => (
    <ZCodeSection t={t} preferences={preferences} timer={timer} subject={props.subject} />
  )))

  /**
   * 输入区右侧的用量胶囊（与 Codex / OpenCode 的用量图标同一座位）。
   * `inject` 在 React 之外执行，因此这里只传服务与文案，座位标准套件由渲染器
   * 提供。
   */
  ctx.slots.inject(ZCODE_USAGE_SLOT, () => ctx.slots.register({
    name: ZCODE_USAGE_SLOT,
    id: ZCODE_USAGE_ID,
    order: ZCODE_USAGE_ORDER,
    inject: (): ZCodeUsageStatusInjected => ({ t, timer, preferences }),
  }, ZCodeUsageStatus))
}
