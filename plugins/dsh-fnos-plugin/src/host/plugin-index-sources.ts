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

import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { resolveRepairEnvironment } from './dependency-repair.ts'
import type { PluginIndexSourceInfo } from '../contracts/gateway-proxy-contract.ts'

/** 官方插件市场的 settings entry id（由官方 bundle 固定）。 */
export const MARKET_ENTRY_ID = 'plugin-market'

/**
 * 提供「自定义插件索引」能力的官方 **bundle** 包名。
 *
 * 索引功能由它贡献（`plugin-market` 只是其中一条 entry）。因此「索引是否启用」
 * 等价于「这个 bundle 是否在 profile 的 `dsh.profile.bundles` 里」——与官方
 * `setBundleEnabled` 的判据一致，而不是看某个本地开关。
 */
export const MARKET_BUNDLE_NAME = '@deepseek-ai/dsh-experimental-plugin-market-bundle'

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
  /** 插件市场是否可用（已装且已启用）；false 时两键不可用。 */
  readonly marketAvailable: boolean
  /**
   * 插件市场 bundle 是否**已启用**。
   *
   * 与 `marketAvailable` 的区别：bundle 装了但未选中时，`marketEnabled` 为 false
   * 而 `marketAvailable` 也为 false——但界面要能表达「装了、只是关着」，好让用户
   * 把开关打开。仅看 `marketAvailable` 会把这两种情况混为一谈。
   */
  readonly marketEnabled: boolean
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
 * 读 profile 选中的 bundle 列表。
 * @returns 包名列表；读不到时空数组。
 */
async function readSelectedBundles(): Promise<readonly string[]> {
  const environment = resolveRepairEnvironment()
  if (environment === undefined) return []
  try {
    const manifest = JSON.parse(await readFile(join(environment.profileDirectory, 'package.json'), 'utf8')) as {
      dsh?: { profile?: { bundles?: string[] } }
    }
    return manifest.dsh?.profile?.bundles ?? []
  } catch {
    return []
  }
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

  /*
    **「启用」= 这个 bundle 是否被 profile 选中**，与官方 `setBundleEnabled` 同判据。

    早前只看服务是否挂载（`ctx.get('pluginMarket')`），那是「模块在不在内存里」，
    不是「用户是否启用它」——于是 bundle 明明在 `bundles` 数组里、界面却可以因为
    一个本地开关显示「未开启」，与实际状态相反。

    现在 `enabled` 由 bundle 选择状态决定，开关也随之变成真正的启用/禁用。
  */
  const selected = await readSelectedBundles()
  const bundleEnabled = selected.includes(MARKET_BUNDLE_NAME)

  return {
    marketAvailable: bundleEnabled && configured !== undefined,
    marketEnabled: bundleEnabled,
    configured: configured ?? [],
    missing: configured === undefined
      ? [...RECOMMENDED_INDEXES]
      : RECOMMENDED_INDEXES.filter(url => {
          const present = new Set(configured.map(item => item.trim().replace(/\/+$/u, '')))
          return !present.has(url.trim().replace(/\/+$/u, ''))
        }),
    recommended: [...RECOMMENDED_INDEXES],
    sources,
  }
}

/**
 * 设置：把缺失的推荐源补进去。
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

/**
 * 启用/禁用「自定义插件索引」能力。
 *
 * 复用 `plugin-toggle` 的 bundle 逻辑（官方 `setBundleEnabled` 的同构实现），
 * 因此开关背后是**真正在增删 `dsh.profile.bundles`**，而不是记一个本地偏好。
 *
 * @param ctx - 宿主上下文（此处不用，保留签名一致性）。
 * @param enabled - 目标状态。
 * @returns 是否成功；`needRestart` 表示需重启 Web 才生效（仅**启用**时）。
 */
export async function setMarketEnabled(_ctx: Context, enabled: boolean): Promise<{ ok: boolean, error?: string, needRestart?: boolean }> {
  const environment = resolveRepairEnvironment()
  if (environment === undefined) return { ok: false, error: 'profile-unavailable' }

  const manifestPath = join(environment.profileDirectory, 'package.json')
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      dsh?: { profile?: { bundles?: string[] } }
    }
    const previous = manifest.dsh?.profile?.bundles ?? []
    const next = enabled
      ? (previous.includes(MARKET_BUNDLE_NAME) ? previous : [...previous, MARKET_BUNDLE_NAME])
      : previous.filter(item => item !== MARKET_BUNDLE_NAME)
    if (JSON.stringify(previous) === JSON.stringify(next)) return { ok: true, needRestart: false }

    manifest.dsh = { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles: next } }
    const temporary = `${manifestPath}.dsh-market-toggle-${String(process.pid)}`
    await writeFile(temporary, `${JSON.stringify(manifest, undefined, 2)}\n`, { mode: 0o600 })
    await rename(temporary, manifestPath)
    /*
      **只有启用需要重启，禁用立即生效。**

      启用要往组合里加一层 bundle，而组合是在进程启动时装配的——不重启，那层
      代码根本不在内存里。

      禁用则是把它从组合里摘掉：已经加载的模块还在内存里，但索引这条路不再被
      调用，用户看到的行为就是「立刻关掉了」。为此提示「重启生效」属于过度要求，
      反而让用户以为没生效。
    */
    return { ok: true, needRestart: enabled }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
