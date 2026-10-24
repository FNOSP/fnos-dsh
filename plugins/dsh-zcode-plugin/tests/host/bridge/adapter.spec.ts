import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'

import { ZCODE_PROVIDER, ZCODE_PROVIDER_NAME } from '../../../src/contracts/identity.ts'
import {
  bridgeDataDirOf,
  bridgeProviderId,
  bridgeWorkspacePath,
  ZCodeBridgeAdapter,
  type ZCodeBridgeAdapterOptions,
} from '../../../src/host/bridge/adapter.ts'

const tempRoots: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'zcode-adapter-spec-'))
  tempRoots.push(dir)
  return dir
}

interface AdapterHooks {
  readonly cliPath?: () => string | undefined
  readonly accountJwt?: () => Promise<string | undefined>
  readonly family?: () => 'bigmodel' | 'zai'
  readonly modelIds?: () => readonly string[]
}

/** 最小 options：标题分支不触发任何惰性依赖，目录/账号都是占位实现。 */
function createAdapter(hooks: AdapterHooks = {}): ZCodeBridgeAdapter {
  const options: ZCodeBridgeAdapterOptions = {
    dataDir: () => join(tmpdir(), 'zcode-adapter-spec-unused'),
    family: hooks.family ?? (() => 'bigmodel'),
    accountJwt: hooks.accountJwt ?? (async () => undefined),
    modelIds: hooks.modelIds ?? (() => []),
    logger: { info: () => {}, warn: () => {} },
    ...(hooks.cliPath === undefined ? {} : { cliPath: hooks.cliPath }),
  }
  return new ZCodeBridgeAdapter(options)
}

/** 一条 `purpose: 'session-title'` 请求；标题分支只用 messages 里的用户正文。 */
function titleRequest(text: string): GenerateOptions {
  return {
    provider: ZCODE_PROVIDER,
    model: 'GLM-5.3-Flash',
    purpose: 'session-title',
    messages: [{ role: 'user', content: [{ type: 'text', text }] }],
  }
}

async function collect(stream: AsyncIterable<StreamChunk>): Promise<readonly StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

/** 按位置取指定类型的 chunk；类型不符时给出可定位的失败信息。 */
function chunkAt<T extends StreamChunk['type']>(
  chunks: readonly StreamChunk[],
  index: number,
  type: T,
): Extract<StreamChunk, { type: T }> {
  const value = chunks[index]
  if (value === undefined) throw new Error(`缺少第 ${String(index)} 个 chunk（共 ${String(chunks.length)} 个）`)
  if (value.type !== type) {
    throw new Error(`第 ${String(index)} 个 chunk 类型应为 ${type}，实际为 ${value.type}`)
  }
  return value as Extract<StreamChunk, { type: T }>
}

afterEach(() => {
  for (const dir of tempRoots) rmSync(dir, { recursive: true, force: true })
  tempRoots.length = 0
})

describe('stream() 会话标题分支', () => {
  it('chunk 序列固定为 block-start → text-delta → block-end → usage → finish', async () => {
    const chunks = await collect(createAdapter().stream(titleRequest('帮我总结这次改动')))

    expect(chunks.map(chunk => chunk.type)).toEqual([
      'block-start',
      'text-delta',
      'block-end',
      'usage',
      'finish',
    ])
  })

  it('chunk 字段符合 DSH 流契约（index 0 / 文本块 / 零用量 / stop）', async () => {
    const chunks = await collect(createAdapter().stream(titleRequest('标题请求')))
    const title = '标题请求'

    expect(chunkAt(chunks, 0, 'block-start')).toEqual({
      type: 'block-start',
      index: 0,
      blockType: 'text',
    })
    expect(chunkAt(chunks, 1, 'text-delta')).toEqual({
      type: 'text-delta',
      index: 0,
      text: title,
    })
    expect(chunkAt(chunks, 2, 'block-end')).toEqual({
      type: 'block-end',
      index: 0,
      block: { type: 'text', text: title },
    })
    expect(chunkAt(chunks, 3, 'usage')).toEqual({
      type: 'usage',
      usage: { inputTokens: 0, outputTokens: 0 },
    })
    expect(chunkAt(chunks, 4, 'finish')).toEqual({
      type: 'finish',
      reason: { kind: 'stop' },
    })
  })

  it('标题会把连续空白压成单个空格', async () => {
    const chunks = await collect(createAdapter().stream(titleRequest('  你好\n\n世界\t！  ')))

    expect(chunkAt(chunks, 1, 'text-delta').text).toBe('你好 世界 ！')
  })

  it('标题截断到 24 个字符（不追加省略号）', async () => {
    const long = '一'.repeat(30)
    const chunks = await collect(createAdapter().stream(titleRequest(long)))

    expect(chunkAt(chunks, 1, 'text-delta').text).toBe('一'.repeat(24))
  })

  it('取不到人话时交回默认标题（不产出文本块，也不造垃圾标题）', async () => {
    const chunks = await collect(createAdapter().stream({
      provider: ZCODE_PROVIDER,
      model: 'GLM-5.3-Flash',
      purpose: 'session-title',
      messages: [{ role: 'user', content: [{ type: 'reasoning', text: '只有思考，没有正文' }] }],
    }))

    // 没有可用的标题来源：宁可让会话保留默认标题，也不要拿英文指令凑一个。
    expect(chunks.some((chunk) => chunk.type === 'text-delta')).toBe(false)
    expect(chunks.some((chunk) => chunk.type === 'finish')).toBe(true)
  })

  it('标题分支完全不触碰 CLI / 账号 / 模型目录等依赖（不启动子进程、不发协议请求）', async () => {
    const cliPath = vi.fn(() => '/nonexistent/zcode.cjs')
    const accountJwt = vi.fn(async () => undefined)
    const family = vi.fn((): 'bigmodel' | 'zai' => 'bigmodel')
    const modelIds = vi.fn((): readonly string[] => [])
    const adapter = createAdapter({ cliPath, accountJwt, family, modelIds })

    await collect(adapter.stream(titleRequest('本地标题')))

    expect(cliPath, '标题分支不应探测 CLI').not.toHaveBeenCalled()
    expect(accountJwt, '标题分支不应读取账号').not.toHaveBeenCalled()
    expect(family, '标题分支不应解析账号家族').not.toHaveBeenCalled()
    expect(modelIds, '标题分支不应读取模型目录').not.toHaveBeenCalled()
    expect(adapter.sessionModel('session-1')).toBeUndefined()
    expect(adapter.channel()).toBeUndefined()
  })
})

