/**
 * OpenCode 模型目录归一化。
 *
 * 输入有三个来源，优先级从高到低：
 *
 * 1. **Console 工作空间配置**（`GET /console/api/v2/config`）：登录账号后
 *    才能读到，是「用户空间里启用了哪些模型」的唯一权威来源，并且带逐模型的
 *    能力（思考 effort/toggle、输入模态、容量、禁用标记）。
 * 2. **公开模型目录**（`models.opencode.ai/api.json` 的 `opencode-go` 段）：
 *    models.dev 形态的完整能力元数据，未登录也可读。
 * 3. **pi-ai 内置目录**（`opencodeGoProvider()`）：提供经过上游验证的
 *    wire 兼容开关（`thinkingFormat`、`maxTokensField`、会话亲和等）与
 *    兜底的思考等级映射。
 *
 * 三者合并后得到 {@link OpenCodeModel}：协议族、端点、能力、容量都固定下来，
 * 供适配器与界面共用。图片生成模型（输出含 `image`）与无法识别协议的条目
 * 会被跳过并记入 `warnings`，不会静默变成一个发不出去的模型。
 *
 * @module dsh-opencode/catalog
 */

import type { Api, Model } from '@earendil-works/pi-ai'
import {
  OPENCODE_API_PATHS,
  OPENCODE_INFERENCE_ORIGIN,
  OPENCODE_GO_MODELS_URL,
  OPENCODE_MODEL_CATALOG_URL,
} from '../contracts/identity.ts'
import {
  OPENCODE_REASONING_LEVELS,
  type OpenCodeApiKind,
  type OpenCodeCatalog,
  type OpenCodeModel,
  type OpenCodeModelCost,
  type OpenCodeThinkingLevelMap,
} from '../contracts/catalog.ts'

/** 上游没有给容量时的保守兜底（与 DSH 的默认值一致）。 */
export const DEFAULT_CONTEXT_WINDOW = 262_144
/** 上游没有给输出上限时的保守兜底。 */
export const DEFAULT_MAX_TOKENS = 32_768
/** 目录与 rosters 的响应体积上限，防止异常响应把宿主拖垮。 */
export const CATALOG_RESPONSE_MAX_BYTES = 32 * 1024 * 1024
/** 公开目录的重新读取间隔：它体积大且变化慢。 */
export const CATALOG_METADATA_TTL_MS = 6 * 60 * 60 * 1000
/** 模型清单与 Console 配置的重新读取间隔。 */
export const CATALOG_ROSTER_TTL_MS = 60 * 1000

/** AI SDK 包名到网关协议族的映射（与 opencode 客户端的路由一致）。 */
const NPM_TO_API: Readonly<Record<string, OpenCodeApiKind>> = {
  '@ai-sdk/anthropic': 'anthropic-messages',
  '@ai-sdk/openai': 'openai-responses',
  '@ai-sdk/openai-compatible': 'openai-completions',
  '@ai-sdk/google': 'google-generative-ai',
}

/** Console 工作空间里可识别的 provider id（Go 套餐是本插件的作用域）。 */
const CONSOLE_PROVIDER_IDS = ['opencode-go'] as const

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : undefined
}

function array(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : []
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
}

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** 协议族对应的完整端点前缀。 */
export function baseURLForApi(api: OpenCodeApiKind): string {
  return `${OPENCODE_INFERENCE_ORIGIN}${OPENCODE_API_PATHS[api]}`
}

/** 从 AI SDK 包名解析协议族；未知包名返回 undefined。 */
export function apiFromPackage(value: unknown): OpenCodeApiKind | undefined {
  const raw = typeof value === 'string' ? value.trim() : ''
  // Console 用 `aisdk:<npm 包名>` 标注协议包（opencode 客户端自己的约定）。
  const name = raw.startsWith('aisdk:') ? raw.slice('aisdk:'.length) : raw
  return name.length > 0 ? NPM_TO_API[name] : undefined
}

/** 从 `<list>.data[].id` 或 `<map>` 形态中读出模型 id 列表。 */
export function modelIdsFrom(payload: unknown): string[] {
  const source = record(payload)
  if (source === undefined) return []
  const ids: string[] = []
  const push = (value: unknown): void => {
    const id = nonEmptyString(value)
    if (id !== undefined && !ids.includes(id)) ids.push(id)
  }
  if (Array.isArray(source.data)) for (const entry of source.data) push(record(entry)?.id)
  if (Array.isArray(source.models)) for (const entry of source.models) push(record(entry)?.id)
  const models = record(source.models)
  if (models !== undefined) for (const key of Object.keys(models)) push(key)
  return ids
}

