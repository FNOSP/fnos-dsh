/** Browser half of the fnOS-specific DSH integration plugin. */

import '../styles/index.scss'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { FnosLocaleKey } from './locales.ts'
import type { ReferenceInsert, SessionInput } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { CommandUiContract } from '@deepseek-ai/dsh-client-ui-commands/client'
import type {} from '@deepseek-ai/dsh-client-ui-commands/client'
import type { InputTriggerServiceContract, InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: 拉入插件管理页对 `plugins.detail.section` 的登记契约
// （`PluginDetailProps`）。该包只在类型层使用，运行时不 import——客户端模块表
// 里没有它，运行时引入会直接报模块缺失。
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: 拉入 ui-session 对 GlobalStandardProps/SessionStandardProps 的合并
// （useSessions、sessionId、useProjection），会话作用域座位的标准套件才有类型。
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { FnosInputPickerButton } from '../components/FnosInputPickerButton.tsx'
import { FnosAuthorizedPathPanel } from '../components/FnosAuthorizedPathPicker.tsx'
import { FnosOpenInHeaderAction } from '../components/FnosOpenInHeaderAction.tsx'
import { FnosSessionLogHeaderAction } from '../components/FnosSessionLogHeaderAction.tsx'
import { FnosPanelMain, FnosPanelRow } from '../components/FnosPanelRow.tsx'
import { FnosRefreshMenuEntry, FnosRestartMenuEntry } from '../components/FnosWebActionsMenuEntry.tsx'
import { FnosConfigOverlay } from '../components/FnosConfigOverlay.tsx'
import { FNOS_OPEN_IN_APP_SEAT, FNOS_SESSION_LOG_SEAT } from './header-utility-seats.ts'
import { createPickerOpenStore } from './input-references/picker-store.ts'
import { insertFnosReferences } from './input-references/input-reference-actions.ts'
import { createFnosCommandContribution, createFnosDirectorySource } from './input-references/fnos-command-source.ts'
import { FNOS_REFERENCE_SOURCE, fnosReferenceDisplayText, fnosReferencePromptText, type FnosInputReference, type InputSnapshotForReference } from './input-references/input-references.ts'
import { en, zh } from './locales.ts'
import { de } from './locales.de.ts'
import { es } from './locales.es.ts'
import { fr } from './locales.fr.ts'
import { it } from './locales.it.ts'
import { ja } from './locales.ja.ts'
import { ko } from './locales.ko.ts'
import { ru } from './locales.ru.ts'
import { ensurePluginLanguages, registerPluginDictionaries } from './language-pack.ts'
import { installFnosLanguageSync } from './services/language-sync.ts'
import { installFnosRemotePathOpener } from './services/path-opener.ts'
import { installFnosPresentedOpen } from './services/present-open.ts'
import { FnosSettingsDocumentAction } from '../components/FnosSettingsDocumentAction.tsx'
import { installFnosBrowserRefreshShortcut } from './shortcuts/browser-refresh-shortcut.ts'
import { installFnosSettingsShortcut } from './shortcuts/settings-shortcut.ts'
import { isEmbeddedFnosFrame } from './services/sdk-carrier.ts'
import { createTrimApp } from './services/sdk.ts'
import { installFnosPageTitle } from './services/sdk-title.ts'
import { createThemeBridge } from './services/theme-bridge.ts'
import { createThemePersistence } from './services/theme-persistence.ts'
import { createThemeController } from './services/theme-controller.ts'
import { installWorkspaceAuthorizedShortcut } from './shortcuts/workspace-authorized-shortcut.ts'
import type { FnosSettings } from '../contracts/theme-contract.ts'
import { installSemiDshTheme } from '@tnnevol/dsh-semi-ui'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.dsh-fnos': FnosLocaleKey
  }
}

export const name = 'dsh-fnos-plugin-client'
export const inject = ['theme', 'slots', 'locale', 'sessions', 'inputTriggers', 'commandUi', 'remote', 'remote.session', 'configForms', 'sessionLogDownload']

type SessionLogDownloadState = {
  bySession: Record<string, { open: boolean, status: 'downloading' | 'success' | 'error', error: string | null } | undefined>
}

