/**
 * FNOS-013 Midscene 桥接插件（host 半侧）。
 *
 * 本插件是**宿主模型层的标准消费者**，不是提供方：它在本地托管一个 OpenAI
 * 兼容的 HTTP 服务，把 Midscene（或任何标准 OpenAI 客户端）的请求翻译成
 * `ctx.llm.stream()` 调用。
 *
 * - 模型来源（FNOS-013-02）：目录聚合 `ctx.llm.listProviders()` 与逐提供方的
 *   `listModels()`，标识用「提供方/模型」形式；`llm/adapters-updated` 事件触发
 *   缓存失效，新增提供方零改动跟随（AC-03）。
 * - 凭据（FNOS-013-04）：桥**不读取、不存储、不转发**任何凭据——解析、风控头、
 *   token 续期全部留在各提供方插件内（如 `dsh-codebuddy`）；桥只持有 `ctx.llm`
 *   句柄。
 * - 生命周期（FNOS-013-01）：HTTP 服务经 `ctx.effect` 托管，HMR/卸载时等端口
 *   真正释放再放行，避免新实例撞上未释放的端口。
 * - 技能（FNOS-013-13）：包内 `skills/` 目录经 SkillProvider 随插件注册，卸载
 *   同步消失；用户自装的同名技能按宿主发现优先级胜出。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-skill'
import { Config, generateApiKey } from './contracts/config.ts'
import type { BridgeConfig } from './contracts/config.ts'
import { BridgeServer } from './host/bridge-server.ts'
import type { SessionModelReader } from './host/model-choice.ts'
import { registerBundledSkills } from './host/skills.ts'

export {
  Config,
  BRIDGE_HOST,
  DEFAULT_BRIDGE_PORT,
  DEFAULT_FAMILY,
  FIXED_MODEL_NAME,
  MIDSCENE_FAMILIES,
  OPENAI_API_PREFIX,
  generateApiKey,
  isKnownFamily,
  renderEnvFile,
} from './contracts/config.ts'
export type { BridgeConfig, MidsceneFamily } from './contracts/config.ts'
export { chooseModel } from './host/model-choice.ts'
export type { ModelChoice, SessionModelReader } from './host/model-choice.ts'
export { resolveModelName, formatModelName } from './contracts/model-name.ts'
export type { ResolvedModel } from './contracts/model-name.ts'
export { buildCatalog, modelSupportsImage, toOpenAiModel } from './host/catalog.ts'
export type { ModelCatalogSnapshot, OpenAiModelEntry } from './host/catalog.ts'
export { convertMessages, convertTools, parseDataUri, RequestConversionError } from './host/convert.ts'
export { aggregateStream, makeChunk, sseLine, toFinishReason, toOpenAiError } from './host/stream.ts'
export { BridgeServer, BridgePortInUseError, CatalogCache } from './host/bridge-server.ts'
export type { BridgeDeps } from './host/bridge-server.ts'
export { createBundledSkillProvider, registerBundledSkills, bundledSkillsDir, listBundledSkills, SKILL_PROVIDER_NAME } from './host/skills.ts'

/** 插件在组合里的名字。 */
export const name = 'dsh-midscene'

/**
 * 依赖服务。
 *
 * `llm` 是硬依赖（没有它就没有模型可桥接，插件不该激活）；`skills` 与
 * `attachments` 走可选获取——前者缺席时只是不发技能，后者缺席时图片请求返回
 * 明确错误，不该让整个桥起不来。
 */
export const inject = ['llm']

/**
 * 插件入口。
 * @param ctx - Cordis 上下文。
 * @param config - 插件配置（默认值来自 `Config`）。
 */
export function apply(ctx: Context, rawConfig: BridgeConfig = Config({}) as unknown as BridgeConfig): void {
  const logger = ctx.logger
  // 密钥为空（首次安装、旧配置升级）时补一个并在启动日志里说明——用户下一次
  // 拉 /v1/midscene-env 会拿到它；不做静默补值，否则用户不知道 .env 该填什么。
  const config: BridgeConfig = rawConfig.apiKey.length > 0
    ? rawConfig
    : { ...rawConfig, apiKey: generateApiKey() }
  if (rawConfig.apiKey.length === 0) {
    logger.info('[midscene] 已为非空接入密钥生成随机值（可在插件设置页查看或重新生成）')
  }
  const log = (message: string): void => { logger.info(`[midscene] ${message}`) }

  // 附件服务：`profile` 未挂载时缺席（图片请求会得到明确错误而不是崩溃）。
  const attachments = (): AttachmentStore | undefined =>
    ctx.get('attachments') as AttachmentStore | undefined

  // 「跟随 DSH 当前模型」的读取面：`agentDefaultModel` 是设置页模型选择器所写的
  // 服务，缺席时（精简 profile）回落 undefined，此时桥走兜底逻辑。
  const sessionModel: SessionModelReader = {
    current: () => {
      const service = ctx.get('agentDefaultModel') as { currentSelection?: () => { provider?: string, model?: string } } | undefined
      const selection = service?.currentSelection?.()
      if (selection?.provider === undefined || selection.model === undefined) return undefined
      return `${selection.provider}/${selection.model}`
    },
  }

  const bridge = new BridgeServer({
    llm: ctx.llm,
    attachments: attachments(),
    config,
    sessionModel,
    log,
  })

  ctx.effect(() => {
    void bridge.start().catch((error: unknown) => {
      // 启动失败必须让用户看见原因（端口占用是最常见的一种）：记 error 级日志。
      // 不 rethrow——effect 回调是同步的，抛出会变成未处理的拒绝；日志是用户
      // 在 DSH 启动输出里能看到的位置。
      logger.error(`[midscene] ${error instanceof Error ? error.message : String(error)}`)
    })
    // 释放时等 stop 完成（端口真正释放后才返回），否则 HMR 后新实例会撞上
    // 尚未释放的端口。
    return async () => { await bridge.stop() }
  }, 'dsh-midscene: loopback OpenAI bridge')

  // 目录缓存跟随提供方变化：新装提供方插件、配置新自定义端点后目录即时更新。
  ctx.effect(() => {
    const refresh = (): void => {
      bridge.catalog.invalidate()
      log('检测到提供方变化，模型目录缓存已失效')
    }
    return ctx.on('llm/adapters-updated', refresh)
  }, 'dsh-midscene: catalog invalidation')

  // 技能内置分发：注册表缺席（精简 profile）时跳过，不影响桥。
  ctx.effect(() => {
    const skills = ctx.get('skills')
    if (skills === undefined) {
      log('技能注册表不可用，跳过内置技能分发')
      return () => {}
    }
    const dispose = registerBundledSkills(skills as never)
    log('已注册内置 Midscene 浏览器自动化技能')
    return dispose
  }, 'dsh-midscene: bundled skills')
}
