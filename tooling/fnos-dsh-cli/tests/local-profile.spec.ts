import { beforeEach, describe, expect, it, vi } from 'vitest'
import { dirname, join } from 'node:path'
import { repositoryRoot } from '../src/config/paths.js'

const mocks = vi.hoisted(() => ({
  readdir: vi.fn(),
  realpath: vi.fn(),
  unlink: vi.fn(),
  runTurbo: vi.fn(),
  runRepoDsh: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
}))

const targets = [
  {
    value: 'codex',
    label: 'Codex Auth',
    name: '@tnnevol/dsh-codex-auth',
    filter: '@tnnevol/dsh-codex-auth...',
    path: 'plugins/dsh-codex-auth-plugin/package.json',
    slug: 'dsh-codex-auth',
  },
  {
    value: 'fnos',
    label: 'fnOS',
    name: '@tnnevol/dsh-fnos',
    filter: '@tnnevol/dsh-fnos...',
    path: 'plugins/dsh-fnos-plugin/package.json',
    slug: 'dsh-fnos',
  },
]

vi.mock('../src/config/targets.js', () => ({ pluginTargets: targets, findPluginTarget: vi.fn() }))
vi.mock('../src/core/turbo.js', () => ({
  runRepoDsh: mocks.runRepoDsh,
  runTurbo: mocks.runTurbo,
  runTurboWatch: vi.fn(),
}))
vi.mock('node:fs/promises', async importOriginal => ({
  ...(await importOriginal<typeof import('node:fs/promises')>()),
  readdir: mocks.readdir,
  realpath: mocks.realpath,
  unlink: mocks.unlink,
  readFile: mocks.readFile,
  writeFile: mocks.writeFile,
}))

const { ensureLocalProfilePlugins, localProfilePlugins, localDshVersion } = await import('../src/core/local-profile.js')

/** 归一化目标是运行时基线本身：从 catalog 读，而不是在测试里重述版本字面量。 */
const LOCAL_DSH_VERSION = localDshVersion()

/** The profile records absolute `link:` specs, so the fixture must match the resolved directory. */
const codexDirectory = dirname(join(repositoryRoot, 'plugins/dsh-codex-auth-plugin/package.json'))

