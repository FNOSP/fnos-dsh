/**
 * OpenCode 供应商标识与网关地址：host 与 client 共用的契约。
 *
 * 路由名沿用 pi-ai 与 OpenClaw 的生态约定（`opencode-go`），这样模型选择器里
 * 出现的名字与 OpenCode 自己的 `/models` 表述一致。它与 pi-ai 内置的公开目录
 * 路由同名：本插件注册时若该路由已被用户设置声明，注册会以 `DUPLICATE_ADAPTER`
 * 失败，插件在详情页给出可诊断的错误，而不是静默覆盖。
 *
 * @module dsh-opencode/identity
 */

/** 本插件向 `ctx.llm` 注册的 provider 路由。 */
export const OPENCODE_PROVIDER = 'opencode-go'

/** 模型选择器与设置页显示的供应商名称。 */
export const OPENCODE_PROVIDER_NAME = 'OpenCode Go'

/** OpenCode Console 的账号与 API 根地址。 */
export const OPENCODE_CONSOLE_ORIGIN = 'https://opencode.ai/console'

/** 推理网关根地址；各协议族在其下分路径。 */
export const OPENCODE_INFERENCE_ORIGIN = 'https://opencode.ai/inference'

/** Go 套餐的模型清单（未鉴权即可读，是目录的可用性下限）。 */
export const OPENCODE_GO_MODELS_URL = `${OPENCODE_INFERENCE_ORIGIN}/go/v1/models`

/** Go 套餐的用量接口；实际返回结构由 `contracts/usage` 归一化。 */
export const OPENCODE_GO_USAGE_URL = `${OPENCODE_INFERENCE_ORIGIN}/go/v1/usage`

/** 模型能力元数据（models.dev 形态，含按模型区分的思考等级）。 */
export const OPENCODE_MODEL_CATALOG_URL = 'https://models.opencode.ai/api.json'

/** OpenCode CLI 的 Console 设备授权 client_id。 */
export const OPENCODE_DEVICE_CLIENT_ID = 'opencode-cli'

/** 各协议族在网关上的相对路径（不含模型资源路径）。 */
export const OPENCODE_API_PATHS = {
  'openai-completions': '/go/openai/v1',
  'openai-responses': '/go/openai/v1',
  'anthropic-messages': '/go/anthropic',
  'google-generative-ai': '/go/google/v1beta',
} as const