/** 只保留 DSH 能发送的输入模态：text 与 image。 */
export function normalizeInputModalities(value: unknown): ('text' | 'image')[] {
  const entries = Array.isArray(value) ? value : []
  const input: ('text' | 'image')[] = []
  for (const entry of entries) {
    if (entry === 'text' && !input.includes('text')) input.push('text')
    if (entry === 'image' && !input.includes('image')) input.push('image')
  }
  return input
}

/** 上游 reasoning 描述：`reasoning_options` 数组或 Console 的 `capabilities.reasoning`。 */
interface ReasoningShape {
  readonly effort: readonly string[]
  readonly toggle: boolean
  readonly budget: boolean
}

/** 把两种上游形态归一成同一组控制项。 */
export function readReasoning(value: unknown): ReasoningShape | undefined {
  if (value === false) return { effort: [], toggle: false, budget: false }
  // models.dev：reasoning_options: [{type:'effort',values:[...]},{type:'toggle'},{type:'budget_tokens'}]
  if (Array.isArray(value)) return readReasoningOptions(value)
  // Console：{ supported, toggle?, effort?: string[], budget?: {min,max} }
  const source = record(value)
  if (source === undefined) return undefined
  if (source.supported === false) return { effort: [], toggle: false, budget: false }
  return {
    effort: array(source.effort).filter((entry): entry is string => typeof entry === 'string'),
    toggle: source.toggle === true,
    budget: record(source.budget) !== undefined,
  }
}

/** 解析 models.dev 的 reasoning_options 数组。 */
function readReasoningOptions(value: readonly unknown[]): ReasoningShape {
  const options = value.map(record).filter((entry): entry is JsonRecord => entry !== undefined)
  let effort: string[] = []
  let toggle = false
  let budget = false
  for (const option of options) {
    if (option.type === 'effort') {
      effort = array(option.values).filter((entry): entry is string => typeof entry === 'string')
    }
    if (option.type === 'toggle') toggle = true
    if (option.type === 'budget_tokens') budget = true
  }
  return { effort, toggle, budget }
}

/**
 * 思考等级映射。
 *
 * 语义严格对齐 pi-ai 的 `thinkingLevelMap`：
 * - 键是选择器提供的等级，值是发给网关的拼写；
 * - `null` 表示不受支持；
 * - 缺省 `off` 表示「关闭思考」受支持、且协议按缺省方式表达（发送 disabled）；
 * - `off: 'none'` 表示关闭时显式发送 `none`。
 *
 * 上游没有给出任何 effort 列表时返回 `undefined`，让 pi-ai 使用自己的缺省等级
 * （这是上游对 toggle/budget 型模型的既有处理方式），而不是凭空造出等级。
 */
export function thinkingLevelMapFromReasoning(value: unknown): OpenCodeThinkingLevelMap | undefined {
  const reasoning = readReasoning(value)
  if (reasoning === undefined) return undefined
  const offered = new Set(reasoning.effort)
  const hasEffort = reasoning.effort.length > 0
  if (!hasEffort) return undefined
  const map: OpenCodeThinkingLevelMap = {}
  for (const level of OPENCODE_REASONING_LEVELS) {
    if (level === 'off') continue
    map[level] = offered.has(level) ? level : null
  }
  if (offered.has('none')) map.off = 'none'
  else if (!reasoning.toggle && !reasoning.budget) map.off = null
  // toggle / budget 且没有 none：保留缺省的 off（发送协议原生的关闭字段）。
  return map
}

/** 读取 models.dev 形态的某个 provider 段。 */
function catalogModelRecord(catalog: unknown, providerId: string): {
  provider: JsonRecord | undefined
  models: ReadonlyMap<string, JsonRecord>
} {
  const providers = record(catalog)
  const provider = providers !== undefined ? record(providers[providerId]) : undefined
  const models = new Map<string, JsonRecord>()
  const entries = record(provider?.models)
  if (entries !== undefined) {
    for (const [id, entry] of Object.entries(entries)) {
      const source = record(entry)
      if (source !== undefined) models.set(id, source)
    }
  }
  return { provider, models }
}

