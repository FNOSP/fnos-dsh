import { describe, expect, it, vi } from 'vitest'
import type { LlmProviderInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'

import type { ZCodeEndpointPlan } from '../../../src/contracts/identity.ts'
import type { ZCodeBridgeAdapter } from '../../../src/host/bridge/adapter.ts'
import { ZCodeCompositeAdapter } from '../../../src/host/bridge/composite.ts'

/** 可迭代的空流：用来比对 `stream()` 是否原样转发了某个通道的流对象。 */
function streamOf(...chunks: StreamChunk[]): AsyncIterable<StreamChunk> {
  return {
    async *[Symbol.asyncIterator]() {
      yield* chunks
    },
  }
}

function request(): Parameters<ZCodeCompositeAdapter['stream']>[0] {
  return { provider: 'dsh-zcode', model: 'GLM-5.3-Flash', messages: [] }
}

/** 只有委托关系被验证，具体实现由各自的适配器负责；这里用哨兵值区分来源。 */
function createComposite(plan: () => ZCodeEndpointPlan): {
  adapter: ZCodeCompositeAdapter
  bridge: {
    stream: ReturnType<typeof vi.fn>
    dispose: ReturnType<typeof vi.fn>
  }
  pi: {
    providerInfo: ReturnType<typeof vi.fn>
    providerRetryPolicy: ReturnType<typeof vi.fn>
    listModels: ReturnType<typeof vi.fn>
    resolveModel: ReturnType<typeof vi.fn>
    stream: ReturnType<typeof vi.fn>
  }
} {
  const bridge = {
    stream: vi.fn(() => streamOf()),
    dispose: vi.fn(),
  }
  const pi = {
    providerInfo: vi.fn((): LlmProviderInfo => ({ id: 'dsh-zcode', name: 'ZCode (pi)' })),
    providerRetryPolicy: vi.fn(() => ({ retries: 2 })),
    listModels: vi.fn(async () => []),
    resolveModel: vi.fn(async () => ({ provider: 'dsh-zcode', model: 'GLM-5.3-Flash' })),
    stream: vi.fn(() => streamOf()),
  }
  const adapter = new ZCodeCompositeAdapter({
    plan,
    bridge: bridge as unknown as ZCodeBridgeAdapter,
    pi: pi as unknown as PiAiAdapter,
  })
  return { adapter, bridge, pi }
}

describe('ZCodeCompositeAdapter 的通道分流', () => {
  it('start-plan 策略下 stream() 原样交给桥接通道', () => {
    const { adapter, bridge, pi } = createComposite(() => 'start-plan')
    const bridgeStream = streamOf({ type: 'finish', reason: { kind: 'stop' } })
    bridge.stream.mockReturnValue(bridgeStream)

    expect(adapter.stream(request())).toBe(bridgeStream)
    expect(bridge.stream).toHaveBeenCalledTimes(1)
    expect(pi.stream).not.toHaveBeenCalled()
  })

  it('ultra 策略下 stream() 原样交给 pi-ai 通道', () => {
    const { adapter, bridge, pi } = createComposite(() => 'ultra')
    const piStream = streamOf({ type: 'finish', reason: { kind: 'stop' } })
    pi.stream.mockReturnValue(piStream)

    expect(adapter.stream(request())).toBe(piStream)
    expect(pi.stream).toHaveBeenCalledTimes(1)
    expect(bridge.stream).not.toHaveBeenCalled()
  })

  it('每个请求都重新读取策略（偏好切换立即生效）', () => {
    let plan: ZCodeEndpointPlan = 'start-plan'
    const { adapter, bridge, pi } = createComposite(() => plan)

    adapter.stream(request())
    plan = 'ultra'
    adapter.stream(request())

    expect(bridge.stream).toHaveBeenCalledTimes(1)
    expect(pi.stream).toHaveBeenCalledTimes(1)
  })
})

describe('ZCodeCompositeAdapter 的元数据委托', () => {
  it('providerInfo 用 pi-ai 侧结果（模型元数据只有一处来源）', () => {
    const { adapter, pi } = createComposite(() => 'start-plan')

    expect(adapter.providerInfo('dsh-zcode')).toEqual({ id: 'dsh-zcode', name: 'ZCode (pi)' })
    expect(pi.providerInfo).toHaveBeenCalledWith('dsh-zcode')
  })

  it('providerRetryPolicy 与 listModels 透传 provider 入参', async () => {
    const { adapter, pi } = createComposite(() => 'start-plan')

    expect(adapter.providerRetryPolicy('route-a')).toEqual({ retries: 2 })
    await adapter.listModels('route-a')

    expect(pi.providerRetryPolicy).toHaveBeenCalledWith('route-a')
    expect(pi.listModels).toHaveBeenCalledWith('route-a')
  })

  it('resolveModel 透传 provider / model / signal', async () => {
    const { adapter, pi } = createComposite(() => 'start-plan')
    const controller = new AbortController()

    await adapter.resolveModel('dsh-zcode', 'GLM-5.3-Flash', controller.signal)

    expect(pi.resolveModel).toHaveBeenCalledWith('dsh-zcode', 'GLM-5.3-Flash', controller.signal)
  })
})

describe('ZCodeCompositeAdapter 的资源释放', () => {
  it('bridge() 暴露桥接通道，dispose() 只释放桥接通道持有的子进程', () => {
    const { adapter, bridge } = createComposite(() => 'start-plan')

    expect(adapter.bridge()).toBe(bridge)
    adapter.dispose()
    expect(bridge.dispose).toHaveBeenCalledTimes(1)
  })
})
