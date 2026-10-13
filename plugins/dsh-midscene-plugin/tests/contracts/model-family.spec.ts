import { describe, expect, it } from 'vitest'
import { MIDSCENE_FAMILIES } from '../../src/contracts/config.ts'
import {
  filterModelsByFamily,
  guessFamily,
  retainCompatibleModels,
} from '../../src/contracts/model-family.ts'

/**
 * 模型 → 协议家族映射的行为约束。
 *
 * 映射错了的表现是**静默错位**（点击偏几像素到几十像素）而不是报错，因此这里对
 * 「本仓库实际目录里的模型」逐个断言——它们的判定结果就是用户设置页会看到的东西。
 */

describe('guessFamily：已知模型的判定', () => {
  it('仓库目录里实际存在的模型都能判到家族', () => {
    // 取自真实目录（`/v1/models` 的 24 个条目中带提供方前缀的那些）。
    const cases: readonly [string, string][] = [
      ['codebuddy/glm-5.3', 'glm-v'],
      ['codebuddy/glm-5.3-flash', 'glm-v'],
      ['codebuddy/glm-5.2', 'glm-v'],
      ['codebuddy/glm-5.1', 'glm-v'],
      ['codebuddy/deepseek-v4.1-flash', 'deepseek'],
      ['codebuddy/deepseek-v4-pro', 'deepseek'],
      ['codebuddy/deepseek-v4-flash', 'deepseek'],
      ['deepseek-official/deepseek-flash', 'deepseek'],
      ['codebuddy/kimi-k3-1', 'kimi3'],
      ['codebuddy/kimi-k2.8-preview', 'kimi'],
      ['openai-codex/gpt-6-luna', 'gpt-6'],
      ['openai-codex/gpt-5.6-terra', 'gpt-5'],
      ['openai-codex/gpt-5.6-luna', 'gpt-5'],
    ]
    for (const [id, expected] of cases) {
      expect(guessFamily(id)?.family, id).toBe(expected)
    }
  })

  it('推断结果始终落在 Midscene 白名单内（否则运行时必失败）', () => {
    const ids = [
      'glm-5.3', 'deepseek-v4.1-flash', 'kimi-k3-1', 'kimi-k2.8-preview', 'gpt-6-luna',
      'gpt-5.6-terra', 'gemini-3.5-flash', 'doubao-seed-2-1-turbo', 'qwen3.7-plus',
      'qwen3-vl-plus', 'qwen-vl-max-latest', 'mimo-v2.6-pro', 'ui-tars-1.5', 'autoglm-9b',
    ]
    for (const id of ids) {
      const guess = guessFamily(id)
      expect(guess, id).toBeDefined()
      expect(MIDSCENE_FAMILIES, id).toContain(guess!.family)
    }
  })

  it('未知模型不猜（返回 undefined，由界面要求手选）', () => {
    // 目录里确有 Midscene 未适配的自研系列；猜错比不猜更危险。
    for (const id of ['codebuddy/auto', 'codebuddy/hy3', 'codebuddy/space-bunny', 'codebuddy/minimax-m3', 'codebuddy/codewise-default-model-v2']) {
      expect(guessFamily(id), id).toBeUndefined()
    }
  })

  it('更具体的规则优先：kimi-k3 判为 kimi3 而非 kimi', () => {
    expect(guessFamily('kimi-k3')?.family).toBe('kimi3')
    expect(guessFamily('kimi-k2.6')?.family).toBe('kimi')
  })

  it('给出可核对的判断依据（不是「插件说啥就是啥」）', () => {
    expect(guessFamily('glm-5.3')?.reason).toContain('GLM')
    expect(guessFamily('deepseek-v4.1-flash')?.reason).toContain('DeepSeek')
  })

  it('大小写不敏感（提供方写法不统一）', () => {
    expect(guessFamily('CodeBuddy/GLM-5.3')?.family).toBe('glm-v')
    expect(guessFamily('DeepSeek-V4.1-Flash')?.family).toBe('deepseek')
  })
})

describe('filterModelsByFamily：按家族过滤', () => {
  const models = [
    { id: 'codebuddy/glm-5.3' },
    { id: 'codebuddy/glm-5.3-flash' },
    { id: 'codebuddy/deepseek-v4.1-flash' },
    { id: 'codebuddy/kimi-k3-1' },
    { id: 'codebuddy/hy3' },
  ] as const

  it('只返回该家族的模型，未识别的不含在内', () => {
    const glm = filterModelsByFamily(models, 'glm-v').map(m => m.id)
    expect(glm).toEqual(['codebuddy/glm-5.3', 'codebuddy/glm-5.3-flash'])
    expect(filterModelsByFamily(models, 'deepseek').map(m => m.id))
      .toEqual(['codebuddy/deepseek-v4.1-flash'])
    // hy3 无法判断家族，任何家族下都不出现。
    for (const family of ['glm-v', 'deepseek', 'kimi3']) {
      expect(filterModelsByFamily(models, family).map(m => m.id), family).not.toContain('codebuddy/hy3')
    }
  })

  it('家族为空时返回空数组（界面据此隐藏模型字段）', () => {
    expect(filterModelsByFamily(models, '')).toEqual([])
    expect(filterModelsByFamily(models, '   ')).toEqual([])
  })

  it('没有匹配项时返回空数组（而不是全部）', () => {
    expect(filterModelsByFamily(models, 'gemini')).toEqual([])
  })
})

describe('retainCompatibleModels：换家族时剔除不兼容的模型', () => {
  it('剔除不再属于新家族的模型，保留原顺序', () => {
    const selected = ['codebuddy/glm-5.3', 'codebuddy/deepseek-v4.1-flash', 'codebuddy/glm-5.2']
    expect(retainCompatibleModels(selected, 'deepseek')).toEqual(['codebuddy/deepseek-v4.1-flash'])
    expect(retainCompatibleModels(selected, 'glm-v')).toEqual(['codebuddy/glm-5.3', 'codebuddy/glm-5.2'])
  })

  it('家族为空时全部清掉（未选家族就不该留着模型）', () => {
    expect(retainCompatibleModels(['codebuddy/glm-5.3'], '')).toEqual([])
  })

  it('目录里查不到的条目保留（可能只是提供方暂时被卸载，不该丢用户的选择）', () => {
    expect(retainCompatibleModels(['vendor/whatever-model'], 'deepseek'))
      .toEqual(['vendor/whatever-model'])
  })

  it('这就是「配置里 family=glm-v 却用着 DeepSeek 模型」的防线', () => {
    // 实测过的真实错配：models 首选 deepseek、family 是 glm-v。切换家族时若能剔除，
    // 就不会留下这种静默错位的组合。
    const mismatched = ['codebuddy/deepseek-v4.1-flash', 'codebuddy/glm-5.3-flash']
    expect(retainCompatibleModels(mismatched, 'glm-v')).toEqual(['codebuddy/glm-5.3-flash'])
    expect(retainCompatibleModels(mismatched, 'deepseek')).toEqual(['codebuddy/deepseek-v4.1-flash'])
  })
})