/** Console 配置中的一个模型条目。 */
interface ConsoleModelEntry {
  readonly id: string
  readonly entry: JsonRecord
}

/**
 * 从 Console 配置里取出 `opencode-go` 工作空间模型。
 *
 * 结构不对（未登录、404、字段漂移）时返回 `undefined`，调用方回退到公开目录；
 * 这是「登录后能读到用户空间」的增强路径，不能成为单点故障。
 */
export function consoleModelsFromConsoleConfig(config: unknown): {
  readonly providerId: string
  readonly packageName?: string
  /** Console 下发的路由头（如工作空间 id）；只保留 `x-opencode-*`。 */
  readonly headers?: Readonly<Record<string, string>>
  readonly models: readonly ConsoleModelEntry[]
} | undefined {
  const body = record(config)
  const providers = record(body?.providers) ?? body
  if (providers === undefined) return undefined
  for (const providerId of CONSOLE_PROVIDER_IDS) {
    const provider = record(providers[providerId])
    if (provider === undefined) continue
    const models = record(provider.models) ?? {}
    const entries: ConsoleModelEntry[] = []
    for (const [key, value] of Object.entries(models)) {
      const entry = record(value)
      if (entry === undefined) continue
      const requestId = nonEmptyString(entry.modelID) ?? key
      entries.push({ id: requestId, entry })
    }
    const packageName = nonEmptyString(provider.package)
    const headers = safeConsoleHeaders(provider.headers)
    return {
      providerId,
      ...(packageName === undefined ? {} : { packageName }),
      ...(headers === undefined ? {} : { headers }),
      models: entries,
    }
  }
  return undefined
}

/**
 * 只接收 Console 下发的路由头。
 *
 * 允许表是白名单：`authorization`、`api-key` 一类的凭据头即使上游真的下发，
 * 也绝不能被复制进 provider 配置或浏览器响应。
 */
export function safeConsoleHeaders(value: unknown): Readonly<Record<string, string>> | undefined {
  const source = record(value)
  if (source === undefined) return undefined
  const headers: Record<string, string> = {}
  for (const [name, entry] of Object.entries(source)) {
    if (typeof entry !== 'string' || entry.length === 0 || entry.length > 512) continue
    if (!/^x-opencode-[a-z0-9-]+$/iu.test(name)) continue
    headers[name.toLowerCase()] = entry
  }
  return Object.keys(headers).length === 0 ? undefined : headers
}

/** 内置目录的索引：同时按请求 id 与上游 modelID 建索引。 */
export function builtinModelIndex(models: readonly Model<Api>[]): Map<string, Model<Api>> {
  const index = new Map<string, Model<Api>>()
  for (const model of models) index.set(model.id, model)
  return index
}

/** 从内置模型读取 wire 兼容开关；类型层只保留对象。 */
function builtinCompat(model: Model<Api> | undefined): JsonRecord | undefined {
  return model?.compat === undefined ? undefined : record(model.compat)
}

/** 新模型的协议兼容缺省值；与 pi-ai 只针对 opencode-go 的既有条目保持一致。 */
function compatFor(api: OpenCodeApiKind, builtin: Model<Api> | undefined, interleaved: boolean): JsonRecord {
  const known = builtinCompat(builtin)
  if (known !== undefined) return structuredClone(known)
  switch (api) {
    case 'openai-completions':
      return {
        supportsStore: false,
        supportsDeveloperRole: false,
        supportsStrictMode: true,
        maxTokensField: 'max_tokens',
        ...(interleaved ? { requiresReasoningContentOnAssistantMessages: true } : {}),
      }
    case 'openai-responses':
      return {
        sessionAffinityFormat: 'openai-nosession',
        supportsMidConvoSystemMessages: true,
        supportsAdditionalTools: true,
      }
    default:
      return {}
  }
}

