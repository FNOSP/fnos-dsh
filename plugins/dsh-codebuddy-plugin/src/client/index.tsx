/** CodeBuddy 插件的浏览器端部分。 */

import type { TimerService } from '../types/client/index'
import '../styles/index.scss'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'

import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: 拉入 ui-session 对 SessionStandardProps 的合并（含 useProjection），
// 会话作用域座位的标准套件才不会是空对象。
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: 拉入插件管理页对 `plugins.bundle.config` 的登记契约。
// 该包只在类型层使用，运行时不 import——客户端模块表里没有它。
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { installSemiDshTheme } from '@tnnevol/dsh-semi-ui'
import { CodeBuddyUsageStatus } from '../components/CodeBuddyUsageStatus.tsx'
import type { CodeBuddyUsageStatusInjected } from '../components/CodeBuddyUsageStatus.tsx'
import { CodeBuddyDetailSection } from './panel.tsx'
import type { CodeBuddyDetailProps, CodeBuddyDetailSectionProps } from './panel.tsx'
import { bumpAccountEpoch } from './store/account-epoch.ts'
import { en, zh } from './locales/index.ts'

import type { ConnectionRpc } from './rpc.ts'
import { guardRpc } from './rpc.ts'

/** 本插件文案的设置命名空间。 */
const NS = 'settings.codebuddy'

export const name = 'dsh-codebuddy-plugin-client'
export const inject = ['slots', 'locale', 'connection', 'remote']

export function apply(ctx: ClientContext): void {
  // 账号切换后 host 广播 llm/adapters-updated；bump 代际让用量指示器与插件
  // 详情页各区块即时重拉账号相关数据（模型选择器由 harness 目录自己刷新）。
  const remote = (ctx as unknown as { remote?: { $on: (event: string, listener: () => void) => () => void } }).remote
  ctx.effect(() => {
    if (remote === undefined) return () => {}
    const off = remote.$on('llm/adapters-updated', () => { bumpAccountEpoch() })
    return () => { off() }
  }, 'dsh-codebuddy-plugin: account epoch sync')
  ctx.effect(() => installSemiDshTheme(), 'dsh-codebuddy-plugin: Semi DSH theme')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-codebuddy-plugin: locale')

  const t = ctx.locale.bind(NS) as CodeBuddyDetailProps['t']
  // 连接层的 `call` 声明为 `Promise<RpcResult<T>>`（结果信封），但它在传输失败时
  // 会**拒绝**：主机不可达、socket 断开、非 2xx、rpcId 不匹配都会抛出。各处
  // 调用点只判 `result.ok`，因此那类失败会静默跳过 `setLoading(false)` 之类的
  // 收尾（按钮永久转圈），或变成没人看的未处理拒绝。在唯一取 rpc 的地方收敛成
  // 「永不拒绝」，把声明好的契约补回来——见 `guardRpc` 的实现注释。
  const rpc = guardRpc((ctx.get('connection') as { rpc: ConnectionRpc }).rpc)
  // 输入框指示器在存在 timer service 时按其刷新；DSH client 为此暴露了
  // `ctx.timer`。回退到本地 timer shim，让指示器在最小化组合下也能工作。
  const timer = (ctx.get('timer') as TimerService | undefined) ?? {
    interval(callback: () => void, delay: number): () => void {
      const id = window.setInterval(callback, delay)
      return () => { window.clearInterval(id) }
    },
  }

  /**
   * 配置入口挂在插件管理页的组合包详情页。
   *
   * 座位选 `plugins.detail.section` 而不是官方的 `plugins.bundle.config`：
   * 上游 `PackageDetail` 的固定顺序是
   *
   *   1. `plugins.bundle.config`（组合包自己的配置）
   *   2. 「包含的组件」（`RowsSection`）
   *   3. `plugins.detail.section`（本座位）
   *
   * `bundle.config` **永远**排在「包含的组件」之前，插件无法用它把内容放到组件
   * 列表下方；而需求要求的顺序是「包含的组件 → 设置字段 → 账号管理 → Token
   * 统计」。`detail.section` 是唯一的落点。
   *
   * 代价是它**不按包名分派**（`kind: 'list'` 而非 `keyed`）：页面会给打开的每个
   * 详情页渲染它，因此组件必须自己看 `subject`，不是本插件的组合包就返回
   * `null`——见 `CodeBuddyDetailSection` 的说明。
   *
   * 原先的 `settings.section`（设置弹框里的 CodeBuddy 区块）与 `shell.overlay`
   * （全页面管理面板 + `#/codebuddy/*` hash 路由）都已移除：登录、账号管理、
   * Token 统计、自动偏好全部在这个详情页内完成。
   */
  ctx.slots.inject('plugins.detail.section', () => ctx.slots.register({
    name: 'plugins.detail.section',
    // list 座位要求 id；owner props（`subject`）由页面传入，因此这里**不能**也
    // 不需要 `inject`。rpc/t 经闭包进入组件——它们来自本插件自己的 ctx。
    id: 'codebuddy',
    order: 60,
  }, (props: { subject?: CodeBuddyDetailSectionProps['subject'] }) =>
    <CodeBuddyDetailSection rpc={rpc} t={t} subject={props.subject} />))

  // 实时额度读数放在 composer dock，与 Codex 插件一致。
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: 'codebuddy-usage',
    order: 2,
    inject: (): CodeBuddyUsageStatusInjected => ({ t, timer, rpc }),
  }, CodeBuddyUsageStatus))
}
