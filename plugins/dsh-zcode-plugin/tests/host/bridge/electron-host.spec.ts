import { describe, expect, it, vi, afterEach } from 'vitest'

import { buildAppServerEnv } from '../../../src/host/bridge/protocol.ts'
import {
  isElectronHost,
  resolveZCodeNodePath,
} from '../../../src/host/bridge/runtime-paths.ts'

/**
 * DSH Desktop 的宿主进程是 Electron 二进制（`ELECTRON_RUN_AS_NODE=1` 当 node 用），
 * 因此 `process.execPath` 不是 node。子进程若丢掉这个变量会当成 GUI 应用启动并立即退出，
 * 表现为「app-server 没能启动」。这组用例锁住这条口径。
 */
describe('Electron 宿主的子进程环境', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key]
    }
    Object.assign(process.env, originalEnv)
    vi.unstubAllEnvs()
  })

  it('普通 Node 宿主下不把该变量透传给子进程', () => {
    const env = buildAppServerEnv({}, { PATH: '/usr/bin', ELECTRON_RUN_AS_NODE: '1' })
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined()
    expect(env.PATH).toBe('/usr/bin')
  })

  it('显式覆盖时保留该变量（Electron 宿主必须让它以 node 身份运行）', () => {
    const env = buildAppServerEnv({ ELECTRON_RUN_AS_NODE: '1' }, { PATH: '/usr/bin' })
    expect(env.ELECTRON_RUN_AS_NODE).toBe('1')
  })

  it('覆盖项与 ZCODE_* 一起生效，且系统白名单照常透传', () => {
    const env = buildAppServerEnv(
      { ELECTRON_RUN_AS_NODE: '1', ZCODE_DATA_BASE_DIR: '/tmp/x' },
      { PATH: '/usr/bin', HOME: '/Users/u', ANTHROPIC_API_KEY: 'secret' },
    )
    expect(env.ELECTRON_RUN_AS_NODE).toBe('1')
    expect(env.ZCODE_DATA_BASE_DIR).toBe('/tmp/x')
    expect(env.HOME).toBe('/Users/u')
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
  })
})

describe('isElectronHost', () => {
  it('在普通 Node 里返回 false', () => {
    // 测试环境本身不是 Electron。
    expect(isElectronHost()).toBe(false)
  })
})

describe('resolveZCodeNodePath', () => {
  afterEach(() => {
    delete process.env.DSH_ZCODE_NODE
  })

  it('DSH_ZCODE_NODE 优先于配置与 execPath', () => {
    process.env.DSH_ZCODE_NODE = '/custom/node'
    expect(resolveZCodeNodePath('/configured/node')).toBe('/custom/node')
  })

  it('没有环境变量时用配置值', () => {
    expect(resolveZCodeNodePath('/configured/node')).toBe('/configured/node')
  })

  it('都没有时回落到 process.execPath', () => {
    expect(resolveZCodeNodePath()).toBe(process.execPath)
  })

  it('空白值视为未设置', () => {
    process.env.DSH_ZCODE_NODE = '   '
    expect(resolveZCodeNodePath(' /configured/node ')).toBe('/configured/node')
  })
})
