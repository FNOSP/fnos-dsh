import { describe, expect, it } from 'vitest'
import { normalizePatchForTest, statusSnapshotForTest } from './helpers/settings-routes-harness.ts'

/**
 * 接入设置端点的字段校验（FNOS-013-05/14 的设置页）。
 *
 * 只测纯函数部分（快照组装与写入校验）：端点的 HTTP 层依赖 `ctx.webServer`，
 * 由 DSH 宿主提供，包级测试里用纯函数覆盖业务规则更有价值——那里才是真正会
 * 出错的地方（白名单、列表归一化、目录读取失败时的退化）。
 */

const config = {
  port: 8787,
  apiKey: 'k'.repeat(32),
  family: 'glm-v',
  models: [] as readonly string[],
  requestTimeoutMs: 1000,
  logRequests: false,
}

describe('设置快照', () => {
  it('包含固定模型名、基址与 .env 文本（界面据此渲染，无需二次拼装）', async () => {
    const snapshot = await statusSnapshotForTest(
      { readConfig: () => config, listModels: async () => [] },
    ) as { fixedModelName: string, baseUrl: string, envFile: string, families: string[] }
    expect(snapshot.fixedModelName).toBe('dsh-model')
    expect(snapshot.baseUrl).toBe('http://127.0.0.1:8787/v1')
    expect(snapshot.envFile).toContain('MIDSCENE_MODEL_NAME="dsh-model"')
    // 家族候选必须是 Midscene 白名单，否则用户会在运行时才踩 Invalid MIDSCENE_MODEL_FAMILY。
    expect(snapshot.families).toContain('glm-v')
    expect(snapshot.families).not.toContain('dsh-model')
  })

  it('目录读取失败时快照仍生成（设置页要能打开）', async () => {
    const snapshot = await statusSnapshotForTest({
      readConfig: () => config,
      listModels: async () => { throw new Error('boom') },
    }) as { availableModels: unknown[] }
    expect(snapshot.availableModels).toEqual([])
  })

  it('密钥为空时快照给出一个可用密钥（首装自举）', async () => {
    const snapshot = await statusSnapshotForTest({
      readConfig: () => ({ ...config, apiKey: '' }),
      listModels: async () => [],
    }) as { apiKey: string, envFile: string }
    expect(snapshot.apiKey).toMatch(/^[0-9a-f]{32}$/u)
    expect(snapshot.envFile).toContain(snapshot.apiKey)
  })
})

describe('写入校验', () => {
  it('拒绝不在白名单内的家族（在配置面就拦住，不等运行时）', () => {
    expect(() => normalizePatchForTest({ family: 'dsh-model' }))
      .toThrow(/unknown family/u)
    expect(normalizePatchForTest({ family: 'gpt-6' })).toEqual({ family: 'gpt-6' })
  })

  it('模型列表去空白项并拒绝非字符串', () => {
    expect(normalizePatchForTest({ models: ['a/b', '  ', ' c/d '] })).toEqual({ models: ['a/b', 'c/d'] })
    expect(() => normalizePatchForTest({ models: [1] })).toThrow(/provider\/model/u)
  })

  it('无受支持字段时返回空补丁（调用方据此回 400）', () => {
    expect(normalizePatchForTest({ action: 'update' })).toEqual({})
    expect(normalizePatchForTest({ family: 123, models: 'nope' })).toEqual({})
  })
})
