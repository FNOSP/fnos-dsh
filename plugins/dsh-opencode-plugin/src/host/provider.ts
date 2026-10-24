/**
 * 动态 OpenCode provider（Zen 与 Go 合并为一个供应商）。
 *
 * 目录同时包含 OpenCode Zen（按量）与 OpenCode Go（套餐）两类模型，但只注册
 * 一个 DSH 供应商：同名模型用 `zen:` / `go:` 前缀保证 id 唯一，显示名追加
 * `· zen` / `· go` 小尾巴。发请求前前缀会被剥掉（{@link wireModelId}），
 * 网关看到的仍是原始模型 id。
 *
 * 与 `llm-pi-ai` 的静态路由不同，这里每次目录刷新都会重建 pi-ai `Provider`：
 * 模型集合、协议族、思考等级全部来自当前账号的目录快照，因此上游新增模型
 * 不需要升级插件或改设置。重建只替换 `profiles()` 返回的 Map 身份——
 * `PiAiAdapter` 以该身份判断配置是否变化，并在下一次操作时重建内部模型集合，
 * 进行中的请求仍使用它捕获的旧快照。
 *
 * 网关要求每个会话带稳定的 `x-opencode-session` 头以复用上下文缓存；
 * pi-ai 的 `withOpenCodeSessionHeader` 会在 `options.sessionId` 存在时注入，
 * 而 `PiAiAdapter` 会从 DSH 的 `GenerateOptions.sessionId` 透传。
 *
 * @module dsh-opencode/provider
 */

