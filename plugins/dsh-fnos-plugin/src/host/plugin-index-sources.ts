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
import type { PluginIndexSourceInfo } from '../contracts/gateway-proxy-contract.ts'

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

/**
 * 索引标题读取超时（毫秒）。
 *
 * 标题只是展示优化，读不到就退回 URL——不该让一个慢索引把整页卡住。
 */
const TITLE_TIMEOUT_MS = 4000

/**
 * 从索引文件里读标题。
 *
 * 索引格式 1 的 `title` 可以是字符串，也可以是按语言的表（`{ zh, en }`）。
 * 两种都接受，按当前语言优先。
 *
 * **不在代码里硬编码标题**：索引自己改名时（比如从「dsh 插件目录」变成
 * 「Awesome DSH Plugin 插件精选」）这里自动跟上。
 *
 * @param url - 索引 URL。
 * @param locale - 当前语言（如 `zh`）。
 * @returns 标题；读不到时 undefined。
 */
async function fetchIndexTitle(url: string, locale: string): Promise<string | undefined> {
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, TITLE_TIMEOUT_MS)
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } })
    if (!response.ok) return undefined
    const value = await response.json() as { title?: unknown }
    const title = value.title
    if (typeof title === 'string') return title.trim() === '' ? undefined : title
    if (typeof title === 'object' && title !== null) {
      const table = title as Record<string, unknown>
      // 先精确语言，再退化到其主语言（zh-CN → zh），最后 en。
      const exact = table[locale]
      if (typeof exact === 'string') return exact
      const base = locale.split('-')[0] ?? locale
      const byBase = table[base]
      if (typeof byBase === 'string') return byBase
      if (typeof table.en === 'string') return table.en
    }
    return undefined
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 取推荐源的展示信息（含标题）。
 * @param locale - 当前语言。
 * @returns 每个源一条；标题读不到时只给 URL。
 */
async function describeSources(locale: string): Promise<PluginIndexSourceInfo[]> {
  return Promise.all(RECOMMENDED_INDEXES.map(async url => {
    const label = await fetchIndexTitle(url, locale)
    return label === undefined ? { url } : { url, label }
  }))
}

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
  /** 推荐源的展示信息（含从索引里读到的标题）。 */
  readonly sources: readonly PluginIndexSourceInfo[]
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
    /*
      **先看服务是否真的挂载**（`ctx.get('pluginMarket')`），再读配置。

      只查 settings.describe 是不够的：那份文档在插件被禁用时也可能残留，
      从而把「已卸载/已停用」误报成「可用」，接着一键设置会写进一份没人读的配置。
      服务名 `pluginMarket` 取自其构造函数（`super(ctx, 'pluginMarket')`）。
    */
    if (ctx.get('pluginMarket') === undefined) return undefined

    const descriptor = ctx.settings.describe().find(row => row.ns === MARKET_ENTRY_ID)
    const value = descriptor?.value as { indexes?: unknown } | undefined
    if (value === undefined) return []
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
export async function readIndexStatus(ctx: Context, locale = 'zh'): Promise<PluginIndexStatus> {
  const sources = await describeSources(locale)
  const configured = readConfigured(ctx)
  if (configured === undefined) {
    return {
      marketAvailable: false,
      reason: 'plugin-market-not-installed',
      configured: [],
      missing: [...RECOMMENDED_INDEXES],
      recommended: [...RECOMMENDED_INDEXES],
      sources,
    }
  }
  const present = new Set(configured.map(url => url.trim().replace(/\/+$/u, '')))
  const missing = RECOMMENDED_INDEXES.filter(url => !present.has(url.trim().replace(/\/+$/u, '')))
  return { marketAvailable: true, configured, missing, recommended: [...RECOMMENDED_INDEXES], sources }
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
export async function applyRecommendedIndexes(ctx: Context, locale = 'zh'): Promise<PluginIndexStatus> {
  const status = await readIndexStatus(ctx, locale)
  if (!status.marketAvailable) return status

  const merged = [...status.configured]
  const present = new Set(merged.map(url => url.trim().replace(/\/+$/u, '')))
  for (const url of RECOMMENDED_INDEXES) {
    if (!present.has(url.trim().replace(/\/+$/u, ''))) merged.push(url)
  }
  await ctx.settings.update(MARKET_ENTRY_ID, { indexes: merged })
  return readIndexStatus(ctx, locale)
}
