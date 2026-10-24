/**
 * 模型目录服务：把账号权益归一化成 DSH 的模型清单。
 *
 * 目录的**真源是额度接口**，不是内置静态表。原因很具体：ZCode 会按账号动态
 * 下发 Start Plan 的可用模型（套餐变体、活动赠送、到期都会改变清单），而内置
 * provider 规则里的 `builtinModelIds` 只是发版时的快照。因此每次刷新都以
 * `billing/balance` 的 `capabilities` 为准；只有额度接口不可读（未登录、网络
 * 失败、业务码非 0）时才回落到内置兜底，并把 `source` 标成 `builtin`，
 * 让界面能说明「当前清单未经账号确认」。
 *
 * 模型能力（上下文窗口、最大输出、思考等级、图片输入）来自 `client/configs`，
 * 缺失时用安全默认值，避免因为没有配置就把模型藏起来。
 *
 * @module dsh-zcode/catalog
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  deriveBalancePeriod,
  normalizeModelId,
  modelIdOfCapability,
  type ZCodeBalanceEntry,
  type ZCodeCatalog,
  type ZCodeModel,
  type ZCodePlanEntry,
  type ZCodeThinkingLevelMap,
} from '../contracts/catalog.ts'
import { ZCODE_ANTHROPIC_BASE_URL, type ZCodeFamily } from '../contracts/identity.ts'
import {
  ZCodeConsoleError,
  type ZCodeClientModel,
  type ZCodeConsoleClient,
  type ZCodeRawBalance,
} from './console-client.ts'

/**
 * 未在 `client/configs` 里描述时的兜底能力。
 *
 * 取 GLM-5 系列的实际取值：40 万上下文、8 万最大输出。宁可保守（更早提示
 * 上下文超限），也不要把上限猜高导致请求被网关拒绝。
 */
export const ZCODE_FALLBACK_CONTEXT_WINDOW = 400_000
export const ZCODE_FALLBACK_MAX_TOKENS = 80_000

/**
 * 内置兜底模型清单。
 *
 * 与 ZCode 内置 provider 规则的 `builtinModelIds` 一致；只在额度接口不可读时
 * 使用，用于保证未登录状态下的选择器不是空的。
 */
export const ZCODE_BUILTIN_MODEL_IDS: readonly string[] = [
  'GLM-5.3-Flash',
  'GLM-5.2',
  'GLM-5-Turbo',
]

/**
 * 思考等级映射。
 *
 * GLM 系列在 Anthropic 协议下用 `thinking` 块表达推理，pi-ai 的等级键与上游
 * 取值不是一一对应：`off` 表示不请求思考，其余按强度映射到上游 `low` /
 * `high` / `max` 三档。上游只认这三档，因此中间等级向上取整而不是透传，
 * 否则会得到 400。
 */
export function thinkingLevelMapOf(levels: readonly string[] | undefined): {
  map: ZCodeThinkingLevelMap
  reasoning: boolean
} {
  if (levels === undefined || levels.length === 0) {
    return { map: {}, reasoning: false }
  }
  const normalized = new Set(levels.map(level => level.trim().toLowerCase()))
  const map: ZCodeThinkingLevelMap = {}
  // 未支持思考时，除 off 外全部标为 null，让选择器只留下 off。
  if (!normalized.has('low') && !normalized.has('medium') && !normalized.has('high') && !normalized.has('max')) {
    return { map: { off: null }, reasoning: false }
  }
  map.off = null
  if (normalized.has('low')) map.minimal = 'low'
  if (normalized.has('low')) map.low = 'low'
  if (normalized.has('high')) map.medium = 'high'
  if (normalized.has('high')) map.high = 'high'
  if (normalized.has('max')) map.xhigh = 'max'
  if (normalized.has('max')) map.max = 'max'
  return { map, reasoning: true }
}

/**
 * 上游是否因凭据失效而拒绝。
 *
 * ZCode 的账号令牌有有效期，过期后额度接口返回 HTTP 401（无错误信封）。
 * 这个状态与「网络不通」「没有套餐」的处理方式完全不同，必须先分开。
 */
export function isUnauthorized(error: unknown): boolean {
  return error instanceof ZCodeConsoleError && error.status === 401
}

