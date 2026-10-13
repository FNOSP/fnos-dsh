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
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-skill'
import { Config, generateApiKey, liveConfig } from './contracts/config.ts'
import type { BridgeConfig } from './contracts/config.ts'
import { MIDSCENE_SETTINGS_NAMESPACE } from './contracts/settings-rpc.ts'
import { registerMidsceneSettingsRoutes } from './host/settings-routes.ts'
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
  GENERIC_FAMILY,
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
export { BridgeServer, BridgePortExhaustedError, CatalogCache } from './host/bridge-server.ts'
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
 * @param rawConfig - 插件配置（默认值来自 `Config`；volatile 字段为引用，见 liveConfig）。
 */
export function apply(ctx: Context, rawConfig: BridgeConfig = Config({}) as unknown as BridgeConfig): void {
  const logger = ctx.logger
  const log = (message: string): void => { logger.info(`[midscene] ${message}`) }

  /**
   * 配置读取面：每次读取都取当前值。
   *
   * 声明为 `.volatile()` 的字段才能被官方设置表单编辑、且热更新无需重挂载插件；代价是
   * `apply` 收到的字段是**引用**而非值（解包见 `volatileValue`）。因此这里**不能**重建
   * 配置对象或按字段做「值判断」——那样会把引用拍平成快照，用户在设置页改完就不生效
   * （家族能改、密钥改不动的差异正是这么来的）。
   */
  const live = liveConfig(rawConfig)

  /**
   * 首次安装时按需生成接入密钥。
   *
   * `Config` 的 `apiKey` 默认值是空串而不是随机值：schemastery 的默认值在 schema 求值
   * 阶段产生，无法带进「写回用户配置」这一步；而且生成后必须**持久化**，否则每次重启
   * 都换一把key，已经复制到 `.env` 的用户会突然 401。
   *
   * 因此这里用「读时兜底 + 一次性持久化」：兜底值在闭包里记忆，保证同一进程内桥与
   * `/v1/midscene-env` 看到同一把密钥（否则自举端点返回的密钥会与桥实际校验的不一致）；
   * 持久化在设置服务可用时进行（`ctx.inject(['settings'])` 块内）。
   */
  let pendingKey: string | undefined
  const apiKey = (): string => {
    const current = live.apiKey
    if (current.length > 0) return current
    pendingKey ??= generateApiKey()
    return pendingKey
  }
  // 桥与设置端点都用这一份「有效配置」：密钥经 apiKey() 解析，其余字段直读。
  const effective: BridgeConfig = {
    get port() { return live.port },
    get apiKey() { return apiKey() },
    get family() { return live.family },
    get model() { return live.model },
    get requestTimeoutMs() { return live.requestTimeoutMs },
    get logRequests() { return live.logRequests },
  }

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
    config: effective,
    sessionModel,
    log,
  })

  ctx.effect(() => {
    void bridge.start().then(
      actualPort => {
        // 端口被占用而自动跳号时把**实际**端口写回配置：这样重启后首选端口就是
        // 可用的那个，不会每次都重新扫描；用户重新拉 .env 也能拿到一致的地址。
        if (actualPort === undefined || actualPort === live.port) return
        ctx.inject(['settings'], (scoped) => {
          const settings = scoped.settings as unknown as {
            update: (ns: string, patch: object) => Promise<void>
          }
          void settings.update(MIDSCENE_SETTINGS_NAMESPACE, { port: actualPort }).then(
            () => { log(`已将实际端口 ${actualPort} 写回插件配置`) },
            (error: unknown) => { log(`写回实际端口失败：${String(error)}（本次运行仍使用 ${actualPort}）`) },
          )
        })
      },
      (error: unknown) => {
        // 启动失败必须让用户看见原因（整段端口被占用是最常见的一种）：记 error 级
        // 日志。不 rethrow——effect 回调是同步的，抛出会变成未处理的拒绝；日志是
        // 用户在 DSH 启动输出里能看到的位置。
        logger.error(`[midscene] ${error instanceof Error ? error.message : String(error)}`)
      },
    )
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

  // 设置端点：把设置页的读写能力（密钥显示/重新生成/自定义、指定模型）挂到
  // DSH 的 Web 服务上。`webServer`/`settings` 缺席时跳过——精简 profile 里桥仍可用，
  // 只是没有设置界面（配置走 profile 文件）。
  //
  // 协议家族不在其中：它由桥按实际使用的模型推导（见 `resolveFamily`），用户不接触。
  ctx.inject(['webServer', 'settings'], (scoped) => {
    const settings = scoped.settings as unknown as {
      update: (ns: string, patch: object, expectedRevision?: number) => Promise<void>
    }
    // registerMidsceneSettingsRoutes 自己用 ctx.effect 托管两个路由的释放。
    // 首次安装：把兜底密钥写回配置，之后重启保持同一把（否则已复制到 .env 的用户会 401）。
    if (live.apiKey.length === 0) {
      void settings.update(MIDSCENE_SETTINGS_NAMESPACE, { apiKey: apiKey() }).then(
        () => { log('已生成并保存接入密钥（可在插件设置页查看或重新生成）') },
        (error: unknown) => { log(`保存接入密钥失败：${String(error)}（本次运行使用临时密钥）`) },
      )
    }
    registerMidsceneSettingsRoutes(scoped as unknown as Context, {
      readConfig: () => effective,
      // 复用桥的目录缓存：设置界面的下拉与 /v1/models 同源，不会出现「界面上有、
      // 桥上查不到」的不一致；提供方变化时缓存失效逻辑也只需要维护一处。
      listModels: async () => {
        const snapshot = await bridge.catalog.get()
        return snapshot.entries.map(entry => ({
          id: entry.id,
          vision: entry.vision === true,
          ...entry.name === undefined ? {} : { name: entry.name },
        }))
      },
      // 「当前会实际使用的模型」：家族由它推导，设置页也用它说明「正在用哪个模型」。
      // 复用桥的同一套决策（chooseModel），保证设置页显示与真实调用一致。
      resolveModel: async () => await bridge.resolveModel(),
      update: async patch => { await settings.update(MIDSCENE_SETTINGS_NAMESPACE, patch) },
      log,
    })
    log('已注册接入设置端点')
  })

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