/** 读取模型成本；缺失或非法时返回 undefined，而不是伪造 0。 */
function costFrom(value: unknown): OpenCodeModelCost | undefined {
  const cost = record(value)
  if (cost === undefined) return undefined
  const input = finiteNonNegative(cost.input)
  const output = finiteNonNegative(cost.output)
  if (input === undefined || output === undefined) return undefined
  const cache = record(cost.cache)
  const cacheRead = finiteNonNegative(cache?.read ?? cost.cache_read)
  const cacheWrite = finiteNonNegative(cache?.write ?? cost.cache_write)
  return {
    input,
    output,
    ...(cacheRead === undefined ? {} : { cacheRead }),
    ...(cacheWrite === undefined ? {} : { cacheWrite }),
  }
}

/** 单条模型的构建输入。 */
export interface CatalogEntryInput {
  readonly id: string
  /** Console 条目（若登录且该模型在工作空间内）。 */
  readonly consoleEntry?: JsonRecord
  /** models.dev 条目（若公开目录描述了它）。 */
  readonly catalogEntry?: JsonRecord
  /** pi-ai 内置条目（若上游目录包含它）。 */
  readonly builtin?: Model<Api>
  /** 公开目录的 provider 级 npm（模型条目缺省时继承）。 */
  readonly providerNpm?: string
  /** Console 配置的 provider 级 package（模型条目缺省时继承）。 */
  readonly consoleProviderNpm?: string
}

/** 构建结果：成功模型（可带降级说明），或跳过原因。 */
export type CatalogEntryResult =
  | { readonly ok: true; readonly model: OpenCodeModel; readonly warnings?: readonly string[] }
  | { readonly ok: false; readonly reason: string }

/**
 * 合并一条模型的三方信息。
 *
 * 纯函数，不读网络：Console 提供启用状态与最新能力，公开目录补全描述与容量，
 * 内置目录保留经过验证的 wire 兼容开关。
 */
export function buildCatalogEntry(entry: CatalogEntryInput): CatalogEntryResult {
  const { id, consoleEntry, catalogEntry, builtin } = entry
  const warnings: string[] = []
  const consoleCaps = record(consoleEntry?.capabilities)
  const consoleReasoning = consoleCaps !== undefined && 'reasoning' in consoleCaps
    ? consoleCaps.reasoning
    : undefined
  const catalogProvider = record(catalogEntry?.provider)
  const declaredNpm = nonEmptyString(consoleEntry?.package)
    ?? nonEmptyString(catalogProvider?.npm)
    ?? nonEmptyString(entry.providerNpm)
    ?? nonEmptyString(entry.consoleProviderNpm)
  let api: OpenCodeApiKind | undefined = apiFromPackage(declaredNpm)
    ?? apiFromPackage(record(builtin?.compat)?.package)
    ?? builtinApiKind(builtin)
  if (api === undefined) {
    // 上游明确声明了协议但我们不认识：跳过（端点无法猜）。
    if (declaredNpm !== undefined) return { ok: false, reason: `${id}: 无法识别的协议 ${declaredNpm}` }
    // 活跃 roster 里有、但三份元数据都没描述：按 Go 网关最常见的
    // OpenAI Chat Completions 投影，并明确提示这是推断。
    api = 'openai-completions'
    warnings.push(`${id}: 上游没有协议元数据，按 openai-completions 推断`)
  }

  const output = array(consoleCaps?.output).length > 0
    ? array(consoleCaps?.output)
    : array(record(catalogEntry?.modalities)?.output)
  if (output.includes('image')) return { ok: false, reason: `${id}: 图片生成模型不在适配范围` }

  const rawInput = array(consoleCaps?.input).length > 0
    ? consoleCaps?.input
    : array(record(catalogEntry?.modalities)?.input).length > 0
      ? record(catalogEntry?.modalities)?.input
      : builtin?.input
  const inputModalities = normalizeInputModalities(rawInput)
  if (inputModalities.length === 0) {
    warnings.push(`${id}: 上游没有输入模态元数据，按纯文本处理`)
  }
  const input: ('text' | 'image')[] = inputModalities.includes('image') ? ['text', 'image'] : ['text']

  const reasoning = consoleReasoning !== undefined
    ? readReasoning(consoleReasoning) !== undefined && record(consoleReasoning)?.supported !== false
      && consoleReasoning !== false
    : catalogEntry?.reasoning === true || (catalogEntry?.reasoning === undefined && builtin?.reasoning === true)

  const thinkingLevelMap = reasoning
    ? thinkingLevelMapFromReasoning(consoleReasoning)
      ?? thinkingLevelMapFromReasoning(catalogEntry?.reasoning_options)
      ?? builtin?.thinkingLevelMap
    : undefined

  const consoleLimit = record(consoleEntry?.limit)
  const catalogLimit = record(catalogEntry?.limit)
  const contextWindow = positiveInteger(consoleLimit?.context)
    ?? positiveInteger(catalogLimit?.context)
    ?? builtin?.contextWindow
    ?? DEFAULT_CONTEXT_WINDOW
  const maxTokens = positiveInteger(consoleLimit?.output)
    ?? positiveInteger(catalogLimit?.output)
    ?? builtin?.maxTokens
    ?? DEFAULT_MAX_TOKENS

  const cost = costFrom(consoleEntry?.cost) ?? costFrom(catalogEntry?.cost)
    ?? (builtin === undefined
      ? undefined
      : costFrom({
        input: builtin.cost.input,
        output: builtin.cost.output,
        cache_read: builtin.cost.cacheRead,
        cache_write: builtin.cost.cacheWrite,
      }))

  const name = nonEmptyString(consoleEntry?.name) ?? nonEmptyString(catalogEntry?.name) ?? builtin?.name ?? id
  const description = nonEmptyString(catalogEntry?.description)
  const family = nonEmptyString(consoleEntry?.family) ?? nonEmptyString(catalogEntry?.family)
  const interleaved = record(catalogEntry?.interleaved)?.field === 'reasoning_content'
  const compat = compatFor(api, builtin, interleaved)
  const inputLimits = record(builtin?.inputLimits)

  return {
    ok: true,
    model: {
      id,
      name,
      ...(description === undefined ? {} : { description }),
      ...(family === undefined ? {} : { family }),
      api,
      baseURL: baseURLForApi(api),
      reasoning,
      ...(thinkingLevelMap === undefined ? {} : { thinkingLevelMap }),
      input,
      contextWindow,
      maxTokens,
      ...(cost === undefined ? {} : { cost }),
      ...(Object.keys(compat).length === 0 ? {} : { compat }),
      ...(inputLimits === undefined ? {} : { inputLimits }),
      ...(catalogEntry?.status === 'deprecated' ? { deprecated: true } : {}),
      ...(consoleEntry?.disabled === true ? { disabled: true } : {}),
      go: true,
    },
    ...(warnings.length === 0 ? {} : { warnings }),
  }
}

