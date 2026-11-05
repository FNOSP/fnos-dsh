import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex'
import { describe, expect, it } from 'vitest'
import { createCodexAdapter } from '../../src/host/adapter.ts'
import { CodexCredentialStore } from '../../src/host/store.ts'

describe('dsh-codex-auth-plugin model adapter', () => {
  it('exposes the provider-native Codex model catalog to dsh', async () => {
    const adapter = createCodexAdapter(new CodexCredentialStore('/tmp/dsh-codex-auth-test.json'), () => undefined)
    const models = await adapter.listModels('openai-codex')
    const providerCatalog = await openaiCodexProvider().getModels()

    // 模型 id 由 pi-ai 随版本更新（0.2.2 基线起为 gpt-5.6 / gpt-6 一系），
    // 因此断言与 provider 自身目录一致，而不是硬编码命名片段。
    expect(models.length).toBeGreaterThan(0)
    expect(models.map(model => model.id).sort()).toEqual(providerCatalog.map(model => model.id).sort())
    expect(models.every(model => model.name.length > 0)).toBe(true)
  })
})
