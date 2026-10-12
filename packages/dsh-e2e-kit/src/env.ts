/**
 * 接入配置：从 DSH Midscene 插件托管的桥接服务获取模型配置。
 *
 * Midscene 在 Bridge Mode 下要求**模型配置在 Node 侧**（终端环境变量）。本仓库的
 * 做法是让插件生成这份配置——四行固定值、`MIDSCENE_MODEL_API_KEY` 只是占位值
 * （桥不转发任何模型凭据），模型由桥按 `dsh-model` 决定。
 *
 * 因此测试项目不需要自己了解模型细节，只要向桥要一份配置即可。端口**不固定**
 * （被占用时桥会自动跳号），所以这里按健康检查的 `port` 字段取实际端口。
 *
 * @module dsh-e2e-kit/env
 */

/** 插件默认的首选端口（桥被占用时会自动跳号，故仅作为探测起点）。 */
export const DEFAULT_BRIDGE_PORT = 8787

/** 端口被占用时向上探测的次数上限（与插件的 `PORT_SCAN_LIMIT` 一致）。 */
export const PORT_PROBE_LIMIT = 20

/** 桥接服务的接入配置。 */
export interface BridgeEnv {
  /** 实际生效的端口。 */
  readonly port: number
  /** `MIDSCENE_MODEL_BASE_URL`。 */
  readonly baseUrl: string
  /** `.env` 文本（四行固定值）。 */
  readonly envFile: string
  /** 结构化变量，便于按需取用。 */
  readonly variables: Readonly<Record<string, string>>
}

/** 探测超时（毫秒）：本机回环请求，给足 2 秒足够。 */
const PROBE_TIMEOUT_MS = 2000

/**
 * 探测桥接服务的实际端口。
 * @param options - 可选的起始端口与探测上限。
 * @param options.from - 起始端口，默认 {@link DEFAULT_BRIDGE_PORT}。
 * @param options.limit - 向上探测次数上限，默认 {@link PORT_PROBE_LIMIT}。
 * @returns 实际端口；全部探测失败时为 `undefined`。
 */
export async function findBridgePort(
  options: { readonly from?: number, readonly limit?: number } = {},
): Promise<number | undefined> {
  const from = options.from ?? DEFAULT_BRIDGE_PORT
  const limit = options.limit ?? PORT_PROBE_LIMIT
  for (let offset = 0; offset < limit; offset += 1) {
    const port = from + offset
    try {
      const response = await fetch(`http://127.0.0.1:${port}/v1/health`, {
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      })
      if (!response.ok) continue
      const body = await response.json() as { port?: number, status?: string }
      if (body.status !== 'ok') continue
      // 健康响应里的 port 是权威值：它反映服务**实际**监听的端口。
      return typeof body.port === 'number' ? body.port : port
    } catch {
      // 该端口没有服务，继续探测下一个。
    }
  }
  return undefined
}

/**
 * 取一份可直接使用的接入配置。
 *
 * 失败时抛出带指引的错误，而不是让后续的模型调用报出难以理解的缺配置错误——
 * 后者会让人以为是用例写错了。
 * @param options - 可选的起始端口与探测上限。
 * @param options.from - 起始端口。
 * @param options.limit - 探测次数上限。
 * @returns 接入配置。
 * @throws 桥接服务不可用时抛出。
 */
export async function loadBridgeEnv(
  options: { readonly from?: number, readonly limit?: number } = {},
): Promise<BridgeEnv> {
  const port = await findBridgePort(options)
  if (port === undefined) {
    throw new Error(
      '未找到 DSH Midscene 桥接服务。请确认 DSH 正在运行且 @tnnevol/dsh-midscene 插件已启用'
      + `（已探测 127.0.0.1:${options.from ?? DEFAULT_BRIDGE_PORT} 起的 ${options.limit ?? PORT_PROBE_LIMIT} 个端口）。`,
    )
  }
  const response = await fetch(`http://127.0.0.1:${port}/v1/midscene-env`)
  if (!response.ok) {
    throw new Error(`桥接服务的 /v1/midscene-env 返回 ${response.status}；请检查插件版本是否匹配。`)
  }
  const body = await response.json() as { content?: string, variables?: Record<string, string> }
  if (typeof body.content !== 'string' || body.variables === undefined) {
    throw new Error('桥接服务返回的接入配置格式不符（缺 content 或 variables）。')
  }
  return { port, baseUrl: body.variables.MIDSCENE_MODEL_BASE_URL ?? '', envFile: body.content, variables: body.variables }
}

/**
 * 把接入配置写入当前进程环境（Midscene 从 `process.env` 读取）。
 * @param env - {@link loadBridgeEnv} 的返回值。
 * @returns 写入的键列表（便于日志中如实说明设置了什么，且不含真实凭据——桥的密钥是占位值）。
 */
export function applyBridgeEnv(env: BridgeEnv): readonly string[] {
  const keys: string[] = []
  for (const [key, value] of Object.entries(env.variables)) {
    process.env[key] = value
    keys.push(key)
  }
  return keys
}
