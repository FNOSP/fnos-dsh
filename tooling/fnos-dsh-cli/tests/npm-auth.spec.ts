import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ execFile: vi.fn() }))

vi.mock('node:child_process', async importOriginal => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  execFile: mocks.execFile,
}))

const { checkPublishAuth } = await import('../src/core/npm-auth.js')

/**
 * 以**回调式**桩替换 `execFile`，与被测实现保持一致。
 *
 * 不能用「返回 Promise」的桩：`promisify` 在调用时就取定 `execFile` 的实现，
 * 只替换函数不会生效，用例会静默挂到超时（本仓库已记录过该陷阱）。
 */
function stubCommands(map: Record<string, { stdout?: string, fail?: boolean }>): void {
  mocks.execFile.mockImplementation(
    (command: string, _args: unknown, _options: unknown, callback: (error: unknown, stdout?: string) => void) => {
      const entry = map[command]
      if (entry === undefined || entry.fail === true) {
        callback(new Error(`${command} whoami failed`))
        return
      }
      callback(null, entry.stdout ?? '')
    },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('发布前鉴权自检', () => {
  it('npm 已登录时放行', async () => {
    stubCommands({ npm: { stdout: 'better-vae\n' } })
    const result = await checkPublishAuth()
    expect(result.ok).toBe(true)
    expect(result.message).toContain('better-vae')
  })

  it('npm 未登录但 pnpm 已登录时，给出把 pnpm 凭据同步给 npm 的命令', async () => {
    // 实测场景：用户跑了 pnpm login（凭据写进 pnpm 自己的配置），而发布用的是
    // npm publish，于是首个包以 E404 失败——看起来像「包不存在」，实际是没认证。
    stubCommands({ npm: { fail: true }, pnpm: { stdout: 'better-vae\n' } })
    const result = await checkPublishAuth()
    expect(result.ok).toBe(false)
    expect(result.message).toContain('pnpm 已登录（better-vae）')
    expect(result.message).toContain('pnpm login 不会替 npm 认证')
    expect(result.message).toContain('npm config set //registry.npmjs.org/:_authToken')
  })

  it('两者都未登录时提示先登录', async () => {
    stubCommands({ npm: { fail: true }, pnpm: { fail: true } })
    const result = await checkPublishAuth()
    expect(result.ok).toBe(false)
    expect(result.message).toContain('npm login')
  })

  it('whoami 返回空白不算登录（避免把空输出当用户名）', async () => {
    stubCommands({ npm: { stdout: '   \n' }, pnpm: { fail: true } })
    const result = await checkPublishAuth()
    expect(result.ok).toBe(false)
  })
})
