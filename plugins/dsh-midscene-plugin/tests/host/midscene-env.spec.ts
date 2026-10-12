import { describe, expect, it } from 'vitest'
import { buildMidsceneEnv, inferMidsceneFamily, pickDefaultModel } from '../../src/host/midscene-env.ts'

/**
 * 接入配置自动推导（FNOS-013-05/13）。
 *
 * 这是「用户零配置」的实现核心：Midscene 强制要求四个模型环境变量，其中
 * `MIDSCENE_MODEL_FAMILY` 决定提示词模板与坐标解析协议。插件必须能把这些值
 * 算出来，用户才不会被迫去查官方文档、更不必准备任何第三方密钥。
 *
 * 家族推断**只给建议值、不猜**：推断不出时返回 undefined 并给出警告——错的
 * family 会让定位静默失准，比缺值更难排查。
 */

describe('inferMidsceneFamily', () => {
  it('识别官方支持的家族', () => {
    const cases: [string, string][] = [
      ['glm-5.3-flash', 'glm-v'],
      ['glm-4.6v', 'glm-v'],
      ['deepseek-flash', 'deepseek'],
      ['deepseek-v4-pro', 'deepseek'],
      ['gemini-3-flash', 'gemini'],
      ['qwen3.5-plus', 'qwen3'],
      ['doubao-seed-2-0-lite', 'doubao-seed'],
      ['kimi-k3', 'kimi3'],
      ['mimo-v2.6-pro', 'xiaomi-mimo'],
      ['gpt-6-luna', 'gpt-6'],
      ['gpt-5.6-terra', 'gpt-5'],
      ['autoglm-phone', 'auto-glm'],
      ['vlm-ui-tars-doubao-1.5', 'vlm-ui-tars-doubao-1.5'],
    ]
    for (const [model, family] of cases) {
      expect(inferMidsceneFamily({ id: model }), model).toBe(family)
    }
  })

  it('整个 GLM 系列归到 glm-v（实测 CodeBuddy 的 glm-5.3 声明了图片能力）', () => {
    // `glm-v` 是智谱视觉家族的协议名，不是「模型名必须含 V」。
    expect(inferMidsceneFamily({ id: 'codebuddy/glm-5.3-flash' })).toBe('glm-v')
    expect(inferMidsceneFamily({ id: 'glm-5v-turbo' })).toBe('glm-v')
    expect(inferMidsceneFamily({ id: 'x/glm-4.6v' })).toBe('glm-v')
  })

  it('gpt 按代次给不同家族', () => {
    expect(inferMidsceneFamily({ id: 'gpt-6-sol' })).toBe('gpt-6')
    expect(inferMidsceneFamily({ id: 'gpt-5.4' })).toBe('gpt-5')
    expect(inferMidsceneFamily({ id: 'gpt-4o' })).toBe('gpt-4')
  })

  it('kimi-k3 与 kimi-k2.6 用不同家族', () => {
    expect(inferMidsceneFamily({ id: 'kimi-k3' })).toBe('kimi3')
    expect(inferMidsceneFamily({ id: 'kimi-k2.6' })).toBe('kimi')
  })

  it('从「提供方/模型」标识与可读名两处匹配（id 是内部代号时靠 name）', () => {
    // 真实场景：CodeBuddy 的目录里 id 是代号、name 才带系列名。
    expect(inferMidsceneFamily({ id: 'codebuddy/hy3', name: 'Hunyuan-Turbos' })).toBeUndefined()
    expect(inferMidsceneFamily({ id: 'codebuddy/gpt-6-luna' })).toBe('gpt-6')
    expect(inferMidsceneFamily({ id: 'x/internal-1', name: 'GLM-5V Turbo' })).toBe('glm-v')
  })

  it('未知模型返回 undefined 而不是硬猜一个家族', () => {
    // 猜错的 family 会让坐标定位静默失准，比返回缺值危险得多。
    expect(inferMidsceneFamily({ id: 'some-unknown-model' })).toBeUndefined()
    expect(inferMidsceneFamily({ id: 'codebuddy/hy3', name: 'Hy3' })).toBeUndefined()
  })
})

