/**
 * 插件配置契约（FNOS-013-01、桥接服务行为细则）。
 *
 * 配置面围绕一个目标收敛：**让 Midscene 的接入配置变成固定四行，且用户零密钥**。
 * - `apiKey`：桥的接入密钥（安装即生成，可在设置页重新随机或自定义）。
 * - `family`：Midscene 的协议家族（决定它的提示词模板与坐标解析协议）。
 * - `models`：可选的测试模型白名单；空表示跟随 DSH 当前模型选择。
 *
 * 类型标注沿用仓库既有写法（见 `dsh-failover-search-plugin` 的说明）：只写
 * `z.object(...)` 时推导类型会引用 schemastery 内部的 cosmokit 类型，声明文件
 * 生成会报 “inferred type cannot be named without a reference to …”。显式标注
 * `Schemastery.ObjectS/ObjectT` 后导出的是本插件自己的契约面。
 * `Schemastery` 是 schemastery 声明的全局命名空间，无需也不能 import。
 */
import { randomBytes } from 'node:crypto'
import z from '@deepseek-ai/schemastery'

/**
 * 桥接服务的默认端口。
 *
 * 决策 D4：端口固定、占用即报错，不做自动换端口——静默换端口会让工作区接入
 * 配置（`.env` 里的 `MIDSCENE_MODEL_BASE_URL`）失配，故障更难排查。
 * 选 8787 避开项目内其它端口（DSH Web 8070、FPK 网关 3080、Desktop CDP 9333）。
 */
export const DEFAULT_BRIDGE_PORT = 8787

/** 桥接只监听回环地址（需求行为约束：不向局域网暴露）。 */
export const BRIDGE_HOST = '127.0.0.1'

/** 桥接对外呈现的 OpenAI API 前缀。 */
export const OPENAI_API_PREFIX = '/v1'

/**
 * Midscene 侧固定使用的对外模型名。
 *
 * 桥按这个名字决定「用哪个模型」：优先用插件配置指定的模型，否则跟随 DSH 当前
 * 模型选择。做成固定值后，用户可以把 `.env` 写死、不必随模型变化更新它。
 */
export const FIXED_MODEL_NAME = 'dsh-model'

/**
 * Midscene 接受的协议家族白名单。
 *
 * **必须与 Midscene 的校验列表逐字一致**——它对该字段做运行时校验，未知值直接
 * 拒绝并报 `Invalid MIDSCENE_MODEL_FAMILY value`（实测 `dsh-model` 被拒）。原因是
 * 技术的：family 决定 Midscene 用哪套提示词模板与坐标解析协议，绑定到具体模型的
 * 输出格式，无法为未知家族生成请求。
 *
 * 列表取自 Midscene v1.15.0 的运行时错误信息与 `ModelFamily` 类型定义；上游新增
 * 家族时需同步本表（{@link isKnownFamily} 用于在配置面提前给出可读提示，而不是
 * 等运行时才报错）。
 */
export const MIDSCENE_FAMILIES = [
  'doubao-vision',
  'doubao-seed',
  'gemini',
  'qwen2.5-vl',
  'qwen3-vl',
  'qwen3',
  'qwen3.5',
  'qwen3.6',
  'vlm-ui-tars',
  'vlm-ui-tars-doubao',
  'vlm-ui-tars-doubao-1.5',
  'glm-v',
  'auto-glm',
  'auto-glm-multilingual',
  'gpt-5',
  'gpt-6',
  'deepseek',
  'kimi',
  'kimi3',
  'xiaomi-mimo',
] as const

/** 协议家族取值。 */
export type MidsceneFamily = (typeof MIDSCENE_FAMILIES)[number]

/**
 * 默认协议家族。
 *
 * 选 `glm-v`：智谱视觉系列的协议，且本仓库 CodeBuddy 目录里 GLM 系列模型齐全
 * （实测 `glm-5.3` / `glm-5.3-flash` 都声明了图片能力）。用户换模型后若家族不再
 * 匹配，设置页会给出提示（见 `familyMismatchHint`）。
 */
export const DEFAULT_FAMILY: MidsceneFamily = 'glm-v'

/**
 * 判断一个值是否为 Midscene 接受的家族。
 * @param value - 待判定的家族值。
 * @returns 是否在白名单内。
 */
export function isKnownFamily(value: string): value is MidsceneFamily {
  return (MIDSCENE_FAMILIES as readonly string[]).includes(value)
}