/** 内置 pi-ai 模型自身的协议族（内置 provider 已按 api 分好类）。 */
function builtinApiKind(model: Model<Api> | undefined): OpenCodeApiKind | undefined {
  return isOpenCodeApiKind(model?.api) ? model.api : undefined
}

/** 协议族判定：pi-ai 的 `Api` 是开放字符串联合，必须显式收窄。 */
export function isOpenCodeApiKind(value: unknown): value is OpenCodeApiKind {
  return value === 'openai-completions'
    || value === 'openai-responses'
    || value === 'anthropic-messages'
    || value === 'google-generative-ai'
}

/** 构建目录快照的输入。 */
export interface BuildCatalogInput {
  /** `GET /console/api/v2/config` 的响应体。 */
  readonly consoleConfig?: unknown
  /** `GET /inference/go/v1/models` 的响应体。 */
  readonly goRoster?: unknown
  /** `models.opencode.ai/api.json` 的响应体。 */
  readonly catalog?: unknown
  /** pi-ai 内置的 OpenCode Go 模型。 */
  readonly builtin?: readonly Model<Api>[]
  readonly now?: number
}

/**
 * 合并三方来源，生成目录快照。
 *
 * 模型集合的取舍：
 * - Console 配置可读且列出了模型 → 只服务这些模型（这就是「用户空间里启用的
 *   模型」）；`disabled: true` 的条目保留在快照里供界面展示，但不进入适配器。
 * - 否则 → 服务公开 roster 与公开目录的并集；两者都拿不到时退回内置目录。
 */
