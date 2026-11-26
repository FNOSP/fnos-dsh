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
import { FnosSessionLogHeaderAction } from '../components/FnosSessionLogHeaderAction.tsx'
import { FnosFooterEntry } from '../components/FnosFooterEntry.tsx'
import { FnosConfigOverlay } from '../components/FnosConfigOverlay.tsx'
import { FnosAccountLoginOverlay } from '../components/FnosAccountLoginOverlay.tsx'
import { LogFeedbackAnchor, LogFeedbackPanel } from '../components/LogFeedbackPanel.tsx'
import { logPanelStore } from './log-panel-store.ts'
import { FNOS_SESSION_LOG_SEAT } from './header-utility-seats.ts'
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
import { postTaskLog } from './services/runtime-status-client.ts'
import { installFnosBrowserRefreshShortcut } from './shortcuts/browser-refresh-shortcut.ts'
import { registerOfficialShortcuts } from './shortcuts/official-shortcuts.ts'
import { isFnosHosted } from './services/environment.ts'
import { createTrimApp } from './services/sdk.ts'
import { installFnosPageTitle } from './services/sdk-title.ts'
import { createThemeBridge } from './services/theme-bridge.ts'
import { createThemePersistence } from './services/theme-persistence.ts'
import { createThemeController } from './services/theme-controller.ts'
import { installWorkspaceAuthorizedShortcut } from './shortcuts/workspace-authorized-shortcut.ts'
import type { FnosSettings } from '../contracts/theme-contract.ts'
import { installSemiDshTheme } from '@tnnevol/dsh-semi-ui'
import { log } from './logger.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.dsh-fnos': FnosLocaleKey
  }
}

