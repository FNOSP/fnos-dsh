/**
 * ZCode provider：把 Start Plan 目录投影成 DSH 的 `dsh-zcode` 路由。
 *
 * 与静态声明的供应商不同，这里每次目录刷新都会重建 pi-ai `Provider`：模型
 * 集合、上下文窗口、思考等级都来自当前账号的权益快照，因此上游调整套餐后
 * 不需要升级插件。重建只替换 `profiles()` 返回的 Map 身份——`PiAiAdapter`
 * 以该身份判断配置是否变化，进行中的请求仍使用它捕获的旧快照。
 *
 * 协议固定为 Anthropic Messages：ZCode 的 Start Plan 端点只提供这一族。模型
 * id 原样发出（不做前缀改写），因为目录里的 id 已经是网关接受的大小写形态。
 *
 * 请求头分两层：
 * - 路由级 `headers`：客户端身份头（`x-device-mid`、`x-zcode-*` 等），每次
 *   交互都带，参与网关的来源归因；
 * - 凭据：`resolveApiKey` 返回账号 JWT，`PiAiAdapter` 会把它写成
 *   `x-api-key`，插件再补 `authorization` 头，与官方客户端一致。
 *
 * @module dsh-zcode/provider
 */

import type {
  Api,
  CreateProviderOptions,
  Model,
  Provider,
  ProviderAuth,
  ProviderStreams,
} from '@earendil-works/pi-ai'
import {
  createProvider,
  defaultProviderAuthContext,
  InMemoryCredentialStore,
} from '@earendil-works/pi-ai'
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy'
import type { Context } from '@deepseek-ai/cordis'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import { LlmError, resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import type { AdapterRegistrationHandle } from '@deepseek-ai/dsh-llm'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import type { ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import type { ZCodeModel } from '../contracts/catalog.ts'
import {
  ZCODE_PROVIDER,
  ZCODE_PROVIDER_NAME,
} from '../contracts/identity.ts'
import { zcodeSourceHeaders } from './console-client.ts'

/** 流空闲上限：思考型模型的长停顿不应被误判断流。 */
export const ZCODE_STREAM_IDLE_TIMEOUT_MS = 300_000
/** 每个请求的 base64 图片总负载上限（与 DSH 默认一致）。 */
export const ZCODE_MAX_REQUEST_IMAGE_BYTES = 20 * 1024 * 1024
/** 每张请求图片的像素预算（2048 × 2048）。 */
export const ZCODE_REQUEST_IMAGE_PIXEL_BUDGET = 2048 * 2048
/** 每张请求图片的编码后字节目标。 */
export const ZCODE_REQUEST_IMAGE_MAX_BYTES = 1024 * 1024

/** 把目录条目投影为 pi-ai 模型。 */
export function toPiModel(model: ZCodeModel): Model<Api> {
  const value = {
    id: model.id,
    name: model.name,
    api: model.api,
    provider: ZCODE_PROVIDER,
    baseUrl: model.baseURL,
    input: [...model.input],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    reasoning: model.reasoning,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    type: 'chat' as const,
    ...(model.thinkingLevelMap === undefined
      ? {}
      : { thinkingLevelMap: { ...model.thinkingLevelMap } }),
  }
  return value as unknown as Model<Api>
}

/**
 * 给推理请求补 `authorization` 头。
 *
 * `PiAiAdapter` 把 `resolveApiKey` 的结果写成 `x-api-key`；ZCode 网关的
 * Anthropic 兼容层同时读 `authorization`，官方客户端两者都发。这里在流入口
 * 统一补上，避免只带一个头被网关当成不完整客户端。
 *
 * 必须是同步改写：`stream` / `streamSimple` 的返回类型是直接可迭代的事件流，
 * 不是 Promise；把入口改成 async 会破坏调用方的同步取流契约。
 */
function withAuthorizationHeader(streams: ProviderStreams): ProviderStreams {
  const decorate = (model: Model<Api>, options: unknown): Model<Api> => {
    const token = (options as { apiKey?: string } | undefined)?.apiKey
    if (token === undefined || token.length === 0) return model
    const current = (model as { headers?: Record<string, string> }).headers
    return { ...model, headers: { ...current, authorization: `Bearer ${token}` } } as Model<Api>
  }
  return {
    ...streams,
    stream: (model, context, options) => streams.stream(decorate(model, options), context, options),
    streamSimple: (model, context, options) => streams.streamSimple(decorate(model, options), context, options),
  }
}

/** Anthropic Messages 实现；当前只有这一族。 */
function zcodeApis(): NonNullable<CreateProviderOptions['api']> {
  return {
    'anthropic-messages': withAuthorizationHeader(anthropicMessagesApi()),
  }
}

function providerAuth(resolveToken: () => Promise<string | undefined>): ProviderAuth {
  return {
    apiKey: {
      name: 'ZCode 账号凭据',
      async resolve() {
        const key = await resolveToken()
        if (key === undefined || key.length === 0) return undefined
        return { auth: { apiKey: key }, source: 'ZCode 账号登录' }
      },
    },
  }
}

/** 构建 provider。 */
export function createZCodeProvider(
  models: readonly ZCodeModel[],
  resolveToken: () => Promise<string | undefined>,
): Provider {
  return createProvider({
    id: ZCODE_PROVIDER,
    name: ZCODE_PROVIDER_NAME,
    auth: providerAuth(resolveToken),
    models: models.map(toPiModel),
    api: zcodeApis(),
  })
}

/** 构建供应商 profile。 */
export function createZCodeProfile(
  models: readonly ZCodeModel[],
  resolveToken: () => Promise<string | undefined>,
  headers: Readonly<Record<string, string>> = {},
): ResolvedPiAiProviderProfile {
  return {
    provider: ZCODE_PROVIDER,
    displayName: ZCODE_PROVIDER_NAME,
    streamIdleTimeoutMs: ZCODE_STREAM_IDLE_TIMEOUT_MS,
    maxRequestImageBytes: ZCODE_MAX_REQUEST_IMAGE_BYTES,
    requestImagePixelBudget: ZCODE_REQUEST_IMAGE_PIXEL_BUDGET,
    requestImageMaxBytes: ZCODE_REQUEST_IMAGE_MAX_BYTES,
    retryPolicy: resolveRetryPolicy(undefined, 'dsh-zcode retryPolicy'),
    configuredMaxTokens: new Map(),
    headers: { ...headers },
    piProvider: createZCodeProvider(models, resolveToken),
    modelErrors: new Map(),
  }
}

/** 用当前 profile 构造 pi-ai 适配器；`profiles` 每次操作都会被重新读取。 */
export function createZCodePiAdapter(options: {
  readonly profiles: () => ReadonlyMap<string, ResolvedPiAiProviderProfile>
  readonly resolveToken: () => Promise<string | undefined>
  readonly resolveAttachments?: () => AttachmentStore | undefined
}): PiAiAdapter {
  return new PiAiAdapter({
    profiles: options.profiles,
    resolveApiKey: async () => {
      const token = await options.resolveToken()
      if (token === undefined || token.length === 0) {
        throw new LlmError(
          'ZCode 尚未登录：请在插件详情页登录 ZCode 账号',
          'MISSING_CREDENTIAL',
        )
      }
      return token
    },
    // 凭据由本插件自己持有，pi-ai 侧的凭据库不参与鉴权；注入空存储是为了
    // 满足适配器契约，并让后续 provider 原生登录保持可用。
    auth: {
      credentials: new InMemoryCredentialStore(),
      authContext: defaultProviderAuthContext(),
    },
    ...(options.resolveAttachments === undefined
      ? {}
      : { resolveAttachments: options.resolveAttachments }),
  })
}

/** 运行时依赖。 */
export interface ZCodeProviderRuntimeOptions {
  /** 返回当前可用账号 JWT；未登录返回 undefined。 */
  readonly resolveToken: () => Promise<string | undefined>
  /** 提供稳定的设备标识，用于构造路由头。 */
  readonly deviceMid: () => string
  /** 读取宿主附件服务，供图片输入使用。 */
  readonly resolveAttachments: () => AttachmentStore | undefined
  readonly logger: Pick<Context['logger'], 'warn' | 'info'>
}

/** 路由状态，供详情页诊断。 */
export interface ZCodeRouteStatus {
  readonly id: string
  readonly name: string
  readonly registered: boolean
  readonly error?: string
  readonly modelCount: number
}

/**
 * 注册并持有唯一的 `dsh-zcode` 路由。
 *
 * 路由被其他适配器占用时记录原因并保持未注册状态，由详情页把冲突说明展示
 * 给用户，而不是让整个插件失效。
 */
export class ZCodeProviderRuntime {
  private snapshot: ReadonlyMap<string, ResolvedPiAiProviderProfile> = new Map()
  private readonly adapter: PiAiAdapter
  private registration: AdapterRegistrationHandle | undefined
  private registered = false
  private error: string | undefined
  private currentModels: readonly ZCodeModel[] = []

  constructor(private readonly options: ZCodeProviderRuntimeOptions) {
    this.adapter = createZCodePiAdapter({
      profiles: () => this.snapshot,
      resolveToken: this.options.resolveToken,
      resolveAttachments: this.options.resolveAttachments,
    })
  }

  /** 当前目录模型。 */
  models(): readonly ZCodeModel[] {
    return this.currentModels
  }

  /** 路由注册状态。 */
  routeStatus(): readonly ZCodeRouteStatus[] {
    return [{
      id: ZCODE_PROVIDER,
      name: ZCODE_PROVIDER_NAME,
      registered: this.registered,
      ...(this.error === undefined ? {} : { error: this.error }),
      modelCount: this.currentModels.length,
    }]
  }

  /** 在插件 fiber 上注册路由。 */
  register(ctx: Context): void {
    ctx.effect(() => {
      this.registered = false
      this.error = undefined
      try {
        this.registration = ctx.llm.registerAdapter([ZCODE_PROVIDER], this.adapter)
        this.registered = true
      } catch (registerError) {
        this.error = registerError instanceof Error ? registerError.message : String(registerError)
        this.options.logger.warn(`dsh-zcode: 无法注册 ${ZCODE_PROVIDER} 路由：${this.error}`)
      }
      return () => {
        this.registration?.()
        this.registration = undefined
        this.registered = false
      }
    }, 'dsh-zcode: LLM 路由')
  }

  /** 用新目录重建 profile；下一次 LLM 操作即可见。 */
  update(models: readonly ZCodeModel[]): void {
    this.currentModels = models
    // 新 Map 身份是 PiAiAdapter 重建模型集合的信号。
    this.snapshot = new Map([[
      ZCODE_PROVIDER,
      createZCodeProfile(models, this.options.resolveToken, zcodeSourceHeaders(this.options.deviceMid())),
    ]])
  }
}
