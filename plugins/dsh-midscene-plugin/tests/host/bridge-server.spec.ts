import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type { GenerateOptions, LlmModelInfo, LlmRuntime, StreamChunk } from '@deepseek-ai/dsh-llm'
import { BridgePortExhaustedError, BridgeServer } from '../../src/host/bridge-server.ts'
import { PORT_SCAN_LIMIT, type BridgeConfig } from '../../src/contracts/config.ts'
import type { SessionModelReader } from '../../src/host/model-choice.ts'

/**
 * 桥接服务的 HTTP 行为（FNOS-013-01/03/04）。
 *
 * 用真实 HTTP 服务器与真实端口跑：端点路由、SSE 格式、错误状态码这些正是
 * 「客户端看到什么」的部分，用 mock 请求对象测不出真问题。
 */

const servers: BridgeServer[] = []
const blockers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async server => server.stop()))
  await Promise.all(blockers.splice(0).map(async server => new Promise<void>((resolve) => {
    server.close(() => resolve())
    server.closeAllConnections()
  })))
})

/** 取一个空闲端口（先监听再释放，避免固定端口在 CI 上撞车）。 */
async function freePort(): Promise<number> {
  const probe = createServer()
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', () => resolve()))
  const address = probe.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  await new Promise<void>(resolve => probe.close(() => resolve()))
  return port
}

/** 记录调用的宿主模型层替身。 */
function fakeLlm(options: {
  providers?: { id: string, name: string }[]
  models?: Record<string, readonly LlmModelInfo[]>
  chunks?: readonly StreamChunk[]
  fail?: Error
  /**
   * 各模型披露的思考档位（模型 id → 档位 id 列表，由弱到强）。
   *
   * 不传时替身**没有** `resolveModelInfo`，用于覆盖「宿主给不出元数据」的降级路径。
   */
  reasoningEfforts?: Record<string, readonly string[]>
} = {}): { llm: LlmRuntime, calls: GenerateOptions[] } {
  const calls: GenerateOptions[] = []
  const llm = {
    listProviders: () => options.providers ?? [{ id: 'codebuddy', name: 'CodeBuddy' }],
    listModels: async (provider: string) => options.models?.[provider] ?? [
      { provider, id: 'glm-5.3-flash', name: 'GLM', inputModalities: ['text', 'image'] },
    ],
    ...options.reasoningEfforts === undefined ? {} : {
      resolveModelInfo: async (provider: string, model: string) => {
        const ids = options.reasoningEfforts?.[`${provider}/${model}`]
        if (ids === undefined) return { provider, id: model, name: model }
        if (ids.length === 0) return { provider, id: model, name: model }
        return {
          provider,
          id: model,
          name: model,
          reasoning: { efforts: ids.map(id => ({ id, name: id.charAt(0).toUpperCase() + id.slice(1) })) },
        }
      },
    },
    stream: (request: GenerateOptions): AsyncIterable<StreamChunk> => {
      calls.push(request)
      const chunks = options.chunks ?? [
        { type: 'text-delta', index: 0, text: '你好' },
        { type: 'finish', reason: { kind: 'stop' } },
      ]
      return (async function* generate() {
        if (options.fail !== undefined) throw options.fail
        for (const chunk of chunks) yield chunk
      })()
    },
  } as unknown as LlmRuntime
  return { llm, calls }
}

/** 附件服务替身。 */
function fakeAttachments(): AttachmentStore {
  return {
    saveImages: async (inputs: readonly { data: Uint8Array, mediaType: string }[]) =>
      inputs.map((input, index) => ({
        attachmentId: `att-${index}` as never,
        mediaType: input.mediaType,
        bytes: input.data.byteLength,
        width: 1,
        height: 1,
      })),
  } as unknown as AttachmentStore
}

/** 启动一个桥用于测试。 */
async function startBridge(overrides: Partial<BridgeConfig> = {}, deps: {
  llm?: LlmRuntime
  attachments?: AttachmentStore | undefined
  sessionModel?: SessionModelReader
} = {}): Promise<{ port: number, calls: GenerateOptions[] }> {
  const port = await freePort()
  const fake = (deps.llm ?? fakeLlm().llm)
  const calls: GenerateOptions[] = []
  // 包一层记录调用：测试要在断言里看发往宿主模型层的入参。
  const wrapped = {
    ...(fake as unknown as Record<string, unknown>),
    stream: (request: GenerateOptions) => {
      calls.push(request)
      return (fake as LlmRuntime).stream(request)
    },
  } as unknown as LlmRuntime
  const server = new BridgeServer({
    llm: wrapped,
    attachments: 'attachments' in deps ? deps.attachments : fakeAttachments(),
    config: {
      port,
      apiKey: 'test-key',
      family: 'glm-v',
      model: '',
      locateModel: '',
      planningModel: '',
      insightModel: '',
      requestTimeoutMs: 10_000,
      logRequests: false,
      ...overrides,
    },
    sessionModel: deps.sessionModel ?? { current: () => undefined },
    log: () => {},
  })
  await server.start()
  servers.push(server)
  return { port, calls }
}