describe('buildMidsceneEnv', () => {
  it('生成可直接写入 .env 的四个变量', () => {
    const env = buildMidsceneEnv({
      baseUrl: 'http://127.0.0.1:8787/v1',
      model: { id: 'codebuddy/glm-5.3-flash' },
    })
    expect(env.content).toContain('MIDSCENE_MODEL_BASE_URL="http://127.0.0.1:8787/v1"')
    expect(env.content).toContain('MIDSCENE_MODEL_API_KEY="local-bridge"')
    expect(env.content).toContain('MIDSCENE_MODEL_NAME="codebuddy/glm-5.3-flash"')
    expect(env.content).toContain('MIDSCENE_MODEL_FAMILY="glm-v"')
    expect(env.familyWarning).toBeUndefined()
  })

  it('API key 恒为占位值，不含任何真实凭据', () => {
    const env = buildMidsceneEnv({ baseUrl: 'http://127.0.0.1:8787/v1', model: { id: 'codebuddy/glm' } })
    expect(env.variables.MIDSCENE_MODEL_API_KEY).toBe('local-bridge')
    // 桥不做鉴权、不转发凭据，配置里不该出现任何疑似密钥的内容。
    expect(env.content).not.toMatch(/sk-|your-|-key"/u)
  })

  it('模型名用「提供方/模型」全称（不是厂商模型名）', () => {
    const env = buildMidsceneEnv({ baseUrl: 'http://127.0.0.1:8787/v1', model: { id: 'codebuddy/glm-5.3-flash' } })
    expect(env.variables.MIDSCENE_MODEL_NAME).toBe('codebuddy/glm-5.3-flash')
  })

  it('未匹配到家族时不写该变量并给出警告', () => {
    const env = buildMidsceneEnv({ baseUrl: 'http://127.0.0.1:8787/v1', model: { id: 'unknown/model' } })
    expect(env.variables.MIDSCENE_MODEL_FAMILY).toBeUndefined()
    expect(env.content).not.toContain('MIDSCENE_MODEL_FAMILY')
    expect(env.familyWarning).toContain('unknown/model')
    // 警告要点明「该变量是必需的」与两条出路，而不是含糊提示。
    expect(env.familyWarning).toContain('必需的')
    expect(env.familyWarning).toContain('vision')
  })

  it('生成的内容以换行收尾（可直接重定向为文件）', () => {
    const env = buildMidsceneEnv({ baseUrl: 'http://127.0.0.1:8787/v1', model: { id: 'glm-v' } })
    expect(env.content.endsWith('\n')).toBe(true)
  })
})

describe('pickDefaultModel', () => {
  it('优先选具备图片能力的模型（Midscene 靠截图理解页面）', () => {
    const picked = pickDefaultModel([
      { id: 'a/text-only', vision: false },
      { id: 'b/vision-model', vision: true },
      { id: 'c/also-vision', vision: true },
    ])
    expect(picked?.id).toBe('b/vision-model')
  })

  it('优先挑家族可推断的模型（避免默认给一个 family 未知的）', () => {
    // 真实场景：CodeBuddy 目录里既有 glm-5.3（家族可推断）也有 hy3（内部代号、推断不出），
    // 默认应挑前者，用户拿到配置即可用。
    const picked = pickDefaultModel([
      { id: 'codebuddy/hy3', name: 'Hy3', vision: true },
      { id: 'codebuddy/glm-5.3-flash', name: 'GLM-5.3-Flash', vision: true },
    ])
    expect(picked?.id).toBe('codebuddy/glm-5.3-flash')
  })

  it('目录顺序稳定：同等情况取第一个', () => {
    const picked = pickDefaultModel([
      { id: 'codebuddy/glm-5.3', vision: true },
      { id: 'codebuddy/glm-5.2', vision: true },
    ])
    expect(picked?.id).toBe('codebuddy/glm-5.3')
  })

  it('没有图片能力模型时回落到第一个（并让调用方如实呈现）', () => {
    const picked = pickDefaultModel([{ id: 'only', vision: false }])
    expect(picked?.id).toBe('only')
  })

  it('空目录返回 undefined', () => {
    expect(pickDefaultModel([])).toBeUndefined()
  })
})
