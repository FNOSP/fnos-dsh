/**
 * 把 `web` 接缝的提供方选择切回本插件（FNOS-010-12 补充）。
 *
 * 背景：`web` 行的 `searchProvider` / `fetchProvider` 是**固定选择**语义——配了哪个
 * id，接缝就只用那个 provider，其它 provider 即使注册成功也不会被走到（官方
 * `resolveProvider`）。官方「网络搜索」设置页保存时会把这两个键写成官方 id，于是
 * 本插件的复合提供方永远不被调用：表现为「插件页看着正常、账号也在，但
 * `web_search` / `web_fetch` 走的是官方端点」，官方余额一耗尽就直接 402。
 *
 * 这里给「智能搜索」开关的**重新开启**补上修复动作：写 `web` 命名空间的两个键。
 * 只写开启方向——关闭是会话级偏好（该会话不接入），不应影响其它会话的全局选择。
 */
import { FAILOVER_PROVIDER_ID, WEB_SETTINGS_NAMESPACE } from '../contracts/constants.ts'
import { readRecord, readString } from './http.ts'

/** settings 服务中本模块用到的一条配置条目（投影后的有效值）。 */
export interface SettingsEntryLike {
  /** profile 条目 id，即配置命名空间。 */
  readonly ns: string
  /** 当前**生效**的配置值（已合并 bundle 层与覆盖层）。 */
  readonly value: unknown
}

/**
 * settings 服务的最小可写面。
 *
 * 只声明用到的两个方法：本插件不 import 官方 settings 包的具体导出（服务访问型
 * peer 依赖的既有约定），形状在这里收敛，避免把上层实现绑死。
 */
export interface SettingsFormsLike {
  /** 列出可配置条目及其生效值。 */
  describe: () => readonly SettingsEntryLike[]
  /** 合并写入某条目的可编辑字段。 */
  update: (ns: string, patch: Record<string, unknown>) => Promise<void>
}

/** 一次接管尝试的结局。 */
export type WebSelectionOutcome =
  /** 两个键本来就已经指向本插件，没有写入。 */
  | 'already'
  /** 已写入两个键。 */
  | 'updated'
  /** 缺少 settings 服务或 `web` 条目不可配置，无法写入。 */
  | 'skipped'

/**
 * 确保 `web` 接缝的搜索与抓取都选中本插件。
 *
 * 判定依据是 `describe()` 投影出的**生效值**（`value`），而不是覆盖层：这样在
 * 「无覆盖、bundle 层已经指向本插件」时不会产生一次多余写入，也不会把等价的覆盖
 * 写进 profile。
 *
 * 写入失败由调用方处理：这里不吞异常，让上层决定是记日志还是上报（开关本身
 * 不能因为配置写不进去而失败）。
 *
 * @param settings - settings 服务（可能尚未就绪）。
 * @returns 接管结局。
 */
export async function ensureWebSelection(settings: SettingsFormsLike | undefined): Promise<WebSelectionOutcome> {
  if (settings === undefined) return 'skipped'

  // `web` 条目必须存在且可配置：被禁用时 describe() 不会列出它，此时无从写入。
  const entry = settings.describe().find(row => row.ns === WEB_SETTINGS_NAMESPACE)
  if (entry === undefined) return 'skipped'

  const current = readRecord(entry.value)
  if (
    readString(current.searchProvider) === FAILOVER_PROVIDER_ID
    && readString(current.fetchProvider) === FAILOVER_PROVIDER_ID
  ) {
    return 'already'
  }

  await settings.update(WEB_SETTINGS_NAMESPACE, {
    searchProvider: FAILOVER_PROVIDER_ID,
    fetchProvider: FAILOVER_PROVIDER_ID,
  })
  return 'updated'
}
