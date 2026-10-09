/**
 * 插件内部的来源适配器契约与用量快照类型。
 *
 * 这些类型描述「已配置账号的一次尝试」，而不是接缝类型：接缝只看到复合提供方
 * 一个提供方（{@link import('./failover-provider.ts').FailoverSearchProvider}），
 * 来源适配器在它内部被调用。保持这层独立，是为了让每个平台的字段映射、错误语义
 * 与用量端点各自可测。
 */
import type { WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web'

/** 两个三方平台 id（官方搜索是兜底级，不是「平台账号池」）。 */
export type PlatformId = 'tinyfish' | 'tavily'

/**
 * 一个来源适配器：把一次搜索请求发到某个平台并归一成接缝结果。
 *
 * 适配器**不做**账号选择、转移与重试——那是账号池与复合提供方的职责；它只对
 * 「用这个 key 发这一次请求」负责。
 */
export interface SourceAdapter {
  /** 平台 id，用于事件与错误信息。 */
  readonly platform: PlatformId
  /**
   * 用指定 key 执行一次搜索。
   * @param request - 接缝搜索请求（query 与可选 maxResults）。
   * @param apiKey - 本次尝试使用的账号 key。
   * @param signal - 上层取消信号（用户中止时直接上抛）。
   * @returns 归一后的接缝搜索结果。
   * @throws 网络错误、超时、非 2xx 与结构不可解析的响应。
   */
  search(request: WebSearchRequest, apiKey: string, signal?: AbortSignal): Promise<WebSearchResult>
}

/** 一次用量查询的读数：适配器只报告它查到的事实。 */
export interface UsageReading {
  /** 额度是否已耗尽/触限；`undefined` 表示该平台没有可判定的额度概念。 */
  readonly exhausted?: boolean
  /** 用于展示的用量条目（名称 → 文本值）。 */
  readonly details: Readonly<Record<string, string>>
  /** 查询失败时的可读原因；成功时为 undefined。 */
  readonly error?: string
}

/** 一个账号的用量快照：读数 + 由缓存层盖章的身份与时间。 */
export interface AccountUsage extends UsageReading {
  /** 平台 id。 */
  readonly platform: PlatformId
  /** 账号代号（备注名或 `平台-序号`），用于展示与事件；不含 key 的任何片段。 */
  readonly accountLabel: string
  /** 快照获取时间（ISO-8601）。 */
  readonly fetchedAt: string
}

/** 一个平台的用量查询适配器。 */
export interface UsageAdapter {
  /** 平台 id。 */
  readonly platform: PlatformId
  /**
   * 查询一个账号的用量（免费端点，不产生平台计费调用）。
   *
   * 适配器不负责给结果盖章：平台、账号代号与获取时间由 {@link UsageStore} 统一
   * 填写，避免任何适配器产出身份或时间对不上的快照。失败以带有 `error` 的读数
   * 表达，不抛出。
   *
   * @param apiKey - 账号 key。
   * @param signal - 取消信号。
   * @returns 该账号的用量读数。
   */
  fetchUsage(apiKey: string, signal?: AbortSignal): Promise<UsageReading>
}