type SessionLogDownloadStore = {
  getSnapshot: () => SessionLogDownloadState
  subscribe: (listener: () => void) => () => void
}

type SessionLogDownloadController = {
  store: SessionLogDownloadStore
  download: (sessionId: SessionId) => Promise<void>
  dismiss: (sessionId: SessionId) => void
}

export function apply(ctx: ClientContext): void {
  ctx.effect(() => installSemiDshTheme(), 'dsh-fnos: Semi DSH theme')
  const bridge = createThemeBridge()
  const fnosSettings = ctx.configForms.get<FnosSettings>('dsh-fnos')
  {
    const controller = createThemeController(ctx, bridge, createThemePersistence(fnosSettings))

    ctx.effect(() => {
      const unsubscribe = bridge.subscribe(() => { controller.refresh() })
      const unsubscribeSettings = fnosSettings.subscribe(() => { controller.refresh() })
      const offThemeChange = ctx.on('theme/change', () => { controller.refresh() })
      controller.refresh()
      void bridge.connect().catch(error => {
        console.debug('[dsh-fnos] unable to connect to fnOS theme events', error)
      })

      return async () => {
        unsubscribe()
        unsubscribeSettings()
        offThemeChange()
        await bridge.disconnect()
        controller.dispose()
      }
    }, 'dsh-fnos: fnOS theme bridge')
  }

  /** 「飞牛 OS」面板 id：侧栏行与 main 视图靠它配对。 */
const FNOS_CONFIG_PANEL_ID = 'dsh-fnos-config'

const namespace = 'settings.dsh-fnos'
  ctx.effect(() => ctx.locale.register(namespace, { zh, en }), 'dsh-fnos: locale')
  // FNOS-045：先补齐可选语言（已存在则跳过，六个插件可能都想注册同一批 id），
  // 再登记本插件命名空间的各语言字典。
  ctx.effect(() => ensurePluginLanguages(ctx), 'dsh-fnos: language pack')
  ctx.effect(
    () => registerPluginDictionaries(ctx, namespace, { ja, ko, de, fr, es, it, ru }),
    'dsh-fnos: locale dictionaries',
  )
  // 飞牛界面语言 → DSH 界面语言。SDK 不可用只记调试日志，不影响启动。
  ctx.effect(() => {
    let stop: (() => void | Promise<void>) | undefined
    void installFnosLanguageSync(ctx, {
      availableLocales: () => ctx.locale.getLocale().locales,
      setLocale: id => { ctx.locale.setLocale(id) },
      createSdk: createTrimApp,
    }).then(dispose => { stop = dispose }).catch(error => {
      console.debug('[dsh-fnos] unable to sync DSH locale from fnOS', error)
    })
    return () => { void stop?.() }
  }, 'dsh-fnos: fnOS language sync')
  const t = ctx.locale.bind(namespace) as (key: FnosLocaleKey) => string

  ctx.effect(() => installFnosRemotePathOpener(ctx.remote.session, {
    createSdk: createTrimApp,
    message: key => t(key),
  }), 'dsh-fnos: fnOS path opener')
  ctx.effect(() => installFnosPageTitle(createTrimApp), 'dsh-fnos: fnOS page title')
  ctx.effect(() => installFnosBrowserRefreshShortcut(), 'dsh-fnos: browser refresh shortcut')
  ctx.effect(() => installFnosSettingsShortcut(), 'dsh-fnos: settings shortcut')
  ctx.effect(() => installWorkspaceAuthorizedShortcut(t), 'dsh-fnos: workspace authorized shortcut')

  const source: InputTriggerSource = {
    trigger: '@',
    name: FNOS_REFERENCE_SOURCE,
    candidates: async () => [],
    onPick: () => undefined,
    codec: {
      clipboardText: ref => fnosReferencePromptText(ref),
      serialize: async ref => fnosReferencePromptText(ref),
    },
  }
  const directorySource = createFnosDirectorySource(t)
  const inputTriggers = ctx.get('inputTriggers') as InputTriggerServiceContract
  ctx.effect(() => {
    const unregister = inputTriggers.registerSource(source)
    const unregisterDirectorySource = inputTriggers.registerSource(directorySource)
    return () => {
      unregisterDirectorySource()
      unregister()
    }
  }, 'dsh-fnos: fnOS input reference source')

  ctx.inject(['commandUi'], (scope: ClientContext) => {
    const commandUi = scope.get('commandUi') as CommandUiContract
    scope.effect(() => commandUi.register(createFnosCommandContribution(
      t,
      (sessionId, reference) => insertFnosCommandReference(ctx, sessionId, reference),
    )), 'dsh-fnos: /fn command contribution')
  })

  if (isEmbeddedFnosFrame()) {
    ctx.effect(() => installFnosPresentedOpen(createTrimApp), 'dsh-fnos: presented-file opener')
    ctx.slots.inject('conversation.session.header.utilities', () => {
      const sessionLogDownload = ctx.get('sessionLogDownload') as SessionLogDownloadController | undefined
      if (sessionLogDownload === undefined) throw new Error('sessionLogDownload service is unavailable')
      return ctx.slots.register({
        ...FNOS_SESSION_LOG_SEAT,
        locale: namespace,
        inject: (sessionId) => ({
          hooks: { sessionLogDownload: sessionLogDownload.store },
          sessionId,
          exportToComputer: (sessionId: SessionId) => sessionLogDownload.download(sessionId),
          dismissDownload: (sessionId: SessionId) => { sessionLogDownload.dismiss(sessionId) },
        }),
      }, FnosSessionLogHeaderAction)
    })
    // 遮蔽 DSH 官方的「打开应用」按钮（同 id、更低 priority，低者生效）。
    //
    // 官方按钮按编译期常量表探测本机应用，在 fnOS 上会把系统的 ZFS Event
    // Daemon（`/usr/sbin/zed`）误判为 Zed 编辑器，且取不到对应图标，菜单里
    // 因此出现一个点了也打不开编辑器的条目。该常量表不可配置，所以在这里用
    // fnOS 自己的文件能力替代它。只改 fnOS iframe 内的表现。
    // 排序（priority 升序、再 order 升序）与遮蔽规则的取值集中在
    // `header-utility-seats.ts`，并由测试用真实 SlotCore 驱动验证实际顺序。
    ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
      ...FNOS_OPEN_IN_APP_SEAT,
      locale: namespace,
      inject: () => ({ t }),
    }, FnosOpenInHeaderAction))
    ctx.slots.inject('settings.action', () => ctx.slots.register({
      name: 'settings.action',
      id: 'open-document',
      order: 0,
      priority: -1,
      locale: namespace,
      inject: () => ({ t }),
    }, FnosSettingsDocumentAction))
  }
  /*
   * 详情页不再挂配置块：授权目录与依赖修复已收进「更多」菜单打开的配置弹框
   * （`FnosConfigMenuEntry`）。同一份设置只保留一个入口，避免两处都能改。
   */

  /*
   * 刷新 / 重启不再挂在侧栏底部：它们已并入会话头部的「…」菜单
   * （`FnosSessionLogHeaderAction`）。两个都是低频动作，常驻两个按钮位不划算。
   */

  /**
   * 授权目录选择器拆成两个槽位条目，共享一个会话级开关 store：
   *
   *  - `conversation.input.left`：工具栏里的 fnOS 图标，只翻转开关；
   *  - `conversation.input.overlay`：卡片宽的浮层面板，位置与斜杠指令面板
   *    一致（该槽锚点是输入卡片内部的零高定位上下文）。
   *
   * 两个条目没有父子关系，拿不到对方的 ref，只能靠外部 store 同步。
   * overlay 座位的 `order` 取 10：排在指令面板(0)、命令选择(1)与反馈框(2)
   * 之后，同一时刻最多只有一个由用户主动打开。
   */
  const pickerStore = createPickerOpenStore()
  ctx.effect(() => () => { pickerStore.closeAll() }, 'dsh-fnos: picker store')
  /**
   * **侧栏面板列表里的「飞牛 OS」入口，位于「更多」之上。**
   *
   * 「插件」「自动化任务」那一组由 `sidebar.panellist` 渲染，「更多」是
   * `panelList` 里固定的最后一项——所以要排在它上方，就得注册成本槽位的一行。
   *
   * 代价：`sidebar.panellist` 的语义是「可切换面板」，点击会走
   * `layout.selectPanel(id)`，而它**先校验 `hasMainPanel(id)`**、没有配对主视图
   * 直接抛错。因此必须同时注册 `main` 视图。
   *
   * 那个主视图只渲染一句占位说明并在挂载时打开配置弹框——位置借面板行的外观，
   * 行为仍是弹框（见 `FnosPanelRow.tsx` 的说明）。
   *
   * `order: 20` 让它排在「自动化任务」（10）之后、「更多」之前。
   */
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: FNOS_CONFIG_PANEL_ID,
    order: 20,
    locale: namespace,
    label: () => t('configMenuEntry'),
    inject: () => ({ t }),
  }, FnosPanelRow))
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: FNOS_CONFIG_PANEL_ID,
    locale: namespace,
    inject: () => ({ t }),
  }, FnosPanelMain))
  /**
   * 「刷新页面」与「重启服务」两行仍留在「更多」菜单里（order 91/92）。
   *
   * 它们都是「整个应用」级别的操作，与会话无关——原先挂在会话头部工具条，
   * 语义不对且占用头部宽度。放进同一菜单后与面板动作归为一类。
   */
  ctx.slots.inject('sidebar.panellist.actions', () => ctx.slots.register({
    name: 'sidebar.panellist.actions',
    id: 'dsh-fnos-refresh-entry',
    order: 91,
    locale: namespace,
    inject: () => ({ t }),
  }, (props: { onDismiss?: () => void }) => FnosRefreshMenuEntry({ ...props, t })))
  ctx.slots.inject('sidebar.panellist.actions', () => ctx.slots.register({
    name: 'sidebar.panellist.actions',
    id: 'dsh-fnos-restart-entry',
    order: 92,
    locale: namespace,
    inject: () => ({ t }),
  }, (props: { onDismiss?: () => void }) => FnosRestartMenuEntry({ ...props, t })))

  /**
   * 配置弹框本体挂在 `shell.overlay`（官方挂 portal 弹框的槽位），不挂在菜单项的
   * 子树里：菜单选中后会关闭并卸载整棵子树，弹框的可见状态会随之丢失。
   */
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'dsh-fnos-config-dialog',
    locale: namespace,
    inject: () => ({ t }),
  }, FnosConfigOverlay))

  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'dsh-fnos-input-picker',
    order: 100,
    locale: namespace,
    inject: () => ({ store: pickerStore }),
  }, FnosInputPickerButton))
  ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({
    name: 'conversation.input.overlay',
    id: 'dsh-fnos-path-panel',
    order: 10,
    locale: namespace,
    inject: (sessionId: string) => ({
      store: pickerStore,
      insertReferences: (input: InputSnapshotForReference, references: readonly FnosInputReference[]) => insertFnosReferences(ctx, sessionId as SessionId, references, input),
    }),
  }, FnosAuthorizedPathPanel))
}

/** Insert a command-popup selection over the currently open `/` or `/fn` token. */
function insertFnosCommandReference(ctx: ClientContext, sessionId: SessionId, reference: FnosInputReference): boolean {
  const actx = ctx.sessions.scope(sessionId)
  if (actx === undefined) return false
  const conversation = actx.get('conversation') as { input: { for: (scope: ClientContext) => SessionInput } } | undefined
  const input = conversation?.input.for(actx)
  if (input === undefined) return false
  const state = input.state.getSnapshot()
  const token = state.draft.endsWith('/fn')
    ? '/fn'
    : state.draft.endsWith('/f')
      ? '/f'
      : state.draft.endsWith('/') ? '/' : undefined
  if (token === undefined) return false
  const start = state.draft.length - token.length
  const value: ReferenceInsert = {
    source: FNOS_REFERENCE_SOURCE,
    ref: reference.ref,
    label: reference.semanticPath.split('/').filter(Boolean).at(-1) ?? reference.semanticPath,
    appearance: reference.kind === 'directory' ? 'folder' : 'file',
    clipboardText: fnosReferenceDisplayText(reference),
  }
  return input.insertReference(value, { start, end: state.draft.length, draftRev: state.draftRev })
}