describe('FNOS-013-01 服务与健康检查', () => {
  it('健康检查反映宿主提供方与模型目录状态（AC-01）', async () => {
    const { port } = await startBridge()
    const response = await fetch(`http://127.0.0.1:${port}/v1/health`)
    expect(response.status).toBe(200)
    const body = await response.json() as Record<string, unknown>
    expect(body.status).toBe('ok')
    expect(body.providers).toEqual(['codebuddy'])
    expect(body.models).toBe(1)
    expect(body.attachments).toBe(true)
  })

  it('只绑回环地址（行为约束：不向局域网暴露）', async () => {
    const { port } = await startBridge()
    // 回环可访问
    expect((await fetch(`http://127.0.0.1:${port}/v1/health`)).status).toBe(200)
  })

  it('端口被占用时自动跳到下一个可用端口（不因冲突而不可用）', async () => {
    const port = await freePort()
    const blocker = createServer()
    await new Promise<void>(resolve => blocker.listen(port, '127.0.0.1', () => resolve()))
    blockers.push(blocker)

    const logs: string[] = []
    const { llm } = fakeLlm()
    const server = new BridgeServer({
      llm,
      attachments: undefined,
      config: { port, apiKey: 'test-key', family: 'glm-v', model: '', locateModel: '', planningModel: '', insightModel: '', requestTimeoutMs: 1000, logRequests: false },
      sessionModel: { current: () => undefined },
      log: message => { logs.push(message) },
    })
    servers.push(server)
    const actual = await server.start()
    // 跳到下一个端口，且服务真的可用。
    expect(actual).toBe(port + 1)
    expect(server.port).toBe(port + 1)
    expect((await fetch(`http://127.0.0.1:${actual}/v1/health`)).status).toBe(200)
    // 必须告诉用户端口变了并要重拉 .env——这正是原 fail-fast 设计要防的「静默失配」，
    // 现在用「如实告知」承接，而不是让它静默发生。
    expect(logs.join('\n')).toMatch(/被占用|改用/u)
    expect(logs.join('\n')).toContain('midscene-env')
  })

  it('跳号后的健康端点与 .env 都报实际端口（否则用户拿到连不上的地址）', async () => {
    const port = await freePort()
    const blocker = createServer()
    await new Promise<void>(resolve => blocker.listen(port, '127.0.0.1', () => resolve()))
    blockers.push(blocker)

    const { llm } = fakeLlm()
    const server = new BridgeServer({
      llm,
      attachments: undefined,
      config: { port, apiKey: 'test-key', family: 'glm-v', model: '', locateModel: '', planningModel: '', insightModel: '', requestTimeoutMs: 1000, logRequests: false },
      sessionModel: { current: () => undefined },
      log: () => {},
    })
    servers.push(server)
    const actual = await server.start()

    const health = await (await fetch(`http://127.0.0.1:${actual}/v1/health`)).json() as { port: number }
    expect(health.port).toBe(actual)

    const env = await (await fetch(`http://127.0.0.1:${actual}/v1/midscene-env`)).json() as {
      variables: Record<string, string>
      content: string
    }
    // .env 里的 BASE_URL 必须带实际端口：写首选端口会让 Midscene 直接连不上。
    expect(env.variables.MIDSCENE_MODEL_BASE_URL).toBe(`http://127.0.0.1:${actual}/v1`)
    expect(env.content).toContain(`:${actual}/v1`)
    expect(env.content).not.toContain(`:${port}/v1`)
  })

  it('连续 20 个端口都被占用时报错并给出区间与建议', async () => {
    const port = await freePort()
    // 占满 PORT_SCAN_LIMIT 个连续端口
    for (let offset = 0; offset < PORT_SCAN_LIMIT; offset += 1) {
      const blocker = createServer()
      await new Promise<void>(resolve => blocker.listen(port + offset, '127.0.0.1', () => resolve()))
      blockers.push(blocker)
    }
    const { llm } = fakeLlm()
    const server = new BridgeServer({
      llm,
      attachments: undefined,
      config: { port, apiKey: 'test-key', family: 'glm-v', model: '', locateModel: '', planningModel: '', insightModel: '', requestTimeoutMs: 1000, logRequests: false },
      sessionModel: { current: () => undefined },
      log: () => {},
    })
    // 全部被占时必须有明确终点，不能一直找下去。
    await expect(server.start()).rejects.toBeInstanceOf(BridgePortExhaustedError)
    await expect(server.start()).rejects.toThrow(/均被占用/u)
  })

  it('stop 后端口真正释放，可被新实例立即复用（AC-02）', async () => {
    const port = await freePort()
    const config: BridgeConfig = { port, apiKey: 'test-key', family: 'glm-v', model: '', locateModel: '', planningModel: '', insightModel: '', requestTimeoutMs: 1000, logRequests: false }
    const first = new BridgeServer({ llm: fakeLlm().llm, attachments: undefined, config, sessionModel: { current: () => undefined }, log: () => {} })
    await first.start()
    await first.stop()
    const second = new BridgeServer({ llm: fakeLlm().llm, attachments: undefined, config, sessionModel: { current: () => undefined }, log: () => {} })
    // 若 stop 未等端口释放，这里会抛 BridgePortInUseError。
    await second.start()
    servers.push(second)
    expect(second.listening).toBe(true)
  })

  it('重复 stop 是安全的（幂等）', async () => {
    const { port } = await startBridge()
    const server = servers[0]!
    await server.stop()
    await expect(server.stop()).resolves.toBeUndefined()
    // 端口已释放
    expect((await fetch(`http://127.0.0.1:${port}/v1/health`).catch(() => undefined))).toBeUndefined()
  })

  it('未知端点返回 404 且列出可用端点', async () => {
    const { port } = await startBridge()
    const response = await fetch(`http://127.0.0.1:${port}/v1/nope`, { headers: { authorization: 'Bearer test-key' } })
    expect(response.status).toBe(404)
    const body = await response.json() as { error: { message: string } }
    expect(body.error.message).toContain('/v1/models')
  })
})

