/**
 * FNOS-010 插件的浏览器半侧：插件详情页的配置区与用量区块。
 *
 * 两块都在 `plugins.detail.section` 座位上渲染，顺序为「配置表单 → 平台用量」，
 * 整体位于「包含的组件」**之后**（上游 `PackageDetail` 的固定顺序：
 * `bundle.config` → 包含的组件 → `detail.section`）。配置区用官方 `SettingsForm`
 * 渲染标量字段、Semi UI 自绘账号列表与开关，保存走官方 `mutate`。
 *
 * 搜索本身完全在 host 侧（复合提供方），浏览器不参与检索。
 */
import '../styles/index.scss'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { installSemiDshTheme } from '@tnnevol/dsh-semi-ui'
import { SettingsFormModel, settingsNumberField } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { FAILOVER_PACKAGE_NAME, FAILOVER_SETTINGS_NAMESPACE } from '../contracts/constants.ts'
import { FAILOVER_ACCOUNTS_ENDPOINT, FAILOVER_REFRESH_ENDPOINT, FAILOVER_REVEAL_ENDPOINT, FAILOVER_USAGE_CHANNEL, FAILOVER_USAGE_ENDPOINT } from '../contracts/usage-rpc.ts'
import type { AccountsSnapshot, RevealKeySnapshot, UsageSnapshot } from '../contracts/usage-rpc.ts'
import type { AccountSummaryView } from './account-list.ts'
import { FailoverConfigSection } from './config-section.tsx'
import type { PluginSettings } from './config-section.tsx'
import { en, zh } from './locales.ts'
import type { UsageLocaleKey } from './locales.ts'
import { FailoverUsageSection } from './usage-section.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'plugins.failoverSearch': UsageLocaleKey
  }
}

/** Cordis 客户端插件名。 */
export const name = 'dsh-failover-search-plugin-client'

/** 需要的客户端服务：座位、本地化、连接层 RPC 与共享配置表单。 */
export const inject = ['slots', 'locale', 'connection', 'configForms']

/** 用量区块与配置区的文案命名空间。 */
const NS = 'plugins.failoverSearch'

/** Connection 的 RPC 面（装饰性收窄，只用到 `call`）。 */
interface ConnectionRpc {
  call: <T>(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal) => Promise<{ ok: true, value: T } | { ok: false, error: { code: string, message: string } }>
}

