/**
 * `dsh-zcode` 的 HTTP 执行通道：自行收发 Anthropic Messages。
 *
 * 为什么不用 pi-ai：网关要求 `system` 是官方 agent 的**两段独立文本块**，而
 * pi-ai 会把 system 拼成单块且没有可用的改写点（详见 `messages-client.ts`）。
 * 这条通道自己组装请求，因此能精确满足该要求。
 *
 * 模型元数据（上下文窗口、思考等级、模态）仍由同一目录快照提供，与 HTTP
 * 通道之外的部分保持一致。
 *
 * @module dsh-zcode/http/adapter
 */

import { LlmAdapter, LlmError, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type {
  ContentBlock,
  GenerateOptions,
  LlmModelInfo,
  LlmResolvedModelInfo,
  StreamChunk,
  TokenUsage,
} from '@deepseek-ai/dsh-llm'

import type { ZCodeEndpointPlan } from '../../contracts/identity.ts'
import { ZCODE_PROVIDER_NAME } from '../../contracts/identity.ts'
import { START_PLAN_PREFIX_BODY, START_PLAN_PREFIX_HEAD } from '../start-plan-prefix.ts'
import { streamMessages, type MessagesRequest } from './messages-client.ts'
import {
  leadingSystem,
  messageText,
  toAnthropicMessages,
  toAnthropicTools,
  toEffort,
} from './translate.ts'

/** 一个可执行模型。 */
export interface ZCodeHttpModel {
  readonly id: string
  readonly name: string
  readonly contextWindow: number
  readonly maxTokens: number
  readonly reasoning: boolean
  readonly efforts?: readonly { readonly id: ReturnType<typeof ReasoningEffortId>; readonly name: string }[]
  /** 等级 → 上游字符串；与 efforts 同源，用于把所选等级翻译成请求字段。 */
  readonly thinkingLevelMap?: Readonly<Record<string, string | null>>
  readonly inputModalities?: readonly ('text' | 'image')[]
}

/** 通道依赖。 */
export interface ZCodeHttpAdapterOptions {
  /** 当前模型清单（每次调用读取，目录刷新后立刻生效）。 */
  readonly models: () => readonly ZCodeHttpModel[]
  /** 当前端点策略与凭据。 */
  readonly baseUrl: () => string
  readonly apiKey: () => Promise<string | undefined>
  /** 设备标识，写入 metadata 与请求头。 */
  readonly deviceId: () => string
  /** 客户端身份头。 */
  readonly headers?: () => Record<string, string>
  /** 读取图片附件为 base64；不支持图片时返回 undefined。 */
  /**
   * 把图片附件读成 base64。
   *
   * 必须是异步：附件字节由宿主的附件服务异步读取并按路由上限压缩。
   * 返回 undefined 表示该图跳过（例如读取失败），不影响整条请求。
   */
  readonly readImage?: (
    block: Extract<ContentBlock, { type: 'image' }>,
  ) => Promise<{ mediaType: string; data: string } | undefined>
  readonly logger?: { warn(message: string): void }
  /** 便于测试注入。 */
  readonly fetchImpl?: typeof fetch
}

/** 单条流内的块状态：用来把增量与 id 关联起来。 */
interface BlockState {
  readonly blockType: 'text' | 'thinking' | 'tool_use'
  readonly id?: string
  readonly name?: string
  /** 累计的思考签名，跨轮回传时使用。 */
  signature?: string
  /** 累计正文：`block-end` 必须带完整文本，否则宿主拿不到内容。 */
  readonly text: string[]
  readonly arguments: string[]
}

/** 自行发送的适配器。 */
export class ZCodeHttpAdapter extends LlmAdapter {
  constructor(private readonly options: ZCodeHttpAdapterOptions) {
    super()
  }

  override providerInfo(provider: string): { readonly id: string; readonly name: string } {
    return { id: provider, name: ZCODE_PROVIDER_NAME }
  }

  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return this.options.models().map(model => ({
      provider,
      id: model.id,
      name: model.name,
      ...(model.inputModalities === undefined ? {} : { inputModalities: [...model.inputModalities] }),
    }))
  }

  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    const found = this.options.models().find(candidate => candidate.id === model)
    if (found === undefined) {
      throw new LlmError(`dsh-zcode: 未知模型 "${model}"`, 'UNKNOWN_MODEL')
    }
    return {
      provider,
      id: found.id,
      name: found.name,
      context: { contextWindow: found.contextWindow },
      defaultMaxTokens: found.maxTokens,
      ...(found.inputModalities === undefined ? {} : { inputModalities: [...found.inputModalities] }),
      ...(found.reasoning && found.efforts !== undefined
        ? {
          reasoning: {
            efforts: found.efforts.map(effort => ({ ...effort })),
            // 调用方未指定时用最高档：与官方客户端默认一致。
            ...(found.efforts.length === 0
              ? {}
              : { defaultEffort: found.efforts[found.efforts.length - 1]!.id }),
          },
        }
        : {}),
    }
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const model = this.options.models().find(candidate => candidate.id === options.model)
    if (model === undefined) {
      throw new LlmError(`dsh-zcode: 未知模型 "${options.model}"`, 'UNKNOWN_MODEL')
    }
    const apiKey = await this.options.apiKey()
    if (apiKey === undefined || apiKey.length === 0) {
      throw new LlmError('ZCode 凭据不可用：请先在插件详情页登录 ZCode 账号', 'MISSING_CREDENTIAL')
    }

    const plan = this.options.baseUrl().includes('/ultra/') ? 'ultra' : 'start-plan'
    const request: MessagesRequest = {
      baseUrl: this.options.baseUrl(),
      apiKey,
      model: model.id,
      maxTokens: options.maxTokens ?? model.maxTokens,
      // 循环构造的请求把系统提示词放在首条 system 消息里；手工调用走 options.system。
      system: options.system ?? leadingSystem(options.messages),
      messages: await toAnthropicMessages(options.messages, this.options.readImage),
      tools: toAnthropicTools(options.tools),
      effort: toEffort(resolveEffort(options.reasoningEffort, model), model.thinkingLevelMap),
      thinking: model.reasoning,
      deviceId: this.options.deviceId(),
      ...(options.sessionId === undefined ? {} : { sessionId: String(options.sessionId) }),
      ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(this.options.headers === undefined ? {} : { extraHeaders: this.options.headers() }),
      // 限流重试要可观察：用户看到「卡住」时必须能从日志判断是在等上游。
      onRateLimit: (info) => {
        this.options.logger?.warn(
          `dsh-zcode: 触发限流（HTTP ${String(info.status)}`
          + `${info.businessCode === undefined ? '' : `, ${info.businessCode}`}），`
          + `第 ${String(info.attempt)} 次重试前等待 ${String(Math.round(info.delayMs / 1000))} 秒`,
        )
      },
    }

    // ultra 端点不做内容校验；只有 start-plan 需要官方两段前缀。
    const prefix = plan === 'start-plan'
      ? { head: START_PLAN_PREFIX_HEAD, body: START_PLAN_PREFIX_BODY }
      : { head: '', body: '' }

    const blocks = new Map<number, BlockState>()
    let started = false
    let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 }
    let stopReason = 'end_turn'

    try {
      for await (const event of streamMessages(request, prefix, this.options.fetchImpl)) {
        switch (event.kind) {
          case 'message-start':
            if (event.usage !== undefined) usage = mergeUsage(usage, event.usage)
            break
          case 'block-start': {
            blocks.set(event.index, {
              blockType: event.blockType,
              ...(event.id === undefined ? {} : { id: event.id }),
              ...(event.name === undefined ? {} : { name: event.name }),
              text: [],
              arguments: [],
            })
            if (event.blockType === 'thinking') {
              yield { type: 'block-start', index: event.index, blockType: 'reasoning' }
            } else if (event.blockType === 'text') {
              yield { type: 'block-start', index: event.index, blockType: 'text' }
            }
            // 工具调用不单独发 block-start：DSH 用 tool-call-delta 建立块。
            started = true
            break
          }
          case 'text-delta':
            if (event.text !== '') {
              blocks.get(event.index)?.text.push(event.text)
              yield { type: 'text-delta', index: event.index, text: event.text }
            }
            break
          case 'thinking-delta':
            if (event.text !== '') {
              blocks.get(event.index)?.text.push(event.text)
              yield { type: 'reasoning-delta', index: event.index, text: event.text }
            }
            break
          case 'signature-delta': {
            const state = blocks.get(event.index)
            if (state !== undefined) state.signature = `${state.signature ?? ''}${event.signature}`
            break
          }
          case 'tool-delta': {
            const state = blocks.get(event.index)
            if (state !== undefined) state.arguments.push(event.argumentsDelta)
            const id = state?.id ?? `tool-${String(event.index)}`
            yield {
              type: 'tool-call-delta',
              index: event.index,
              id: id as never,
              ...(state?.name === undefined ? {} : { name: state.name }),
              argumentsDelta: event.argumentsDelta,
            }
            started = true
            break
          }
          case 'block-stop': {
            const state = blocks.get(event.index)
            if (state === undefined) break
            if (state.blockType === 'text') {
              yield {
                type: 'block-end',
                index: event.index,
                block: { type: 'text', text: state.text.join('') },
              }
            } else if (state.blockType === 'thinking') {
              // 思考块正文是思考内容本身；签名不能混进正文（会显示在界面上），
              // 它属于跨轮重放元数据，交给 replayState 承载。
              yield {
                type: 'block-end',
                index: event.index,
                block: { type: 'reasoning', text: state.text.join('') },
              }
            } else if (state.blockType === 'tool_use' && state.id !== undefined) {
              yield {
                type: 'block-end',
                index: event.index,
                block: {
                  type: 'tool-call',
                  id: state.id as never,
                  name: state.name ?? '',
                  arguments: state.arguments.join(''),
                },
              }
            }
            break
          }
          case 'message-delta':
            stopReason = event.stopReason
            if (event.usage !== undefined) usage = mergeUsage(usage, event.usage)
            break
          case 'error':
            yield {
              type: 'finish',
              reason: {
                kind: 'error',
                failure: { message: `ZCode: ${event.message}`, code: 'PROVIDER' },
              },
            }
            return
          default:
            break
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (options.signal?.aborted === true) {
        yield {
          type: 'finish',
          reason: { kind: 'aborted', failure: { message: 'ZCode: 请求已取消', code: 'ABORTED' } },
        }
        return
      }
      this.options.logger?.warn(`zcode: 请求失败 ${message}`)
      yield {
        type: 'finish',
        reason: { kind: 'error', failure: { message, code: 'PROVIDER' } },
      }
      return
    }

    void started
    yield { type: 'usage', usage }
    /*
     * 思考签名必须跨轮原样回传，否则上游拒绝；但它不属于可见正文。
     * 用 `replayState` 承载：宿主把它存在 assistant 消息上，下一轮随消息带回。
     * 每块一条，与发出的块顺序一一对应。
     */
    // 必须是可无损序列化的纯 JSON：undefined 会让宿主的校验直接拒绝整条流。
    const blockReplay = [...blocks.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, state]) => (state.signature === undefined ? null : { signature: state.signature }))
    yield {
      type: 'finish',
      reason: stopReason === 'tool_use'
        ? { kind: 'tool-calls' }
        : stopReason === 'max_tokens'
          ? { kind: 'max-tokens' }
          : { kind: 'stop' },
      ...(blockReplay.some(entry => entry !== null)
        ? { replayState: { response: { stopReason }, blocks: blockReplay } }
        : {}),
    }
  }

  /** 端点策略（诊断用）。 */
  planOf(baseUrl: string): ZCodeEndpointPlan {
    return baseUrl.includes('/ultra/') ? 'ultra' : 'start-plan'
  }
}

