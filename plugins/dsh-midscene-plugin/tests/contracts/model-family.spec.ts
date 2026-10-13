import { describe, expect, it } from 'vitest'
import { MIDSCENE_FAMILIES } from '../../src/contracts/config.ts'
import { guessFamily, resolveFamily } from '../../src/contracts/model-family.ts'

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

describe('resolveFamily：家族推导（含名单外模型的回落）', () => {
  it('能识别的模型用对应家族', () => {
    expect(resolveFamily('codebuddy/glm-5.3')).toMatchObject({ family: 'glm-v', exact: true })
    expect(resolveFamily('codebuddy/deepseek-v4.1-flash')).toMatchObject({ family: 'deepseek', exact: true })
    expect(resolveFamily('codebuddy/kimi-k3-1')).toMatchObject({ family: 'kimi3', exact: true })
  })

  it('名单外但识图的模型回落到通用家族（用户选它也能用）', () => {
    // 需求要点：Midscene 未适配的识图模型同样必须可用。回落到 bbox/xy/1000
    // （10 个家族共用的主导协议）后即可工作，实测 hy3 在其下定位 3/3 命中。
    for (const id of ['codebuddy/hy3', 'codebuddy/minimax-m3', 'codebuddy/auto']) {
      const resolved = resolveFamily(id)
      expect(resolved.family, id).toBe('glm-v')
      expect(resolved.exact, id).toBe(false)
      // 结果必须落在 Midscene 白名单内，否则运行时必然报错。
      expect(MIDSCENE_FAMILIES, id).toContain(resolved.family)
    }
  })

  it('永不返回 undefined（已决定用某个模型时，必须给出协议）', () => {
    for (const id of ['', 'unknown/vendor-model', 'codebuddy/hy3']) {
      expect(resolveFamily(id).family.length, id).toBeGreaterThan(0)
    }
  })
})
