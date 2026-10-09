/**
 * 插件详情页用量区块的展示投影（纯函数，可独立测试）。
 *
 * 为什么这一段是 Semi UI 自绘而不是官方配置表单：官方 `Config` schema 能表达
 * 标量字段与列表，但用量区块要的是**跨账号的只读实时状态**——每个账号的余额、
 * 套餐用量、获取时间与失败提示并列呈现，且数据来自后台刷新的内存快照而不是配置
 * 文档。官方配置 UI 没有承载「只读状态面板」的控件，因此按插件 UI 规范的
 * 「配置项 UI 选择顺序」，key/顺序等标量配置留在官方 `Config`，这一块自绘。
 */
import type { AccountUsage } from '../contracts/types.ts'
import { OFFICIAL_SOURCE_ID, TAVILY_PLATFORM_ID, TINYFISH_PLATFORM_ID } from '../contracts/constants.ts'

/** 一个平台分组的展示模型。 */
export interface PlatformUsageGroup {
  /** 平台 id。 */
  readonly platform: string
  /** 分组标题用的本地化键。 */
  readonly titleKey: 'tinyfishTitle' | 'tavilyTitle'
  /** 该平台的账号卡片。 */
  readonly accounts: readonly AccountUsageCard[]
}

/** 一个账号的展示模型。 */
export interface AccountUsageCard {
  /** 账号代号（不含 key 片段）。 */
  readonly label: string
  /** 本次读数是否成功。 */
  readonly ok: boolean
  /** 按顺序呈现的用量条目。 */
  readonly entries: readonly { key: string, labelKey: UsageLabelKey, value: string }[]
  /** 失败时的可读提示。 */
  readonly error?: string
}

/** 用量条目的本地化键。 */
export type UsageLabelKey =
  | 'balance'
  | 'autoReload'
  | 'searchRate'
  | 'keyUsage'
  | 'plan'
  | 'planUsage'
  | 'paygoUsage'

/** 各条目在展示层的顺序与标题键。 */
const DETAIL_LABELS: readonly { key: string, labelKey: UsageLabelKey }[] = [
  { key: 'balance', labelKey: 'balance' },
  { key: 'autoReload', labelKey: 'autoReload' },
  { key: 'searchRate', labelKey: 'searchRate' },
  { key: 'keyUsage', labelKey: 'keyUsage' },
  { key: 'plan', labelKey: 'plan' },
  { key: 'planUsage', labelKey: 'planUsage' },
  { key: 'paygoUsage', labelKey: 'paygoUsage' },
]

/**
 * 把一个账号的快照投影成展示模型。
 *
 * 只呈现快照里真实存在的条目：平台少给一个字段时，界面上就是没有那一行，而不是
 * 显示「未知」占位——这与结果日期缺省时的处理一致。
 *
 * @param usage - 该账号的用量快照。
 * @returns 展示模型。
 */
export function projectAccount(usage: AccountUsage): AccountUsageCard {
  const entries = DETAIL_LABELS
    .map(({ key, labelKey }) => {
      const value = usage.details[key]
      return value === undefined ? undefined : { key, labelKey, value }
    })
    .filter((entry): entry is { key: string, labelKey: UsageLabelKey, value: string } => entry !== undefined)

  const ok = usage.error === undefined
  const card: AccountUsageCard = { label: usage.accountLabel, ok, entries }
  return usage.error === undefined ? card : { ...card, error: usage.error }
}

/**
 * 把快照按平台分组，供展示区按平台分列呈现。
 *
 * 顺序固定为 TinyFish → Tavily（与默认转移顺序一致），空平台也保留分组：用户在
 * 界面上能看出「这个平台还没配账号」，而不是整块消失。
 *
 * @param snapshot - 当前用量快照。
 * @returns 两个平台的分组。
 */
export function groupByPlatform(snapshot: readonly AccountUsage[]): readonly PlatformUsageGroup[] {
  const platforms = [
    { platform: TINYFISH_PLATFORM_ID, titleKey: 'tinyfishTitle' as const },
    { platform: TAVILY_PLATFORM_ID, titleKey: 'tavilyTitle' as const },
  ]

  return platforms.map(({ platform, titleKey }) => ({
    platform,
    titleKey,
    accounts: snapshot.filter(entry => entry.platform === platform).map(projectAccount),
  }))
}

/**
 * 快照中最新的一次获取时间，用于区块标题旁的整体时间戳。
 * @param snapshot - 当前用量快照。
 * @returns ISO-8601 时间戳；无快照时为 undefined。
 */
export function latestFetchedAt(snapshot: readonly AccountUsage[]): string | undefined {
  let latest: string | undefined
  for (const entry of snapshot) {
    if (latest === undefined || entry.fetchedAt > latest) latest = entry.fetchedAt
  }
  return latest
}

/** 官方兜底级在展示层的固定代号（不参与用量分组，仅用于文案对照）。 */
export const OFFICIAL_LABEL = OFFICIAL_SOURCE_ID