/**
 * 把调用方传入的思考等级收敛到该模型真正可用的档位。
 *
 * 历史会话可能保存了上一版目录里存在、现在被过滤掉的等级（例如上游只支持
 * low/high/max 时，旧值 `xhigh` 已不在候选里）。此时直接透传会让请求带上
 * 一个语义不明的档位，界面也会把它当作显示名原样展示，因此回退到默认档。
 */
export function resolveEffort(
  requested: string | undefined,
  model: ZCodeHttpModel,
): string | undefined {
  if (requested === undefined) return undefined
  const efforts = model.efforts
  if (efforts === undefined || efforts.length === 0) return requested
  const available = efforts.map(effort => String(effort.id))
  if (available.includes(requested)) return requested
  return available[available.length - 1]
}

/** 合并两次 usage：上游在 message_start 与 message_delta 各报一部分。 */
function mergeUsage(base: TokenUsage, next: TokenUsage): TokenUsage {
  return {
    inputTokens: Math.max(base.inputTokens, next.inputTokens),
    outputTokens: Math.max(base.outputTokens, next.outputTokens),
    ...(next.cacheReadTokens === undefined && base.cacheReadTokens === undefined
      ? {}
      : { cacheReadTokens: next.cacheReadTokens ?? base.cacheReadTokens }),
    ...(next.cacheWriteTokens === undefined && base.cacheWriteTokens === undefined
      ? {}
      : { cacheWriteTokens: next.cacheWriteTokens ?? base.cacheWriteTokens }),
  }
}

/** 供转换层复用：从消息里取文本。 */
export { messageText }

/**
 * 把一个 DSH 思考等级 id 与显示名组成适配器可用的选项。
 *
 * 用官方的品牌构造函数而不是断言，避免手写 `as` 绕过类型约束。
 */
export function reasoningEffort(id: string, name: string): { id: ReturnType<typeof ReasoningEffortId>; name: string } {
  return { id: ReasoningEffortId(id), name }
}
