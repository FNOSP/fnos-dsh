/**
 * OpenCode 供应商身份与网关地址：host 与 client 共用的契约。
 *
 * 模型目录同时包含 OpenCode Zen（按量）与 OpenCode Go（套餐）两类来源，
 * 但**只注册一个** DSH 供应商 `OpenCode`：同名模型在两组里都存在，
 * 合并成一个列表时用模型 id 的 `zen:` / `go:` 前缀区分，显示名追加
 * `· zen` / `· go` 小尾巴。发请求前前缀会被剥掉，网关看到的仍是原始 id。
 *
 * 路由 id 带 `dsh-` 前缀是刻意的：`opencode` 是 pi-ai 内置目录里的路由名，
 * 用户可能已在 `llm-pi-ai` 设置里手工声明（实测会与本插件的
 * `registerAdapter` 冲突）。带前缀的 id 不会与用户配置撞名。
 *
 * @module dsh-opencode/identity
 */

/** 两类模型来源：Zen 按量 与 Go 套餐。 */
export type OpenCodePlan = 'zen' | 'go'

/** 本插件注册的唯一供应商路由。 */
export const OPENCODE_PROVIDER = 'dsh-opencode'
/** 模型选择器与设置页显示的供应商名称。 */
export const OPENCODE_PROVIDER_NAME = 'OpenCode'

/** 模型 id 的 plan 前缀：保证合并后同一模型的两组条目 id 唯一。 */
export const OPENCODE_PLAN_PREFIXES: Readonly<Record<OpenCodePlan, string>> = {
  zen: 'zen:',
  go: 'go:',
}

/** 合并列表里的稳定模型键（`plan:realId`）。 */
export function modelKey(plan: OpenCodePlan, id: string): string {
  return `${OPENCODE_PLAN_PREFIXES[plan]}${id}`
}

/** 从模型键解析 plan；不是本插件格式时返回 undefined。 */
export function planOfModelKey(key: string): OpenCodePlan | undefined {
  for (const plan of ['zen', 'go'] as const) {
    if (key.startsWith(OPENCODE_PLAN_PREFIXES[plan])) return plan
  }
  return undefined
}

/** 剥掉 plan 前缀，得到网关真正接受的模型 id。 */
export function wireModelId(key: string): string {
  const plan = planOfModelKey(key)
  return plan === undefined ? key : key.slice(OPENCODE_PLAN_PREFIXES[plan].length)
}

/** 合并列表里的显示名：在原名后追加 `· zen` / `· go`。 */
export function modelDisplayName(name: string, plan: OpenCodePlan): string {
  return `${name} · ${plan}`
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
