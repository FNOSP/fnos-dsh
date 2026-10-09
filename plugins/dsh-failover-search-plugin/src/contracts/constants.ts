/**
 * FNOS-010 插件的稳定标识符与默认取值。
 *
 * 取值来自 PLAN-FNOS-010「命名定义」章节：全部标识符只在这里定义一次，
 * 实现与文档不得出现第二套命名。
 */

/**
 * 搜索提供方 id，同时也是组合行 id 与配置命名空间。
 *
 * 三者取同名：patch 的 `searchProvider` 指向它，Loader 诊断按行 id 寻址，
 * 官方配置表单按插件入口导出的 `Config` 自动挂接同一命名空间。
 */
export const FAILOVER_PROVIDER_ID = 'dsh-failover-search'

/** 组合行 id（`cordis.patch.yml` 的 insert）。 */
export const FAILOVER_ROW_ID = FAILOVER_PROVIDER_ID

/** 配置命名空间（settings namespace）。 */
export const FAILOVER_SETTINGS_NAMESPACE = FAILOVER_PROVIDER_ID

/** npm 包名，客户端模块表按包名寻址，必须与 package.json 一致。 */
export const FAILOVER_PACKAGE_NAME = '@tnnevol/dsh-failover-search'

/** TinyFish 平台 id。 */
export const TINYFISH_PLATFORM_ID = 'tinyfish'

/** Tavily 平台 id。 */
export const TAVILY_PLATFORM_ID = 'tavily'

/** 官方搜索来源 id（对齐官方提供方 `DEEPSEEK_PROVIDER_ID`）。 */
export const OFFICIAL_SOURCE_ID = 'deepseek-official'

/** 默认转移顺序：免费额度优先 → 按次计费 → 消耗模型额度的官方殿后。 */
export const DEFAULT_FAILOVER_ORDER = [TINYFISH_PLATFORM_ID, TAVILY_PLATFORM_ID, OFFICIAL_SOURCE_ID] as const

/** 单个账号一次搜索请求的默认超时（毫秒）。 */
export const DEFAULT_HOST_TIMEOUT_MS = 15000

/** 同平台账号失败后是否继续尝试同平台其它账号。 */
export const DEFAULT_SAME_PLATFORM_RETRY = true

/** 用量快照的后台刷新周期（分钟）。 */
export const DEFAULT_USAGE_REFRESH_MINUTES = 5

/** 是否启用基于用量快照的请求前账号排除。 */
export const DEFAULT_PROBE_ENABLED = true

/** 用量刷新间隔的允许范围（分钟）。 */
export const USAGE_REFRESH_MIN_MINUTES = 1
export const USAGE_REFRESH_MAX_MINUTES = 60

/** TinyFish 搜索端点。 */
export const TINYFISH_SEARCH_ENDPOINT = 'https://api.search.tinyfish.ai'

/** TinyFish 钱包端点（免费查询，用于展示）。 */
export const TINYFISH_WALLET_ENDPOINT = 'https://agent.tinyfish.ai/v1/wallet'

/** TinyFish 官方默认限流：每分钟 30 次，按 API key 计。 */
export const TINYFISH_RATE_LIMIT_PER_MINUTE = 30

/** Tavily 搜索端点。 */
export const TAVILY_SEARCH_ENDPOINT = 'https://api.tavily.com/search'

/** Tavily 账户用量端点（免费查询）。 */
export const TAVILY_USAGE_ENDPOINT = 'https://api.tavily.com/usage'

/** 官方搜索兜底级使用的凭据引用（与官方提供方默认一致）。 */
export const OFFICIAL_API_KEY_ENV = 'DEEPSEEK_API_KEY'
