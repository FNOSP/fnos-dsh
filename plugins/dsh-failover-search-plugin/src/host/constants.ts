/**
 * host 侧实现常量：不上行到配置面，也不属于用户可调范围。
 */

/**
 * Tavily 搜索深度。
 *
 * `basic` 每次 1 credit；`advanced` 更贵也更慢，而需求第一版只透出基础查询能力
 * （高级搜索参数不在范围内），因此固定 basic。
 */
export const TAVILY_DEFAULT_SEARCH_DEPTH = 'basic'

/** 本地限流窗口长度（毫秒）：TinyFish 30 req/min/key 的滑窗记账口径。 */
export const RATE_WINDOW_MS = 60_000
