/**
 * 插件配置契约（FNOS-013-01、桥接服务行为细则）。
 *
 * 第一版不做客户端设置界面，配置走插件配置默认值（需求「不在本次范围内」
 * 已登记）：端口、默认提供方、请求超时与日志开关。
 *
 * 类型标注沿用仓库既有写法（见 `dsh-failover-search-plugin` 的说明）：只写
 * `z.object(...)` 时推导类型会引用 schemastery 内部的 cosmokit 类型，声明文件
 * 生成会报 “inferred type cannot be named without a reference to …”。显式标注
 * `Schemastery.ObjectS/ObjectT` 后导出的是本插件自己的契约面。
 * `Schemastery` 是 schemastery 声明的全局命名空间，无需也不能 import。
 */
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

/** 配置字段的推导类型（`z.object` 的泛型参数）。 */
interface BridgeConfigShape {
  port: z<NoInfer<number>, NoInfer<number>, 'defined'>
  defaultProvider: z<NoInfer<string>, NoInfer<string>, 'defined'>
  requestTimeoutMs: z<NoInfer<number>, NoInfer<number>, 'defined'>
  logRequests: z<NoInfer<boolean>, NoInfer<boolean>, 'defined'>
}

/**
 * 桥接服务配置。
 *
 * `defaultProvider` 用于解析不带提供方前缀的裸模型名（如 `glm-5.3-flash`）：
 * 请求里的模型字段按「提供方/模型」解析，裸名落到这里配置的默认提供方。留空时
 * 裸名不被接受（返回明确错误并提示用「提供方/模型」形式）——比猜一个提供方安全：
 * DSH 内多个提供方可能有同名模型。
 */
export const Config: z<Schemastery.ObjectS<NoInfer<BridgeConfigShape>>, Schemastery.ObjectT<NoInfer<BridgeConfigShape>>, 'plain'> = z.object({
  port: z.natural().default(DEFAULT_BRIDGE_PORT)
    .description(`监听端口（默认 ${DEFAULT_BRIDGE_PORT}）；被占用时启动失败并明确报错，不自动更换端口`),
  defaultProvider: z.string().default('')
    .description('裸模型名的默认提供方路由键（如 codebuddy）；留空则只接受「提供方/模型」形式'),
  requestTimeoutMs: z.natural().default(300_000)
    .description('单次模型请求的超时毫秒数；0 表示不超时'),
  logRequests: z.boolean().default(true)
    .description('是否在宿主日志记录每次请求的一行摘要（不含消息内容与图片数据）'),
})

/** 解析后的桥接服务配置。 */
export interface BridgeConfig {
  /** 监听端口。 */
  readonly port: number
  /** 裸模型名的默认提供方；空串表示不接受裸名。 */
  readonly defaultProvider: string
  /** 单次模型请求超时（毫秒）；0 表示不超时。 */
  readonly requestTimeoutMs: number
  /** 是否记录请求摘要日志。 */
  readonly logRequests: boolean
}
