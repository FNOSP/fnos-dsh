import { describe, expect, it } from 'vitest'
import { resolveOfficialOptions } from '../../src/host/official-fallback.ts'

/** 构造一个最小的 settings 服务替身。 */
function settingsStub(rows: { ns: string, value: unknown }[]) {
  return {
    describe: () => rows,
  }
}

/** 构造一个最小的 credentials 服务替身。 */
function credentialsStub(values: Record<string, string>) {
  const reads: string[] = []
  return {
    reads,
    service: {
      resolve: async (ref: unknown) => {
        const key = String(ref)
        reads.push(key)
        const value = values[key]
        return value === undefined ? undefined : { value }
      },
    },
  }
}

/** 构造一个最小的 launch environment 替身。 */
function launchStub(values: Record<string, string> = {}) {
  return { get: (name: string) => (values[name] === undefined ? undefined : { value: values[name] }) }
}

describe('FNOS-010-03 官方兜底级沿用用户既有配置', () => {
  it('读取 web-search-deepseek 命名空间里的端点、模型与凭据引用', () => {
    const settings = settingsStub([{
      ns: 'web-search-deepseek',
      value: { baseURL: 'https://custom.example/anthropic/v1', model: 'custom-model', maxUses: 7, apiKeyEnv: 'MY_KEY' },
    }])

    const options = resolveOfficialOptions({
      settings,
      credentials: credentialsStub({}).service,
      launch: launchStub(),
      logger: { warn: () => {} },
    })

    // 兜底级必须与「设置 → 插件 → 网络搜索」里的配置一致，否则用户改过的端点会被静默忽略。
    expect(options.baseURL).toBe('https://custom.example/anthropic/v1')
    expect(options.model).toBe('custom-model')
    expect(options.maxUses).toBe(7)
    expect(String(options.apiKeyEnv)).toBe('MY_KEY')
  })

  it('命名空间缺失时回落到官方默认值', () => {
    const options = resolveOfficialOptions({
      settings: settingsStub([]),
      credentials: credentialsStub({}).service,
      launch: launchStub(),
      logger: { warn: () => {} },
    })

    expect(options.baseURL).toBe('https://api.deepseek.com/anthropic/v1')
    expect(options.model).toBe('deepseek-v4-flash')
    expect(options.maxUses).toBe(5)
    expect(String(options.apiKeyEnv)).toBe('DEEPSEEK_API_KEY')
  })

  it('凭据优先从 credentials 服务解析，其次回落启动环境', async () => {
    const credentials = credentialsStub({ DEEPSEEK_API_KEY: 'from-store' })
    const options = resolveOfficialOptions({
      settings: settingsStub([]),
      credentials: credentials.service,
      launch: launchStub({ DEEPSEEK_API_KEY: 'from-env' }),
      logger: { warn: () => {} },
    })

    await expect(options.resolveApiKey?.()).resolves.toBe('from-store')
  })

  it('credentials 服务没有值时使用启动环境里的同名变量', async () => {
    const credentials = credentialsStub({})
    const options = resolveOfficialOptions({
      settings: settingsStub([]),
      credentials: credentials.service,
      launch: launchStub({ DEEPSEEK_API_KEY: 'from-env' }),
      logger: { warn: () => {} },
    })

    await expect(options.resolveApiKey?.()).resolves.toBe('from-env')
  })

  it('两处都没有凭据时返回 undefined（由官方提供方给出缺凭据提示）', async () => {
    const options = resolveOfficialOptions({
      settings: settingsStub([]),
      credentials: credentialsStub({}).service,
      launch: launchStub(),
      logger: { warn: () => {} },
    })

    await expect(options.resolveApiKey?.()).resolves.toBeUndefined()
  })

  it('settings 服务缺席时不抛错，直接用默认值', () => {
    const options = resolveOfficialOptions({
      settings: undefined,
      credentials: credentialsStub({}).service,
      launch: launchStub(),
      logger: { warn: () => {} },
    })

    expect(options.baseURL).toBe('https://api.deepseek.com/anthropic/v1')
  })

  it('命名空间值不是对象时按缺失处理，不把坏值传下去', () => {
    const options = resolveOfficialOptions({
      settings: settingsStub([{ ns: 'web-search-deepseek', value: 'not-an-object' }]),
      credentials: credentialsStub({}).service,
      launch: launchStub(),
      logger: { warn: () => {} },
    })

    expect(options.baseURL).toBe('https://api.deepseek.com/anthropic/v1')
    expect(options.maxUses).toBe(5)
  })

  it('凭据解析抛错时回落启动环境，不让兜底级因解析异常直接失败', async () => {
    const options = resolveOfficialOptions({
      settings: settingsStub([]),
      credentials: {
        resolve: async () => { throw new Error('credentials store unavailable') },
      },
      launch: launchStub({ DEEPSEEK_API_KEY: 'from-env' }),
      logger: { warn: () => {} },
    })

    await expect(options.resolveApiKey?.()).resolves.toBe('from-env')
  })
})
