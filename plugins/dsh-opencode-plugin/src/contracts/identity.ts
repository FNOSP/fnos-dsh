/**
 * OpenCode 供应商身份与网关地址：host 与 client 共用的契约。
 *
 * 本插件注册**两组**供应商，对应 OpenCode Console 的两类模型来源：
 *
 * - `dsh-opencode`（显示名 OpenCode Zen）：OpenCode Zen 按量模型；
 * - `dsh-opencode-go`（显示名 OpenCode Go）：Go 套餐模型。
 *
 * 路由 id 带 `dsh-` 前缀是刻意的：`opencode` / `opencode-go` 是 pi-ai 内置
 * 目录里的路由名，用户可能已在 `llm-pi-ai` 设置里手工声明（实测会与本插件的
 * `registerAdapter` 冲突，导致登录后模型不出现在选择器）。带前缀的 id 不会
 * 与用户配置撞名。
 *
 * @module dsh-opencode/identity
 */

/** 两类模型来源：Zen 按量 与 Go 套餐。 */
export type OpenCodePlan = 'zen' | 'go'

/** 一组供应商路由的完整描述。 */
export interface OpenCodeProviderDescriptor {
  /** 注册到 `ctx.llm` 的路由 id。 */
  readonly id: string
  /** 模型选择器与设置页显示的供应商名称。 */
  readonly name: string
  readonly plan: OpenCodePlan
}

/** 本插件注册的两组供应商，顺序即选择器里的展示顺序。 */
export const OPENCODE_PROVIDERS: readonly OpenCodeProviderDescriptor[] = [
  { id: 'dsh-opencode', name: 'OpenCode Zen', plan: 'zen' },
  { id: 'dsh-opencode-go', name: 'OpenCode Go', plan: 'go' },
]

/** Zen 按量供应商路由（默认组）。 */
export const OPENCODE_PROVIDER = 'dsh-opencode'
/** Zen 按量供应商显示名。 */
export const OPENCODE_PROVIDER_NAME = 'OpenCode Zen'
/** Go 套餐供应商路由。 */
export const OPENCODE_GO_PROVIDER = 'dsh-opencode-go'
/** Go 套餐供应商显示名。 */
export const OPENCODE_GO_PROVIDER_NAME = 'OpenCode Go'

/** 按 plan 取供应商描述；未知 plan 回落到 Zen。 */
export function providerForPlan(plan: OpenCodePlan): OpenCodeProviderDescriptor {
  return OPENCODE_PROVIDERS.find(provider => provider.plan === plan) ?? OPENCODE_PROVIDERS[0]!
}

/** OpenCode Console 的账号与 API 根地址。 */
export const OPENCODE_CONSOLE_ORIGIN = 'https://opencode.ai/console'

/** 推理网关根地址；各协议族在其下分路径。 */
export const OPENCODE_INFERENCE_ORIGIN = 'https://opencode.ai/inference'

/** 按量（Zen）模型清单。 */
export const OPENCODE_MODELS_URL = `${OPENCODE_INFERENCE_ORIGIN}/v1/models`

/** Go 套餐模型清单。 */
export const OPENCODE_GO_MODELS_URL = `${OPENCODE_INFERENCE_ORIGIN}/go/v1/models`

/** Go 套餐的用量接口。 */
export const OPENCODE_GO_USAGE_URL = `${OPENCODE_INFERENCE_ORIGIN}/go/v1/usage`

/** 模型能力元数据（models.dev 形态，含按模型区分的思考等级）。 */
export const OPENCODE_MODEL_CATALOG_URL = 'https://models.opencode.ai/api.json'

/** OpenCode CLI 的 Console 设备授权 client_id。 */
export const OPENCODE_DEVICE_CLIENT_ID = 'opencode-cli'

/**
 * 请求 user-agent。
 *
 * OpenCode 的文档要求调用方用自己的 user-agent 标识客户端，而不是通用 SDK 名；
 * 同时 Cloudflare 会对空/默认 UA 的请求返回 1010，目录抓取也必须带上它。
 */
export const OPENCODE_USER_AGENT = 'dsh-opencode/1 (+https://github.com/FNOSP/fnos-dsh)'
