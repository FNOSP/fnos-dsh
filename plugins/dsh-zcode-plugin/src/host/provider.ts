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
} from '@earendil-works/pi-ai'
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy'
import type { Context } from '@deepseek-ai/cordis'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import { resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import type { AdapterRegistrationHandle } from '@deepseek-ai/dsh-llm'
import type { ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import type { ZCodeModel, ZCodeThinkingLevelMap } from '../contracts/catalog.ts'
import {
  ZCODE_ANTHROPIC_BASE_URLS,
  ZCODE_PROVIDER,
  ZCODE_PROVIDER_NAME,
  DEFAULT_ZCODE_ENDPOINT_PLAN,
  type ZCodeEndpointPlan,
} from '../contracts/identity.ts'
import type { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { reasoningEffort, ZCodeHttpAdapter } from './http/adapter.ts'
import { zcodeSourceHeaders } from './console-client.ts'

/** 流空闲上限：思考型模型的长停顿不应被误判断流。 */
export const ZCODE_STREAM_IDLE_TIMEOUT_MS = 300_000
/** 每个请求的 base64 图片总负载上限（与 DSH 默认一致）。 */
export const ZCODE_MAX_REQUEST_IMAGE_BYTES = 20 * 1024 * 1024
/** 每张请求图片的像素预算（2048 × 2048）。 */
export const ZCODE_REQUEST_IMAGE_PIXEL_BUDGET = 2048 * 2048
/** 每张请求图片的编码后字节目标。 */
export const ZCODE_REQUEST_IMAGE_MAX_BYTES = 1024 * 1024

/**
 * 把目录条目投影为 pi-ai 模型。
 *
 * @param model - 目录条目。
 * @param baseURL - 覆盖端点（端点策略决定，见 `ZCodeEndpointPlan`）。
 */
export function toPiModel(model: ZCodeModel, baseURL?: string): Model<Api> {
  const value = {
    id: model.id,
    name: model.name,
    api: model.api,
    provider: ZCODE_PROVIDER,
    baseUrl: baseURL ?? model.baseURL,
    input: [...model.input],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    reasoning: model.reasoning,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    type: 'chat' as const,
    /*
     * ZCode 的思考等级用 `output_config.effort` 表达（上游客户端配置里
     * `reasoning.levels.<level>.anthropic.set` 就是往这个路径写 low/high/max）。
     *
     * 只有 `forceAdaptiveThinking` 才会让 pi-ai 走 effort 分支；不设它，pi-ai
     * 会退回 `thinking: { type: 'enabled', budget_tokens }`，网关拿不到 effort，
     * 用户在 DSH 里选的思考等级就等于没生效。
     */
    ...(model.reasoning ? { compat: { forceAdaptiveThinking: true } } : {}),
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
  baseURL?: string,
): Provider {
  return createProvider({
    id: ZCODE_PROVIDER,
    name: ZCODE_PROVIDER_NAME,
    auth: providerAuth(resolveToken),
    models: models.map(model => toPiModel(model, baseURL)),
    api: zcodeApis(),
  })
}

/** 构建供应商 profile。 */
export function createZCodeProfile(
  models: readonly ZCodeModel[],
  resolveToken: () => Promise<string | undefined>,
  headers: Readonly<Record<string, string>> = {},
  baseURL?: string,
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
    piProvider: createZCodeProvider(models, resolveToken, baseURL),
    modelErrors: new Map(),
  }
}

/**
 * 固定显示名的 pi-ai 适配器。
 *
 * registry 在 `registerAdapter` 时立即调用 `providerInfo` 并**永久缓存**结果
 * （`listProviders()` 之后只返回这份快照），而本插件的 profile 快照要等目录
 * 首次刷新才有内容——默认实现那一刻会回落成 provider id，模型选择器的分组名
 * 从此固定成 `dsh-zcode`。这里直接返回契约常量，不依赖任何运行期状态。
 */

/** 运行时依赖。 */
export interface ZCodeProviderRuntimeOptions {
  /**
   * 按端点策略返回可用凭据；未登录/缺凭据返回 undefined。
   *
   * `start-plan` 用账号 JWT（ZCode 域凭证）；`ultra` 用家族 MaaS 令牌。
   * 两种凭据由同一份登录记录提供，但被不同端点接受。
   */
  readonly resolveToken: (plan: ZCodeEndpointPlan) => Promise<string | undefined>
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
  /** 当前端点策略，便于详情页说明「请求会发到哪里、扣哪种额度」。 */
  readonly endpointPlan?: ZCodeEndpointPlan
}

/**
 * 注册并持有唯一的 `dsh-zcode` 路由。
 *
 * 路由被其他适配器占用时记录原因并保持未注册状态，由详情页把冲突说明展示
 * 给用户，而不是让整个插件失效。
 */
export class ZCodeProviderRuntime {
  private snapshot: ReadonlyMap<string, ResolvedPiAiProviderProfile> = new Map()
  /** HTTP 通道：同时是模型元数据的唯一来源。 */
  /** 执行通道：自行收发 Anthropic Messages（满足网关对 system 分块的要求）。 */
  private readonly adapter: ZCodeHttpAdapter
  private registration: AdapterRegistrationHandle | undefined
  private registered = false
  private error: string | undefined
  private currentModels: readonly ZCodeModel[] = []
  private endpointPlan: ZCodeEndpointPlan = DEFAULT_ZCODE_ENDPOINT_PLAN

  constructor(private readonly options: ZCodeProviderRuntimeOptions) {
    this.adapter = new ZCodeHttpAdapter({
      models: () => this.currentModels.map(model => ({
        id: model.id,
        name: model.name,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        reasoning: model.reasoning,
        inputModalities: model.input,
        // 等级来自目录的 thinkingLevelMap：键是 DSH 的等级 id，值为上游字符串
        // （null 表示该等级不可用）。只透出可用的档位，选择器才不会给出空档。
        ...(model.thinkingLevelMap === undefined
          ? {}
          : {
            efforts: reasoningEffortsOf(model.thinkingLevelMap),
            thinkingLevelMap: model.thinkingLevelMap,
          }),
      })),
      baseUrl: () => ZCODE_ANTHROPIC_BASE_URLS[this.endpointPlan],
      apiKey: () => this.options.resolveToken(this.endpointPlan),
      deviceId: () => this.options.deviceMid(),
      headers: () => zcodeSourceHeaders(this.options.deviceMid()),
      // 图片输入：把附件读成 base64 发给模型。宿主负责按路由上限压缩，
      // 这里只做 base64 编码；读取失败时跳过该图而不是让整条请求失败。
      readImage: async (block) => {
        const attachments = this.options.resolveAttachments()
        if (attachments === undefined) return undefined
        try {
          const stored = await attachments.readImage(block.attachment)
          return {
            mediaType: block.attachment.mediaType,
            data: Buffer.from(stored.data).toString('base64'),
          }
        } catch (error) {
          this.options.logger.warn(
            `dsh-zcode: 读取图片附件失败，已跳过：${error instanceof Error ? error.message : String(error)}`,
          )
          return undefined
        }
      },
      logger: this.options.logger,
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
      endpointPlan: this.endpointPlan,
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

  /** 当前端点策略。 */
  plan(): ZCodeEndpointPlan {
    return this.endpointPlan
  }

  /**
   * 用新目录与端点策略重建 profile；下一次 LLM 操作即可见。
   *
   * 端点策略决定 baseURL 与凭据类型，两者必须一起换：只换端点不换凭据会直接
   * 401（`ultra` 不接受账号 JWT）。
   */
  update(models: readonly ZCodeModel[], plan: ZCodeEndpointPlan = this.endpointPlan): void {
    this.currentModels = models
    this.endpointPlan = plan
  }
}
/**
 * 需要把 Start Plan 的官方提示词前缀注入到请求里。
 *
 * 落点说明：宿主在 `adapterStream` 里做的是
 *   `const call = await adapter.prepareCall(...); dispatch = (o) => call.stream(o)`
 * 也就是说 `prepareCall` 返回的 `stream` 就是最终取流入口。因此包装它即可
 * 影响真正的请求，不需要改上游包、也不需要自己发 HTTP。
 *
 * 之所以不能只重写 `stream()`：设置了 `prepared` 的调用路径不会经过它。
 */

/**
 * 选择器里的档位顺序（从弱到强）与显示名。
 *
 * 这是 DSH 的通用档位词表，不是上游词表：一个上游等级可能对应多个档位
 * （例如上游 `low` 同时承接 `minimal` 与 `low`）。
 */
const REASONING_EFFORT_LADDER = [
  { id: 'minimal', name: 'Minimal' },
  { id: 'low', name: 'Low' },
  { id: 'medium', name: 'Medium' },
  { id: 'high', name: 'High' },
  { id: 'xhigh', name: 'Extra High' },
  { id: 'max', name: 'Max' },
] as const

/**
 * 把目录的思考等级映射转成选择器可用的档位。
 *
 * 两条规则都是必需的：
 * 1. 映射为 `null` 的等级上游不支持，剔除；否则选中即被拒。
 * 2. **多个档位映射到同一上游值时只保留最强的一档**。DSH 的通用档位词表比
 *    上游更细（`minimal`/`low`、`medium`/`high`、`xhigh`/`max` 常落在同一个上游
 *    值上），把它们全列出来会让用户以为选到了不同强度，实际发出去的请求字节
 *    完全相同——这是「看着能调、其实没调」的假象。
 *
 * 代价：若宿主配置里存着被合并掉的旧值（如 `xhigh`），它会找不到对应项而原样
 * 显示内部 id。请求侧由 `resolveEffort` 兜底到合法档位，不会发错。
 */
export function reasoningEffortsOf(
  map: ZCodeThinkingLevelMap,
): { id: ReturnType<typeof ReasoningEffortId>; name: string }[] {
  const supported = REASONING_EFFORT_LADDER.filter(level => {
    const mapped = map[level.id as keyof ZCodeThinkingLevelMap]
    return typeof mapped === 'string'
  })
  // 从强到弱收敛：同一上游值只保留最强档，保证留下的是语义最贴近上游行为的那个。
  const claimed = new Set<string>()
  const kept = new Set<string>()
  for (const level of [...supported].reverse()) {
    const upstream = map[level.id as keyof ZCodeThinkingLevelMap]
    if (typeof upstream !== 'string' || claimed.has(upstream)) continue
    claimed.add(upstream)
    kept.add(level.id)
  }
  return supported
    .filter(level => kept.has(level.id))
    .map(level => reasoningEffort(level.id, level.name))
}
