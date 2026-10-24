/**
 * Start Plan 额度服务。
 *
 * 额度按「模型 × 周期」表达，与固定三窗口的套餐不同：同一模型可能既有日额度
 * 又有一次性活动额度。这里保留上游粒度，让界面能分别展示，而不是把它们并成
 * 一个百分比——合并会掩盖「日额度用完但活动额度还有」这类实际情况。
 *
 * 读不到额度时返回带原因的失败结果而不是抛错：用量胶囊不该让整个详情页变红。
 *
 * @module dsh-zcode/usage
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  usagePercent,
  type ZCodeUsage,
  type ZCodeUsageWindow,
} from '../contracts/usage.ts'
import { mergeBalanceEntries, toBalanceEntries } from './catalog.ts'
import type { ZCodeConsoleClient } from './console-client.ts'

/** 失败原因。 */
export type ZCodeUsageFailure =
  | 'not-signed-in'
  | 'request-failed'

/** 读取结果。 */
export type ZCodeUsageResult =
  | { readonly ok: true; readonly usage: ZCodeUsage }
  | { readonly ok: false; readonly reason: ZCodeUsageFailure; readonly message: string }

/** 额度服务依赖。 */
export interface ZCodeUsageServiceOptions {
  readonly client: ZCodeConsoleClient
  readonly resolveToken: () => Promise<string | undefined>
  readonly resolveFamily?: () => Promise<string | undefined>
  readonly logger?: Pick<Context['logger'], 'warn' | 'info'>
  /** 缓存时间（毫秒）；额度是低频变化数据，读太勤没有意义。 */
  readonly cacheMs?: number
  readonly now?: () => number
}

const DEFAULT_CACHE_MS = 60_000

/** 额度服务。 */
export class ZCodeUsageService {
  private cached: { readonly result: ZCodeUsageResult; readonly at: number } | undefined
  private inflight: Promise<ZCodeUsageResult> | undefined
  private readonly options: ZCodeUsageServiceOptions

  constructor(options: ZCodeUsageServiceOptions) {
    this.options = options
  }

  private get now(): number {
    return this.options.now?.() ?? Date.now()
  }

  /** 失效缓存，强制下次读取走网络。 */
  invalidate(): void {
    this.cached = undefined
  }

  /** 读取额度；`force` 为 true 时跳过缓存。 */
  async read(force = false): Promise<ZCodeUsageResult> {
    const cacheMs = this.options.cacheMs ?? DEFAULT_CACHE_MS
    if (!force && this.cached !== undefined && this.now - this.cached.at < cacheMs) {
      return this.cached.result
    }
    // 并发读取合并成一次请求：详情页与胶囊可能同时触发。
    this.inflight ??= this.load().finally(() => {
      this.inflight = undefined
    })
    return this.inflight
  }

  private async load(): Promise<ZCodeUsageResult> {
    const token = await this.options.resolveToken()
    if (token === undefined) {
      const result: ZCodeUsageResult = {
        ok: false,
        reason: 'not-signed-in',
        message: '尚未登录 ZCode 账号',
      }
      this.cached = { result, at: this.now }
      return result
    }
    try {
      const snapshot = await this.options.client.balance(token)
      // 同一模型在多份套餐下的额度按「模型 + 周期」合并，避免界面出现重复行。
      const windows: ZCodeUsageWindow[] = mergeBalanceEntries(toBalanceEntries(snapshot.balances)).map(entry => {
        const percent = usagePercent(entry.usedUnits, entry.totalUnits)
        return {
          label: entry.showName,
          ...(entry.capability === undefined ? {} : { capability: entry.capability }),
          totalUnits: entry.totalUnits,
          usedUnits: entry.usedUnits,
          remainingUnits: entry.remainingUnits,
          percent,
          ...(entry.period === undefined ? {} : { period: entry.period }),
          // periodEnd / expiresAt 已经是 epoch 毫秒，转成 ISO 供界面格式化。
          ...(entry.periodEnd === undefined
            ? entry.expiresAt === undefined
              ? {}
              : { resetsAt: new Date(entry.expiresAt).toISOString() }
            : { resetsAt: new Date(entry.periodEnd).toISOString() }),
          exhausted: entry.remainingUnits <= 0,
        }
      })
      const family = await this.options.resolveFamily?.()
      const result: ZCodeUsageResult = {
        ok: true,
        usage: {
          plans: snapshot.plans.map(plan => ({
            planId: plan.planId,
            ...(plan.name === undefined ? {} : { name: plan.name }),
            ...(plan.endsAt === undefined ? {} : { endsAt: plan.endsAt }),
          })),
          windows,
          fetchedAt: this.now,
          ...(family === undefined ? {} : { family }),
        },
      }
      this.cached = { result, at: this.now }
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.options.logger?.warn('dsh-zcode: 读取额度失败', error)
      const result: ZCodeUsageResult = { ok: false, reason: 'request-failed', message }
      this.cached = { result, at: this.now }
      return result
    }
  }
}
