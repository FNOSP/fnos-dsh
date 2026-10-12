import { describe, expect, it } from 'vitest'
import { formatModelName, resolveModelName } from '../../src/contracts/model-name.ts'

/**
 * 「提供方/模型」命名解析（FNOS-013-02、桥接服务行为细则第 1 条）。
 *
 * 难点是模型 id 自含 `/`（OpenRouter 风格）与提供方 id 自含 `/` 两种情况不能
 * 互相误伤，因此解析用「已知提供方最长前缀匹配」，未命中才退化到第一个 `/`。
 */

describe('resolveModelName', () => {
  it('按已知提供方解析常规形式', () => {
    expect(resolveModelName('codebuddy/glm-5.3-flash', ['codebuddy', 'openai-codex'], ''))
      .toEqual({ provider: 'codebuddy', model: 'glm-5.3-flash' })
  })

  it('模型 id 自含 / 时保留完整模型 id', () => {
    // 提供方 openrouter 配模型 deepseek/deepseek-chat：只有最长前缀匹配能解对。
    expect(resolveModelName('openrouter/deepseek/deepseek-chat', ['openrouter'], ''))
      .toEqual({ provider: 'openrouter', model: 'deepseek/deepseek-chat' })
  })

  it('提供方 id 自含 / 时取最长匹配', () => {
    // `a/b` 比 `a` 更长，应按 `a/b` 解析而不是 `a`。
    expect(resolveModelName('a/b/model-x', ['a', 'a/b'], ''))
      .toEqual({ provider: 'a/b', model: 'model-x' })
  })

  it('未命中已知提供方时按第一个 / 切分，让宿主做权威判定', () => {
    // 目录缓存尚未刷新（新装提供方插件）时仍要能解析出提供方，由宿主给出
    // 「未注册路由」的明确错误。
    expect(resolveModelName('brandnew/model-y', ['codebuddy'], ''))
      .toEqual({ provider: 'brandnew', model: 'model-y' })
  })

  it('裸模型名用配置的默认提供方', () => {
    expect(resolveModelName('glm-5.3-flash', ['codebuddy'], 'codebuddy'))
      .toEqual({ provider: 'codebuddy', model: 'glm-5.3-flash' })
  })

  it('裸模型名且未配置默认提供方时拒绝解析', () => {
    // 比猜一个提供方安全：多个提供方可能有同名模型。
    expect(resolveModelName('glm-5.3-flash', ['codebuddy'], '')).toBeUndefined()
  })

  it('空串与仅分隔符被拒绝', () => {
    expect(resolveModelName('', ['codebuddy'], 'codebuddy')).toBeUndefined()
    expect(resolveModelName('   ', ['codebuddy'], 'codebuddy')).toBeUndefined()
    expect(resolveModelName('/model', [], '')).toBeUndefined()
    expect(resolveModelName('provider/', [], '')).toBeUndefined()
  })

  it('首尾空白被忽略', () => {
    expect(resolveModelName('  codebuddy/glm  ', ['codebuddy'], ''))
      .toEqual({ provider: 'codebuddy', model: 'glm' })
  })

  it('formatModelName 与解析互逆', () => {
    const name = formatModelName('openrouter', 'deepseek/deepseek-chat')
    expect(name).toBe('openrouter/deepseek/deepseek-chat')
    expect(resolveModelName(name, ['openrouter'], '')).toEqual({
      provider: 'openrouter',
      model: 'deepseek/deepseek-chat',
    })
  })
})