/**
 * 挂载配置区与用量区块。
 * @param ctx - 浏览器插件上下文。
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => installSemiDshTheme(), 'dsh-failover-search: Semi DSH theme')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-failover-search: locale')
  const t = ctx.locale.bind(NS) as (key: UsageLocaleKey) => string

  const rpc = (ctx.get('connection') as unknown as { rpc: ConnectionRpc }).rpc

  /**
   * 官方共享配置表单：按插件入口 id 取到，读写都在同一份配置文档上。
   *
   * 只处理标量字段（超时、刷新间隔、开关）：顺序与账号列表由组件自绘交互、写入仍走
   * 同一份 `mutate`，所以「官方能表达的字段留在官方表单」与「官方控件表达不了的交互
   * 自绘」并存，不存在第二套配置存储。
   */
  const form = (ctx.get('configForms') as unknown as { get: <T>(id: string) => ConfigForm<T> }).get<PluginSettings>(FAILOVER_SETTINGS_NAMESPACE)
  const model = new SettingsFormModel<PluginSettings>(form, [
    settingsNumberField('timeoutMs'),
    settingsNumberField('usageRefreshMinutes'),
  ])
  ctx.effect(() => () => { model.dispose() }, 'dsh-failover-search: config form subscription')

  /**
   * 读取用量快照。
   *
   * 失败在这里收敛成拒绝：区块把它呈现为「用量快照不可用」，不影响搜索链路
   * （用量端点失败从不进入搜索错误链路）。
   */
  const load = async (): Promise<UsageSnapshot> => {
    const result = await rpc.call<UsageSnapshot>(FAILOVER_USAGE_CHANNEL, FAILOVER_USAGE_ENDPOINT, {})
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
    return result.value
  }

  /**
   * 强制重查平台用量端点并返回新快照（FNOS-010-08-AC-04）。
   *
   * 与 `load` 分成两条 RPC：`load` 只读内存快照（打开页面就该用这个，不产生外部
   * 请求），`refresh` 才真实打到两个平台的免费查询端点。宿主侧复用后台刷新用的
   * 同一个 `refreshUsage`，因此单个账号查询失败不会让整次刷新失败。
   */
  const refresh = async (): Promise<UsageSnapshot> => {
    const result = await rpc.call<UsageSnapshot>(FAILOVER_USAGE_CHANNEL, FAILOVER_REFRESH_ENDPOINT, {})
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
    return result.value
  }

  /**
   * 读取账号 key 掩码。
   *
   * 明文 key 是 secret 角色、不随配置读取面跨线，因此「这一行配的是哪个 key」只能由
   * host 送回不可还原的掩码。取不到时返回空数组：界面回落到「已保存」状态，不阻塞配置区
   * 其余部分的使用。
   */
  const loadSummaries = async (): Promise<readonly AccountSummaryView[]> => {
    try {
      const result = await rpc.call<AccountsSnapshot>(FAILOVER_USAGE_CHANNEL, FAILOVER_ACCOUNTS_ENDPOINT, {})
      return result.ok ? result.value.accounts : []
    } catch {
      // 掩码是展示增强：取不到就退化为「已保存」标签。
      return []
    }
  }

  /**
   * 复制某个账号的 key 到剪贴板。
   *
   * 明文是 secret 角色、不随配置读取面跨线，所以这里按「平台 + 代号」向 host 取一次，
   * 取到立刻写剪贴板，**不放进组件状态**——放进去就等于把明文留在内存与重渲染路径上，
   * 也失去了「只在用户点击时取」这个约束。
   *
   * 返回是否成功，供按钮显示「已复制」；失败不抛给调用方，避免一次复制失败打断列表渲染。
   */
  const copyKey = async (platform: string, label: string): Promise<boolean> => {
    try {
      const result = await rpc.call<RevealKeySnapshot>(FAILOVER_USAGE_CHANNEL, FAILOVER_REVEAL_ENDPOINT, { platform, label })
      if (!result.ok) return false
      await navigator.clipboard.writeText(result.value.key)
      return true
    } catch {
      return false
    }
  }

  /**
   * 详情页区块：配置区 + 平台用量，都挂在 `plugins.detail.section`。
   *
   * 座位选择理由（与其他插件一致）：上游 `PackageDetail` 的固定顺序是
   *
   *   1. `plugins.bundle.config`（组合包自己的配置）
   *   2. 「包含的组件」（`RowsSection`，插件自己那一行）
   *   3. `plugins.detail.section`（本座位）
   *
   * `bundle.config` **永远**排在「包含的组件」之前，插件无法用它把内容放到组件
   * 列表下方；而需求要的顺序是「包含的组件 → 配置区 → 平台用量」。因此用
   * `detail.section`。换座位不影响写入路径：配置表单仍经 `configForms` 按**插件
   * 入口 id** 取得，与座位无关，读写照样走官方 `mutate`。
   *
   * 该座位是 **list**（不是 keyed）：页面会给打开的任何详情页都渲染它，因此必须
   * 自己判断 `subject`——不是本插件的组合包就返回 `null`，否则这段界面会出现在
   * 别的插件详情页上。list 座位要求 `id`，且不能声明 `inject`（owner props 由
   * 页面传入）。
   */
  ctx.slots.inject('plugins.detail.section', () => ctx.slots.register({
    name: 'plugins.detail.section',
    id: 'dsh-failover-search',
    order: 70,
  }, (props: { subject?: FailoverSubject }) => {
    if (props.subject === undefined) return null
    if (props.subject.kind !== 'bundle') return null
    if (props.subject.pkg?.name !== FAILOVER_PACKAGE_NAME) return null
    // 掩码由组件自己持有并刷新：slot 渲染函数不适合挂插件级状态，交给组件更直接。
    // 用 JSX 元素而不是直接调用组件函数：两个子组件各自持有 hooks，直接调用会把它们
    // 挂到座位渲染器的 hook 链上，顺序一乱就破坏 hook 规则。
    return (
      <>
        <FailoverConfigSection t={t} form={form} model={model} loadSummaries={loadSummaries} copyKey={copyKey} />
        <FailoverUsageSection t={t} load={load} refresh={refresh} revision={form.getSnapshot().revision} />
      </>
    )
  }))
}

/** `plugins.detail.section` 的 owner props 子集：只关心正在打开的页面主题。 */
interface FailoverSubject {
  readonly kind?: string
  readonly pkg?: { readonly name?: string } | undefined
}
