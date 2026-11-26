/**
 * 用 DSH 官方的快捷键服务注册飞牛的两个全局命令。
 *
 * ## 为什么改用官方服务
 *
 * 早前是自建方案：挂一个隐藏 DOM 节点 → `createRoot` 渲染 `DshHotKeys` →
 * 在 window 捕获阶段自己判键 → 为 `preventDefault` 的时序绕行做注释和开关。
 *
 * 那套东西**不会出现在 DSH 的「快捷键」面板里**，用户看不到、也改不了；而且
 * 每条命令都要自己处理重入与冒泡顺序。
 *
 * 官方 `ctx.shortcuts.register` 直接解决这些：
 *
 * - 出现在面板，支持自定义绑定；
 * - 自动做冲突检测与键位预留；
 * - `defaults` 按 `<runtime>:<platform>` 分别给默认键，不必自己探测平台；
 * - **`resolve` 返回 `handled` 时官方会先 `preventDefault` 再执行**（见
 *   `registry.dispatch`：`consume()` 在 `run()` 之前），所以「拦住浏览器默认
 *   行为」是免费的——浏览器不会再拿 `Ctrl+,` 去开设置、也不会拿 `Ctrl+R` 刷新。
 *
 * ## 保留的两处自建部分
 *
 * - **只在 fnOS 环境生效**：`resolve` 里判环境，不满足返回 `pass`（既不拦也不做），
 *   浏览器恢复它自己的行为。飞牛插件也可能被装在普通 DSH Web 上。
 * - **`F5`**：一个可编辑命令在每个 profile 只能绑一个组合，而 `F5` 没有独立归属位
 *   （`Ctrl/Cmd+R` 已占用 web 三个 profile）；`registerFixed` 又要求自己比对
 *   gesture 并调 `consume`，与现状等价。故 `F5` 仍由 `browser-refresh-shortcut.ts`
 *   负责。
 *
 * @module dsh-fnos/client/shortcuts/official-shortcuts
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ShortcutBinding, ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts/client'
import { configDialogStore } from '../config-dialog-store.ts'
import { isFnosHosted } from '../services/environment.ts'
import { isEmbeddedFnosFrame } from '../services/sdk-carrier.ts'
import type { FnosLocaleKey } from '../locales.ts'

type Translate = (key: FnosLocaleKey) => string

/** 设置弹框的 modal 标识：注册后官方会把它视为可交互的模态层。 */
const SETTINGS_MODAL = 'fnos-settings'

/**
 * 注册「打开飞牛设置」与「刷新页面」两个命令。
 * @param ctx - 客户端上下文（需要 `shortcuts` 服务）。
 * @param t - 文案函数。
 * @returns 卸载函数。
 */
export function registerOfficialShortcuts(ctx: ClientContext, t: Translate): () => void {
  const disposers: (() => void)[] = []

  /*
    `Ctrl/Cmd + ,` 打开飞牛设置。

    官方 `settings.open` 在 **web** 运行时绑的是 `primary + alt + Comma`，所以
    `primary + Comma` 在 web 下是空位——正好给飞牛。桌面运行时官方占了它，但飞牛
    只在 fnOS（web）生效，不冲突。

    浏览器本来会拿这个组合开自己的设置面板；返回 `handled` 时官方会
    `preventDefault`，那一步因此被拦住。
  */
  disposers.push(ctx.shortcuts.register({
    id: 'fnos.settings.open' as ShortcutCommandId,
    label: () => t('shortcutOpenFnosSettings'),
    aliases: ['fnos', 'feiniu', '飞牛设置'],
    defaults: {
      'web:macos': { code: 'Comma', modifiers: ['primary'] },
      'web:windows': { code: 'Comma', modifiers: ['primary'] },
      'web:linux': { code: 'Comma', modifiers: ['primary'] },
    },
    /* 只在页面层生效：输入框内的 `Ctrl+,` 不该被打断。 */
    regions: ['page'],
    modals: [],
    resolve: ({ modal }) => {
      if (!isFnosHosted()) return { status: 'pass' }
      if (modal !== null) return { status: 'blocked', reason: 'modal' }
      return { status: 'handled', run: () => { configDialogStore.set(true) } }
    },
  }))

  /*
    `Ctrl/Cmd + R` 刷新当前 DSH 页面。

    与早先的 `browser-refresh-shortcut.ts` 同义：在 fnOS 的 iframe 里，浏览器
    默认的刷新会重载**外层**（fnOS 桌面），而不是 DSH 自己；拦下它改成重载本页面。

    - 非 iframe（独立浏览器页面）：返回 `pass`，让浏览器自己刷新；
    - 终端里：官方对 `KeyR` 有专门放行（反向搜索），不必我们再判。

    返回 `handled` 时官方 `preventDefault`，浏览器不再刷外层。
  */
  const reloadBinding: Record<string, ShortcutBinding> = {
    'web:macos': { code: 'KeyR', modifiers: ['meta'] },
    'web:windows': { code: 'KeyR', modifiers: ['control'] },
    'web:linux': { code: 'KeyR', modifiers: ['control'] },
  }
  disposers.push(ctx.shortcuts.register({
    id: 'fnos.browser.reload' as ShortcutCommandId,
    label: () => t('shortcutReloadPage'),
    aliases: ['reload', 'refresh', '刷新'],
    defaults: reloadBinding,
    regions: ['page', 'editable'],
    modals: [],
    resolve: () => {
      if (!isEmbeddedFnosFrame()) return { status: 'pass' }
      return { status: 'handled', run: () => { window.location.reload() } }
    },
  }))

  return () => { for (const dispose of disposers) dispose() }
}

export { SETTINGS_MODAL }