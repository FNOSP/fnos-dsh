import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FAMILY,
  FIXED_MODEL_NAME,
  MIDSCENE_FAMILIES,
  generateApiKey,
  isKnownFamily,
  liveConfig,
  renderEnvFile,
  volatileValue,
} from '../../src/contracts/config.ts'

/**
 * 接入设置的配置契约（FNOS-013-05、14 的设置页）。
 *
 * 这里的断言都对应真实约束，而非实现细节：
 * - 家族白名单必须与 Midscene 的运行时校验一致（实测 `dsh-model` 被拒）；
 * - 密钥默认安装即生成、且是桥自己的密钥（不是模型凭据）；
 * - 配置字段是 volatile（否则官方设置表单不可编辑），读取必须解包。
 */

describe('Midscene 协议家族白名单', () => {
  it('内置完整白名单且包含默认家族', () => {
    // 与 Midscene v1.15.0 运行时错误信息逐字一致；上游新增家族时需同步。
    expect(MIDSCENE_FAMILIES).toHaveLength(20)
    expect(MIDSCENE_FAMILIES).toContain(DEFAULT_FAMILY)
    expect(DEFAULT_FAMILY).toBe('glm-v')
  })

  it('白名单里没有 dsh-model（实测被 Midscene 运行时拒绝）', () => {
    // 用户方案原本希望家族也固定为 dsh-model；Midscene 对该字段做校验，
    // 传未知值直接报 Invalid MIDSCENE_MODEL_FAMILY value。
    expect(isKnownFamily('dsh-model')).toBe(false)
    expect(isKnownFamily('glm-v')).toBe(true)
    expect(isKnownFamily('')).toBe(false)
  })
})

describe('接入密钥', () => {
  it('生成 32 位十六进制密钥，且每次不同', () => {
    const first = generateApiKey()
    const second = generateApiKey()
    expect(first).toMatch(/^[0-9a-f]{32}$/u)
    expect(second).toMatch(/^[0-9a-f]{32}$/u)
    expect(first).not.toBe(second)
  })
})

describe('renderEnvFile', () => {
  it('输出固定四行且模型名是常量占位', () => {
    const env = renderEnvFile({ port: 8787, apiKey: 'abc123', family: 'glm-v' })
    expect(env).toContain('MIDSCENE_MODEL_BASE_URL="http://127.0.0.1:8787/v1"')
    expect(env).toContain('MIDSCENE_MODEL_API_KEY="abc123"')
    expect(env).toContain(`MIDSCENE_MODEL_NAME="${FIXED_MODEL_NAME}"`)
    expect(env).toContain('MIDSCENE_MODEL_FAMILY="glm-v"')
  })

  it('换模型不改 .env：函数不接受模型参数', () => {
    // 这是「固定四行」的核心承诺——模型由桥决定，因此渲染函数里没有模型入参。
    expect(renderEnvFile.length).toBe(1)
    const env = renderEnvFile({ port: 8787, apiKey: 'k', family: 'gpt-6' })
    expect(env).toContain(`MIDSCENE_MODEL_NAME="${FIXED_MODEL_NAME}"`)
    expect(env).not.toContain('codebuddy/')
  })
})

describe('volatileValue', () => {
  it('普通值原样返回', () => {
    expect(volatileValue('glm-v')).toBe('glm-v')
    expect(volatileValue(8787)).toBe(8787)
    expect(volatileValue(['a/b'])).toEqual(['a/b'])
  })

  it('包装成引用（volatile）时解包为当前值', () => {
    // 配置字段声明为 volatile 才能被官方设置表单编辑；apply 收到的是引用而非值。
    let current = 'glm-v'
    const ref = { get: () => current }
    expect(volatileValue(ref)).toBe('glm-v')
    current = 'gpt-6'
    expect(volatileValue(ref)).toBe('gpt-6')
  })

  it('undefined 保持 undefined', () => {
    expect(volatileValue(undefined)).toBeUndefined()
  })
})

describe('liveConfig', () => {
  it('每次读取都取当前值（设置页改动立即作用于运行中的桥）', () => {
    // 若只读一次快照，用户改完家族或密钥必须重启 DSH 才生效——与「设置页能改」不符。
    const state = { apiKey: 'first', family: 'glm-v', model: '' }
    const config = liveConfig({
      get port() { return 8787 },
      get apiKey() { return state.apiKey },
      get family() { return state.family },
      get model() { return state.model },
      get requestTimeoutMs() { return 1000 },
      get logRequests() { return false },
    })
    expect(config.apiKey).toBe('first')
    expect(config.family).toBe('glm-v')
    state.apiKey = 'second'
    state.family = 'gpt-6'
    state.model = 'codebuddy/glm-5.3-flash'
    expect(config.apiKey).toBe('second')
    expect(config.family).toBe('gpt-6')
    expect(config.model).toBe('codebuddy/glm-5.3-flash')
  })

  it('解包 volatile 引用的字段', () => {
    let family = 'glm-v'
    const config = liveConfig({
      get port() { return 8787 },
      get apiKey() { return 'k' },
      get family() { return { get: () => family } as unknown as string },
      get model() { return '' },
      get requestTimeoutMs() { return 1000 },
      get logRequests() { return true },
    })
    expect(config.family).toBe('glm-v')
    family = 'deepseek'
    expect(config.family).toBe('deepseek')
  })

  it('model 缺失时回落空串（老配置升级不炸）', () => {
    const config = liveConfig({
      get port() { return 8787 },
      get apiKey() { return 'k' },
      get family() { return 'glm-v' },
      get model() { return undefined as unknown as string },
      get requestTimeoutMs() { return 1000 },
      get logRequests() { return true },
    })
    expect(config.model).toBe('')
  })
})
