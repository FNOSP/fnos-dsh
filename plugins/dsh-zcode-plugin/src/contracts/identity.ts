/**
 * ZCode 供应商身份与网关地址：host 与 client 共用的契约。
 *
 * 本插件只注册**一个** DSH 供应商 `ZCode`（路由 `dsh-zcode`），承载 ZCode
 * Start Plan 的模型。账号体系有两个「家族」（BigModel 国内 / Z.ai 海外），
 * 两者的登录入口、额度与网关完全相同，仅授权页域名不同；模型清单由账号
 * 权益动态决定，因此不在这里枚举。
 *
 * 路由 id 带 `dsh-` 前缀是刻意的：`zcode` / `zhipu` 可能已被用户在内置目录里
 * 手工声明，带前缀的 id 不会与用户配置撞名。
 *
 * @module dsh-zcode/identity
 */

/** 账号家族：BigModel（国内）与 Z.ai（海外）。 */
export type ZCodeFamily = 'bigmodel' | 'zai'

/** 两个家族按固定顺序排列，用于界面与目录的稳定展示。 */
export const ZCODE_FAMILIES: readonly ZCodeFamily[] = ['bigmodel', 'zai']

/** 本插件注册的唯一供应商路由。 */
export const ZCODE_PROVIDER = 'dsh-zcode'
/** 模型选择器分组与设置页显示的供应商名称。 */
export const ZCODE_PROVIDER_NAME = 'zcode'

/** 家族显示名。 */
export const ZCODE_FAMILY_LABELS: Readonly<Record<ZCodeFamily, string>> = {
  bigmodel: 'BigModel',
  zai: 'Z.ai',
}

/** ZCode 控制面根地址（OAuth、额度、客户端配置都在这个域下）。 */
export const ZCODE_ORIGIN = 'https://zcode.z.ai'

/**
 * 桌面端登录用的「授权码换令牌」端点。
 *
 * 浏览器授权完成后回跳到插件同源路由，再用本端点换取两份凭据：
 * `data.token`（Start Plan 用）与 `data.<family>.access_token`（家族业务令牌）。
 */
export const ZCODE_OAUTH_TOKEN_URL = `${ZCODE_ORIGIN}/api/v1/oauth/token`

/** 桌面端注册的回调协议前缀。 */
export const ZCODE_DESKTOP_REDIRECT_URI = 'zcode://oauth/callback'

/** Start Plan 额度与权益接口。 */
export const ZCODE_BALANCE_URL = `${ZCODE_ORIGIN}/api/v1/zcode-plan/billing/balance`
/** 客户端运行时配置（验证码开关、Start Plan 预览权益、模型能力）。 */
export const ZCODE_CLIENT_CONFIGS_URL = `${ZCODE_ORIGIN}/api/v1/client/configs`
/** Agent 运行时配置（代理端点映射、签名开关）。 */
export const ZCODE_AGENT_CONFIGS_URL = `${ZCODE_ORIGIN}/api/v1/agent/configs`

/**
 * 推理端点的两种策略。
 *
 * 官方开源项目（`zai-org/ZCode` 的 `official-coding-plan-gateway.ts`）把
 * `open.bigmodel.cn/api/anthropic/v1/messages` 改写成
 * `<origin>/api/v1/ultra/anthropic/v1/messages`——官方模型流量走 `ultra`。
 *
 * 两条端点的差异（2026-10-25 实测）：
 * - `start-plan`（`zcode-plan/anthropic`）：消耗 Start Plan 套餐额度，用账号 JWT。
 *   网关会校验请求的 `system` 是否为官方 agent 原文，未注入前缀时返回
 *   HTTP 405 + 业务码 `3012`；按 `start-plan-prefix.ts` 注入后正常放行。
 * - `ultra`（`ultra/anthropic`）：用家族 MaaS 令牌，按量计费；
 *   余额为 0 时返回 HTTP 429 + 业务码 `1113`。
 *
 * 默认走 `start-plan`：只订套餐、没有按量余额的账号只有这条路可用。
 */
export type ZCodeEndpointPlan = 'start-plan' | 'ultra'

/** 两种策略对应的端点前缀。 */
export const ZCODE_ANTHROPIC_BASE_URLS: Readonly<Record<ZCodeEndpointPlan, string>> = {
  'start-plan': `${ZCODE_ORIGIN}/api/v1/zcode-plan/anthropic`,
  ultra: `${ZCODE_ORIGIN}/api/v1/ultra/anthropic`,
}

/** 默认策略：Start Plan（账号若只有套餐额度，这是唯一有意义的选择）。 */
export const DEFAULT_ZCODE_ENDPOINT_PLAN: ZCodeEndpointPlan = 'start-plan'

/** Start Plan 的 Anthropic 兼容推理端点前缀（默认策略，保留旧名便于引用）。 */
export const ZCODE_ANTHROPIC_BASE_URL = ZCODE_ANTHROPIC_BASE_URLS['start-plan']

/** 端点策略的展示名。 */
export const ZCODE_ENDPOINT_PLAN_LABELS: Readonly<Record<ZCodeEndpointPlan, string>> = {
  'start-plan': 'Start Plan（套餐额度）',
  ultra: 'Ultra（按量余额）',
}

/**
 * 请求 user-agent。
 *
 * ZCode 网关按客户端身份做来源归因，`ZCode/` 前缀与官方客户端保持同一形态；
 * 版本号取本插件跟踪的客户端版本（见 {@link ZCODE_CLIENT_VERSION}）。
 */
export const ZCODE_CLIENT_VERSION = '3.16.3'

/** 完整 user-agent 串。 */
export const ZCODE_USER_AGENT = `ZCode/${ZCODE_CLIENT_VERSION} ai-sdk/provider-utils/4.0.27 runtime/node.js/24`

/** Anthropic 协议版本头。 */
export const ZCODE_ANTHROPIC_VERSION = '2023-06-01'

/**
 * 中段 system 注入的 beta 标记。
 *
 * 官方客户端在允许模型接收「对话中插入 system 消息」时带这个头；缺失时
 * 网关仍可用，但中段 system 会被静默忽略，因此固定发送。
 */
export const ZCODE_ANTHROPIC_BETA = 'mid-conversation-system-2026-04-07'
