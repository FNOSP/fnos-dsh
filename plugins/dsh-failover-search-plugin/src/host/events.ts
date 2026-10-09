/**
 * 每级搜索尝试的脱敏会话事件。
 *
 * 事件只记录排障需要的四件事：平台、账号代号、结局、耗时。**不含 key 的任何
 * 片段，也不含 query 全文**——需求行为约束要求 key 全程不以明文出现在会话记录
 * 中，而 query 属于用户内容，提供方层不复制它。
 */

/** 一次来源尝试的结局。 */
export type AttemptOutcome = 'succeeded' | 'failed' | 'skipped'

/** 一条脱敏的尝试事件。 */
export interface ProviderAttemptEvent {
  /** 来源 id：`tinyfish` / `tavily` / `deepseek-official`。 */
  readonly platform: string
  /** 账号代号（备注名或 `平台-序号`）；官方兜底级等于平台 id。 */
  readonly account: string
  /** 本次尝试的结局。 */
  readonly outcome: AttemptOutcome
  /** 本次尝试耗时（毫秒）。 */
  readonly durationMs: number
}

/** 事件进入会话日志时使用的键；声明在会话事件表上由宿主统一回放。 */
export const FAILOVER_ATTEMPT_EVENT = 'web/failover-search-attempt'