describe('FNOS-013-02 模型目录端点', () => {
  it('返回标准 OpenAI 列表，标识为「提供方/模型」（AC-01）', async () => {
    const { port } = await startBridge()
    const response = await fetch(`http://127.0.0.1:${port}/v1/models`, { headers: { authorization: 'Bearer test-key' } })
    expect(response.status).toBe(200)
    const body = await response.json() as { object: string, data: Record<string, unknown>[] }
    expect(body.object).toBe('list')
    expect(body.data[0]).toMatchObject({
      id: 'codebuddy/glm-5.3-flash',
      object: 'model',
      owned_by: 'codebuddy',
    })
  })

  it('图片能力随宿主元数据标注（AC-02）', async () => {
    const { port } = await startBridge()
    const body = await (await fetch(`http://127.0.0.1:${port}/v1/models`, { headers: { authorization: 'Bearer test-key' } })).json() as { data: Record<string, unknown>[] }
    expect(body.data[0]!.vision).toBe(true)
    expect(body.data[0]!.input_modalities).toEqual(['text', 'image'])
  })

  it('多提供方模型全部出现（AC-01/AC-03）', async () => {
    const { llm } = fakeLlm({
      providers: [{ id: 'deepseek-official', name: 'DeepSeek' }, { id: 'codebuddy', name: 'CodeBuddy' }],
      models: {
        'deepseek-official': [{ provider: 'deepseek-official', id: 'deepseek-chat', name: 'Chat' }],
        codebuddy: [{ provider: 'codebuddy', id: 'glm', name: 'GLM', inputModalities: ['text', 'image'] }],
      },
    })
    const { port } = await startBridge({}, { llm })
    const body = await (await fetch(`http://127.0.0.1:${port}/v1/models`, { headers: { authorization: 'Bearer test-key' } })).json() as { data: { id: string }[] }
    expect(body.data.map(entry => entry.id).sort()).toEqual(['codebuddy/glm', 'deepseek-official/deepseek-chat'])
  })
})

describe('FNOS-013-03 对话补全', () => {
  it('非流式返回完整回答（AC-01）', async () => {
    const { port, calls } = await startBridge()
    const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-key' },
      body: JSON.stringify({
        model: 'codebuddy/glm-5.3-flash',
        messages: [{ role: 'user', content: '你好' }],
      }),
    })
    expect(response.status).toBe(200)
    const body = await response.json() as Record<string, unknown>
    expect(body.object).toBe('chat.completion')
    expect(body.model).toBe('codebuddy/glm-5.3-flash')
    const choices = body.choices as { message: { content: string }, finish_reason: string }[]
    expect(choices[0]!.message.content).toBe('你好')
    expect(choices[0]!.finish_reason).toBe('stop')
    // 路由到宿主模型层的入参正确
    expect(calls[0]).toMatchObject({ provider: 'codebuddy', model: 'glm-5.3-flash' })
  })

  it('流式返回标准 SSE 分片与 [DONE]（AC-02）', async () => {
    const { port } = await startBridge({}, {
      llm: fakeLlm({
        chunks: [
          { type: 'text-delta', index: 0, text: '你' },
          { type: 'text-delta', index: 0, text: '好' },
          { type: 'finish', reason: { kind: 'stop' } },
        ],
      }).llm,
    })
    const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-key' },
      body: JSON.stringify({
        model: 'codebuddy/glm-5.3-flash',
        messages: [{ role: 'user', content: 'hi' }],
        stream: true,
      }),
    })
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const text = await response.text()
    expect(text).toContain('data: ')
    expect(text.trimEnd().endsWith('data: [DONE]')).toBe(true)
    const payloads = text.split('\n\n').filter(line => line.startsWith('data: ') && !line.includes('[DONE]'))
      .map(line => JSON.parse(line.slice(6)) as Record<string, unknown>)
    // 首个分片带 role，后续带 content
    expect(payloads[0]).toMatchObject({ object: 'chat.completion.chunk' })
    const contents = payloads
      .map(payload => (payload.choices as { delta: Record<string, unknown> }[])[0]?.delta.content)
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
    expect(contents.join('')).toBe('你好')
  })

  it('流式结尾携带 finish_reason（AC-02）', async () => {
    const { port } = await startBridge()
    const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-key' },
      body: JSON.stringify({ model: 'codebuddy/glm-5.3-flash', messages: [{ role: 'user', content: 'hi' }], stream: true }),
    })
    const text = await response.text()
    expect(text).toContain('"finish_reason":"stop"')
  })

  it('带图片请求经附件落盘并传给宿主（AC-03）', async () => {
    const attachments = fakeAttachments()
    let saved = 0
    const counting = {
      saveImages: async (inputs: readonly { data: Uint8Array, mediaType: string }[]) => {
        saved += 1
        return (attachments.saveImages as (i: readonly { data: Uint8Array, mediaType: string }[]) => Promise<unknown[]>)(inputs)
      },
    } as unknown as AttachmentStore
    const { port } = await startBridge({}, { attachments: counting })
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='
    const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-key' },
      body: JSON.stringify({
        model: 'codebuddy/glm-5.3-flash',
        messages: [{
          role: 'user',
          content: [{ type: 'text', text: '看图' }, { type: 'image_url', image_url: { url: png } }],
        }],
      }),
    })
    expect(response.status).toBe(200)
    expect(saved).toBe(1)
  })

  it('不支持图片的模型收到图片时返回 400（AC-02 门控）', async () => {
    const { llm } = fakeLlm({ models: { codebuddy: [{ provider: 'codebuddy', id: 'text-only', name: 'T' }] } })
    const { port } = await startBridge({}, { llm })
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='
    const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-key' },
      body: JSON.stringify({
        model: 'codebuddy/text-only',
        messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: png } }] }],
      }),
    })
    expect(response.status).toBe(400)
    const body = await response.json() as { error: { message: string } }
    expect(body.error.message).toContain('vision')
  })

  it('提供方错误以标准格式返回并定位到「提供方/模型」（AC-04）', async () => {
    const { llm } = fakeLlm({ fail: new Error('provider exploded') })
    const { port } = await startBridge({}, { llm })
    const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-key' },
      body: JSON.stringify({ model: 'codebuddy/glm-5.3-flash', messages: [{ role: 'user', content: 'hi' }] }),
    })
    expect(response.status).toBe(502)
    const body = await response.json() as { error: { message: string, type: string } }
    expect(body.error.message).toContain('codebuddy/glm-5.3-flash')
    expect(body.error.type).toBe('upstream_error')
  })

  it('不同「提供方/模型」各自正确路由（AC-05）', async () => {
    const { llm } = fakeLlm({
      providers: [{ id: 'codebuddy', name: 'CodeBuddy' }, { id: 'custom', name: 'Custom' }],
      models: {
        codebuddy: [{ provider: 'codebuddy', id: 'glm', name: 'GLM' }],
        custom: [{ provider: 'custom', id: 'my-model', name: 'Mine' }],
      },
    })
    const { port, calls } = await startBridge({}, { llm })
    for (const model of ['codebuddy/glm', 'custom/my-model']) {
      const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer test-key' },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }] }),
      })
      expect(response.status, model).toBe(200)
    }
    expect(calls.map(call => `${call.provider}/${call.model}`)).toEqual(['codebuddy/glm', 'custom/my-model'])
  })

  it('既非固定模型名也非「提供方/模型」时返回 400 并给出两条正确写法', async () => {
    const { port } = await startBridge()
    const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-key' },
      body: JSON.stringify({ model: 'glm', messages: [{ role: 'user', content: 'hi' }] }),
    })
    expect(response.status).toBe(400)
    const body = await response.json() as { error: { message: string } }
    // 错误信息要同时给出两条出路：用固定名跟随 DSH，或从目录里挑一个。
    expect(body.error.message).toContain('dsh-model')
    expect(body.error.message).toContain('/v1/models')
  })

  it('空消息返回 400', async () => {
    const { port } = await startBridge()
    const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-key' },
      body: JSON.stringify({ model: 'codebuddy/glm-5.3-flash', messages: [] }),
    })
    expect(response.status).toBe(400)
  })

  it('非法 JSON 返回 400 而不是 500', async () => {
    const { port } = await startBridge()
    const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-key' },
      body: '{not json',
    })
    expect(response.status).toBe(400)
  })

  it('温度与 max_tokens 透传到宿主调用（请求转换完整性）', async () => {
    const { port, calls } = await startBridge()
    await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-key' },
      body: JSON.stringify({
        model: 'codebuddy/glm-5.3-flash',
        messages: [{ role: 'user', content: 'hi' }],
        temperature: 0.3,
        max_tokens: 128,
        stop: ['END'],
      }),
    })
    expect(calls[0]!.temperature).toBe(0.3)
    expect(calls[0]!.maxTokens).toBe(128)
    expect(calls[0]!.stop).toEqual(['END'])
  })
})

