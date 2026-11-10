/**
 * 「自定义插件索引」：检测官方插件市场是否启用，并一键写入两个推荐索引源。
 *
 * ## 依赖边界
 *
 * 索引源存在**官方插件市场自己的** settings 里（`@deepseek-ai/dsh-plugin-market`
 * 的 `indexes: string[]`，字段名与默认值见其 `Config`）。因此：
 *
 * - 市场没装 → 索引功能本身不存在，界面必须置灰并说明，而不是写一份没人读的配置；
 * - 市场装了 → 用 `ctx.settings.update('plugin-market', { indexes })` 写入。
 *
 * entry id `plugin-market` 由官方 bundle 的 `cordis.patch.yml` 固定（见
 * `dsh-experimental-plugin-market-bundle`），不是猜出来的。
 *
 * @module dsh-fnos/plugin-index-sources
 */

import type { Context } from '@deepseek-ai/cordis'

/** 官方插件市场的 settings entry id（由官方 bundle 固定）。 */
export const MARKET_ENTRY_ID = 'plugin-market'

/**
 * 本插件推荐的两个索引源。
 *
 * 一个自有站点（跟随项目发布，可离线自建），一个 jsDelivr 上的 npm 包
 * （全球 CDN，不依赖自有域名）。两者内容同源，互为备份。
 */
export const RECOMMENDED_INDEXES: readonly string[] = [
  'https://fndsh-doc.tnnevol.cn/plugins/market/index.json',
  'https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json',
]

/** 索引状态。 */
export interface PluginIndexStatus {
  /** 插件市场是否已挂载（没装时为 false，两键不可用）。 */
  readonly marketAvailable: boolean
  /** 不可用原因。 */
  readonly reason?: string
  /** 当前已配置的索引源。 */
  readonly configured: readonly string[]
  /** 推荐源里当前**缺失**的部分。 */
  readonly missing: readonly string[]
  /** 推荐的源（原样返回，界面据此展示「应该配哪些」）。 */
  readonly recommended: readonly string[]
}

/**
 * 读当前已配置的索引源。
 *
 * 优先读 settings 文档（那是持久化的权威值）；市场服务未挂载时返回 undefined。
 * @param ctx - 宿主上下文。
 * @returns 索引源数组；不可用时 undefined。
 */
function readConfigured(ctx: Context): readonly string[] | undefined {
  try {
    const descriptor = ctx.settings.describe().find(row => row.ns === MARKET_ENTRY_ID)
    const value = descriptor?.value as { indexes?: unknown } | undefined
    if (value === undefined) return undefined
    return Array.isArray(value.indexes) ? value.indexes.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return undefined
  }
}

/**
 * 读索引状态。
 * @param ctx - 宿主上下文。
 * @returns 状态。
 */
export function readIndexStatus(ctx: Context): PluginIndexStatus {
  const configured = readConfigured(ctx)
  if (configured === undefined) {
    return {
      marketAvailable: false,
      reason: 'plugin-market-not-installed',
      configured: [],
      missing: [...RECOMMENDED_INDEXES],
      recommended: [...RECOMMENDED_INDEXES],
    }
  }
  const present = new Set(configured.map(url => url.trim().replace(/\/+$/u, '')))
  const missing = RECOMMENDED_INDEXES.filter(url => !present.has(url.trim().replace(/\/+$/u, '')))
  return { marketAvailable: true, configured, missing, recommended: [...RECOMMENDED_INDEXES] }
}

/**
 * 一键设置：把缺失的推荐源补进去。
 *
 * **只追加、不覆盖**：用户可能自己配了别的源，整份替换会把它删掉。
 * 已存在的（含尾斜杠差异）不重复添加。
 *
 * @param ctx - 宿主上下文。
 * @returns 写入后的状态。
 */
export async function applyRecommendedIndexes(ctx: Context): Promise<PluginIndexStatus> {
  const status = readIndexStatus(ctx)
  if (!status.marketAvailable) return status

  const merged = [...status.configured]
  const present = new Set(merged.map(url => url.trim().replace(/\/+$/u, '')))
  for (const url of RECOMMENDED_INDEXES) {
    if (!present.has(url.trim().replace(/\/+$/u, ''))) merged.push(url)
  }
  await ctx.settings.update(MARKET_ENTRY_ID, { indexes: merged })
  return readIndexStatus(ctx)
}