export function buildCatalog(input: BuildCatalogInput): OpenCodeCatalog {
  const now = input.now ?? Date.now()
  const { provider: catalogProvider, models: catalogModels } = catalogModelRecord(input.catalog, 'opencode-go')
  // Zen 段只作为**元数据**补充：同一模型可能只在 Zen 段落里被描述（Go roster
  // 里有、Go 目录段还没有），端点与协议族仍按 Go 网关投影。
  const { provider: zenProvider, models: zenModels } = catalogModelRecord(input.catalog, 'opencode')
  const providerNpm = nonEmptyString(catalogProvider?.npm) ?? nonEmptyString(zenProvider?.npm)
  const builtin = builtinModelIndex(input.builtin ?? [])
  const consoleScope = consoleModelsFromConsoleConfig(input.consoleConfig)
  // Console 的 provider 级 package 是模型级 package 的缺省值。
  const consoleProviderNpm = consoleScope?.packageName
  const warnings: string[] = []

  const rosterIds = new Set(modelIdsFrom(input.goRoster))
  const catalogIds = new Set(catalogModels.keys())
  const consoleEntries = new Map<string, JsonRecord>()
  for (const entry of consoleScope?.models ?? []) consoleEntries.set(entry.id, entry.entry)

  // Console 配置可读 ≠ 模型全集：实测 Go 工作空间的 `models` 可能为空，
  // 它表示「没有额外覆盖/自定义条目」，而不是「一个模型都没启用」。因此
  // 账号配置只做**增补**（自定义条目、禁用标记、路由头），模型全集仍以
  // 活 roster 为准。
  const ids: string[] = []
  if (rosterIds.size > 0) {
    ids.push(...rosterIds)
  } else if (catalogIds.size > 0) {
    // 没有活清单时退回目录，但要排除已标为 deprecated 的条目。
    ids.push(...[...catalogIds].filter(id => catalogModels.get(id)?.status !== 'deprecated'))
  } else {
    ids.push(...builtin.keys())
    if (ids.length > 0) warnings.push('无法读取 OpenCode 公开目录，暂用 pi-ai 内置目录')
  }
  for (const id of consoleEntries.keys()) if (!ids.includes(id)) ids.push(id)
  // Console 配置读取成功即视为账号目录（即便没有额外条目）。
  const source: 'console' | 'public' = consoleScope === undefined ? 'public' : 'console'
  if (ids.length === 0) warnings.push('没有读到任何 OpenCode Go 模型')

  const models: OpenCodeModel[] = []
  const seen = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    const consoleEntry = consoleEntries.get(id)
    const catalogEntry = catalogModels.get(id) ?? zenModels.get(id)
    const builtinEntry = builtin.get(id)
    const result = buildCatalogEntry({
      id,
      ...(consoleEntry === undefined ? {} : { consoleEntry }),
      ...(catalogEntry === undefined ? {} : { catalogEntry }),
      ...(builtinEntry === undefined ? {} : { builtin: builtinEntry }),
      ...(providerNpm === undefined ? {} : { providerNpm }),
      ...(consoleProviderNpm === undefined ? {} : { consoleProviderNpm }),
    })
    if (result.ok) {
      models.push(result.model)
      for (const warning of result.warnings ?? []) warnings.push(warning)
    } else {
      warnings.push(result.reason)
    }
  }

  return { fetchedAt: now, source, models, warnings }
}

/** 目录可能来自的 URL：供服务层与测试共用。 */
export interface CatalogUrls {
  readonly roster: string
  readonly catalog: string
}

/** 默认的公开数据源地址。 */
export const DEFAULT_CATALOG_URLS: CatalogUrls = {
  roster: OPENCODE_GO_MODELS_URL,
  catalog: OPENCODE_MODEL_CATALOG_URL,
} satisfies CatalogUrls

/** 读取 JSON 响应并限制体积；非 2xx 抛错。 */
async function fetchJson(
  url: string,
  init: RequestInit,
  maxBytes = CATALOG_RESPONSE_MAX_BYTES,
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  const response = await fetchImpl(url, init)
  if (!response.ok) throw new Error(`${url} 返回 HTTP ${response.status}`)
  const text = await response.text()
  if (text.length > maxBytes) throw new Error(`${url} 响应超过 ${maxBytes} 字节`)
  return JSON.parse(text) as unknown
}

/** 网络抓取的输入。 */
export interface FetchCatalogInput {
  readonly fetchImpl?: typeof fetch
  readonly accessToken?: string
  readonly orgId?: string
  readonly server?: string
  readonly signal?: AbortSignal
  readonly builtin?: readonly Model<Api>[]
  readonly urls?: CatalogUrls
  readonly now?: number
  /** 跳过公开目录的抓取（调用方已有缓存）。 */
  readonly catalog?: unknown
  /** 跳过 roster 的抓取（调用方已有缓存）。 */
  readonly goRoster?: unknown
}