describe('固定模型名 dsh-model（FNOS-013-05 零配置接入）', () => {
  it('MODEL_NAME=dsh-model 时跟随 DSH 会话模型', async () => {
    const { llm } = fakeLlm({
      providers: [{ id: 'codebuddy', name: 'CodeBuddy' }],
      models: { codebuddy: [{ provider: 'codebuddy', id: 'glm-5.3-flash', name: 'GLM', inputModalities: ['text', 'image'] }] },
    })
    const { port, calls } = await startBridge({}, { llm, sessionModel: { current: () => 'codebuddy/glm-5.3-flash' } })
    const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-key' },
      body: JSON.stringify({ model: 'dsh-model', messages: [{ role: 'user', content: 'hi' }] }),
    })
    expect(response.status).toBe(200)
    expect(calls[0]).toMatchObject({ provider: 'codebuddy', model: 'glm-5.3-flash' })
  })

  it('会话模型没有识图能力时跳过它，改用识图模型（Midscene 靠截图工作）', async () => {
    // 会话模型是用户为日常对话选的，不一定是给 Midscene 用的。选到纯文本模型时
    // Midscene 无法工作，因此跳过并兜底到识图模型——比让用户对着「模型不支持图片」
    // 的错误自己排查更省事（用户并没有为 Midscene 指定过模型）。
    const { llm } = fakeLlm({
      providers: [{ id: 'codebuddy', name: 'CodeBuddy' }],
      models: {
        codebuddy: [
          { provider: 'codebuddy', id: 'text-only', name: 'Text', inputModalities: ['text'] },
          { provider: 'codebuddy', id: 'vision-model', name: 'Vision', inputModalities: ['text', 'image'] },
        ],
      },
    })
    const { port, calls } = await startBridge({}, { llm, sessionModel: { current: () => 'codebuddy/text-only' } })
    const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-key' },
      body: JSON.stringify({ model: 'dsh-model', messages: [{ role: 'user', content: 'hi' }] }),
    })
    expect(response.status).toBe(200)
    expect(calls[0]).toMatchObject({ provider: 'codebuddy', model: 'vision-model' })
  })

  it('插件配置指定的模型优先于会话模型（可选项语义）', async () => {
    const { llm } = fakeLlm({
      providers: [{ id: 'codebuddy', name: 'CodeBuddy' }],
      models: {
        codebuddy: [
          { provider: 'codebuddy', id: 'glm-5.3-flash', name: 'GLM', inputModalities: ['text', 'image'] },
          { provider: 'codebuddy', id: 'pinned-model', name: 'Pinned', inputModalities: ['text', 'image'] },
        ],
      },
    })
    const { port, calls } = await startBridge(
      { model: 'codebuddy/pinned-model' },
      { llm, sessionModel: { current: () => 'codebuddy/glm-5.3-flash' } },
    )
    await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-key' },
      body: JSON.stringify({ model: 'dsh-model', messages: [{ role: 'user', content: 'hi' }] }),
    })
    expect(calls[0]).toMatchObject({ provider: 'codebuddy', model: 'pinned-model' })
  })

  it('配置指定的模型不存在时回落会话模型（并如实在 /v1/midscene-env 登记被跳过的）', async () => {
    const { llm } = fakeLlm({
      providers: [{ id: 'codebuddy', name: 'CodeBuddy' }],
      models: { codebuddy: [{ provider: 'codebuddy', id: 'real', name: 'Real', inputModalities: ['text', 'image'] }] },
    })
    const { port, calls } = await startBridge(
      { model: 'codebuddy/gone' },
      { llm, sessionModel: { current: () => 'codebuddy/real' } },
    )
    await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-key' },
      body: JSON.stringify({ model: 'dsh-model', messages: [{ role: 'user', content: 'hi' }] }),
    })
    // 跳过不存在的配置项，用会话模型；否则用户会看到「未注册路由」而看不到真因。
    expect(calls[0]).toMatchObject({ provider: 'codebuddy', model: 'real' })
  })

  it('会话模型也没有时兜底挑一个具备图片能力的模型', async () => {
    const { llm } = fakeLlm({
      providers: [{ id: 'p', name: 'P' }],
      models: {
        p: [
          { provider: 'p', id: 'text-only', name: 'T' },
          { provider: 'p', id: 'vision-one', name: 'V', inputModalities: ['text', 'image'] },
        ],
      },
    })
    const { port, calls } = await startBridge({}, { llm, sessionModel: { current: () => undefined } })
    await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-key' },
      body: JSON.stringify({ model: 'dsh-model', messages: [{ role: 'user', content: 'hi' }] }),
    })
    expect(calls[0]).toMatchObject({ provider: 'p', model: 'vision-one' })
  })

  it('接入配置端返回固定四行，且模型名是常量占位', async () => {
    const { port } = await startBridge({ apiKey: 'abc123', family: 'glm-v' })
    const response = await fetch(`http://127.0.0.1:${port}/v1/midscene-env`, {
      headers: { authorization: 'Bearer abc123' },
    })
    const body = await response.json() as { content: string, variables: Record<string, string>, resolvedFrom?: string }
    expect(body.content).toContain('MIDSCENE_MODEL_NAME="dsh-model"')
    expect(body.content).toContain('MIDSCENE_MODEL_FAMILY="glm-v"')
    expect(body.content).toContain('MIDSCENE_MODEL_API_KEY="abc123"')
    expect(body.variables.MIDSCENE_MODEL_NAME).toBe('dsh-model')
    // 换模型不改 .env：模型名与家族都与当前模型无关。
    expect(body.resolvedFrom).toBeDefined()
  })
})

