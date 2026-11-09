/**
 * OpenCode 模型目录归一化（Console 按量与 Go 套餐两组）。
 *
 * 输入有三个来源，优先级从高到低：
 *
 * 1. **Console 工作空间配置**（`GET /console/api/v2/config`）：登录账号后
 *    才能读到，按 provider 给出工作空间级覆盖（停用标记、能力/容量覆盖、
 *    自定义条目）以及推理请求要带的路由头（`x-opencode-org-id` 等）。
 * 2. **公开模型清单与目录**（`/inference/v1/models`、`/inference/go/v1/models`
 *    与 `models.opencode.ai/api.json` 的 `opencode` / `opencode-go` 段）：
 *    未登录也可读，是模型全集的来源。
 * 3. **pi-ai 内置目录**（`opencodeProvider()` / `opencodeGoProvider()`）：
 *    提供经过上游验证的 wire 兼容开关与兜底的思考等级映射。
 *
 * 两个来源各注册一组供应商（见 `contracts/identity.ts`），因此同名模型可以
 * 同时存在于两组：Console 走 `/inference/...`，Go 走 `/inference/go/...`。
 * 图片生成模型（输出含 `image`）与无法识别协议的条目会被跳过并记入
 * `warnings`，不会静默变成一个发不出去的模型。
 *
 * @module dsh-opencode/catalog
 */

import type { Api, Model } from '@earendil-works/pi-ai'
import {
  OPENCODE_GO_MODELS_URL,
  OPENCODE_INFERENCE_ORIGIN,
  OPENCODE_MODEL_CATALOG_URL,
  OPENCODE_MODELS_URL,
  OPENCODE_USER_AGENT,
  type OpenCodePlan,
} from '../contracts/identity.ts'
import {
  OPENCODE_REASONING_LEVELS,
  type OpenCodeAccountPlan,
  type OpenCodeApiKind,
  type OpenCodeCatalog,
  type OpenCodeModel,
  type OpenCodeModelCost,
  type OpenCodeThinkingLevelMap,
} from '../contracts/catalog.ts'
import { estimateOf, type OpenCodeEstimateTable } from '../contracts/estimates.ts'

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

/** 各 plan 的协议端点前缀（anthropic 由 SDK 追加 `/v1/messages`）。 */
const API_PATHS: Readonly<Record<OpenCodePlan, Readonly<Record<OpenCodeApiKind, string>>>> = {
  console: {
    'anthropic-messages': '/anthropic',
    'google-generative-ai': '/google/v1beta',
    'openai-completions': '/openai/v1',
    'openai-responses': '/openai/v1',
  },
  go: {
    'anthropic-messages': '/go/anthropic',
    'google-generative-ai': '/go/google/v1beta',
    'openai-completions': '/go/openai/v1',
    'openai-responses': '/go/openai/v1',
  },
}

/** 目录分组在警告文案里的显示名。 */
const PLAN_LABELS: Readonly<Record<OpenCodePlan, string>> = {
  console: 'OpenCode Console',
  go: 'OpenCode Go',
}

/** 目录构建时遍历的 plan 顺序。 */
const PLANS: readonly OpenCodePlan[] = ['console', 'go']

/** Console provider id 到 plan 的映射。 */
const CONSOLE_PROVIDER_PLANS: Readonly<Record<string, OpenCodePlan>> = {
  'opencode': 'console',
  'opencode-go': 'go',
}

/** models.dev 目录段到 plan 的映射。 */
const CATALOG_SECTION_PLANS: Readonly<Record<string, OpenCodePlan>> = {
  'opencode': 'console',
  'opencode-go': 'go',
}

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

/** 某个 plan 的协议族完整端点前缀。 */
export function baseURLFor(plan: OpenCodePlan, api: OpenCodeApiKind): string {
  return `${OPENCODE_INFERENCE_ORIGIN}${API_PATHS[plan][api]}`
}

/** 兼容旧调用：按协议族取端点（默认 Go）。 */
export function baseURLForApi(api: OpenCodeApiKind, plan: OpenCodePlan = 'go'): string {
  return baseURLFor(plan, api)
}

/** 协议族判定：pi-ai 的 `Api` 是开放字符串联合，必须显式收窄。 */
export function isOpenCodeApiKind(value: unknown): value is OpenCodeApiKind {
  return value === 'openai-completions'
    || value === 'openai-responses'
    || value === 'anthropic-messages'
    || value === 'google-generative-ai'
}

/** 从 AI SDK 包名解析协议族；未知包名返回 undefined。 */
export function apiFromPackage(value: unknown): OpenCodeApiKind | undefined {
  const raw = typeof value === 'string' ? value.trim() : ''
  // Console 用 `aisdk:<npm 包名>` 标注协议包（opencode 客户端自己的约定）。
  const name = raw.startsWith('aisdk:') ? raw.slice('aisdk:'.length) : raw
  return name.length > 0 ? NPM_TO_API[name] : undefined
}

/**
 * 从完整端点 URL 解析协议族。
 *
 * 目录里有些模型只给了端点、没给 npm 包名（例如 Console 的 `minimax-m3` 是
 * `…/inference/openai/v1` + Chat Completions）。这里只认带方法段的完整端点；
 * 只有前缀（`…/openai/v1`）时无法区分 Responses 与 Chat Completions，返回
 * undefined 交给下一级规则。
 * @param value - 目录里的 `provider.api`。
 * @returns 协议族；无法判断时为 undefined。
 */