import type {
  Api,
  CreateProviderOptions,
  Model,
  Provider,
  ProviderAuth,
  ProviderStreams,
} from '@earendil-works/pi-ai'
import { createProvider, defaultProviderAuthContext, InMemoryCredentialStore } from '@earendil-works/pi-ai'
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy'
import { googleGenerativeAIApi } from '@earendil-works/pi-ai/api/google-generative-ai.lazy'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy'
import { withOpenCodeSessionHeader } from '@earendil-works/pi-ai/providers/opencode-headers'
import type { Context } from '@deepseek-ai/cordis'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import { LlmError, resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import type { AdapterRegistrationHandle } from '@deepseek-ai/dsh-llm'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import type { ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import type { OpenCodeModel, OpenCodeModelCost } from '../contracts/catalog.ts'
import {
  modelDisplayName,
  modelKey,
  OPENCODE_PROVIDER,
  OPENCODE_PROVIDER_NAME,
  OPENCODE_USER_AGENT,
  wireModelId,
} from '../contracts/identity.ts'

/** 流空闲上限：思考型模型的长停顿不应被误判断流。 */
export const OPENCODE_STREAM_IDLE_TIMEOUT_MS = 300_000
/** 每个请求的 base64 图片总负载上限（与 DSH 默认一致）。 */
export const OPENCODE_MAX_REQUEST_IMAGE_BYTES = 20 * 1024 * 1024
/** 每张请求图片的像素预算（2048 × 2048）。 */
export const OPENCODE_REQUEST_IMAGE_PIXEL_BUDGET = 2048 * 2048
/** 每张请求图片的编码后字节目标。 */
export const OPENCODE_REQUEST_IMAGE_MAX_BYTES = 1024 * 1024

function costOf(cost: OpenCodeModelCost | undefined): Model<Api>['cost'] {
  return {
    input: cost?.input ?? 0,
    output: cost?.output ?? 0,
    cacheRead: cost?.cacheRead ?? 0,
    cacheWrite: cost?.cacheWrite ?? 0,
  }
}

/**
 * 把目录条目投影为 pi-ai 模型。
 *
 * `id` 带 plan 前缀以保证合并列表内唯一，`name` 追加 `· zen` / `· go`；
 * `compat` 与 `inputLimits` 是不透明 JSON，原样交给 pi-ai。
 */
export function toPiModel(model: OpenCodeModel): Model<Api> {
  const value = {
    id: modelKey(model.plan, model.id),
    name: modelDisplayName(model.name, model.plan),
    api: model.api,
    provider: OPENCODE_PROVIDER,
    baseUrl: model.baseURL,
    input: [...model.input],
    cost: costOf(model.cost),
    reasoning: model.reasoning,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    type: 'chat' as const,
    ...(model.thinkingLevelMap === undefined ? {} : { thinkingLevelMap: { ...model.thinkingLevelMap } }),
    ...(model.compat === undefined ? {} : { compat: model.compat }),
    ...(model.inputLimits === undefined ? {} : { inputLimits: model.inputLimits }),
  }
  return value as unknown as Model<Api>
}

/**
 * 发请求前把合并用的模型 id 还原成网关 id。
 *
 * pi-ai 的 API 实现直接读 `model.id` 作为请求里的模型名，因此必须在
 * `stream` / `streamSimple` 入口改写；其余字段（baseUrl、compat、思考等级）
 * 保持不变。
 */
function withWireModelId(streams: ProviderStreams): ProviderStreams {
  return {
    ...streams,
    stream: (model, context, options) =>
      streams.stream({ ...model, id: wireModelId(model.id) }, context, options),
    streamSimple: (model, context, options) =>
      streams.streamSimple({ ...model, id: wireModelId(model.id) }, context, options),
  }
}

/** 四个协议族的实现；每个都注入 `x-opencode-session` 头并还原网关模型 id。 */
function openCodeApis(): NonNullable<CreateProviderOptions['api']> {
  return {
    'anthropic-messages': withWireModelId(withOpenCodeSessionHeader(anthropicMessagesApi())),
    'google-generative-ai': withWireModelId(withOpenCodeSessionHeader(googleGenerativeAIApi())),
    'openai-completions': withWireModelId(withOpenCodeSessionHeader(openAICompletionsApi())),
    'openai-responses': withWireModelId(withOpenCodeSessionHeader(openAIResponsesApi())),
  }
}

function providerAuth(resolveAccessToken: () => Promise<string | undefined>): ProviderAuth {
  return {
    apiKey: {
      name: 'OpenCode 账号凭据',
      async resolve() {
        const key = await resolveAccessToken()
        if (key === undefined || key.length === 0) return undefined
        return { auth: { apiKey: key }, source: 'OpenCode Console' }
      },
    },
  }
}

/** 构建合并供应商的 pi-ai provider。 */
export function createOpenCodeProvider(
  models: readonly OpenCodeModel[],
  resolveAccessToken: () => Promise<string | undefined>,
): Provider {
  return createProvider({
    id: OPENCODE_PROVIDER,
    name: OPENCODE_PROVIDER_NAME,
    auth: providerAuth(resolveAccessToken),
    models: models.filter(model => model.disabled !== true).map(toPiModel),
    api: openCodeApis(),
  })
}

/**
 * 构建供应商 profile。
 *
 * 独立导出便于测试直接驱动 `PiAiAdapter`，而不必伪造整个 Cordis 上下文。
 */
export function createOpenCodeProfile(
  models: readonly OpenCodeModel[],
  resolveAccessToken: () => Promise<string | undefined>,
  headers: Readonly<Record<string, string>> = {},
): ResolvedPiAiProviderProfile {
  return {
    provider: OPENCODE_PROVIDER,
    displayName: OPENCODE_PROVIDER_NAME,
    streamIdleTimeoutMs: OPENCODE_STREAM_IDLE_TIMEOUT_MS,
    maxRequestImageBytes: OPENCODE_MAX_REQUEST_IMAGE_BYTES,
    requestImagePixelBudget: OPENCODE_REQUEST_IMAGE_PIXEL_BUDGET,
    requestImageMaxBytes: OPENCODE_REQUEST_IMAGE_MAX_BYTES,
    retryPolicy: resolveRetryPolicy(undefined, 'dsh-opencode retryPolicy'),
    configuredMaxTokens: new Map(),
    headers: { 'user-agent': OPENCODE_USER_AGENT, ...headers },
    piProvider: createOpenCodeProvider(models, resolveAccessToken),
    modelErrors: new Map(),
  }
}

/** 用当前 profile 构造 pi-ai 适配器；`profiles` 每次操作都会被重新读取。 */
export function createOpenCodePiAdapter(options: {
  readonly profiles: () => ReadonlyMap<string, ResolvedPiAiProviderProfile>
  readonly resolveAccessToken: () => Promise<string | undefined>
  readonly resolveAttachments?: () => AttachmentStore | undefined
}): PiAiAdapter {
  return new PiAiAdapter({
    profiles: options.profiles,
    resolveApiKey: async () => {
      const token = await options.resolveAccessToken()
      if (token === undefined || token.length === 0) {
        throw new LlmError('OpenCode 尚未登录：请在插件详情页登录 OpenCode Console 账号', 'MISSING_CREDENTIAL')
      }
      return token
    },
    // 本插件自己持有账号凭据，pi-ai 侧的凭据库不参与鉴权；注入空存储
    // 是为了满足适配器契约，并让后续 provider 原生登录保持可用。
    auth: {
      credentials: new InMemoryCredentialStore(),
      authContext: defaultProviderAuthContext(),
    },
    ...(options.resolveAttachments === undefined ? {} : { resolveAttachments: options.resolveAttachments }),
  })
}

/** 运行时依赖。 */
export interface OpenCodeProviderRuntimeOptions {
  /** 返回当前可用 access token；未登录返回 undefined。 */
  readonly resolveAccessToken: () => Promise<string | undefined>
  /** 读取宿主附件服务，供图片输入使用。 */
  readonly resolveAttachments: () => AttachmentStore | undefined
  /** 日志出口；冲突与目录异常只记日志并暴露给界面。 */
  readonly logger: Pick<Context['logger'], 'warn' | 'info'>
}

/** 供应商路由的运行状态，供详情页诊断。 */
export interface OpenCodeRouteStatus {
  readonly id: string
  readonly name: string
  readonly registered: boolean
  readonly error?: string
  readonly modelCount: number
}

/**
 * 注册并持有唯一的 `dsh-opencode` 路由。
 *
 * 路由被其他适配器占用时记录原因并保持未注册状态，由详情页把冲突说明展示
 * 给用户，而不是让整个插件失效。
 */
export class OpenCodeProviderRuntime {
  private snapshot: ReadonlyMap<string, ResolvedPiAiProviderProfile> = new Map()
  private readonly adapter: PiAiAdapter
  private registration: AdapterRegistrationHandle | undefined
  private registered = false
  private error: string | undefined
  private currentModels: readonly OpenCodeModel[] = []

  constructor(private readonly options: OpenCodeProviderRuntimeOptions) {
    this.adapter = createOpenCodePiAdapter({
      profiles: () => this.snapshot,
      resolveAccessToken: this.options.resolveAccessToken,
      resolveAttachments: this.options.resolveAttachments,
    })
  }

  /** 当前目录模型（未过滤隐藏项）。 */
  models(): readonly OpenCodeModel[] {
    return this.currentModels
  }

  /** 路由注册状态；冲突原因只在该路由上生效。 */
  routeStatus(): readonly OpenCodeRouteStatus[] {
    return [{
      id: OPENCODE_PROVIDER,
      name: OPENCODE_PROVIDER_NAME,
      registered: this.registered,
      ...(this.error === undefined ? {} : { error: this.error }),
      modelCount: this.currentModels.filter(model => model.disabled !== true).length,
    }]
  }

  /** 兼容旧调用：返回注册错误。 */
  registrationError(): string | undefined {
    return this.error
  }

  /** 在插件 fiber 上注册路由；返回的清理函数由 `ctx.effect` 管理。 */
  register(ctx: Context): void {
    ctx.effect(() => {
      this.registered = false
      this.error = undefined
      try {
        this.registration = ctx.llm.registerAdapter([OPENCODE_PROVIDER], this.adapter)
        this.registered = true
      } catch (registerError) {
        this.error = registerError instanceof Error ? registerError.message : String(registerError)
        this.options.logger.warn(`dsh-opencode: 无法注册 ${OPENCODE_PROVIDER} 路由：${this.error}`)
      }
      return () => {
        this.registration?.()
        this.registration = undefined
        this.registered = false
      }
    }, 'dsh-opencode: LLM 路由')
  }

  /**
   * 用新目录重建 profile；下一次 LLM 操作即可见。
   *
   * `headers` 是 Console 下发的路由头（工作空间 id 等）；`user-agent` 固定为
   * 本插件自己的标识，不被上游覆盖。
   */
  update(models: readonly OpenCodeModel[], headers: Readonly<Record<string, string>> = {}): void {
    this.currentModels = models
    // 新 Map 身份是 PiAiAdapter 重建模型集合的信号。
    this.snapshot = new Map([[
      OPENCODE_PROVIDER,
      createOpenCodeProfile(models, this.options.resolveAccessToken, headers),
    ]])
  }
}