/**
 * 生成一个接入密钥。
 *
 * 32 位十六进制（128 bit 随机）。这是**桥自己的**接入密钥，与任何模型提供方的凭据
 * 无关——模型凭据始终留在 DSH 的提供方插件内，桥不接触。
 * @returns 随机密钥。
 */
export function generateApiKey(): string {
  return randomBytes(16).toString('hex')
}

/**
 * 生成 Midscene 侧固定四行的接入配置。
 *
 * 四行都是固定值（基址、密钥、模型名、家族），因此用户可以把 `.env` 写死：换模型
 * 只需改插件设置，不必动这个文件。`MIDSCENE_MODEL_NAME` 固定为 {@link FIXED_MODEL_NAME}，
 * 由桥决定实际用哪个模型。
 * @param config - 桥接配置中与接入文件相关的三项。
 * @returns `.env` 文本。
 */
export function renderEnvFile(config: { readonly port: number, readonly apiKey: string, readonly family: string }): string {
  return [
    '# DSH Midscene Bridge 接入配置：四行都是固定值，换模型请改插件设置而非本文件。',
    `MIDSCENE_MODEL_BASE_URL="http://${BRIDGE_HOST}:${config.port}${OPENAI_API_PREFIX}"`,
    `MIDSCENE_MODEL_API_KEY="${config.apiKey}"`,
    `MIDSCENE_MODEL_NAME="${FIXED_MODEL_NAME}"`,
    `MIDSCENE_MODEL_FAMILY="${config.family}"`,
    '',
  ].join('\n')
}

/** 配置字段的推导类型（`z.object` 的泛型参数）。 */
interface BridgeConfigShape {
  port: z<NoInfer<number>, NoInfer<number>, 'defined'>
  apiKey: z<NoInfer<string>, NoInfer<string>, 'defined'>
  family: z<NoInfer<string>, NoInfer<string>, 'defined'>
  models: z<NoInfer<string[]>, NoInfer<string[]>, 'defined'>
  requestTimeoutMs: z<NoInfer<number>, NoInfer<number>, 'defined'>
  logRequests: z<NoInfer<boolean>, NoInfer<boolean>, 'defined'>
}

/**
 * 桥接服务配置。
 *
 * `models` 为空（默认）时桥跟随 DSH 当前模型选择；非空时按列表顺序取第一个能在
 * 目录中找到的模型——这实现「指定用于 Midscene 测试的模型」。
 */
export const Config: z<Schemastery.ObjectS<NoInfer<BridgeConfigShape>>, Schemastery.ObjectT<NoInfer<BridgeConfigShape>>, 'plain'> = z.object({
  port: z.natural().default(DEFAULT_BRIDGE_PORT)
    .description(`监听端口（默认 ${DEFAULT_BRIDGE_PORT}）；被占用时启动失败并明确报错，不自动更换端口`),
  apiKey: z.string().default('').role('secret')
    .description('桥接接入密钥（安装时自动生成）。Midscene 的 .env 用它；可在设置页重新随机生成或自定义'),
  family: z.string().default(DEFAULT_FAMILY)
    .description(`Midscene 协议家族，取值必须来自 Midscene 的白名单（默认 ${DEFAULT_FAMILY}）。它决定 Midscene 的提示词模板与坐标解析协议，换模型时可能需要同步调整`),
  models: z.array(z.string()).default([])
    .description('指定用于 Midscene 测试的模型（「提供方/模型」形式，按顺序尝试第一个可用的）。留空则跟随 DSH 当前模型选择'),
  requestTimeoutMs: z.natural().default(300_000)
    .description('单次模型请求的超时毫秒数；0 表示不超时'),
  logRequests: z.boolean().default(true)
    .description('是否在宿主日志记录每次请求的一行摘要（不含消息内容与图片数据）'),
})

/** 解析后的桥接服务配置。 */
export interface BridgeConfig {
  /** 监听端口。 */
  readonly port: number
  /** 接入密钥。 */
  readonly apiKey: string
  /** Midscene 协议家族。 */
  readonly family: string
  /** 指定模型列表；空表示跟随 DSH 当前模型选择。 */
  readonly models: readonly string[]
  /** 单次模型请求超时（毫秒）；0 表示不超时。 */
  readonly requestTimeoutMs: number
  /** 是否记录请求摘要日志。 */
  readonly logRequests: boolean
}