export function apiFromUrl(value: unknown): OpenCodeApiKind | undefined {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (raw.length === 0) return undefined
  if (raw.includes('/chat/completions')) return 'openai-completions'
  if (raw.includes('/responses')) return 'openai-responses'
  if (raw.includes('/messages')) return 'anthropic-messages'
  if (raw.includes('/google/v1beta')) return 'google-generative-ai'
  return undefined
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

/**
 * 从活 roster 提取「模型 id → 创建时间」。
 *
 * 上游 roster 的每条记录带 `created`（epoch 秒），是模型进入该来源清单的时间；
 * 免费模型的展示顺序按它降序排列，让最近上架的免费模型排在前面。
 *
 * @param payload - roster 响应体。
 * @returns id 到 epoch 秒的映射；缺失或非法的 `created` 不写入。
 */
export function modelCreatedAtFrom(payload: unknown): Map<string, number> {
  const result = new Map<string, number>()
  const source = record(payload)
  const entries = Array.isArray(source?.data)
    ? source.data
    : Array.isArray(source?.models) ? source.models : []
  for (const entry of entries) {
    const row = record(entry)
    const id = nonEmptyString(row?.id)
    const created = row?.created
    if (id === undefined || typeof created !== 'number' || !Number.isFinite(created)) continue
    result.set(id, created)
  }
  return result
}

/**
 * 把活 roster 的 `cost` 归一成 models.dev 的扁平形态。
 *
 * roster 按模态分层（`cost.text.input.price`），还带 `multipliers`（峰谷时段与
 * 长上下文加价）；加价不参与展示，只取基价。缓存读写单价都在 `input.cache` 下。
 *
 * @param value - roster 条目的 `cost`。
 * @returns 扁平成本；形态不符或单价缺失时 undefined。
 */
function rosterCostShape(value: unknown): unknown {
  const text = record(record(value)?.text)
  if (text === undefined) return undefined
  const input = record(text.input)
  const output = record(text.output)
  const cache = record(input?.cache)
  return {
    input: input?.price,
    output: output?.price,
    cache_read: cache?.read,
    cache_write: cache?.write,
  }
}

/**
 * 从活 roster 提取「模型 id → token 单价」。
 *
 * models.dev 目录可能落后于 roster：上游新上架的模型（如 2026-11-03 的
 * `crouton-alpha-free`）当时只出现在 `opencode` 段，`opencode-go` 段没有条目。
 * roster 是网关当前真正在计费的来源，用它兜底才能让「是否免费」判对，
 * 进而让免费模型的额度口径与排序正确。
 *
 * @param payload - roster 响应体。
 * @returns id 到成本的映射；读不到单价的条目不写入。
 */
export function modelCostFrom(payload: unknown): Map<string, OpenCodeModelCost> {
  const result = new Map<string, OpenCodeModelCost>()
  const source = record(payload)
  const entries = Array.isArray(source?.data)
    ? source.data
    : Array.isArray(source?.models) ? source.models : []
  for (const entry of entries) {
    const row = record(entry)
    const id = nonEmptyString(row?.id)
    if (id === undefined) continue
    const cost = costFrom(rosterCostShape(row?.cost))
    if (cost !== undefined) result.set(id, cost)
  }
  return result
}

/**
 * 从账号模型清单读上下文与输出上限。
 *
 * 清单（`/inference/go/v1/models`）是**账号维度实时返回**的：它覆盖当前账号真实
 * 可用的全部模型，而公开目录是全局静态快照，会漏掉刚上架或未收录的模型。实测
 * 2026-11-09：Go 侧 30 个模型里公开目录只收录 26 个，且对 `minimax-m3`、
 * `qwen3.8-max` 给出的上下文明显低于清单。
 *
 * @param payload - 模型清单响应。
 * @returns id → 上限；没有 `limit` 的条目不进结果。
 */
export function modelLimitFrom(payload: unknown): Map<string, { context?: number; output?: number }> {
  const result = new Map<string, { context?: number; output?: number }>()
  for (const [id, row] of rosterRows(payload)) {
    const limit = record(row.limit)
    const context = positiveInteger(limit?.context)
    const output = positiveInteger(limit?.output)
    if (context === undefined && output === undefined) continue
    result.set(id, {
      ...(context === undefined ? {} : { context }),
      ...(output === undefined ? {} : { output }),
    })
  }
  return result
}

/**
 * 从账号模型清单读思考能力声明。
 *
 * 清单的 `capabilities.reasoning` 是两种形态之一：
 *
 * - `{ supported: true, effort: ['low','high','max'] }` —— 有档位分级；
 * - `{ supported: true }` —— 只有开关，没有档位（`toggle` 型）。
 *
 * 直接复用 {@link thinkingLevelMapFromReasoning} 的映射规则，保持与公开目录、
 * Console 两条来源完全同一套语义，不新增解释。
 *
 * 声明支持思考但没有任何档位的条目（toggle 型）存为 `null`，与「清单没提到
 * 这个模型」（不写入 Map）区分开：前者要把模型的 `reasoning` 判为 false。
 *
 * @param payload - 模型清单响应。
 * @returns id → 思考等级映射或 `null`；声明不支持的条目不进结果。
 */
export function modelReasoningFrom(payload: unknown): Map<string, OpenCodeThinkingLevelMap | null> {
  const result = new Map<string, OpenCodeThinkingLevelMap | null>()
  for (const [id, row] of rosterRows(payload)) {
    const capabilities = record(row.capabilities)
    const reasoning = capabilities?.reasoning
    if (reasoning === undefined || reasoning === false) continue
    // `supported: false` 明确表示不支持，交给上层判 false，不写进映射表。
    if (record(reasoning)?.supported === false) continue
    // 有档位时是映射对象；只有开关时是 `null`——调用方据此把 reasoning 判为 false。
    result.set(id, thinkingLevelMapFromReasoning(reasoning) ?? null)
  }
  return result
}

/** 逐条产出清单里的 `[id, 原始条目]`；两种响应形态都接受。 */
function* rosterRows(payload: unknown): Generator<[string, JsonRecord]> {
  const source = record(payload)
  const entries = Array.isArray(source?.data)
    ? source.data
    : Array.isArray(source?.models) ? source.models : []
  for (const entry of entries) {
    const row = record(entry)
    if (row === undefined) continue
    const id = nonEmptyString(row.id)
    if (id === undefined) continue
    yield [id, row]
  }
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

/**
 * 思考等级映射。
 *
 * 语义严格对齐 pi-ai 的 `thinkingLevelMap`：
 * - 键是选择器提供的等级，值是发给网关的拼写；
 * - `null` 表示不受支持；
 * - 缺省 `off` 表示「关闭思考」受支持、且协议按缺省方式表达（发送 disabled）；
 * - `off: 'none'` 表示关闭时显式发送 `none`。
 *
 * 上游没有给出任何 effort 列表时（`toggle` / `budget` 型：只有开关，没有档位）
 * 返回 `undefined`，表示「没有可声明的档位」。
 *
 * **不能把全部档位标 `null`**：DSH 的 `llm` 校验要求「声明支持思考的模型必须
 * 至少有一个可用档位」（`INVALID_MODEL_REASONING`），全 null 会让该模型的
 * 解析直接抛错，整个供应商的模型列表都加载失败。因此这类模型由调用方把
 * `reasoning` 判为 false（见 {@link buildCatalogEntry}），`thinkingLevelMap`
 * 保持缺失，DSH 侧就不会提供思考设置——这正是「只有开关、没有档位」的期望表现。
 */
export function thinkingLevelMapFromReasoning(value: unknown): OpenCodeThinkingLevelMap | undefined {
  // 明确声明不支持思考时返回 undefined：调用方据此不给该模型任何思考设置。
  // 必须在这里拦，因为 `readReasoning` 把 `supported: false` 与「只有开关」
  // 都规约成 `effort: []`，两者在下游无法区分。
  if (value === false) return undefined
  const source = record(value)
  if (source?.supported === false) return undefined
  const reasoning = readReasoning(value)
  if (reasoning === undefined) return undefined
  const offered = new Set(reasoning.effort)
  // 没有档位列表：不声明任何档位（调用方据此把 reasoning 判为 false）。
  if (reasoning.effort.length === 0) return undefined
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

/** 读取某个 plan 的 models.dev 目录段。 */
export function catalogSection(catalog: unknown, plan: OpenCodePlan): {
  provider: JsonRecord | undefined
  models: ReadonlyMap<string, JsonRecord>
} {
  const providers = record(catalog)
  const providerId = Object.keys(CATALOG_SECTION_PLANS).find(key => CATALOG_SECTION_PLANS[key] === plan)
  const provider = providers !== undefined && providerId !== undefined ? record(providers[providerId]) : undefined
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
export interface ConsoleModelEntry {
  readonly id: string
  readonly entry: JsonRecord
}

/** Console 配置中某个 plan 的工作空间范围。 */
export interface ConsoleScope {
  readonly plan: OpenCodePlan
  readonly providerId: string
  readonly packageName?: string
  /** Console 下发的路由头（如工作空间 id）；只保留 `x-opencode-*`。 */
  readonly headers?: Readonly<Record<string, string>>
  readonly models: readonly ConsoleModelEntry[]
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

/**
 * 从 Console 配置里取出两个 plan 的工作空间范围。
 *
 * 结构不对（未登录、404、字段漂移）时返回空 Map，调用方回退到公开目录；
 * 这是「登录后能读到用户空间」的增强路径，不能成为单点故障。
 */
export function consoleScopesFromConsoleConfig(config: unknown): Map<OpenCodePlan, ConsoleScope> {
  const scopes = new Map<OpenCodePlan, ConsoleScope>()
  const body = record(config)
  const providers = record(body?.providers) ?? body
  if (providers === undefined) return scopes
  for (const [providerId, plan] of Object.entries(CONSOLE_PROVIDER_PLANS)) {
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
    scopes.set(plan, {
      plan,
      providerId,
      ...(packageName === undefined ? {} : { packageName }),
      ...(headers === undefined ? {} : { headers }),
      models: entries,
    })
  }
  return scopes
}

/** 兼容旧调用：只取 Go 套餐的 Console 范围。 */
export function consoleModelsFromConsoleConfig(config: unknown): {
  readonly providerId: string
  readonly packageName?: string
  readonly headers?: Readonly<Record<string, string>>
  readonly models: readonly ConsoleModelEntry[]
} | undefined {
  const scope = consoleScopesFromConsoleConfig(config).get('go')
  return scope === undefined
    ? undefined
    : {
      providerId: scope.providerId,
      ...(scope.packageName === undefined ? {} : { packageName: scope.packageName }),
      ...(scope.headers === undefined ? {} : { headers: scope.headers }),
      models: scope.models,
    }
}

/** 内置目录的索引。 */
export function builtinModelIndex(models: readonly Model<Api>[]): Map<string, Model<Api>> {
  const index = new Map<string, Model<Api>>()
  for (const model of models) index.set(model.id, model)
  return index
}

/** 从内置模型读取 wire 兼容开关；类型层只保留对象。 */
function builtinCompat(model: Model<Api> | undefined): JsonRecord | undefined {
  return model?.compat === undefined ? undefined : record(model.compat)
}

/** 新模型的协议兼容缺省值；与 pi-ai 针对 opencode 的既有条目保持一致。 */
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

/** 内置 pi-ai 模型自身的协议族。 */
function builtinApiKind(model: Model<Api> | undefined): OpenCodeApiKind | undefined {
  return isOpenCodeApiKind(model?.api) ? model.api : undefined
}

/** 单条模型的构建输入。 */
export interface CatalogEntryInput {
  readonly id: string
  readonly plan: OpenCodePlan
  /** Console 条目（若登录且该模型在工作空间内）。 */
  readonly consoleEntry?: JsonRecord
  /** 本 plan 的 models.dev 条目。 */
  readonly catalogEntry?: JsonRecord
  /** 另一 plan 的 models.dev 条目（仅补全协议/容量等缺失字段）。 */
  readonly fallbackCatalogEntry?: JsonRecord
  /** 本 plan 的 pi-ai 内置条目。 */
  readonly builtin?: Model<Api>
  /** 另一 plan 的 pi-ai 内置条目（仅兜底）。 */
  readonly fallbackBuiltin?: Model<Api>
  /** 本 plan 目录的 provider 级 npm。 */
  readonly providerNpm?: string
  /** Console 配置的 provider 级 package。 */
  readonly consoleProviderNpm?: string
  /** 活 roster 里该模型的创建时间（epoch 秒），用于免费模型的排序。 */
  readonly rosterCreatedAt?: number
  /** 活 roster 给出的 token 单价；公开目录落后于 roster 时兜底。 */
  readonly rosterCost?: OpenCodeModelCost
  /** 活 roster 给出的上下文与输出上限；账号实时数据，优先于静态目录。 */
  readonly rosterLimit?: { context?: number; output?: number }
  /**
   * 活 roster 给出的思考等级映射。
   *
   * 对象 = 有档位；`null` = 声明支持思考但无档位（toggle 型）；`undefined` =
   * 清单没声明该模型（退回静态目录）。`null` 与 `undefined` 必须区分，前者要
   * 把模型的 `reasoning` 判为 false。
   */
  readonly rosterReasoning?: OpenCodeThinkingLevelMap | null | undefined
  /** 当前套餐档位的估算表；仅 `plan` 为 `go` 时写入预计请求数。 */
  readonly estimates?: OpenCodeEstimateTable
}

/** 构建结果：成功模型（可带降级说明），或跳过原因。 */
export type CatalogEntryResult =
  | { readonly ok: true; readonly model: OpenCodeModel; readonly warnings?: readonly string[] }
  | { readonly ok: false; readonly reason: string }

/**
 * 合并一条模型的多方信息。
 *
 * 纯函数，不读网络：Console 提供启用状态与最新能力，公开目录补全描述与容量，
 * 内置目录保留经过验证的 wire 兼容开关。
 */
export function buildCatalogEntry(entry: CatalogEntryInput): CatalogEntryResult {
  const { id, plan, consoleEntry, catalogEntry, fallbackCatalogEntry, builtin, fallbackBuiltin, rosterCreatedAt, rosterCost, rosterLimit, rosterReasoning } = entry
  const warnings: string[] = []
  const consoleCaps = record(consoleEntry?.capabilities)
  const consoleReasoning = consoleCaps !== undefined && 'reasoning' in consoleCaps
    ? consoleCaps.reasoning
    : undefined
  // 协议解析顺序（已对 2026-10-24 的官方 opencode 1.19.4 命令行逐模型核对 116 条，
  // 全部一致）：
  //   1. 本 plan 目录段的逐模型声明（Console `aisdk:<npm>`、目录 `provider.npm`、
  //      目录 `provider.api` 里的完整端点）；
  //   2. 只有该模型**不在**本段时，才继承另一段的逐模型声明；
  //   3. 本 plan 的 provider 级缺省；
  //   4. pi-ai 内置目录；
  //   5. 兜底按 Chat Completions 推断并给出告警。
  //
  // 关键点：同一模型在 Console 与 Go 两段可能是不同协议（Console 的 `minimax-m3` 是
  // Chat Completions，Go 的 `minimax-m3` 是 Anthropic Messages）；把另一段的
  // 逐模型声明也当成高优先级来源，会覆盖本段真实协议，DSH 端就报
  // `ModelProtocolUnsupported`。所以跨段只在「本段完全没有该模型」时生效。
  // 公开目录的逐模型 npm 优先于 Console 的 `aisdk:<npm>`：实测该账号的 Console
  // 条目把 `grok-build-0.1` 标成 `@ai-sdk/openai-compatible`，而公开目录、官方
  // 文档与官方 CLI 都把它当 Responses（`@ai-sdk/openai`）。Console 的 package
  // 只在公开目录没有该模型 npm 时作为补充来源。
  const ownNpm = nonEmptyString(record(catalogEntry?.provider)?.npm)
    ?? nonEmptyString(consoleEntry?.package)
  const ownUrl = nonEmptyString(record(catalogEntry?.provider)?.api)
  const crossModelNpm = catalogEntry === undefined
    ? nonEmptyString(record(fallbackCatalogEntry?.provider)?.npm)
    : undefined
  const declaredNpm = ownNpm ?? crossModelNpm ?? nonEmptyString(entry.providerNpm) ?? nonEmptyString(entry.consoleProviderNpm)
  let api: OpenCodeApiKind | undefined = apiFromPackage(ownNpm)
    ?? apiFromUrl(ownUrl)
    ?? apiFromPackage(crossModelNpm)
    ?? apiFromPackage(entry.providerNpm)
    ?? apiFromPackage(entry.consoleProviderNpm)
    ?? apiFromPackage(record(builtin?.compat)?.package)
    ?? builtinApiKind(builtin)
    ?? (catalogEntry === undefined ? builtinApiKind(fallbackBuiltin) : undefined)
  if (api === undefined) {
    // 上游明确声明了协议但我们不认识：跳过（端点无法猜）。
    if (declaredNpm !== undefined) return { ok: false, reason: `${id}: 无法识别的协议 ${declaredNpm}` }
    // 活跃 roster 里有、但元数据都没描述：按该 plan 最常见的 Chat Completions
    // 投影，并明确提示这是推断。
    api = 'openai-completions'
    warnings.push(`${id}: 上游没有协议元数据，按 openai-completions 推断`)
  }

  const output = array(consoleCaps?.output).length > 0
    ? array(consoleCaps?.output)
    : array(record(catalogEntry?.modalities)?.output).length > 0
      ? array(record(catalogEntry?.modalities)?.output)
      : array(record(fallbackCatalogEntry?.modalities)?.output)
  if (output.includes('image')) return { ok: false, reason: `${id}: 图片生成模型不在适配范围` }

  const rawInput = array(consoleCaps?.input).length > 0
    ? consoleCaps?.input
    : array(record(catalogEntry?.modalities)?.input).length > 0
      ? record(catalogEntry?.modalities)?.input
      : array(record(fallbackCatalogEntry?.modalities)?.input).length > 0
        ? record(fallbackCatalogEntry?.modalities)?.input
        : builtin?.input ?? fallbackBuiltin?.input
  const inputModalities = normalizeInputModalities(rawInput)
  if (inputModalities.length === 0) warnings.push(`${id}: 上游没有输入模态元数据，按纯文本处理`)
  const input: ('text' | 'image')[] = inputModalities.includes('image') ? ['text', 'image'] : ['text']

  // 账号清单最权威：它按当前账号真实可用集声明能力；没声明时才退回静态目录。
  //
  // `null` = 清单声明支持思考但没有任何档位（toggle 型）；对象 = 有档位；
  // `undefined` = 清单没声明该模型，退回静态目录。
  //
  // toggle 型必须报 false：DSH 要求「支持思考就必须至少有一个可用档位」，
  // 报 true 而档位为空会让整个供应商的模型列表解析失败
  // （INVALID_MODEL_REASONING）。报 false 后 DSH 不提供思考设置，正是
  // 「只有开关、没有档位」的期望表现。
  const reasoning = rosterReasoning === null
    ? false
    : rosterReasoning !== undefined
      ? true
      : consoleReasoning !== undefined
      ? readReasoning(consoleReasoning) !== undefined && record(consoleReasoning)?.supported !== false
        && consoleReasoning !== false
      : catalogEntry?.reasoning === true
      || (catalogEntry?.reasoning === undefined && (fallbackCatalogEntry?.reasoning === true
        || (fallbackCatalogEntry?.reasoning === undefined && (builtin?.reasoning === true || fallbackBuiltin?.reasoning === true))))

  // 顺序：账号清单 → Console → 公开目录（本段→另一段）→ pi-ai 内置。
  // 账号清单排第一，因为它是唯一覆盖当前账号全部可用模型、且反映真实档位的源。
  const thinkingLevelMap = reasoning
    ? rosterReasoning
      ?? thinkingLevelMapFromReasoning(consoleReasoning)
      ?? thinkingLevelMapFromReasoning(catalogEntry?.reasoning_options)
      ?? thinkingLevelMapFromReasoning(fallbackCatalogEntry?.reasoning_options)
      ?? builtin?.thinkingLevelMap
      ?? fallbackBuiltin?.thinkingLevelMap
    : undefined

  const consoleLimit = record(consoleEntry?.limit)
  const catalogLimit = record(catalogEntry?.limit) ?? record(fallbackCatalogEntry?.limit)
  // 账号清单优先：实测公开目录对 minimax-m3（512K vs 1M）、qwen3.8-max
  // （262K vs 1M）明显低估，且完全缺失 kimi-k3.1-pro 等 4 个模型。
  const contextWindow = rosterLimit?.context
    ?? positiveInteger(consoleLimit?.context)
    ?? positiveInteger(catalogLimit?.context)
    ?? builtin?.contextWindow
    ?? fallbackBuiltin?.contextWindow
    ?? DEFAULT_CONTEXT_WINDOW
  const maxTokens = rosterLimit?.output
    ?? positiveInteger(consoleLimit?.output)
    ?? positiveInteger(catalogLimit?.output)
    ?? builtin?.maxTokens
    ?? fallbackBuiltin?.maxTokens
    ?? DEFAULT_MAX_TOKENS

  // 兜底顺序：Console 覆盖 → 本段公开目录 → 另一段公开目录 → pi-ai 内置 → 活 roster。
  // roster 放最后：它只在前面几个来源都没给出价格时才参与，不改动既有模型的展示价。
  const cost = costFrom(consoleEntry?.cost)
    ?? costFrom(catalogEntry?.cost)
    ?? costFrom(fallbackCatalogEntry?.cost)
    ?? (builtin === undefined
      ? undefined
      : costFrom({
        input: builtin.cost.input,
        output: builtin.cost.output,
        cache_read: builtin.cost.cacheRead,
        cache_write: builtin.cost.cacheWrite,
      }))
    ?? rosterCost
  const free = cost !== undefined && cost.input === 0 && cost.output === 0
  // 排序用的时间：优先公开目录的发布日（稳定），其次 roster 的创建时间。
  const releasedAt = nonEmptyString(catalogEntry?.release_date)
    ?? nonEmptyString(fallbackCatalogEntry?.release_date)
    ?? (rosterCreatedAt === undefined
      ? undefined
      : new Date(rosterCreatedAt * 1000).toISOString().slice(0, 10))
  // Console 的免费额度由网关按键客户端身份校验，第三方客户端调用只会得到
  // `FreeTierError`；Go 套餐内含的免费模型（beam-free 等）用订阅凭据正常调用。
  const clientOnly = free && plan === 'console'

  const name = nonEmptyString(consoleEntry?.name)
    ?? nonEmptyString(catalogEntry?.name)
    ?? nonEmptyString(fallbackCatalogEntry?.name)
    ?? builtin?.name
    ?? fallbackBuiltin?.name
    ?? id
  const description = nonEmptyString(catalogEntry?.description) ?? nonEmptyString(fallbackCatalogEntry?.description)
  const family = nonEmptyString(consoleEntry?.family)
    ?? nonEmptyString(catalogEntry?.family)
    ?? nonEmptyString(fallbackCatalogEntry?.family)
  const interleaved = record(catalogEntry?.interleaved)?.field === 'reasoning_content'
    || record(fallbackCatalogEntry?.interleaved)?.field === 'reasoning_content'
  const compat = compatFor(api, builtin ?? fallbackBuiltin, interleaved)
  const inputLimits = record(builtin?.inputLimits) ?? record(fallbackBuiltin?.inputLimits)
  const tools = typeof consoleCaps?.tools === 'boolean'
    ? consoleCaps.tools
    : catalogEntry?.tool_call !== false && fallbackCatalogEntry?.tool_call !== false
  const structuredOutput = catalogEntry?.structured_output === true || fallbackCatalogEntry?.structured_output === true
  // 预计请求数只有 Go 档有口径：没传额度表（按量账号）时一律不带该字段。
  // 表里没有该模型分两种情况：
  // - 免费模型按不限量（`null`）处理。官方 Go 额度表里标 `Unlimited` 的恰好只有
  //   免费模型，FAQ 也写明「达到 Go 限制后可以继续使用免费模型」，所以「Go 侧免费
  //   ⇒ 不限量」是上游的确定规则而非推测；上游新上架的免费模型（如 2026-11-03 的
  //   `crouton-alpha-free`）在内置快照更新前也能正确置顶，不会被当成「额度未知」沉底。
  // - 付费模型保持 undefined（排序沉底）：没有数据就不编造额度。
  const tableValue = estimateOf(entry.estimates, id)
  const estimated = plan !== 'go' || entry.estimates === undefined
    ? undefined
    : tableValue === undefined
      ? (free ? null : undefined)
      : tableValue

  return {
    ok: true,
    model: {
      id,
      name,
      ...(description === undefined ? {} : { description }),
      ...(family === undefined ? {} : { family }),
      api,
      baseURL: baseURLFor(plan, api),
      reasoning,
      ...(thinkingLevelMap === undefined ? {} : { thinkingLevelMap }),
      input,
      contextWindow,
      maxTokens,
      ...(cost === undefined ? {} : { cost }),
      ...(Object.keys(compat).length === 0 ? {} : { compat }),
      ...(inputLimits === undefined ? {} : { inputLimits }),
      plan,
      tools,
      ...(structuredOutput ? { structuredOutput: true } : {}),
      free,
      ...(clientOnly ? { clientOnly: true } : {}),
      ...(releasedAt === undefined ? {} : { releasedAt }),
      ...(estimated === undefined ? {} : { estimatedRequestsPerMonth: estimated }),
      ...(catalogEntry?.status === 'deprecated' || fallbackCatalogEntry?.status === 'deprecated' ? { deprecated: true } : {}),
      ...(consoleEntry?.disabled === true ? { disabled: true } : {}),
    },
    ...(warnings.length === 0 ? {} : { warnings }),
  }
}

/** 构建目录快照的输入。 */
export interface BuildCatalogInput {
  /** `GET /console/api/v2/config` 的响应体。 */
  readonly consoleConfig?: unknown
  /** `GET /inference/v1/models` 的响应体。 */
  readonly consoleRoster?: unknown
  /** `GET /inference/go/v1/models` 的响应体。 */
  readonly goRoster?: unknown
  /** `models.opencode.ai/api.json` 的响应体。 */
  readonly catalog?: unknown
  /** pi-ai 内置的 OpenCode 模型，按 plan 分组。 */
  readonly builtin?: { readonly console?: readonly Model<Api>[]; readonly go?: readonly Model<Api>[] }
  /**
   * 端点策略：统一使用某一来源的端点（`auto` 或缺省表示保持各模型原生端点）。
   *
   * 只在目标来源也存在同名模型时才改写：只存在于单一来源的模型若被强行改到
   * 另一端点，上游会直接返回 `Model is unavailable.`。
   */
  readonly endpointPlan?: OpenCodePlan | 'auto'
  /**
   * 当前套餐档位的每月预计请求数表；只写入 `plan` 为 `go` 的模型。
   *
   * 由调用方按套餐识别结果选表（见 `contracts/estimates.ts`）；缺省时不填该字段，
   * 排序随之回到「免费优先、单价升序」的原口径。
   */
  readonly estimates?: OpenCodeEstimateTable
  readonly now?: number
}

/**
 * 按端点策略改写模型的 `baseURL`。
 *
 * 账号可能只有一种付费方式（例如只订阅了 Go），这时把共用模型的请求统一打到
 * 套餐端点即可消耗套餐额度，而不是去碰需要余额的按量端点。改写的前提是目标
 * 来源的模型清单里也有这个模型：`baseURLFor` 按「来源 + 协议族」生成端点，
 * 所以同名且同协议的模型可以直接换前缀。
 * @param models - 已构建的模型列表。
 * @param plan - 目标来源；`auto` 表示不改写。
 * @returns 改写后的列表；没有可改写的条目时返回原列表。
 */
export function applyEndpointPlan(
  models: readonly OpenCodeModel[],
  plan: OpenCodePlan | 'auto' | undefined,
): readonly OpenCodeModel[] {
  // 先归位到各自来源的原生端点，让函数可以重复调用（切回 `auto` 要能还原）。
  const native = models.map(model => {
    const baseURL = baseURLFor(model.plan, model.api)
    return model.baseURL === baseURL ? model : { ...model, baseURL }
  })
  if (plan === undefined || plan === 'auto') return native
  const available = new Set(models
    .filter(model => model.plan === plan)
    .map(model => `${model.id}\u0000${model.api}`))
  let changed = false
  const next = native.map((model) => {
    if (model.plan === plan) return model
    if (!available.has(`${model.id}\u0000${model.api}`)) return model
    changed = true
    return { ...model, baseURL: baseURLFor(plan, model.api) }
  })
  return changed ? next : native
}

/**
 * 跨来源去重：同一模型 id 在 console 与 go 都出现时，只保留账号套餐对应的一份。
 *
 * 合并供应商把两组来源放在同一个列表里，同一个模型因此会出现两条（如
 * `beam-free` 的 console 与 go 条目）。账号实际能计费的是自己套餐那一侧，重复的
 * 另一侧既占位又容易误选，所以按 `plan` 收掉：`plan` 侧的条目始终保留，另一侧
 * 只删除 id 在 `plan` 侧也存在的重复项；只存在于另一侧的模型（如 `big-pickle`
 * 仅在 console）不属于重复，照常保留。
 *
 * @param models - 合并后的模型列表。
 * @param plan - 账号套餐来源，保留该侧条目。
 * @returns 去掉跨来源重复项后的列表；顺序保持原样。
 */
export function dedupeByPlan(
  models: readonly OpenCodeModel[],
  plan: OpenCodePlan,
): readonly OpenCodeModel[] {
  const owned = new Set(models.filter(model => model.plan === plan).map(model => model.id))
  const next = models.filter(model => model.plan === plan || !owned.has(model.id))
  return next.length === models.length ? models : next
}

/**
 * 整侧归属过滤：只保留账号套餐真正能计费的那一侧。
 *
 * Go 订阅（含 Plus / Teams）账号只保留 `plan === 'go'` 的条目，只有按量余额的
 * 账号只保留 `plan === 'console'` 的条目。**未知套餐按 Go 口径处理**：OpenCode 的
 * 主力形态是 Go 订阅，套餐判不出来时（未公开的套餐接口改版、Key 权限不足）
 * 按 Go 侧展示比两侧混列更接近用户真实可用的集合；console 条目依旧可以通过
 * 「推理端点」偏好显式切到 console 端点后保留可见性判断。
 *
 * @param models - 合并后的模型列表。
 * @param plan - 账号套餐档位。
 * @returns 过滤后的新列表；结果与输入等价时是同一个数组引用。
 */
export function scopeToAccountPlan(
  models: readonly OpenCodeModel[],
  plan: OpenCodeAccountPlan,
): readonly OpenCodeModel[] {
  const keep: OpenCodePlan = plan === 'payg' ? 'console' : 'go'
  const next = models.filter(model => model.plan === keep)
  return next.length === models.length ? models : next
}

/**
 * 目录排序。
 *
 * 两种口径：
 *
 * - **提供估算表**（Go 档）：只按该档位的每月预计请求数排。`null` 是上游标为
 *   Unlimited 的模型，置顶；有数值的降序；表里没有该模型（`undefined`）沉到
 *   末尾；同值按 id 升序。「免费」在这一口径下**不构成优先档**——免费模型若
 *   被标了较低额度，就应排在额度更高的付费模型之后。被禁用或仅官方客户端可用的
 *   条目仍然统一排在最后，且不受额度影响。
 * - **未提供估算表**：免费模型在最前（按时间降序），其次是可用的付费模型（按
 *   单价从低到高），禁用条目排最后。
 *
 * 排序只影响展示顺序，不改变条目本身。
 *
 * @param models - 待排序的模型列表。
 * @param estimates - 可选：当前套餐档位的预计请求数表。
 * @returns 排序后的新列表。
 */
export function sortCatalogModels(
  models: readonly OpenCodeModel[],
  estimates?: OpenCodeEstimateTable,
): readonly OpenCodeModel[] {
  // 不可用（禁用或仅官方客户端可用）：两种口径下都沉底。
  const unavailable = (model: OpenCodeModel): boolean => model.disabled === true || model.clientOnly === true
  // 没有价格元数据的模型不能当作「最便宜」排到前面，统一沉到付费档末尾。
  const price = (model: OpenCodeModel): number =>
    (model.cost === undefined ? Number.POSITIVE_INFINITY : model.cost.input + model.cost.output)
  const time = (model: OpenCodeModel): string => model.releasedAt ?? ''
  // 估算表只对 Go 档有意义：按量模型按 token 计费，没有「每月预计请求数」口径。
  // 列表不是纯 Go 侧（例如 unknown 套餐下的合并列表）、或条目上还没带估算值时
  // 一律回落到老口径，避免整列退化成「只按 id 排」。
  const byEstimate = estimates !== undefined
    && models.every(model => model.plan === 'go')
    && models.some(model => model.estimatedRequestsPerMonth !== undefined)
  // 额度档位：2 = null（不限量，最前），1 = 有数值（降序），0 = 表里没有（沉底）。
  const quotaRank = (model: OpenCodeModel): number =>
    model.estimatedRequestsPerMonth === null ? 2 : model.estimatedRequestsPerMonth === undefined ? 0 : 1
  return [...models].sort((left, right) => {
    if (byEstimate) {
      // 只看「可用 / 不可用」两层：免费与付费在额度口径下同权，一起参与比较。
      const byUnavailable = Number(unavailable(left)) - Number(unavailable(right))
      if (byUnavailable !== 0) return byUnavailable
      if (!unavailable(left)) {
        const byQuotaRank = quotaRank(right) - quotaRank(left)
        if (byQuotaRank !== 0) return byQuotaRank
        const leftQuota = left.estimatedRequestsPerMonth
        const rightQuota = right.estimatedRequestsPerMonth
        if (typeof leftQuota === 'number' && typeof rightQuota === 'number' && leftQuota !== rightQuota) {
          return rightQuota - leftQuota
        }
      }
      return left.id.localeCompare(right.id)
    }
    // 老口径：免费 0 / 付费 1 / 不可用 2。
    const rank = (model: OpenCodeModel): number => (unavailable(model) ? 2 : model.free ? 0 : 1)
    const byRank = rank(left) - rank(right)
    if (byRank !== 0) return byRank
    const bucket = rank(left)
    // 免费模型：新的在前。
    if (bucket === 0) {
      const byTime = time(right).localeCompare(time(left))
      if (byTime !== 0) return byTime
    }
    // 付费模型：便宜的在前。
    if (bucket === 1) {
      const byPrice = price(left) - price(right)
      if (byPrice !== 0) return byPrice
    }
    return left.id.localeCompare(right.id)
  })
}

/** `applyCatalogView` 的选项。 */
export interface CatalogViewOptions {
  /** 账号拥有的来源（旧口径）：只做跨来源同名去重，不过滤单侧独有条目。 */
  readonly ownedPlan?: OpenCodePlan | undefined
  /**
   * 账号套餐档位（新口径）：非 `unknown` 时整侧过滤，取代跨来源去重。
   *
   * 与 `ownedPlan` 同时存在时以本字段为准；缺省或 `unknown` 时回落到
   * `ownedPlan` 的旧行为，保证不传该字段时行为完全不变。
   */
  readonly accountPlan?: OpenCodeAccountPlan | undefined
  /** 当前套餐档位的预计请求数表；缺省时排序保持老口径。 */
  readonly estimates?: OpenCodeEstimateTable | undefined
  /** 当前端点策略；缺省或 `auto` 时不改端点。 */
  readonly endpointPlan?: OpenCodePlan | 'auto' | undefined
}

/**
 * 目录的统一展示口径：按套餐过滤 → 排序 → 按端点策略改写 `baseURL`。
 *
 * 详情页目录卡片与模型选择器都走这一条，避免两处对同一个模型给出不同结论
 * （一处显示 `· console` 条目、另一处已经把它去重掉）。
 *
 * @param models - 目录里的模型列表。
 * @param options - 套餐、估算表与端点策略；缺省时对应步骤跳过。
 * @returns 处理并排好序的新列表。
 */
export function applyCatalogView(
  models: readonly OpenCodeModel[],
  options: CatalogViewOptions,
): readonly OpenCodeModel[] {
  // 账号套餐已知或未知都走整侧过滤（未知按 Go 口径）；只有调用方完全没传
  // accountPlan 时才回落到旧的 ownedPlan 去重口径，保证既有调用方行为不变。
  const scoped = options.accountPlan === undefined
    ? (options.ownedPlan === undefined ? models : dedupeByPlan(models, options.ownedPlan))
    : scopeToAccountPlan(models, options.accountPlan)
  const ordered = sortCatalogModels(scoped, options.estimates)
  if (options.endpointPlan === undefined || options.endpointPlan === 'auto') return ordered
  return applyEndpointPlan(ordered, options.endpointPlan)
}

/**
 * 合并来源，生成目录快照。
 *
 * 每个 plan 的模型集合：活 roster 为全集；没有 roster 时回退公开目录的非
 * deprecated 条目；再失败回退内置目录。Console 配置只做增补（自定义条目、
 * `disabled` 标记、能力/容量覆盖、路由头）。
 */
export function buildCatalog(input: BuildCatalogInput): OpenCodeCatalog {
  const now = input.now ?? Date.now()
  const consoleScopes = consoleScopesFromConsoleConfig(input.consoleConfig)
  const warnings: string[] = []
  const models: OpenCodeModel[] = []
  const rosters: Record<OpenCodePlan, unknown> = { console: input.consoleRoster, go: input.goRoster }
  const builtinByPlan: Record<OpenCodePlan, Map<string, Model<Api>>> = {
    console: builtinModelIndex(input.builtin?.console ?? []),
    go: builtinModelIndex(input.builtin?.go ?? []),
  }

  for (const plan of PLANS) {
    const label = PLAN_LABELS[plan]
    const scope = consoleScopes.get(plan)
    const primary = catalogSection(input.catalog, plan)
    const fallback = catalogSection(input.catalog, plan === 'console' ? 'go' : 'console')
    const rosterIds = modelIdsFrom(rosters[plan])
    const rosterCreated = modelCreatedAtFrom(rosters[plan])
    const rosterCosts = modelCostFrom(rosters[plan])
    // 账号清单是**实时**的：它覆盖当前账号真实可用的全部模型，优先级高于
    // 全局静态目录与随包内置目录（实测公开目录漏掉 4 个模型、并低估 3 个上下文）。
    const rosterLimits = modelLimitFrom(rosters[plan])
    const rosterReasoning = modelReasoningFrom(rosters[plan])
    const consoleEntries = new Map<string, JsonRecord>()
    for (const entry of scope?.models ?? []) consoleEntries.set(entry.id, entry.entry)

    const ids: string[] = []
    if (rosterIds.length > 0) {
      ids.push(...rosterIds)
    } else if (primary.models.size > 0) {
      // 没有活清单时退回目录，但要排除已标为 deprecated 的条目。
      for (const [id, entry] of primary.models) {
        if (entry.status !== 'deprecated') ids.push(id)
      }
    } else {
      ids.push(...builtinByPlan[plan].keys())
      if (ids.length > 0) warnings.push(`${label}: 无法读取公开模型清单，暂用 pi-ai 内置目录`)
    }
    for (const id of consoleEntries.keys()) if (!ids.includes(id)) ids.push(id)
    if (ids.length === 0) warnings.push(`${label}: 没有读到任何模型`)

    const providerNpm = nonEmptyString(primary.provider?.npm) ?? nonEmptyString(fallback.provider?.npm)
    const seen = new Set<string>()
    for (const id of ids) {
      if (seen.has(id)) continue
      seen.add(id)
      const consoleEntry = consoleEntries.get(id)
      const catalogEntry = primary.models.get(id)
      const fallbackCatalogEntry = fallback.models.get(id)
      const builtin = builtinByPlan[plan].get(id)
      const fallbackBuiltin = builtinByPlan[plan === 'console' ? 'go' : 'console'].get(id)
      const result = buildCatalogEntry({
        id,
        plan,
        ...(consoleEntry === undefined ? {} : { consoleEntry }),
        ...(catalogEntry === undefined ? {} : { catalogEntry }),
        ...(fallbackCatalogEntry === undefined ? {} : { fallbackCatalogEntry }),
        ...(builtin === undefined ? {} : { builtin }),
        ...(fallbackBuiltin === undefined ? {} : { fallbackBuiltin }),
        ...(providerNpm === undefined ? {} : { providerNpm }),
        ...(scope?.packageName === undefined ? {} : { consoleProviderNpm: scope.packageName }),
        ...(rosterCreated.has(id) ? { rosterCreatedAt: rosterCreated.get(id) as number } : {}),
        ...(rosterCosts.has(id) ? { rosterCost: rosterCosts.get(id) as OpenCodeModelCost } : {}),
        ...(rosterLimits.has(id) ? { rosterLimit: rosterLimits.get(id) as { context?: number; output?: number } } : {}),
        ...(rosterReasoning.has(id) ? { rosterReasoning: rosterReasoning.get(id) } : {}),
        ...(input.estimates === undefined ? {} : { estimates: input.estimates }),
      })
      if (result.ok) {
        models.push(result.model)
        for (const warning of result.warnings ?? []) warnings.push(`${label}: ${warning}`)
      } else {
        warnings.push(`${label}: ${result.reason}`)
      }
    }
  }

  return {
    fetchedAt: now,
    source: consoleScopes.size > 0 ? 'console' : 'public',
    models: applyEndpointPlan(models, input.endpointPlan),
    warnings,
  }
}

/** 目录可能来自的 URL：供服务层与测试共用。 */
export interface CatalogUrls {
  readonly consoleRoster: string
  readonly goRoster: string
  readonly catalog: string
}

/** 默认的公开数据源地址。 */
export const DEFAULT_CATALOG_URLS: CatalogUrls = {
  consoleRoster: OPENCODE_MODELS_URL,
  goRoster: OPENCODE_GO_MODELS_URL,
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
  readonly builtin?: { readonly console?: readonly Model<Api>[]; readonly go?: readonly Model<Api>[] }
  readonly urls?: CatalogUrls
  readonly now?: number
  /** 跳过公开目录的抓取（调用方已有缓存）。 */
  readonly catalog?: unknown
  readonly consoleRoster?: unknown
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
 * 两个 roster 与公开目录是硬依赖（失败时使用调用方传入的旧值或内置目录），
 * Console 配置是软依赖：它的失败只记录为 `consoleError`，不阻断目录。
 */
export async function fetchOpenCodeCatalog(input: FetchCatalogInput): Promise<FetchCatalogResult> {
  const fetchImpl = input.fetchImpl ?? fetch
  const urls = input.urls ?? DEFAULT_CATALOG_URLS
  const signal = input.signal ?? AbortSignal.timeout(20_000)
  const headers = (auth: boolean): Record<string, string> => ({
    accept: 'application/json',
    'user-agent': OPENCODE_USER_AGENT,
    ...(auth && input.accessToken !== undefined ? { authorization: `Bearer ${input.accessToken}` } : {}),
    ...(auth && input.orgId !== undefined ? { 'x-org-id': input.orgId } : {}),
  })
  const json = (url: string, auth = false): Promise<unknown> =>
    fetchJson(url, { headers: headers(auth), signal }, CATALOG_RESPONSE_MAX_BYTES, fetchImpl)

  let consoleConfig: unknown
  let consoleError: string | undefined
  if (input.accessToken !== undefined) {
    const server = (input.server ?? 'https://opencode.ai/console').replace(/\/+$/, '')
    try {
      consoleConfig = await json(`${server}/api/v2/config`, true)
    } catch (error) {
      consoleError = error instanceof Error ? error.message : String(error)
    }
  }

  const [consoleRoster, goRoster, catalog] = await Promise.all([
    input.consoleRoster !== undefined ? Promise.resolve(input.consoleRoster) : json(urls.consoleRoster, true).catch(() => undefined),
    input.goRoster !== undefined ? Promise.resolve(input.goRoster) : json(urls.goRoster, true).catch(() => undefined),
    input.catalog !== undefined ? Promise.resolve(input.catalog) : json(urls.catalog).catch(() => undefined),
  ])

  return {
    catalog: buildCatalog({
      ...(consoleConfig === undefined ? {} : { consoleConfig }),
      ...(consoleRoster === undefined ? {} : { consoleRoster }),
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
  readonly builtin?: () => { readonly console?: readonly Model<Api>[]; readonly go?: readonly Model<Api>[] }
  readonly urls?: CatalogUrls
  /** 构建目录时注入的估算表（按当前套餐档位），每次构建时求值。 */
  readonly estimates?: () => OpenCodeEstimateTable | undefined
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
  private consoleRoster: unknown
  private goRoster: unknown
  private rosterAt = 0
  private metadata: unknown
  private metadataAt = 0
  private consoleConfig: unknown
  private consoleAt = 0
  private readonly consoleHeaders = new Map<OpenCodePlan, Readonly<Record<string, string>>>()

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
   * Console 下发给某个 plan 的路由头（工作空间 id 等），供推理请求携带。
   *
   * 与目录快照分开：这份数据不进 `/catalog` 响应，浏览器永远看不到它。
   */
  requestHeaders(plan: OpenCodePlan): Readonly<Record<string, string>> | undefined {
    return this.consoleHeaders.get(plan)
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

    let consoleRoster = this.consoleRoster
    let goRoster = this.goRoster
    let catalog = this.metadata
    let consoleConfig = this.consoleConfig

    const rosterStale = force || now - this.rosterAt >= CATALOG_ROSTER_TTL_MS
    const metadataStale = force || now - this.metadataAt >= CATALOG_METADATA_TTL_MS
    const consoleStale = force || now - this.consoleAt >= CATALOG_ROSTER_TTL_MS

    const account = await this.options.resolveAccount()
    const server = (account?.server ?? 'https://opencode.ai/console').replace(/\/+$/, '')
    const authHeaders = (): Record<string, string> => ({
      accept: 'application/json',
      'user-agent': OPENCODE_USER_AGENT,
      ...(account === undefined ? {} : { authorization: `Bearer ${account.access}` }),
      ...(account?.orgId === undefined ? {} : { 'x-org-id': account.orgId }),
    })

    const tasks: Promise<void>[] = []
    if (rosterStale) {
      tasks.push(fetchJson(urls.consoleRoster, { headers: authHeaders(), signal }, CATALOG_RESPONSE_MAX_BYTES, fetchImpl)
        .then((value) => { consoleRoster = value; this.consoleRoster = value })
        .catch((error: unknown) => { this.lastError = describe(error) }))
      tasks.push(fetchJson(urls.goRoster, { headers: authHeaders(), signal }, CATALOG_RESPONSE_MAX_BYTES, fetchImpl)
        .then((value) => { goRoster = value; this.goRoster = value })
        .catch((error: unknown) => { this.lastError = describe(error) }))
    }
    if (metadataStale) {
      tasks.push(fetchJson(urls.catalog, { headers: { accept: 'application/json', 'user-agent': OPENCODE_USER_AGENT }, signal }, CATALOG_RESPONSE_MAX_BYTES, fetchImpl)
        .then((value) => { catalog = value; this.metadata = value; this.metadataAt = now })
        .catch((error: unknown) => { this.lastError = describe(error) }))
    }
    if (account !== undefined && consoleStale) {
      tasks.push(fetchJson(`${server}/api/v2/config`, { headers: authHeaders(), signal }, CATALOG_RESPONSE_MAX_BYTES, fetchImpl)
        .then((value) => {
          consoleConfig = value
          this.consoleConfig = value
          this.consoleAt = now
          this.consoleError = undefined
          this.consoleHeaders.clear()
          for (const [plan, scope] of consoleScopesFromConsoleConfig(value)) {
            if (scope.headers !== undefined) this.consoleHeaders.set(plan, scope.headers)
          }
        })
        .catch((error: unknown) => {
          this.consoleError = describe(error)
          // 换了账号却拉不到配置时，宁可丢掉旧工作空间头，也不要把它带到
          // 新账号的推理请求上。
          this.consoleHeaders.clear()
        }))
    } else if (account === undefined) {
      this.consoleError = undefined
      this.consoleConfig = undefined
      this.consoleHeaders.clear()
    }
    await Promise.all(tasks)
    if (rosterStale) this.rosterAt = now

    const estimates = this.options.estimates?.()
    const next = buildCatalog({
      ...(consoleConfig === undefined ? {} : { consoleConfig }),
      ...(consoleRoster === undefined ? {} : { consoleRoster }),
      ...(goRoster === undefined ? {} : { goRoster }),
      ...(catalog === undefined ? {} : { catalog }),
      ...(this.options.builtin === undefined ? {} : { builtin: this.options.builtin() }),
      ...(estimates === undefined ? {} : { estimates }),
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