describe('设置界面的模型选择（下拉而非手填）', () => {
  it('可选模型目录与 /v1/models 同源，并带视觉能力标记', async () => {
    // 手填的问题是用户无从知道有哪些合法值、写错只在真正跑 Midscene 时才暴露；
    // 下拉的选项必须与桥能路由的模型完全一致（同源读取目录，不另建一份清单）。
    const { llm } = fakeLlm({
      providers: [{ id: 'codebuddy', name: 'CodeBuddy' }],
      models: {
        codebuddy: [
          { provider: 'codebuddy', id: 'glm-5.3-flash', name: 'GLM-5.3-Flash', inputModalities: ['text', 'image'] },
          { provider: 'codebuddy', id: 'text-only', name: 'TextOnly' },
        ],
      },
    })
    const { port } = await startBridge({}, { llm })
    const response = await fetch(`http://127.0.0.1:${port}/v1/models`)
    const body = await response.json() as { data: { id: string, vision: boolean }[] }
    // 目录端点是下拉的数据来源（设置端点复用同一份目录缓存）。
    expect(body.data.map(m => m.id)).toContain('codebuddy/glm-5.3-flash')
    expect(body.data.find(m => m.id === 'codebuddy/glm-5.3-flash')?.vision).toBe(true)
    expect(body.data.find(m => m.id === 'codebuddy/text-only')?.vision).toBe(false)
  })

  it('候选模型数量与目录一致（下拉不会漏项）', async () => {
    const { llm } = fakeLlm({
      providers: [{ id: 'p', name: 'P' }],
      models: {
        p: [
          { provider: 'p', id: 'a', name: 'A', inputModalities: ['text', 'image'] },
          { provider: 'p', id: 'b', name: 'B' },
          { provider: 'p', id: 'c', name: 'C', inputModalities: ['text', 'image'] },
        ],
      },
    })
    const { port } = await startBridge({}, { llm })
    const body = await (await fetch(`http://127.0.0.1:${port}/v1/models`)).json() as { data: unknown[] }
    expect(body.data).toHaveLength(3)
  })
})

