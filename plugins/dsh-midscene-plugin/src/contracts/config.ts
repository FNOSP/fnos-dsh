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
import type { Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

/**
 * 桥接服务的首选端口。
 *
 * 选 8787 避开项目内其它端口（DSH Web 8070、FPK 网关 3080、Desktop CDP 9333）。
 *
 * 端口**不固定**：被占用时自动向上尝试（见 {@link PORT_SCAN_LIMIT}）。这与
 * 「`.env` 四行固定」并不矛盾——实际使用的端口会写回插件配置，并由
 * `/v1/midscene-env` 与设置页如实呈现，用户重新拉一次配置即可；换来的是
 * 「端口冲突不再导致插件不可用」。原设计（D4）选 fail-fast 是为了避免静默失配，
 * 该顾虑由「写回 + 如实呈现 + 设置页提示」承接。
 */
export const DEFAULT_BRIDGE_PORT = 8787

/**
 * 端口被占用时向上尝试的次数上限。
 *
 * 逐个尝试 `首选端口 + n`（n 从 0 到 {@link PORT_SCAN_LIMIT} - 1）。设上限是为了
 * 不无限占用端口、也让「全都不可用」这种情况有明确终点（报错而不是一直找）。
 */
export const PORT_SCAN_LIMIT = 20

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
 * 「通用」家族：用于识别不出家族、但具备图片能力的模型。
 *
 * 依据实测：Midscene 的 20 个家族里，`bbox/xy/1000` 这一坐标协议由 **10 个家族共用**
 * （glm-v、doubao-*、qwen3*、vlm-ui-tars* 等），是分布最广的主导格式；而 `glm-v` 又是
 * 其中限制最少的一个（只声明 `reasoningEffort`/`reasoningBudget` 不受支持，这两项在桥的
 * 默认配置下本就不发送）。
 *
 * 实测：Midscene 未适配的识图模型（如 `codebuddy/hy3`）以 `glm-v` 定位 3/3 命中，
 * 与 `qwen3` 表现一致——即「未适配」不等于「不可用」。
 */
export const GENERIC_FAMILY: MidsceneFamily = 'glm-v'

/**
 * 默认协议家族（等同于 {@link GENERIC_FAMILY}）。
 *
 * 保留这个别名是因为桥在「模型已确定」之前需要一个初始值；实际的家族由
 * `resolveFamily()` 按真实模型推导，用户不接触这个概念。
 */
export const DEFAULT_FAMILY: MidsceneFamily = GENERIC_FAMILY

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
 * 读取一个可能被 Cordis 包装成引用（volatile）的配置字段。
 *
 * 声明为 `.volatile()` 的字段才能被官方设置表单编辑、且热更新无需重挂载插件；
 * 代价是 `apply` 收到的不是值而是稳定引用，必须经这里解包。与 `dsh-fnos-plugin`
 * 的 `volatileValue` 同形（该写法已在仓库内验证）。
 * @param value - 配置字段（可能是引用或普通值）。
 * @returns 解包后的值。
 */
export function volatileValue<T>(value: Volatile<T> | T | undefined): T | undefined {
  if (typeof value !== 'object' || value === null) return value as T | undefined
  const read = (value as { get?: unknown }).get
  return typeof read === 'function' ? (read as () => T).call(value) : value as T
}

/**
 * 生成 Midscene 侧固定四行的接入配置。
 *
 * 四行都是固定值（基址、密钥、模型名、家族），因此用户可以把 `.env` 写死：换模型
 * 只需改插件设置，不必动这个文件。`MIDSCENE_MODEL_NAME` 固定为 {@link FIXED_MODEL_NAME}，
 * 由桥决定实际用哪个模型。
 *
 * **`port` 必须传桥实际监听的端口**（`BridgeServer.port`），不是配置里的首选端口：
 * 端口被占用而自动跳号时，配置字段与实际情况可能不一致，`.env` 里写错端口会让
 * Midscene 直接连不上。
 * @param config - 桥接配置中与接入文件相关的三项。
 * @param config.port - 桥**实际**监听的端口。
 * @param config.apiKey - 桥接入密钥。
 * @param config.family - Midscene 协议家族。
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
  port: z<NoInfer<number>, NoInfer<number>, 'volatile-defined'>
  apiKey: z<NoInfer<string>, NoInfer<string>, 'volatile-defined'>
  family: z<NoInfer<string>, NoInfer<string>, 'volatile-defined'>
  models: z<NoInfer<string[]>, NoInfer<string[]>, 'volatile-defined'>
  requestTimeoutMs: z<NoInfer<number>, NoInfer<number>, 'volatile-defined'>
  logRequests: z<NoInfer<boolean>, NoInfer<boolean>, 'volatile-defined'>
}

/**
 * 桥接服务配置。
 *
 * `models` 为空（默认）时桥跟随 DSH 当前模型选择；非空时按列表顺序取第一个能在
 * 目录中找到的模型——这实现「指定用于 Midscene 测试的模型」。
 */
export const Config: z<Schemastery.ObjectS<NoInfer<BridgeConfigShape>>, Schemastery.ObjectT<NoInfer<BridgeConfigShape>>, 'plain'> = z.object({
  port: z.natural().default(DEFAULT_BRIDGE_PORT).volatile()
    .description(`首选监听端口（默认 ${DEFAULT_BRIDGE_PORT}）。被占用时自动向上尝试最多 ${PORT_SCAN_LIMIT} 个端口，并把实际端口写回本字段；实际端口以插件设置页或 /v1/midscene-env 为准`),
  apiKey: z.string().default('').role('secret').volatile()
    .description('桥接接入密钥（安装时自动生成）。Midscene 的 .env 用它；可在设置页重新随机生成或自定义'),
  family: z.string().default(GENERIC_FAMILY).volatile()
    .description('Midscene 协议家族（**自动维护**，无需手工设置）：桥按实际使用的模型推导。识别得出家族就用该家族，识别不出但能识图的模型用通用家族。它只影响 Midscene 的提示词模板与坐标解析协议'),
  models: z.array(z.string()).default([]).volatile()
    .description('指定用于 Midscene 测试的模型（「提供方/模型」形式，按顺序尝试第一个可用的）。留空则跟随 DSH 当前模型选择'),
  requestTimeoutMs: z.natural().default(300_000).volatile()
    .description('单次模型请求的超时毫秒数；0 表示不超时'),
  logRequests: z.boolean().default(true).volatile()
    .description('是否在宿主日志记录每次请求的一行摘要（不含消息内容与图片数据）'),
})

/**
 * 把 volatile 配置包装成**每次读取都取当前值**的配置对象。
 *
 * 声明为 `.volatile()` 的字段才能被官方设置表单编辑、且热更新无需重挂载插件；代价是
 * `apply` 收到的字段是稳定引用，值会随用户在设置页的编辑改变。桥如果只读一次快照，
 * 用户改完家族/密钥就必须重启 DSH 才生效——那与「设置页能改」的承诺不符。这里用取值器
 * 暴露字段，调用方（桥、状态端点）每次读到的都是最新值。
 * @param raw - `apply` 收到的原始配置（字段可能为 volatile 引用）。
 * @returns 每次读取都取当前值的配置对象。
 */
export function liveConfig(raw: BridgeConfig): BridgeConfig {
  const read = <K extends keyof BridgeConfig>(key: K): BridgeConfig[K] =>
    volatileValue(raw[key]) as BridgeConfig[K]
  return {
    get port() { return read('port') },
    get apiKey() { return read('apiKey') },
    get family() { return read('family') },
    get models() { return read('models') ?? [] },
    get requestTimeoutMs() { return read('requestTimeoutMs') },
    get logRequests() { return read('logRequests') },
  }
}

/** 解析后的桥接服务配置。 */
export interface BridgeConfig {
  /**
   * 首选监听端口。
   *
   * 首次启动时是用户设定的值；端口被占用而自动改用其它端口后，插件会把**实际**
   * 端口写回配置，因此本字段之后读到的即为实际端口。运行期实际端口一律以
   * `BridgeServer.port` 为准（启动完成前配置里的值可能与实际不同）。
   */
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
