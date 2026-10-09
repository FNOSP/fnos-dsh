/**
 * 官方兜底级的选项解析。
 *
 * 兜底级复用官方 `DeepSeekSearchProvider`，凭据沿用用户既有路径、行为与现版本一致
 * （FNOS-010-03 的行为约束）。这里的关键点是**读用户的官方搜索配置**：
 *
 * 「设置 → 插件 → 网络搜索」把端点、模型、`maxUses` 与凭据引用写在
 * `web-search-deepseek` 命名空间里。如果兜底级只用包内常量，用户改过的端点会被
 * 静默忽略——同一份设置在两处表现出不同行为，而这正是最容易被误判为「插件坏了」
 * 的情况。
 */
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { DeepSeekSearchProviderOptions } from '@deepseek-ai/dsh-web-search-deepseek'
import {
  DEEPSEEK_DEFAULT_API_VERSION,
  DEEPSEEK_DEFAULT_BASE_URL,
  DEEPSEEK_DEFAULT_MAX_TOKENS,
  DEEPSEEK_DEFAULT_MAX_USES,
  DEEPSEEK_DEFAULT_MODEL,
} from '@deepseek-ai/dsh-web-search-deepseek'
import { OFFICIAL_API_KEY_ENV } from '../contracts/constants.ts'

/** 官方搜索提供方在设置页里的命名空间。 */
export const OFFICIAL_SEARCH_SETTINGS_NAMESPACE = 'web-search-deepseek'

/** 端点可被环境变量覆盖，与官方实现的读取顺序一致。 */
const SEARCH_BASE_URL_ENV = 'DEEPSEEK_SEARCH_BASE_URL'

/** 解析所需的宿主面；测试可注入替身。 */
export interface OfficialFallbackDeps {
  /** settings 服务；缺席（或命名空间未提供）时使用官方默认值。 */
  readonly settings?: { describe: () => readonly { ns: string, value: unknown }[] } | undefined
  /** credentials 服务；缺席时只读启动环境。 */
  readonly credentials?: { resolve: (ref: CredentialRef) => Promise<{ value: string } | undefined> } | undefined
  /** 启动环境快照。 */
  readonly launch: { get: (name: string) => { value: string } | undefined }
  /** 诊断日志（凭据解析异常等非致命问题）。 */
  readonly logger: { warn: (message: string, ...args: unknown[]) => void }
}

/** 从 settings 服务读取官方搜索命名空间的当前取值。 */
function readOfficialSection(deps: OfficialFallbackDeps): Record<string, unknown> {
  let rows: readonly { ns: string, value: unknown }[]
  try {
    rows = deps.settings?.describe() ?? []
  } catch (error) {
    deps.logger.warn('[failover-search] 读取官方搜索设置失败，改用默认端点：%s', error instanceof Error ? error.message : String(error))
    return {}
  }
  const row = rows.find(entry => entry.ns === OFFICIAL_SEARCH_SETTINGS_NAMESPACE)
  const value = row?.value
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

/** 读取非空字符串字段。 */
function readText(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** 读取有限正整数字段。 */
function readPositiveInt(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined
  return Math.floor(value)
}

/**
 * 解析官方兜底级的一次操作选项。
 *
 * 每个操作入口快照一次（与官方提供方相同的 resolveOptions 模式）：用户在两次搜索之间
 * 可以改配置，而重新注册提供方会让接缝的选择过程对用户可见（表现为闪烁）。
 *
 * @param deps - settings / credentials / 启动环境与日志面。
 * @returns 官方提供方的一次性选项。
 */
export function resolveOfficialOptions(deps: OfficialFallbackDeps): DeepSeekSearchProviderOptions {
  const section = readOfficialSection(deps)
  const apiKeyEnv = credentialRef(readText(section.apiKeyEnv) ?? OFFICIAL_API_KEY_ENV)

  return {
    resolveApiKey: async () => {
      const credentials = deps.credentials
      if (credentials !== undefined) {
        try {
          const resolved = await credentials.resolve(apiKeyEnv)
          if (resolved !== undefined && resolved.value.length > 0) return resolved.value
        } catch (error) {
          // 凭据存储不可用不是「没有凭据」：继续回落启动环境，避免兜底级因解析异常
          // 直接失败，也避免把异常文本当作凭据。
          deps.logger.warn('[failover-search] 凭据解析失败，回落启动环境：%s', error instanceof Error ? error.message : String(error))
        }
      }
      const ambient = deps.launch.get(apiKeyEnv)
      return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined
    },
    apiKeyEnv,
    baseURL: readText(section.baseURL) ?? deps.launch.get(SEARCH_BASE_URL_ENV)?.value ?? DEEPSEEK_DEFAULT_BASE_URL,
    model: readText(section.model) ?? DEEPSEEK_DEFAULT_MODEL,
    apiVersion: readText(section.apiVersion) ?? DEEPSEEK_DEFAULT_API_VERSION,
    maxTokens: readPositiveInt(section.maxTokens) ?? DEEPSEEK_DEFAULT_MAX_TOKENS,
    maxUses: readPositiveInt(section.maxUses) ?? DEEPSEEK_DEFAULT_MAX_USES,
  }
}