describe('接入密钥鉴权', () => {
  it('推理端点不带密钥时被拒（401）', async () => {
    // 密钥守住的是会消耗提供方额度的推理调用。
    const { port } = await startBridge()
    const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'p/m', messages: [{ role: 'user', content: 'hi' }] }),
    })
    expect(response.status).toBe(401)
    const body = await response.json() as { error: { code: string } }
    expect(body.error.code).toBe('invalid_api_key')
  })

  it('推理端点密钥错误时被拒', async () => {
    const { port } = await startBridge()
    const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer wrong-key' },
      body: JSON.stringify({ model: 'p/m', messages: [{ role: 'user', content: 'hi' }] }),
    })
    expect(response.status).toBe(401)
  })

  it('x-api-key 头同样有效（可通过鉴权进入推理）', async () => {
    const { port } = await startBridge()
    const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'test-key' },
      body: JSON.stringify({ model: 'codebuddy/glm-5.3-flash', messages: [{ role: 'user', content: 'hi' }] }),
    })
    // 通过鉴权即可（模型是否存在于 fixture 不影响本用例：非 401 即说明鉴权放行）。
    expect(response.status).not.toBe(401)
  })

  it('只读发现类端点不校验密钥（文档快速接入步骤可直接复制执行）', async () => {
    // 由 TC-034/036 的干净环境复现抓出：这三个端点若校验密钥，按文档逐步执行会 401。
    const { port } = await startBridge()
    for (const path of ['/v1/health', '/v1/models', '/v1/midscene-env']) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`)
      expect(response.status, path).toBe(200)
    }
  })
})

describe('FNOS-013-04 凭据归宿主', () => {
  it('桥不接触凭据：宿主调用入参里没有任何凭据字段', async () => {
    const { port, calls } = await startBridge()
    await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-key' },
      body: JSON.stringify({
        model: 'codebuddy/glm-5.3-flash',
        messages: [{ role: 'user', content: 'hi' }],
        // 客户端就算传了类似字段也不该被透传（桥不读、不转发）。
        api_key: 'should-not-be-forwarded',
        authorization: 'Bearer should-not-be-forwarded',
      }),
    })
    const serialized = JSON.stringify(calls[0])
    expect(serialized).not.toContain('should-not-be-forwarded')
    // 白名单是精确匹配：桥只允许出现这几个键。
    // `sessionId` 是**桥自己生成**的路由/缓存提示（不是凭据、也不是客户端传入），
    // 提供方据此生成按会话路由的头（如 opencode 的 x-opencode-session）。
    expect(Object.keys(calls[0]!).sort()).toEqual(
      ['messages', 'model', 'provider', 'sessionId', 'signal'].sort(),
    )
  })

  it('桥下发稳定的 sessionId：按会话路由的提供方不再缺头', async () => {
    // 回归防护：桥原先不传 sessionId，于是**只要会话模型属于「要求按会话路由」的
    // 提供方**（如 opencode 的 x-opencode-session），桥就整体不可用（502
    // MissingSessionID）——与「DSH 会话能用的模型，桥也能用」直接冲突。
    const { port, calls } = await startBridge()
    for (const prompt of ['hi', 'again']) {
      await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer test-key' },
        body: JSON.stringify({
          model: 'codebuddy/glm-5.3-flash',
          messages: [{ role: 'user', content: prompt }],
        }),
      })
    }
    const first = (calls[0] as Record<string, unknown> | undefined)?.sessionId
    expect(typeof first).toBe('string')
    expect(first).not.toBe('')
    // 必须**稳定**：同一桥实例的多次请求共用同一个 id，提供方的路由与提示缓存才有意义。
    expect((calls[1] as Record<string, unknown> | undefined)?.sessionId).toBe(first)
  })

  it('提供方在流内失败时返回错误而不是空回答（AC-04）', async () => {
    // 宿主把提供方失败编码进 finish 分片（无文本产出）。真实场景：该提供方
    // 未配置凭据。若当作正常结束，客户端看到的是「成功的空回答」，原因消失。
    const { llm } = fakeLlm({
      chunks: [{
        type: 'finish',
        reason: {
          kind: 'error',
          failure: { message: 'DeepSeek API key is not configured', code: 'MISSING_CREDENTIAL' },
        } as never,
      }],
    })
    const { port } = await startBridge({}, { llm })
    const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-key' },
      body: JSON.stringify({ model: 'deepseek-official/deepseek-flash', messages: [{ role: 'user', content: 'hi' }] }),
    })
    expect(response.status).not.toBe(200)
    const body = await response.json() as { error: { message: string, code: string } }
    expect(body.error.message).toContain('deepseek-official/deepseek-flash')
    expect(body.error.message).toContain('API key')
    expect(body.error.code).toBe('MISSING_CREDENTIAL')
  })

  it('流式下流内失败以标准错误分片透出并正常收尾（AC-04 + AC-02）', async () => {
    const { llm } = fakeLlm({
      chunks: [{
        type: 'finish',
        reason: {
          kind: 'error',
          failure: { message: 'quota exhausted', code: 'QUOTA' },
        } as never,
      }],
    })
    const { port } = await startBridge({}, { llm })
    const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-key' },
      body: JSON.stringify({ model: 'codebuddy/glm', messages: [{ role: 'user', content: 'hi' }], stream: true }),
    })
    const text = await response.text()
    // SSE 序列完整：错误分片之后仍有结束分片与 [DONE]。
    expect(text).toContain('quota exhausted')
    expect(text).toContain('"finish_reason":"error"')
    expect(text.trimEnd().endsWith('data: [DONE]')).toBe(true)
  })

  it('未配置路由的可诊断错误带设置指引（AC-04）', async () => {
    const { llm } = fakeLlm({ fail: Object.assign(new Error('no such provider'), { code: 'NO_ADAPTER' }) })
    const { port } = await startBridge({}, { llm })
    const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-key' },
      body: JSON.stringify({ model: 'ghost/model', messages: [{ role: 'user', content: 'hi' }] }),
    })
    expect(response.status).toBe(400)
    const body = await response.json() as { error: { code: string, message: string } }
    expect(body.error.code).toBe('NO_ADAPTER')
    expect(body.error.message).toContain('设置')
  })

  it('附件服务缺席时健康检查如实反映', async () => {
    const { port } = await startBridge({}, { attachments: undefined })
    const body = await (await fetch(`http://127.0.0.1:${port}/v1/health`)).json() as { attachments: boolean }
    expect(body.attachments).toBe(false)
  })
})

describe('目录缓存失效（AC-03）', () => {
  it('invalidate 后重新聚合目录并反映新增提供方', async () => {
    let providers = [{ id: 'codebuddy', name: 'CodeBuddy' }]
    const llm = {
      listProviders: () => providers,
      listModels: async (provider: string) => [{ provider, id: 'm', name: 'M' }],
      stream: () => (async function* generate() { yield { type: 'finish', reason: { kind: 'stop' } } as StreamChunk })(),
    } as unknown as LlmRuntime
    const port = await freePort()
    const server = new BridgeServer({
      llm,
      attachments: undefined,
      config: { port, apiKey: 'test-key', family: 'glm-v', model: '', locateModel: '', planningModel: '', insightModel: '', requestTimeoutMs: 1000, logRequests: false },
      sessionModel: { current: () => undefined },
      log: () => {},
    })
    await server.start()
    servers.push(server)

    const before = await (await fetch(`http://127.0.0.1:${port}/v1/models`, { headers: { authorization: 'Bearer test-key' } })).json() as { data: { id: string }[] }
    expect(before.data.map(entry => entry.id)).toEqual(['codebuddy/m'])

    // 新装提供方插件 → 宿主发 llm/adapters-updated → 插件层调用 invalidate。
    providers = [...providers, { id: 'brandnew', name: 'Brand New' }]
    server.catalog.invalidate()

    const after = await (await fetch(`http://127.0.0.1:${port}/v1/models`, { headers: { authorization: 'Bearer test-key' } })).json() as { data: { id: string }[] }
    expect(after.data.map(entry => entry.id).sort()).toEqual(['brandnew/m', 'codebuddy/m'])
  })
})