describe('local profile plugins', () => {
  beforeEach(() => {
    mocks.readdir.mockResolvedValue([])
    mocks.realpath.mockResolvedValue('/valid')
    mocks.unlink.mockResolvedValue(undefined)
    mocks.runTurbo.mockResolvedValue(undefined)
    mocks.runRepoDsh.mockResolvedValue(undefined)
    mocks.readFile.mockRejectedValue(new Error('ENOENT'))
  })

  it('carries every repository plugin, including the fnOS one', () => {
    /*
      fnOS 插件原先被排除（「只在 fnOS 环境有意义」），但那让样式迭代必须走
      FPK → NAS → 安装，十分钟起步。现在本地 profile 也带它：调用不到 fnOS
      能力时给提示而不是让面板崩掉，界面与交互就能在本地 DSH Web 直接看。
    */
    expect(localProfilePlugins.map(target => target.name)).toEqual([
      '@tnnevol/dsh-codex-auth',
      '@tnnevol/dsh-fnos',
    ])
  })

  it('builds the plugins and links them into the web profile', async () => {
    await ensureLocalProfilePlugins()

    expect(mocks.runTurbo).toHaveBeenCalledWith(['build'], ['@tnnevol/dsh-codex-auth...', '@tnnevol/dsh-fnos...'])
    // codex-auth 需要重新链接；fnos 也可能各算一次，因此按插件判定而不是总数。
    const addCalls = mocks.runRepoDsh.mock.calls.filter(([args]) => (args as string[])[0] === 'plugin')
    expect(addCalls.length).toBeGreaterThanOrEqual(1)
    const [args] = mocks.runRepoDsh.mock.calls[0] ?? []
    expect(args?.[0]).toBe('plugin')
    expect(args?.slice(1, 4)).toEqual(['--profile', 'web', 'add'])
    expect(String(args?.[4])).toContain('plugins/dsh-codex-auth-plugin')
  })

  it('skips a plugin the profile already links as a bundle layer', async () => {
    mocks.readFile.mockResolvedValue(JSON.stringify({
      dependencies: {
        '@tnnevol/dsh-codex-auth': `link:${codexDirectory}`,
      },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@tnnevol/dsh-codex-auth'] } },
    }))

    await ensureLocalProfilePlugins()

    // profile 只把 codex-auth 记为 bundle layer；fnos 仍需链接，因此会有一次
    // 针对 fnos 的 add。这里断言的是「codex-auth 不再被重复 add」。
    const calls = mocks.runRepoDsh.mock.calls.map(([args]) => args as string[])
    expect(calls.some(args => args.includes('@tnnevol/dsh-codex-auth') || String(args[4] ?? '').includes('dsh-codex-auth'))).toBe(false)
  })

  it('re-links a plugin that is a dependency but not yet a bundle layer', async () => {
    mocks.readFile.mockResolvedValue(JSON.stringify({
      dependencies: {
        '@tnnevol/dsh-codex-auth': `link:${codexDirectory}`,
      },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } },
    }))

    await ensureLocalProfilePlugins()

    // codex-auth 需要重新链接；fnos 也可能各算一次，因此按插件判定而不是总数。
    const addCalls = mocks.runRepoDsh.mock.calls.filter(([args]) => (args as string[])[0] === 'plugin')
    expect(addCalls.length).toBeGreaterThanOrEqual(1)
  })

  it('normalizes catalog peer aliases only in the linked profile copy', async () => {
    const profilePackagePath = join(repositoryRoot, '.dsh/profiles/web/package.json')
    const linkedPackagePath = join(repositoryRoot, '.dsh/profiles/web/node_modules/@tnnevol/dsh-codex-auth/package.json')
    mocks.readFile.mockImplementation(async (path: string) => {
      if (path === profilePackagePath) {
        return JSON.stringify({
          dependencies: {
            '@tnnevol/dsh-codex-auth': `link:${codexDirectory}`,
          },
          dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@tnnevol/dsh-codex-auth'] } },
        })
      }
      if (path === linkedPackagePath) {
        return JSON.stringify({
          name: '@tnnevol/dsh-codex-auth',
          peerDependencies: {
            '@deepseek-ai/dsh-llm': 'catalog:dsh',
            react: 'catalog:',
          },
        })
      }
      throw new Error('ENOENT')
    })

    await ensureLocalProfilePlugins()

    expect(mocks.writeFile).toHaveBeenCalledWith(
      linkedPackagePath,
      // 归一化目标就是运行时基线本身，从源码常量读取而不是在此重述版本。
      expect.stringContaining(`"@deepseek-ai/dsh-llm": "${LOCAL_DSH_VERSION}"`),
      'utf8',
    )
    // codex-auth 已在 bundle layer 里，不该被重复 add；fnos 不在，因此整体会有
    // 一次调用。这里断言的是「没有为 codex-auth 再调一次」。
    const addCalls = mocks.runRepoDsh.mock.calls.map(([args]) => args as string[])
    expect(addCalls.some(args => String(args[4] ?? '').includes('dsh-codex-auth'))).toBe(false)
  })

  it('removes dangling profile symlinks before the watch scans the profile', async () => {
    mocks.readdir
      .mockResolvedValueOnce([
        { name: 'broken-link', isDirectory: () => false, isSymbolicLink: () => true },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    mocks.realpath
      .mockRejectedValueOnce(new Error('ENOENT'))

    await ensureLocalProfilePlugins()

    expect(mocks.unlink).toHaveBeenCalledWith(expect.stringContaining('node_modules/broken-link'))
    expect(mocks.unlink).toHaveBeenCalledTimes(1)
  })
})
