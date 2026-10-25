import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  buildAppServerEnv,
  delay,
  ZCODE_RUNTIME_PREFERENCES,
  ZCodeProtocolClient,
} from '../../../src/host/bridge/protocol.ts'

describe('buildAppServerEnv', () => {
  it('只透传系统基础变量白名单', () => {
    const source: NodeJS.ProcessEnv = {
      PATH: '/usr/local/bin:/usr/bin',
      HOME: '/home/tester',
      SHELL: '/bin/zsh',
      USER: 'tester',
      LOGNAME: 'tester',
      TMPDIR: '/tmp',
      PWD: '/tmp/work',
      LANG: 'zh_CN.UTF-8',
      LC_ALL: 'zh_CN.UTF-8',
      LC_CTYPE: 'zh_CN.UTF-8',
      TERM: 'xterm-256color',
      NODE_EXTRA_CA_CERTS: '/etc/ssl/ca.pem',
      SSH_AUTH_SOCK: '/tmp/ssh.sock',
    }

    expect(buildAppServerEnv({}, source)).toEqual(source)
  })

  it('不透传其他供应商密钥与任意宿主变量', () => {
    const env = buildAppServerEnv({}, {
      OPENAI_API_KEY: 'sk-openai',
      ANTHROPIC_API_KEY: 'sk-anthropic',
      DEEPSEEK_API_KEY: 'sk-deepseek',
      AWS_SECRET_ACCESS_KEY: 'aws-secret',
      GITHUB_TOKEN: 'gh-token',
      DATABASE_URL: 'postgres://example',
      HARMLESS_FLAG: '1',
    })

    expect(env).toEqual({})
  })

  it('ZCODE_ 前缀变量（大小写不敏感）全部透传，键名保持原样', () => {
    const env = buildAppServerEnv({}, {
      ZCODE_BASE_URL: 'https://zcode.z.ai',
      zcode_lowercase: '1',
      Zcode_MiXeD: '2',
    })

    expect(env).toEqual({
      ZCODE_BASE_URL: 'https://zcode.z.ai',
      zcode_lowercase: '1',
      Zcode_MiXeD: '2',
    })
  })

  it('显式覆盖项生效，且可以加入白名单之外的变量', () => {
    const env = buildAppServerEnv(
      { ZCODE_APP_VERSION: '9.9.9', CUSTOM_FLAG: 'yes' },
      { ZCODE_APP_VERSION: '1.0.0', EXTERNAL_FLAG: 'host-only' },
    )

    expect(env.ZCODE_APP_VERSION).toBe('9.9.9')
    expect(env.CUSTOM_FLAG).toBe('yes')
    expect(env.EXTERNAL_FLAG).toBeUndefined()
  })

  it('值未定义的变量被跳过', () => {
    const env = buildAppServerEnv({}, { PATH: undefined, ZCODE_X: undefined })

    expect(env).toEqual({})
  })

  it('继承来的 ELECTRON_RUN_AS_NODE 会被清掉，但显式覆盖可以保留', () => {
    // 继承下来不能让 Electron 子进程误入 node 模式；但 Electron 宿主（DSH Desktop）
    // 必须显式带上它，否则子进程会当成 GUI 应用启动并立即退出。
    const inherited = buildAppServerEnv({}, { ELECTRON_RUN_AS_NODE: '1' })
    expect(inherited.ELECTRON_RUN_AS_NODE).toBeUndefined()
    expect(Object.hasOwn(inherited, 'ELECTRON_RUN_AS_NODE')).toBe(false)

    const explicit = buildAppServerEnv({ ELECTRON_RUN_AS_NODE: '1' }, {})
    expect(explicit.ELECTRON_RUN_AS_NODE).toBe('1')
  })

  it('不修改调用方传入的 env 对象', () => {
    const source: NodeJS.ProcessEnv = { PATH: '/usr/bin', ZCODE_X: '1' }
    const snapshot = { ...source }

    buildAppServerEnv({ CUSTOM_FLAG: 'yes' }, source)

    expect(source).toEqual(snapshot)
  })

  it('默认从 process.env 读取', () => {
    vi.stubEnv('ZCODE_SPEC_PASSTHROUGH', 'kept')
    vi.stubEnv('SPEC_OTHER_SECRET', 'dropped')

    const env = buildAppServerEnv({})

    expect(env.ZCODE_SPEC_PASSTHROUGH).toBe('kept')
    expect(env.SPEC_OTHER_SECRET).toBeUndefined()
    expect(env.PATH).toBe(process.env.PATH)
  })

  it('空来源与空覆盖返回空对象', () => {
    expect(buildAppServerEnv({}, {})).toEqual({})
  })
})

describe('ZCODE_RUNTIME_PREFERENCES', () => {
  it('包含客户端 .strict() 要求的四个字段', () => {
    // 客户端用 .strict() 校验运行期偏好，缺字段会让 session/create 直接失败。
    expect(ZCODE_RUNTIME_PREFERENCES).toMatchObject({
      nativeSearchEnhancementsEnabled: false,
      memoryEnabled: false,
      askUserQuestionAutoResolutionEnabled: true,
      modelContextBudgetStrategy: 'preflight-v1',
    })
  })
})

describe('ZCodeProtocolClient 生命周期（不启动子进程）', () => {
  function makeClient(): ZCodeProtocolClient {
    return new ZCodeProtocolClient({
      nodePath: process.execPath,
      cliPath: '/nonexistent/zcode.cjs',
      cwd: '/tmp',
      env: {},
      logger: { info: () => {}, warn: () => {} },
      handlers: { runtimeHeaders: async () => ({}) },
    })
  }

  it('未启动时 isReady() 为 false', () => {
    const client = makeClient()

    expect(client.isReady()).toBe(false)
    client.dispose()
  })

  it('dispose 之后 ensureStarted() 直接拒绝，不会再拉起子进程', async () => {
    const client = makeClient()
    client.dispose()

    await expect(client.ensureStarted()).rejects.toThrow('已销毁')
  })

  it('重复 dispose 安全', () => {
    const client = makeClient()

    expect(() => {
      client.dispose()
      client.dispose()
    }).not.toThrow()
  })
})

describe('delay', () => {
  it('等到计时器到点后才 resolve', async () => {
    const started = Date.now()

    await delay(30)

    expect(Date.now() - started).toBeGreaterThanOrEqual(20)
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
})