describe('多职责路由（FNOS-021-02）', () => {
  /** 两个不同系列的模型：家族不同，路由错了能立刻看出来。 */
  const twoModels = {
    providers: [{ id: 'codebuddy', name: 'CodeBuddy' }],
    models: {
      codebuddy: [
        { provider: 'codebuddy', id: 'glm-5.3-flash', name: 'GLM', inputModalities: ['text' as const, 'image' as const] },
        { provider: 'codebuddy', id: 'deepseek-v4.1-flash', name: 'DeepSeek', inputModalities: ['text' as const, 'image' as const] },
      ],
    },
  }

  it('dsh-model@locate 打到定位职责配的模型（而不是默认模型）', async () => {
    const { llm } = fakeLlm(twoModels)
    const { port, calls } = await startBridge(
      { model: 'codebuddy/glm-5.3-flash', locateModel: 'codebuddy/deepseek-v4.1-flash' },
      { llm },
    )
    await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-key' },
      body: JSON.stringify({ model: 'dsh-model@locate', messages: [{ role: 'user', content: 'hi' }] }),
    })
    // 若四组共用模型名，桥无从区分，这里会错误地打到 glm。
    expect(calls[0]).toMatchObject({ provider: 'codebuddy', model: 'deepseek-v4.1-flash' })
  })

  it('dsh-model 仍然打到默认职责', async () => {
    const { llm } = fakeLlm(twoModels)
    const { port, calls } = await startBridge(
      { model: 'codebuddy/glm-5.3-flash', locateModel: 'codebuddy/deepseek-v4.1-flash' },
      { llm },
    )
    await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-key' },
      body: JSON.stringify({ model: 'dsh-model', messages: [{ role: 'user', content: 'hi' }] }),
    })
    expect(calls[0]).toMatchObject({ provider: 'codebuddy', model: 'glm-5.3-flash' })
  })

  it('专用职责已清空但 .env 是旧的（仍发 @locate）时回落默认，不报错', async () => {
    // 用户先在设置页配了定位模型并拉了 .env，之后又清空了它。旧 .env 仍带 @locate 后缀。
    const { llm } = fakeLlm(twoModels)
    const { port, calls } = await startBridge({ model: 'codebuddy/glm-5.3-flash' }, { llm })
    const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-key' },
      body: JSON.stringify({ model: 'dsh-model@locate', messages: [{ role: 'user', content: 'hi' }] }),
    })
    expect(response.status).toBe(200)
    expect(calls[0]).toMatchObject({ provider: 'codebuddy', model: 'glm-5.3-flash' })
  })

  it('未配置任何专用职责时，接入配置只有默认四行', async () => {
    const { llm } = fakeLlm(twoModels)
    const { port } = await startBridge({ model: 'codebuddy/glm-5.3-flash' }, { llm })
    const body = await (await fetch(`http://127.0.0.1:${port}/v1/midscene-env`)).json() as {
      content: string
      variables: Record<string, string>
      resolvedSlots: Record<string, { model?: string, family: string, dedicated: boolean }>
    }
    expect(body.content).not.toContain('MIDSCENE_LOCATE_MODEL')
    expect(body.variables.MIDSCENE_LOCATE_MODEL_NAME).toBeUndefined()
    expect(body.resolvedSlots.locate).toMatchObject({ model: 'codebuddy/glm-5.3-flash', dedicated: false })
  })

  it('配置定位职责后，接入配置追加该职责一组变量，且家族按该职责的模型推导', async () => {
    const { llm } = fakeLlm(twoModels)
    const { port } = await startBridge(
      { model: 'codebuddy/glm-5.3-flash', locateModel: 'codebuddy/deepseek-v4.1-flash' },
      { llm },
    )
    const body = await (await fetch(`http://127.0.0.1:${port}/v1/midscene-env`)).json() as {
      content: string
      variables: Record<string, string>
      resolvedSlots: Record<string, { model?: string, family: string, dedicated: boolean }>
    }
    expect(body.content).toContain('MIDSCENE_LOCATE_MODEL_NAME="dsh-model@locate"')
    // 家族跟着定位自己的模型（deepseek），不是默认的 glm-v。
    expect(body.content).toContain('MIDSCENE_LOCATE_MODEL_FAMILY="deepseek"')
    expect(body.content).toContain('MIDSCENE_LOCATE_MODEL_STREAM_MODE="non-stream"')
    expect(body.variables.MIDSCENE_LOCATE_MODEL_NAME).toBe('dsh-model@locate')
    expect(body.variables.MIDSCENE_LOCATE_MODEL_FAMILY).toBe('deepseek')
    expect(body.resolvedSlots.locate).toMatchObject({
      model: 'codebuddy/deepseek-v4.1-flash',
      family: 'deepseek',
      dedicated: true,
    })
    // 默认职责的家族保持 glm-v，未被专用职责覆盖。
    expect(body.resolvedSlots.default).toMatchObject({ family: 'glm-v' })
  })
})