/** 抓取结果：目录 + Console 是否可读。 */
export interface FetchCatalogResult {
  readonly catalog: OpenCodeCatalog
  /** Console 配置读取失败的原因；成功或未登录时为 undefined。 */
  readonly consoleError?: string
}

/**
 * 抓取并合并目录。
 *
 * 公开 roster 与目录是硬依赖（失败时使用调用方传入的旧值或内置目录），
 * Console 配置是软依赖：它的失败只记录为 `consoleError`，不阻断目录。
 */
export async function fetchOpenCodeCatalog(input: FetchCatalogInput): Promise<FetchCatalogResult> {
  const fetchImpl = input.fetchImpl ?? fetch
  const urls = input.urls ?? DEFAULT_CATALOG_URLS
  const signal = input.signal ?? AbortSignal.timeout(20_000)
  const json = (url: string, headers: Record<string, string> = {}): Promise<unknown> =>
    fetchJson(url, { headers: { accept: 'application/json', ...headers }, signal }, CATALOG_RESPONSE_MAX_BYTES, fetchImpl)

  let consoleConfig: unknown
  let consoleError: string | undefined
  if (input.accessToken !== undefined) {
    const server = (input.server ?? 'https://opencode.ai/console').replace(/\/+$/, '')
    try {
      consoleConfig = await json(`${server}/api/v2/config`, {
        authorization: `Bearer ${input.accessToken}`,
        ...(input.orgId === undefined ? {} : { 'x-org-id': input.orgId }),
      })
    } catch (error) {
      consoleError = error instanceof Error ? error.message : String(error)
    }
  }

  const [goRoster, catalog] = await Promise.all([
    input.goRoster !== undefined ? Promise.resolve(input.goRoster) : json(urls.roster).catch(() => undefined),
    input.catalog !== undefined ? Promise.resolve(input.catalog) : json(urls.catalog).catch(() => undefined),
  ])

  return {
    catalog: buildCatalog({
      ...(consoleConfig === undefined ? {} : { consoleConfig }),
      ...(goRoster === undefined ? {} : { goRoster }),
      ...(catalog === undefined ? {} : { catalog }),
      ...(input.builtin === undefined ? {} : { builtin: input.builtin }),
      ...(input.now === undefined ? {} : { now: input.now }),
    }),
    ...(consoleError === undefined ? {} : { consoleError }),
  }
}

/** 目录服务的依赖。 */
export interface CatalogServiceOptions {
  /** 当前账号凭据；未登录时返回 undefined。 */
  readonly resolveAccount: () => Promise<{
    readonly access: string
    readonly orgId?: string
    readonly server?: string
  } | undefined>
  readonly fetchImpl?: typeof fetch
  readonly builtin?: () => readonly Model<Api>[]
  readonly urls?: CatalogUrls
  readonly now?: () => number
}

/**
 * 目录快照的宿主侧缓存。
 *
 * 抓取间隔由偏好设置控制；公开目录自身再按 {@link CATALOG_METADATA_TTL_MS}
 * 节流，避免每 15 分钟重新下载 6 MB 的元数据。任何一次抓取失败都保留上一份
 * 快照，只把原因暴露给界面。
 */
export class OpenCodeCatalogService {
  private snapshot: OpenCodeCatalog | undefined
  private consoleError: string | undefined
  private lastError: string | undefined
  private inflight: Promise<OpenCodeCatalog | undefined> | undefined
  private roster: unknown
  private rosterAt = 0
  private metadata: unknown
  private metadataAt = 0
  private consoleConfig: unknown
  private consoleAt = 0
  private consoleHeaders: Readonly<Record<string, string>> | undefined

  constructor(private readonly options: CatalogServiceOptions) {}

  /** 当前快照（可能尚未抓取）。 */
  current(): OpenCodeCatalog | undefined {
    return this.snapshot
  }

  /** 最近一次抓取失败的说明；成功后清空。 */
  error(): string | undefined {
    return this.lastError
  }

  /** Console 配置最近一次不可用的说明（未登录时不设置）。 */
  consoleDiagnostic(): string | undefined {
    return this.consoleError
  }