describe('availability()', () => {
  it('未找到 CLI 时不可用，并给出可定位的原因', () => {
    const adapter = createAdapter({
      cliPath: () => join(tmpdir(), 'zcode-adapter-spec-missing', 'zcode.cjs'),
    })
    const availability = adapter.availability()

    expect(availability.ready).toBe(false)
    const reason = availability.reason ?? ''
    expect(reason).toContain('未找到')
    expect(reason).toContain('zcode.cjs')
    expect(reason, '原因里应提示可用环境变量指定路径').toContain('DSH_ZCODE_CLI')
  })

  it('CLI 存在时可用且不返回原因', () => {
    const cli = join(tempDir(), 'zcode.cjs')
    writeFileSync(cli, '')
    const adapter = createAdapter({ cliPath: () => cli })

    expect(adapter.availability()).toEqual({ ready: true })
  })

  it('cliPath() 返回解析后的绝对路径', () => {
    const cli = join(tempDir(), 'zcode.cjs')
    writeFileSync(cli, '')
    const adapter = createAdapter({ cliPath: () => cli })

    expect(adapter.cliPath()).toBe(resolve(cli))
  })

  it('未显式配置时只可能自动探测到真实存在的文件', () => {
    const adapter = createAdapter()
    const detected = adapter.cliPath()

    expect(detected === undefined || existsSync(detected)).toBe(true)
  })
})

describe('路由元信息与导出辅助函数', () => {
  it('providerInfo 固定返回 ZCode 展示名，id 与入参路由一致', () => {
    const adapter = createAdapter()

    expect(adapter.providerInfo('dsh-zcode')).toEqual({
      id: 'dsh-zcode',
      name: ZCODE_PROVIDER_NAME,
    })
    expect(adapter.providerInfo('another-route')).toEqual({
      id: 'another-route',
      name: ZCODE_PROVIDER_NAME,
    })
  })

  it('bridgeProviderId 按家族生成注入的 provider id', () => {
    expect(bridgeProviderId('bigmodel')).toBe('account:bigmodel-start-plan')
    expect(bridgeProviderId('zai')).toBe('account:zai-start-plan')
  })

  it('workspace 与数据目录辅助函数保持 <dataDir>/workspace 布局', () => {
    expect(bridgeWorkspacePath('/data/zcode-bridge')).toBe('/data/zcode-bridge/workspace')
    expect(bridgeDataDirOf('/data/zcode-bridge')).toBe('/data/zcode-bridge')
  })

  it('dispose() 可重复调用，未启动客户端时不抛错', () => {
    const adapter = createAdapter()

    expect(() => {
      adapter.dispose()
      adapter.dispose()
    }).not.toThrow()
    // 释放后路由元信息仍可回答（静态信息，不依赖子进程）。
    expect(adapter.providerInfo(ZCODE_PROVIDER).name).toBe(ZCODE_PROVIDER_NAME)
  })
})