/** 把一个额度 capability 投影成模型。 */
export function toModel(params: {
  readonly id: string
  readonly capability?: string
  readonly clientModel?: ZCodeClientModel
  readonly family: ZCodeFamily
}): ZCodeModel {
  const { id, capability, clientModel, family } = params
  const levels = clientModel?.reasoningLevels
  const { map, reasoning } = thinkingLevelMapOf(levels)
  const supportsImage = clientModel?.supportsImage === true
  return {
    id,
    name: clientModel?.name ?? id,
    ...(clientModel?.description === undefined ? {} : { description: clientModel.description }),
    family: family === 'zai' ? 'zai' : 'bigmodel',
    api: 'anthropic-messages',
    baseURL: ZCODE_ANTHROPIC_BASE_URL,
    reasoning,
    ...(reasoning ? { thinkingLevelMap: map } : {}),
    input: supportsImage ? ['text', 'image'] : ['text'],
    contextWindow: clientModel?.contextWindow ?? ZCODE_FALLBACK_CONTEXT_WINDOW,
    maxTokens: clientModel?.maxCompletionTokens ?? ZCODE_FALLBACK_MAX_TOKENS,
    tools: true,
    structuredOutput: true,
    accountFamily: family,
    ...(capability === undefined ? {} : { capability }),
  }
}

/** 从额度条目推导模型 id 列表（保序去重）。 */
export function modelIdsFromBalances(balances: readonly ZCodeBalanceEntry[]): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const balance of balances) {
    const raw = balance.capability === undefined ? undefined : modelIdOfCapability(balance.capability)
    // 没有 capability 的额度是账号级/活动级记录（例如总额度），不对应模型。
    if (raw === undefined) continue
    const id = normalizeModelId(raw)
    if (seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}

/** Unix 秒 → epoch 毫秒；非法值返回 undefined。 */
function secondsToMs(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return undefined
  return value * 1000
}

/** 把额度条目归一成契约形状（周期由窗口时长推导）。 */
export function toBalanceEntries(balances: readonly ZCodeRawBalance[]): ZCodeBalanceEntry[] {
  return balances.map(balance => {
    const periodStart = secondsToMs(balance.periodStartSeconds)
    const periodEnd = secondsToMs(balance.periodEndSeconds)
    return {
      entitlementId: balance.capability ?? balance.showName,
      showName: balance.showName,
      ...(balance.capability === undefined ? {} : { capability: balance.capability }),
      totalUnits: balance.totalUnits,
      usedUnits: balance.usedUnits,
      remainingUnits: balance.remainingUnits,
      period: deriveBalancePeriod(balance.periodStartSeconds, balance.periodEndSeconds),
      ...(periodStart === undefined ? {} : { periodStart }),
      ...(periodEnd === undefined ? {} : { periodEnd }),
      ...(secondsToMs(balance.expiresAtSeconds) === undefined
        ? {}
        : { expiresAt: secondsToMs(balance.expiresAtSeconds) }),
      ...(balance.planId === undefined ? {} : { planId: balance.planId }),
    }
  })
}

/**
 * 同一模型在多份套餐下会有多条额度，逐条展示会让界面出现重复行。
 *
 * 这里按「模型 + 周期」合并：保留额度最大的那条作为主额度，把其余总量累加。
 * 累加是有意义的——两份套餐的同一模型日额度确实可以叠加使用；但**不合并
 * 不同周期**，否则会掩盖"日额度用完但活动额度还有"。
 */
export function mergeBalanceEntries(
  entries: readonly ZCodeBalanceEntry[],
): ZCodeBalanceEntry[] {
  const merged = new Map<string, ZCodeBalanceEntry>()
  for (const entry of entries) {
    const key = `${entry.capability ?? entry.showName}::${entry.period}`
    const existing = merged.get(key)
    if (existing === undefined) {
      merged.set(key, entry)
      continue
    }
    const totalUnits = existing.totalUnits + entry.totalUnits
    const usedUnits = existing.usedUnits + entry.usedUnits
    const remainingUnits = existing.remainingUnits + entry.remainingUnits
    merged.set(key, {
      ...existing,
      totalUnits,
      usedUnits,
      remainingUnits,
      // 取更早的到期时间：先到期的额度先生效，提醒用户不要错过。
      ...(earliest(existing.periodEnd, entry.periodEnd) === undefined
        ? {}
        : { periodEnd: earliest(existing.periodEnd, entry.periodEnd) }),
    })
  }
  return [...merged.values()]
}

/** 两个时间戳中较早且存在的那个。 */
function earliest(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined) return right
  if (right === undefined) return left
  return Math.min(left, right)
}

/** 目录服务依赖。 */
export interface ZCodeCatalogServiceOptions {
  readonly client: ZCodeConsoleClient
  /** 当前账号 JWT；未登录返回 undefined。 */
  readonly resolveToken: () => Promise<string | undefined>
  /** 当前账号家族；未登录时为 undefined。 */
  readonly resolveFamily: () => Promise<ZCodeFamily | undefined>
  readonly logger?: Pick<Context['logger'], 'warn' | 'info'>
  /** 快照最短复用时间（毫秒）。 */
  readonly staleAfterMs?: number
  readonly now?: () => number
}

const DEFAULT_STALE_AFTER_MS = 5 * 60_000

/** 目录服务。 */
export class ZCodeCatalogService {
  private current: ZCodeCatalog | undefined
  private inflight: Promise<ZCodeCatalog> | undefined
  private readonly options: ZCodeCatalogServiceOptions