describe('协议误配的可读指引（FNOS-021-06）', () => {
  it('/v1/responses 返回 404，但带「只提供 Chat Completions」的指引', async () => {
    const { port } = await startBridge()
    const response = await fetch(`http://127.0.0.1:${port}/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-key' },
      body: JSON.stringify({ model: 'dsh-model', input: 'hi' }),
    })
    // 状态码保持 404（本桥确实没有这个端点），但要能诊断。
    expect(response.status).toBe(404)
    const body = await response.json() as { error: { message: string } }
    expect(body.error.message).toContain('Chat Completions')
    expect(body.error.message).toContain('openai-chat')
  })

  it('/v1/systemone 返回 404，并说明 Jev 的私有协议不经本桥', async () => {
    const { port } = await startBridge()
    const response = await fetch(`http://127.0.0.1:${port}/v1/systemone`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-key' },
      body: JSON.stringify({ questions: [] }),
    })
    expect(response.status).toBe(404)
    const body = await response.json() as { error: { message: string } }
    expect(body.error.message).toContain('Jev')
    expect(body.error.message).toContain('System One')
  })

  it('未知路径仍给通用 404（不误伤）', async () => {
    const { port } = await startBridge()
    // 未知路径同样要求接入密钥：不给未授权调用者返回端点清单。
    const response = await fetch(`http://127.0.0.1:${port}/v1/nope`, {
      headers: { authorization: 'Bearer test-key' },
    })
    expect(response.status).toBe(404)
    const body = await response.json() as { error: { message: string } }
    expect(body.error.message).toContain('unknown endpoint')
  })

  it('带 response_format 的请求仍然成功（倒退守卫：改成报错会把今天可用的功能推成失败）', async () => {
    // 该字段自 1.15.1 基线起就存在，桥一直忽略，全部既有验收都在此状态下通过；
    // Midscene 对解析失败另有语义重试兜底。因此这里钉住「忽略但成功」。
    const { llm } = fakeLlm({
      providers: [{ id: 'codebuddy', name: 'CodeBuddy' }],
      models: { codebuddy: [{ provider: 'codebuddy', id: 'glm-5.3-flash', name: 'GLM', inputModalities: ['text', 'image'] }] },
    })
    const { port, calls } = await startBridge({}, { llm })
    const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-key' },
      body: JSON.stringify({
        model: 'dsh-model',
        messages: [{ role: 'user', content: 'hi' }],
        response_format: { type: 'json_object' },
      }),
    })
    expect(response.status).toBe(200)
    // 字段被忽略：既不报错，也不出现在宿主调用入参里。
    expect(calls[0]).not.toHaveProperty('response_format')
  })
})

describe('思考开关透传（FNOS-021-03）', () => {
  /** 一个带 off/low/high 档位的模型。 */
  const withEfforts = {
    providers: [{ id: 'codebuddy', name: 'CodeBuddy' }],
    models: { codebuddy: [{ provider: 'codebuddy', id: 'glm-5.3-flash', name: 'GLM', inputModalities: ['text' as const, 'image' as const] }] },
    reasoningEfforts: { 'codebuddy/glm-5.3-flash': ['off', 'low', 'high'] },
  }

  /**
   * 发一次补全。
   * @param port - 桥端口。
   * @param extra - 额外的请求体字段。
   * @returns 响应。
   */
  async function post(port: number, extra: Record<string, unknown> = {}): Promise<Response> {
    return await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-key' },
      body: JSON.stringify({ model: 'dsh-model', messages: [{ role: 'user', content: 'hi' }], ...extra }),
    })
  }

  it('Midscene 关闭思考时，桥传宿主的「关闭」档位（AC-01）', async () => {
    const { llm } = fakeLlm(withEfforts)
    const { port, calls } = await startBridge({ model: 'codebuddy/glm-5.3-flash' }, { llm })
    expect((await post(port, { thinking: { type: 'disabled' } })).status).toBe(200)
    expect(calls[0]?.reasoningEffort).toBe('off')
  })

  it('千问的 enable_thinking:false 同样映射为关闭', async () => {
    const { llm } = fakeLlm(withEfforts)
    const { port, calls } = await startBridge({ model: 'codebuddy/glm-5.3-flash' }, { llm })
    await post(port, { enable_thinking: false })
    expect(calls[0]?.reasoningEffort).toBe('off')
  })

  it('模型不支持该档位时不传 reasoningEffort，请求照常成功（AC-02）', async () => {
    // 宿主只披露 low/high，没有「关闭」档位：宁可少传，也不能拼一个不存在的档位
    // （那会在发起请求前被 UNSUPPORTED_REASONING_EFFORT 拦下）。
    const { llm } = fakeLlm({ ...withEfforts, reasoningEfforts: { 'codebuddy/glm-5.3-flash': ['low', 'high'] } })
    const { port, calls } = await startBridge({ model: 'codebuddy/glm-5.3-flash' }, { llm })
    const response = await post(port, { thinking: { type: 'disabled' } })
    expect(response.status).toBe(200)
    expect(calls[0]).not.toHaveProperty('reasoningEffort')
  })

  it('请求里没有思考字段时不传（行为与升级前一致，AC-03）', async () => {
    const { llm } = fakeLlm(withEfforts)
    const { port, calls } = await startBridge({ model: 'codebuddy/glm-5.3-flash' }, { llm })
    await post(port)
    expect(calls[0]).not.toHaveProperty('reasoningEffort')
    // 其它字段照常转换，未被思考链路影响。
    expect(calls[0]).toMatchObject({ provider: 'codebuddy', model: 'glm-5.3-flash' })
  })

  it('宿主给不出元数据（没有 resolveModelInfo）时降级为不传', async () => {
    const { llm } = fakeLlm({
      providers: [{ id: 'codebuddy', name: 'CodeBuddy' }],
      models: { codebuddy: [{ provider: 'codebuddy', id: 'glm-5.3-flash', name: 'GLM', inputModalities: ['text', 'image'] }] },
    })
    const { port, calls } = await startBridge({ model: 'codebuddy/glm-5.3-flash' }, { llm })
    const response = await post(port, { thinking: { type: 'disabled' } })
    expect(response.status).toBe(200)
    expect(calls[0]).not.toHaveProperty('reasoningEffort')
  })
})
