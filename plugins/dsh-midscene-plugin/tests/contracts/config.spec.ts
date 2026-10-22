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
    // 与 Midscene v1.16.0 的 MODEL_FAMILY_VALUES 逐项一致；上游新增家族时需同步。
    expect(MIDSCENE_FAMILIES).toHaveLength(21)
    expect(MIDSCENE_FAMILIES).toContain(DEFAULT_FAMILY)
    expect(DEFAULT_FAMILY).toBe('glm-v')
  })

  it('白名单与上游 1.16.0 的家族集合一致（含 v1.16 新增的 jev）', () => {
    // FNOS-021-04-AC-02：白名单是「Midscene 接受的值集合」，与上游逐项一致。
    // jev 是 v1.16 新增的家族；插件不会推导它（商业模型 + 不能作默认模型），
    // 但白名单必须收下，否则用户手工指定合法值时会被误判为非法。
    expect(MIDSCENE_FAMILIES).toContain('jev')
    expect([...MIDSCENE_FAMILIES].sort()).toEqual([
      'auto-glm',
      'auto-glm-multilingual',
      'deepseek',
      'doubao-seed',
      'doubao-vision',
      'gemini',
      'glm-v',
      'gpt-5',
      'gpt-6',
      'jev',
      'kimi',
      'kimi3',
      'qwen2.5-vl',
      'qwen3',
      'qwen3-vl',
      'qwen3.5',
      'qwen3.6',
      'vlm-ui-tars',
      'vlm-ui-tars-doubao',
      'vlm-ui-tars-doubao-1.5',
      'xiaomi-mimo',
    ])
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

describe('renderEnvFile：多职责扩展（FNOS-021-02）', () => {
  /** 升级前就是这四行；「全部留空」时必须逐字符保持不变。 */
  const BASELINE_FOUR_LINES = [
    'MIDSCENE_MODEL_BASE_URL="http://127.0.0.1:8787/v1"',
    'MIDSCENE_MODEL_API_KEY="abc123"',
    'MIDSCENE_MODEL_NAME="dsh-model"',
    'MIDSCENE_MODEL_FAMILY="glm-v"',
  ] as const

  it('不传 dedicated 时，四个变量行与升级前逐字符一致（AC-02）', () => {
    const lines = renderEnvFile({ port: 8787, apiKey: 'abc123', family: 'glm-v' }).split('\n')
    // 连续出现、顺序不变。
    const start = lines.indexOf(BASELINE_FOUR_LINES[0])
    expect(start).toBeGreaterThanOrEqual(0)
    expect(lines.slice(start, start + BASELINE_FOUR_LINES.length)).toEqual([...BASELINE_FOUR_LINES])
  })

  it('默认职责**永不**写 STREAM_MODE（写了就破坏「与升级前一致」）', () => {
    const env = renderEnvFile({
      port: 8787,
      apiKey: 'abc123',
      family: 'glm-v',
      dedicated: [{ intent: 'locate', family: 'deepseek' }],
    })
    expect(env).not.toContain('MIDSCENE_MODEL_STREAM_MODE')
    // 专用职责则必须写明（上游对专用职责的流式模式不作继承）。
    expect(env).toContain('MIDSCENE_LOCATE_MODEL_STREAM_MODE="non-stream"')
  })

  it('空数组与不传等价（只有默认四行）', () => {
    const withEmpty = renderEnvFile({ port: 8787, apiKey: 'k', family: 'glm-v', dedicated: [] })
    const without = renderEnvFile({ port: 8787, apiKey: 'k', family: 'glm-v' })
    expect(withEmpty).toBe(without)
    expect(withEmpty).not.toContain('MIDSCENE_LOCATE_MODEL')
    expect(withEmpty).not.toContain('MIDSCENE_PLANNING_MODEL')
    expect(withEmpty).not.toContain('MIDSCENE_INSIGHT_MODEL')
  })

  it('配了专用职责才追加该职责的一组变量（含注释、模型名带职责后缀、家族按该职责推导）', () => {
    const env = renderEnvFile({
      port: 8787,
      apiKey: 'abc123',
      family: 'glm-v',
      dedicated: [{ intent: 'locate', family: 'deepseek' }],
    })
    // 分组注释说明「不配置则沿用上面的默认模型」，避免用户以为这组是必填。
    expect(env).toContain('# 以下为「定位」职责单独指定的模型；不配置则沿用上面的默认模型。')
    expect(env).toContain('MIDSCENE_LOCATE_MODEL_BASE_URL="http://127.0.0.1:8787/v1"')
    expect(env).toContain('MIDSCENE_LOCATE_MODEL_API_KEY="abc123"')
    // 模型名必须与其他职责不同：桥靠 `@职责` 后缀判断这次调用属于哪个职责。
    expect(env).toContain('MIDSCENE_LOCATE_MODEL_NAME="dsh-model@locate"')
    expect(env).toContain('MIDSCENE_LOCATE_MODEL_FAMILY="deepseek"')
    // 只多出定位这一组，没有规划/理解。
    expect(env).not.toContain('MIDSCENE_PLANNING_MODEL')
    expect(env).not.toContain('MIDSCENE_INSIGHT_MODEL')
  })

  it('四职责模型名互不相同（共名会让专用职责的模型永远不被用上，且不报错）', () => {
    const env = renderEnvFile({
      port: 8787,
      apiKey: 'k',
      family: 'glm-v',
      dedicated: [
        { intent: 'locate', family: 'deepseek' },
        { intent: 'planning', family: 'gpt-6' },
        { intent: 'insight', family: 'kimi' },
      ],
    })
    const names = [...env.matchAll(/MIDSCENE_\w*MODEL_NAME="([^"]+)"/gu)].map(match => match[1])
    expect(names).toEqual(['dsh-model', 'dsh-model@locate', 'dsh-model@planning', 'dsh-model@insight'])
    expect(new Set(names).size).toBe(names.length)
  })

  it('专用职责按固定顺序输出（定位 → 规划 → 页面理解），与传入顺序无关', () => {
    const env = renderEnvFile({
      port: 8787,
      apiKey: 'k',
      family: 'glm-v',
      dedicated: [
        { intent: 'insight', family: 'kimi' },
        { intent: 'locate', family: 'deepseek' },
      ],
    })
    const locateAt = env.indexOf('MIDSCENE_LOCATE_MODEL_BASE_URL')
    const insightAt = env.indexOf('MIDSCENE_INSIGHT_MODEL_BASE_URL')
    expect(locateAt).toBeGreaterThan(0)
    expect(insightAt).toBeGreaterThan(locateAt)
  })

  it('显式声明协议为 Chat Completions（FNOS-021-06-AC-01）', () => {
    // 声明为注释而不是多写一个环境变量：既让用户知道该配哪种，又不改变既有的四行取值。
    const env = renderEnvFile({ port: 8787, apiKey: 'k', family: 'glm-v' })
    expect(env).toContain('openai-chat')
    expect(env).toContain('Chat Completions')
    expect(env).toContain('本桥只提供这一种协议')
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
      get locateModel() { return '' },
      get planningModel() { return '' },
      get insightModel() { return '' },
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
      get locateModel() { return '' },
      get planningModel() { return '' },
      get insightModel() { return '' },
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
      get locateModel() { return undefined as unknown as string },
      get planningModel() { return undefined as unknown as string },
      get insightModel() { return undefined as unknown as string },
      get requestTimeoutMs() { return 1000 },
      get logRequests() { return true },
    })
    expect(config.model).toBe('')
    // 三个专用职责同理：老配置里没有这些字段时按「未配置」处理。
    expect(config.locateModel).toBe('')
    expect(config.planningModel).toBe('')
    expect(config.insightModel).toBe('')
  })
})
