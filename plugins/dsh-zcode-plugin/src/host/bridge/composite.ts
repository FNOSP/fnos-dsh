/**
 * 两个执行通道共用一条 `dsh-zcode` 路由。
 *
 * - `start-plan`：走托管 app-server 的桥接通道（可用，消耗套餐额度）；
 * - `ultra`：走 pi-ai 的 HTTP 通道（需要账号有按量余额/资源包）。
 *
 * 模型元数据只由 pi-ai 侧提供：两侧共用同一份目录快照，上下文窗口与思考等级
 * 必须一致，否则同一模型在两个通道下会显示不同的能力。
 *
 * @module dsh-zcode/bridge/composite
 */

import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'

import type { ZCodeEndpointPlan } from '../../contracts/identity.ts'
import type { ZCodeBridgeAdapter } from './adapter.ts'

/** 组合适配器依赖。 */
export interface ZCodeCompositeAdapterOptions {
  /** 当前端点策略；每次取流时读取，偏好切换后立即生效。 */
  readonly plan: () => ZCodeEndpointPlan
  /** HTTP 通道（同时负责模型元数据）。 */
  readonly pi: PiAiAdapter
  /** 桥接通道。 */
  readonly bridge: ZCodeBridgeAdapter
}

/** 按端点策略分流 `stream()` 的适配器。 */
export class ZCodeCompositeAdapter extends LlmAdapter {
  constructor(private readonly options: ZCodeCompositeAdapterOptions) {
    super()
  }

  override providerInfo(provider: string): ReturnType<PiAiAdapter['providerInfo']> {
    return this.options.pi.providerInfo(provider)
  }

  override providerRetryPolicy(
    provider: string,
  ): ReturnType<PiAiAdapter['providerRetryPolicy']> {
    return this.options.pi.providerRetryPolicy(provider)
  }

  override listModels(provider: string): ReturnType<PiAiAdapter['listModels']> {
    return this.options.pi.listModels(provider)
  }

  override resolveModel(
    provider: string,
    model: string,
    signal?: AbortSignal,
  ): ReturnType<PiAiAdapter['resolveModel']> {
    return this.options.pi.resolveModel(provider, model, signal)
  }

  override stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    return this.options.plan() === 'start-plan'
      ? this.options.bridge.stream(options)
      : this.options.pi.stream(options)
  }

  /** 桥接通道持有的子进程。 */
  bridge(): ZCodeBridgeAdapter {
    return this.options.bridge
  }

  dispose(): void {
    this.options.bridge.dispose()
  }
}
