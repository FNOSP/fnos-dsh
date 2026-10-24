import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { buildCatalog } from '../../src/host/catalog.ts'
import { apiFromPackage } from '../../src/host/catalog.ts'

/**
 * 与官方 opencode CLI 的协议映射对齐。
 *
 * 参考快照取自官方 `opencode` 1.19.4 的 `/provider` 输出（2026-10-24 采集），
 * 只保留 opencode / opencode-go 两个供应商里声明了包的模型。断言我们为同一
 * 模型选出的协议族与官方一致，并覆盖「同一模型在两个 plan 协议不同」的场景。
 */
const CLI_REFERENCE: ReadonlyArray<readonly [string, string, string]> = [
  ['zen', 'grok-build-0.1', 'openai-responses'],
  ['zen', 'grok-4.6', 'openai-responses'],
  ['zen', 'claude-haiku-5-5', 'anthropic-messages'],
  ['zen', 'qwen3.6-plus', 'anthropic-messages'],
  ['zen', 'big-pickle', 'openai-completions'],
  ['zen', 'minimax-m3', 'openai-completions'],
  ['zen', 'minimax-m2.7', 'openai-completions'],
  ['zen', 'qwen3.8-max', 'openai-completions'],
  ['go', 'grok-4.6', 'openai-responses'],
  ['go', 'claude-haiku-5-5', 'anthropic-messages'],
  ['go', 'minimax-m3', 'anthropic-messages'],
  ['go', 'qwen3.8-max', 'anthropic-messages'],
  ['go', 'qwen3.6-plus', 'anthropic-messages'],
  ['go', 'mimo-v2.6-flash', 'openai-completions'],
  ['go', 'glm-5.3', 'openai-completions'],
]

async function fixture(name: string): Promise<unknown> {
  const url = new URL(`../fixtures/${name}`, import.meta.url)
  return JSON.parse(await readFile(url, 'utf8'))
}

describe('与官方 CLI 的协议映射对齐', () => {
  it('同一模型在两个 plan 的协议可以不同，各自独立解析', async () => {
    const catalog = await fixture('catalog.json')
    const [zenRoster, goRoster] = await Promise.all([fixture('zen-models.json'), fixture('go-models.json')])
    const models = buildCatalog({ catalog, zenRoster, goRoster }).models
    const pick = (plan: string, id: string): string | undefined =>
      models.find(model => model.plan === plan && model.id === id)?.api
    for (const [plan, id, api] of CLI_REFERENCE) {
      expect(`${plan}/${id}=${pick(plan, id)}`).toBe(`${plan}/${id}=${api}`)
    }
  })

  it('同一模型跨 plan 协议不同时，端点也各自正确', async () => {
    const catalog = await fixture('catalog.json')
    const [zenRoster, goRoster] = await Promise.all([fixture('zen-models.json'), fixture('go-models.json')])
    const models = buildCatalog({ catalog, zenRoster, goRoster }).models
    const find = (plan: string, id: string): (typeof models)[number] | undefined =>
      models.find(model => model.plan === plan && model.id === id)
    expect(find('zen', 'minimax-m3')?.baseURL).toBe('https://opencode.ai/inference/openai/v1')
    expect(find('go', 'minimax-m3')?.baseURL).toBe('https://opencode.ai/inference/go/anthropic')
  })

  it('Console 的 aisdk 包名不会覆盖公开目录的逐模型 npm', async () => {
    const catalog = await fixture('catalog.json')
    const [zenRoster, goRoster] = await Promise.all([fixture('zen-models.json'), fixture('go-models.json')])
    const consoleConfig = {
      providers: {
        opencode: {
          models: {
            'grok-build-0.1': { package: 'aisdk:@ai-sdk/openai-compatible' },
          },
        },
      },
    }
    const models = buildCatalog({ catalog, consoleConfig, zenRoster, goRoster }).models
    expect(models.find(model => model.plan === 'zen' && model.id === 'grok-build-0.1')?.api).toBe('openai-responses')
  })

  it('AI SDK 包名映射覆盖四种协议', () => {
    expect(apiFromPackage('@ai-sdk/openai')).toBe('openai-responses')
    expect(apiFromPackage('@ai-sdk/openai-compatible')).toBe('openai-completions')
    expect(apiFromPackage('@ai-sdk/anthropic')).toBe('anthropic-messages')
    expect(apiFromPackage('@ai-sdk/google')).toBe('google-generative-ai')
    expect(apiFromPackage('aisdk:@ai-sdk/anthropic')).toBe('anthropic-messages')
    expect(apiFromPackage('@acme/unknown')).toBeUndefined()
  })
})