export const name = 'dsh-fnos-plugin-client'
export const inject = ['theme', 'slots', 'locale', 'sessions', 'inputTriggers', 'commandUi', 'remote', 'remote.session', 'configForms', 'sessionLogDownload', 'shortcuts']

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
        log.warn('unable to connect to fnOS theme events', error)
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
      log.warn('unable to sync DSH locale from fnOS', error)
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
  ctx.effect(() => registerOfficialShortcuts(ctx, t), 'dsh-fnos: official shortcuts')
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

  /*
   * 这些座位在**两种 fnOS 形态下都要注册**：内嵌 iframe 与独立浏览器页面。
   *
   * 原先这里判的是 `isEmbeddedFnosFrame()`（`window.parent !== window`），
   * 于是独立浏览器页面被当成「本地开发」整支跳过——用户在新标签页打开应用时，
   * 会话头部的日志/文件入口与设置里的「打开配置文件」全都不出现，而且没有任何
   * 报错。改用 `isFnosHosted()`：网关托管即是 fnOS 应用，与是否 iframe 无关。
   *
   * 能力差异留在各组件内部处理（standalone 没有宿主桥，授权类改走 openAppAuth）。
   */
  if (isFnosHosted()) {
    ctx.effect(() => installFnosPresentedOpen(createTrimApp), 'dsh-fnos: presented-file opener')
    ctx.slots.inject('conversation.session.header.utilities', () => {
      const sessionLogDownload = ctx.get('sessionLogDownload') as SessionLogDownloadController | undefined
      if (sessionLogDownload === undefined) throw new Error('sessionLogDownload service is unavailable')
      return ctx.slots.register({
        ...FNOS_SESSION_LOG_SEAT,
        locale: namespace,
        inject: (sessionId) => ({
          sessionId,
          // 只注入导出动作：进度与结果提示由官方 `session-log-export` 自己弹，
          // 本插件不再额外弹一层（否则一次导出会出现两个弹框）。
          exportToComputer: (sessionId: SessionId) => sessionLogDownload.download(sessionId),
        }),
      }, FnosSessionLogHeaderAction)
    })
    /*
      **文件管理入口不再占会话头部的座位。**

      这里曾注册一个分体按钮（左半执行、右半下拉），与官方的「更多操作」并排，
      于是在会话头部出现两个外观相同的「…」按钮：一个是官方的会话菜单，一个是
      本插件自己的菜单，用户分不清该点哪个。

      现在该能力收进「Session log」菜单的「在应用中打开 → 文件管理」二级项——
      与官方在会话头部右键菜单里提供「在应用中打开」是同一层级的心智模型，
      头部因此只保留一个菜单按钮。

      `FNOS_OPEN_IN_APP_SEAT` 常量与 `FnosOpenInHeaderAction` 组件文件保留：
      前者仍被排序用例引用，后者的「用 fnOS 原生文件管理器打开」实现被菜单
      复用（见 `openSessionDirectoryInFileManager`）。
    */
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
   * 详情页不再挂配置块：授权目录与依赖修复已收进侧栏底部「飞牛 OS」入口打开的
   * 配置弹框（`FnosFooterEntry` + `FnosConfigOverlay`）。同一份设置只保留一个
   * 入口，避免两处都能改。
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
   * 「飞牛 OS」入口：注册到 `sidebar.footer.action`（设置行正上方）。
   *
   * ## 位置的选择过程
   *
   * 试过两个位置都不合适：
   *
   * 1. **`sidebar.panellist`（面板行）**：必须同时注册 `main` 视图，因为
   *    `layout.selectPanel(id)` 会校验 `hasMainPanel(id)`。真机上点它会先闪一帧
   *    空白主区域、`main` 槽渲染报错，而且关闭弹框后再点无反应（相同 id 不重新
   *    挂载）。面板行假设「点它 = 切换长期主视图」，与「打开一个菜单」语义不兼容。
   * 2. **`sidebar.panellist.actions`（「更多」菜单）**：那是「全局面板」分组，
   *    飞牛 OS 不是面板，语义不对，而且埋了两层菜单。
   *
   * `sidebar.footer.action` 是侧栏里唯一「应用级、可叠加、与设置同级」的座位：
   * 它就排在设置行上方，注册进去自然获得与设置一致的宽高与折叠表现。
   */
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'dsh-fnos-footer-entry',
    order: 10,
    locale: namespace,
    inject: () => ({ t }),
  }, (props: { wide?: boolean }) => FnosFooterEntry({ wide: props.wide === true, t })))

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

  /*
    账号登录浮层：官方登录框出现时收起它，改由本插件接管。

    与配置弹框同挂 `shell.overlay`，但用独立 id 与更高 order——两者互斥：配置
    弹框是用户主动打开的，登录浮层是被官方框触发的，同时出现的概率极低，但
    id 分开后各自的挂载与卸载互不牵连。
  */
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'dsh-fnos-account-login',
    order: 20,
    locale: namespace,
    inject: () => ({ t }),
  }, FnosAccountLoginOverlay))

  /*
    任务日志浮层：挂在 `shell.overlay`，与配置弹框、登录浮层同座位但独立 id。

    它不挂在任何功能的组件子树里——插件安装、nrm、依赖修复各自的界面会随卡片
    卸载，浮层若跟着卸载，日志就在用户还在等的时候消失了。
  */
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'dsh-fnos-log-panel',
    order: 30,
    locale: namespace,
    inject: () => ({ t }),
  }, LogFeedbackPanel))

  /*
    收起态的吸附按钮：**与浮层同挂 `shell.overlay`**，不占侧栏座位。

    `sidebar.footer.action` 是 `flex-direction: row` 且不换行的单行容器，已被
    「飞牛 OS」入口占满——再塞一项会被排到侧栏右缘之外（实测 x=272，父容器仅
    264px 宽），完全看不见。挂在 overlay 里可以让它浮在浮层原本的位置附近，
    既不挤占侧栏，也不需要跟着侧栏折叠态变样式。
  */
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'dsh-fnos-log-anchor',
    order: 29,
    locale: namespace,
    inject: () => ({ t }),
  }, (props: { wide?: boolean }) => LogFeedbackAnchor({ wide: props.wide === true, t })))

  /* 临时：挂上 `__dshFnosDemoLog` 供评审时手动触发（评审通过后删除）。 */
  /*
    **任务日志转交宿主，最终进入运行日志中心。**

    `ctx.logger` 是**宿主**服务（Node 进程内），浏览器侧没有它——早前直接把
    `ctx.logger` 传进 store 是错的：那段代码什么也没接上，日志只在浮层里出现，
    日志中心看不到。正确路径是经 HTTP 路由交给宿主，由宿主写进日志服务。

    这里接一个转发器：每行日志 POST 到宿主的 `/runtime/task-log`，宿主再调用
    `ctx.logger.info/warn/error`。请求失败时静默——日志是旁路，不能因为它中断任务。
  */
  ctx.effect(() => {
    logPanelStore.attachHostLogger({
      info: line => { void postTaskLog('info', line) },
      warn: line => { void postTaskLog('warn', line) },
      error: line => { void postTaskLog('error', line) },
    })
    return () => { logPanelStore.attachHostLogger(undefined) }
  }, 'dsh-fnos: task log to host')



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