  /**
   * Console 下发的路由头（工作空间 id 等），供推理请求携带。
   *
   * 与目录快照分开：这份数据不进 `/catalog` 响应，浏览器永远看不到它。
   */
  requestHeaders(): Readonly<Record<string, string>> | undefined {
    return this.consoleHeaders
  }

  /** 强制刷新：忽略节流，重新读取所有来源。 */
  async refresh(): Promise<OpenCodeCatalog> {
    const next = await this.load(true)
    return next ?? { fetchedAt: this.now(), source: 'public', models: [], warnings: [] }
  }

  /** 自动刷新：按节流窗口决定抓取哪些来源；没有新鲜数据时返回当前快照。 */
  async refreshIfStale(): Promise<OpenCodeCatalog | undefined> {
    return this.load(false)
  }

  private now(): number {
    return this.options.now?.() ?? Date.now()
  }

  private async load(force: boolean): Promise<OpenCodeCatalog | undefined> {
    if (this.inflight !== undefined) return this.inflight
    const pending = this.loadOnce(force).finally(() => { this.inflight = undefined })
    this.inflight = pending
    return pending
  }

  private async loadOnce(force: boolean): Promise<OpenCodeCatalog | undefined> {
    const now = this.now()
    const fetchImpl = this.options.fetchImpl ?? fetch
    const urls = this.options.urls ?? DEFAULT_CATALOG_URLS
    const signal = AbortSignal.timeout(20_000)

    let goRoster = this.roster
    let catalog = this.metadata
    let consoleConfig = this.consoleConfig

    const rosterStale = force || now - this.rosterAt >= CATALOG_ROSTER_TTL_MS
    const metadataStale = force || now - this.metadataAt >= CATALOG_METADATA_TTL_MS
    const consoleStale = force || now - this.consoleAt >= CATALOG_ROSTER_TTL_MS

    const account = await this.options.resolveAccount()
    const server = (account?.server ?? 'https://opencode.ai/console').replace(/\/+$/, '')
    const headers = (): Record<string, string> => ({
      accept: 'application/json',
      ...(account === undefined ? {} : { authorization: `Bearer ${account.access}` }),
      ...(account?.orgId === undefined ? {} : { 'x-org-id': account.orgId }),
    })

    const tasks: Promise<void>[] = []
    if (rosterStale) {
      tasks.push(fetchJson(urls.roster, { headers: { accept: 'application/json' }, signal }, CATALOG_RESPONSE_MAX_BYTES, fetchImpl)
        .then((value) => { goRoster = value; this.roster = value; this.rosterAt = now })
        .catch((error: unknown) => { this.lastError = describe(error) }))
    }
    if (metadataStale) {
      tasks.push(fetchJson(urls.catalog, { headers: { accept: 'application/json' }, signal }, CATALOG_RESPONSE_MAX_BYTES, fetchImpl)
        .then((value) => { catalog = value; this.metadata = value; this.metadataAt = now })
        .catch((error: unknown) => { this.lastError = describe(error) }))
    }
    if (account !== undefined && consoleStale) {
      tasks.push(fetchJson(`${server}/api/v2/config`, { headers: headers(), signal }, CATALOG_RESPONSE_MAX_BYTES, fetchImpl)
        .then((value) => {
          consoleConfig = value
          this.consoleConfig = value
          this.consoleAt = now
          this.consoleError = undefined
          this.consoleHeaders = consoleModelsFromConsoleConfig(value)?.headers
        })
        .catch((error: unknown) => {
          this.consoleError = describe(error)
          // 换了账号却拉不到配置时，宁可丢掉旧工作空间头，也不要把它带到
          // 新账号的推理请求上。
          this.consoleHeaders = undefined
        }))
    } else if (account === undefined) {
      this.consoleError = undefined
      this.consoleConfig = undefined
      this.consoleHeaders = undefined
    }
    await Promise.all(tasks)

    const next = buildCatalog({
      ...(consoleConfig === undefined ? {} : { consoleConfig }),
      ...(goRoster === undefined ? {} : { goRoster }),
      ...(catalog === undefined ? {} : { catalog }),
      ...(this.options.builtin === undefined ? {} : { builtin: this.options.builtin() }),
      now,
    })
    this.snapshot = next
    if (next.models.length > 0) this.lastError = undefined
    return next
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