  constructor(options: ZCodeCatalogServiceOptions) {
    this.options = options
  }

  private get now(): number {
    return this.options.now?.() ?? Date.now()
  }

  /** 当前快照；从未刷新过时返回 undefined。 */
  snapshot(): ZCodeCatalog | undefined {
    return this.current
  }

  /** 快照是否已过期。 */
  isStale(): boolean {
    if (this.current === undefined) return true
    const staleAfter = this.options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS
    return this.now - this.current.fetchedAt >= staleAfter
  }

  /** 失效快照，强制下次刷新走网络。 */
  invalidate(): void {
    this.current = undefined
  }

  /** 已过期才刷新，否则复用。 */
  async refreshIfStale(): Promise<ZCodeCatalog> {
    if (this.current !== undefined && !this.isStale()) return this.current
    return this.refresh()
  }

  /** 强制刷新；并发调用合并成一次请求。 */
  async refresh(): Promise<ZCodeCatalog> {
    this.inflight ??= this.load().finally(() => {
      this.inflight = undefined
    })
    return this.inflight
  }

  private async load(): Promise<ZCodeCatalog> {
    const token = await this.options.resolveToken()
    const family = await this.options.resolveFamily()
    if (token === undefined || family === undefined) {
      // 未登录：给一份内置兜底清单，让选择器能展示目录结构，
      // 但标记 source=builtin，界面据此提示需登录。
      const builtin = this.builtinCatalog(family ?? 'bigmodel', [
        '尚未登录 ZCode 账号，当前展示内置模型清单；登录后按账号权益刷新',
      ])
      this.current = builtin
      return builtin
    }

    const warnings: string[] = []
    let balances: ZCodeBalanceEntry[] = []
    let plans: ZCodePlanEntry[] = []
    let source: ZCodeCatalog['source'] = 'builtin'

    try {
      const snapshot = await this.options.client.balance(token)
      balances = mergeBalanceEntries(toBalanceEntries(snapshot.balances))
      plans = snapshot.plans.map(plan => ({
        planId: plan.planId,
        ...(plan.name === undefined ? {} : { name: plan.name }),
        ...(plan.status === undefined ? {} : { status: plan.status }),
        ...(plan.endsAt === undefined ? {} : { endsAt: plan.endsAt }),
      }))
      source = 'balance'
      if (plans.length === 0) {
        warnings.push('额度接口未返回任何套餐记录，账号可能尚未订阅 Start Plan')
      }
    } catch (error) {
      // 401 是账号凭据失效（ZCode 令牌有有效期），不是网络或权益问题：
      // 用户需要重新登录，而不是等一会儿重试。把这两种情况分开说明，
      // 否则用户只会看到"额度接口不可读"而不知道该做什么。
      if (isUnauthorized(error)) {
        warnings.push('ZCode 账号凭据已失效，请重新登录后刷新模型清单')
      } else {
        warnings.push(`额度接口不可读，暂用内置模型清单：${error instanceof Error ? error.message : String(error)}`)
      }
      this.options.logger?.warn('dsh-zcode: 读取额度失败', error)
    }

    let clientModels: readonly ZCodeClientModel[] = []
    try {
      const configs = await this.options.client.clientConfigs(token)
      clientModels = configs.models
    } catch (error) {
      warnings.push('客户端配置不可读，模型能力使用保守默认值')
      this.options.logger?.warn('dsh-zcode: 读取客户端配置失败', error)
    }

    const ids = source === 'balance' ? modelIdsFromBalances(balances) : []
    const modelIds = ids.length > 0 ? ids : [...ZCODE_BUILTIN_MODEL_IDS]
    if (source === 'balance' && ids.length === 0) {
      warnings.push('账号权益里没有可用模型，已回落到内置模型清单')
      source = 'builtin'
    }

    const models = modelIds.map(id => {
      const balance = balances.find(entry =>
        entry.capability !== undefined && normalizeModelId(modelIdOfCapability(entry.capability) ?? '') === id)
      const clientModel = clientModels.find(entry => normalizeModelId(entry.modelId) === id)
      return toModel({
        id,
        ...(balance?.capability === undefined ? {} : { capability: balance.capability }),
        ...(clientModel === undefined ? {} : { clientModel }),
        family,
      })
    })

    const catalog: ZCodeCatalog = {
      fetchedAt: this.now,
      source,
      models,
      plans,
      balances: source === 'balance' ? balances : [],
      warnings,
    }
    this.current = catalog
    return catalog
  }

  private builtinCatalog(family: ZCodeFamily, warnings: readonly string[]): ZCodeCatalog {
    return {
      fetchedAt: this.now,
      source: 'builtin',
      models: ZCODE_BUILTIN_MODEL_IDS.map(id => toModel({ id, family })),
      plans: [],
      balances: [],
      warnings,
    }
  }
}
