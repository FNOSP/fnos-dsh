import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  spawnSync: vi.fn(),
  readPackageInfo: vi.fn(),
}))

vi.mock('node:fs/promises', () => ({
  readFile: mocks.readFile,
  writeFile: mocks.writeFile,
}))
vi.mock('node:fs', async importOriginal => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  existsSync: vi.fn((path: unknown) => {
    const value = String(path)
    return value.endsWith('published-dsh-plugins.json') || value.endsWith('.md')
  }),
}))
vi.mock('node:child_process', () => ({ spawnSync: mocks.spawnSync }))
vi.mock('../src/core/package.js', () => ({ readPackageInfo: mocks.readPackageInfo }))
// 插件目录动态扫描在 vitest 源码加载路径下解析不到仓库根，显式给出目标。
vi.mock('../src/config/targets.js', () => ({
  pluginTargets: [
    {
      value: 'codebuddy',
      label: 'CodeBuddy',
      name: '@tnnevol/dsh-codebuddy',
      filter: '@tnnevol/dsh-codebuddy...',
      path: 'plugins/dsh-codebuddy-plugin/package.json',
      slug: 'dsh-codebuddy',
      // 只在本机维护：源码被 gitignore，路径不得进暂存列表。
      localOnly: true,
    },
    {
      value: 'fnos',
      label: 'fnOS',
      name: '@tnnevol/dsh-fnos',
      filter: '@tnnevol/dsh-fnos...',
      path: 'plugins/dsh-fnos-plugin/package.json',
      slug: 'dsh-fnos',
      localOnly: false,
    },
  ],
}))

const { runVersion } = await import('../src/commands/version.js')
const { runVersionSync, pluginDocPageOf, readDshBaselineFromCatalog } = await import('../src/commands/version-sync.js')

describe('version 转发器（直接调用 bumpp CLI）', () => {
  const PROJECT_START = '5.10.0'

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.readPackageInfo.mockResolvedValue({ name: 'fn-os-apps', version: PROJECT_START })
    mocks.readFile.mockImplementation(async (path: string) => {
      if (path.endsWith('pnpm-workspace.yaml')) return "catalog:\n  '@deepseek-ai/dsh': 0.2.1-rc.2\n"
      return JSON.stringify({ name: 'package', version: PROJECT_START })
    })
    // 守卫的 git status 返回干净；bumpp spawn 成功。
    mocks.spawnSync.mockImplementation(() => ({ status: 0, error: undefined, stderr: '', stdout: '' }))
  })

  it('无位置参数时透传 bumpp 原生菜单（prompt），stdio inherit', async () => {
    await runVersion(['--yes'])

    expect(mocks.spawnSync).toHaveBeenCalledWith('node', [expect.any(String), 'prompt', '-y'], expect.objectContaining({
      cwd: expect.any(String),
      stdio: 'inherit',
    }))
  })

  it('档位与提交开关翻译为 bumpp 参数', async () => {
    await runVersion(['patch', '--yes'])
    expect(mocks.spawnSync).toHaveBeenLastCalledWith('node', [expect.any(String), 'patch', '-y'], expect.objectContaining({ stdio: 'inherit' }))

    await runVersion(['minor', '--no-commit', '--yes'])
    expect(mocks.spawnSync).toHaveBeenLastCalledWith('node', [expect.any(String), 'minor', '-y', '--no-commit'], expect.anything())

    // 交互模式（无 --yes）：不带 -y，bumpp 会弹原生 Bump? 确认。
    await runVersion(['major'])
    expect(mocks.spawnSync).toHaveBeenLastCalledWith('node', [expect.any(String), 'major'], expect.anything())
  })

  it('工作区不干净时拒绝发版（bumpp 提交以 all 模式收口，脏改动会被卷入）', async () => {
    mocks.spawnSync.mockImplementation((_: string, args: string[]) => ({
      status: 0,
      error: undefined,
      stderr: '',
      stdout: args?.[0] === 'status' ? ' M some-dirty-file.ts\n' : '',
    }))

    await expect(runVersion(['--yes'])).rejects.toThrow(/工作区不干净/u)
    const bumppCall = mocks.spawnSync.mock.calls.find(call => call[0] === 'node')
    expect(bumppCall).toBeUndefined()
  })

  it('拒绝不支持的档位与旧小尾巴形态版本串', async () => {
    await expect(runVersion(['prerelease', '--yes'])).rejects.toThrow(/不支持版本档位/u)
    await expect(runVersion(['5.10.1-0.2.1-rc.2.1', '--yes'])).rejects.toThrow(/不支持版本档位/u)
  })

  it('项目版本仍是旧小尾巴形态时拒绝并指引按 FNOS-028 统一', async () => {
    mocks.readPackageInfo.mockResolvedValue({ name: 'fn-os-apps', version: '5.9.0-0.2.1-rc.2.52' })
    await expect(runVersion(['--yes'])).rejects.toThrow(/FNOS-028/u)
  })

  it('catalog 未声明 DSH 基线时报错，不猜测', async () => {
    mocks.readFile.mockImplementation(async (path: string) => {
      if (path.endsWith('pnpm-workspace.yaml')) return 'catalog:\n  foo: 1.0.0\n'
      return JSON.stringify({ name: 'package', version: PROJECT_START })
    })
    await expect(runVersion(['--yes'])).rejects.toThrow(/deepseek-ai\/dsh/u)
  })

  it('major --baseline 在 spawn bumpp 前改写 catalog', async () => {
    await runVersion(['major', '--baseline', '0.2.2-rc.1', '--yes'])

    const yamlWrite = mocks.writeFile.mock.calls.find(call => String(call[0]).endsWith('pnpm-workspace.yaml'))
    expect(String(yamlWrite?.[1])).toContain("'@deepseek-ai/dsh': 0.2.2-rc.1")
    expect(mocks.spawnSync).toHaveBeenLastCalledWith('node', [expect.any(String), 'major', '-y'], expect.anything())
  })

  it('--baseline 搭配非 major 档位或与当前基线相同时被拒绝', async () => {
    await expect(runVersion(['patch', '--baseline', '0.2.2-rc.1', '--yes'])).rejects.toThrow(/major/u)
    await expect(runVersion(['minor', '--baseline', '0.2.2-rc.1', '--yes'])).rejects.toThrow(/major/u)
    await expect(runVersion(['major', '--baseline', '0.2.1-rc.2', '--yes'])).rejects.toThrow(/相同/u)
    await expect(runVersion(['--baseline', '--yes'])).rejects.toThrow(/--baseline/u)
  })
})

describe('version-sync（bumpp execute 钩子）', () => {
  const TARGET_VERSION = '5.10.1'

  beforeEach(() => {
    vi.clearAllMocks()
    // 根 package.json 已被 bumpp 替换为目标版本（execute 在替换后、提交前运行）。
    mocks.readPackageInfo.mockImplementation(async (path: string) => {
      if (path === 'package.json') return { name: 'fn-os-apps', version: TARGET_VERSION }
      if (path.includes('dsh-fnos')) return { name: '@tnnevol/dsh-fnos', version: '5.10.0' }
      return { name: '@tnnevol/dsh-codebuddy', version: '5.10.0' }
    })
    mocks.readFile.mockImplementation(async (path: string) => {
      if (path.endsWith('pnpm-workspace.yaml')) return "catalog:\n  '@deepseek-ai/dsh': 0.2.1-rc.2\n"
      if (path.endsWith('published-dsh-plugins.json')) {
        return JSON.stringify({
          version: 1,
          plugins: [
            { name: '@tnnevol/dsh-fnos', version: '5.10.0' },
          ],
        })
      }
      if (path.endsWith('manifest')) {
        // desc 基线字样故意是过期值，验证同步对齐 catalog。
        return `version = ${TARGET_VERSION}\ndesc = 插件化智能代理工具，运行基线为 DSH 0.2.0-rc.1。<br />主要功能\n`
      }
      if (path.endsWith('fn-deepseek-harness.md')) {
        return [
          '# DeepSeek Harness 应用',
          '',
          `| 应用版本 | \`${TARGET_VERSION}\` |`,
          '| DSH 基线 | `0.2.0-rc.2` |',
          '',
        ].join('\n')
      }
      if (path.endsWith('.md')) {
        return [
          '# plugin',
          '',
          '```sh',
          'dsh plugin --profile web add @tnnevol/dsh-fnos@5.10.0',
          '```',
          '',
          '| `@tnnevol/dsh-fnos` | `5.10.0` | x |',
        ].join('\n')
      }
      return JSON.stringify({ name: 'package', version: '5.10.0' })
    })
    mocks.spawnSync.mockReturnValue({ status: 0, error: undefined, stderr: '', stdout: '' })
  })

  it('把全部插件、副本、安装命令与基线字样同步到目标版本', async () => {
    await runVersionSync()

    const written: [string, string][] = mocks.writeFile.mock.calls.map(call => [String(call[0]), String(call[1])])
    const codebuddy = written.find(([p]) => p.includes('dsh-codebuddy') && p.endsWith('package.json'))
    const fnos = written.find(([p]) => p.includes('dsh-fnos') && p.endsWith('package.json'))
    expect(codebuddy?.[1]).toContain('"version": "5.10.1"')
    expect(fnos?.[1]).toContain('"version": "5.10.1"')

    const manifestWrite = written.find(([p]) => p.endsWith('/manifest'))
    expect(String(manifestWrite?.[1])).toContain('运行基线为 DSH 0.2.1-rc.2')

    const appDocWrite = written.find(([p]) => p.endsWith('fn-deepseek-harness.md'))
    expect(String(appDocWrite?.[1])).toContain('| DSH 基线 | `0.2.1-rc.2` |')

    const writtenMarkdown = written.filter(([p]) => p.endsWith('.md') && !p.endsWith('fn-deepseek-harness.md'))
    for (const [, content] of writtenMarkdown) {
      expect(String(content)).toContain('add @tnnevol/dsh-fnos@5.10.1')
    }
  })

  it('只在本机维护的插件照常升版本，但路径不进暂存列表', async () => {
    await runVersionSync()

    const addCall = mocks.spawnSync.mock.calls.find(call => (call[1] as string[] | undefined)?.[0] === 'add')
    const staged = (addCall?.[1] ?? []).join(' ')
    expect(staged).not.toContain('dsh-codebuddy-plugin')
    expect(staged).toContain('dsh-fnos-plugin')
  })

  it('published 副本与总览表格同步，避免用户照抄装到旧包', async () => {
    await runVersionSync()

    const publishedWrite = mocks.writeFile.mock.calls.find(call => String(call[0]).endsWith('published-dsh-plugins.json'))
    expect(String(publishedWrite?.[1])).toContain('"version": "5.10.1"')

    const indexWrite = mocks.writeFile.mock.calls.find(call => String(call[0]).endsWith('docs/plugins/index.md'))
    expect(String(indexWrite?.[1])).toContain('| `@tnnevol/dsh-fnos` | `5.10.1` |')
    expect(String(indexWrite?.[1])).toContain('add @tnnevol/dsh-fnos@5.10.1')
  })
})

describe('readDshBaselineFromCatalog：catalog 基线读取', () => {
  it('读取顶层 catalog 直系条目，忽略分组子包', () => {
    const yaml = [
      'catalog:',
      "  '@deepseek-ai/dsh': 0.2.1-rc.2",
      '  dsh:',
      "    '@deepseek-ai/dsh-agent': 0.2.1-rc.2",
    ].join('\n')
    expect(readDshBaselineFromCatalog(yaml)).toBe('0.2.1-rc.2')
  })

  it('未声明或形态非法时返回 undefined', () => {
    expect(readDshBaselineFromCatalog('catalog:\n  foo: 1.0.0\n')).toBeUndefined()
    expect(readDshBaselineFromCatalog("catalog:\n  '@deepseek-ai/dsh': not-a-version\n")).toBeUndefined()
  })
})

describe('pluginDocPageOf：文档站页面名解析', () => {
  it('按包名末段推导未登记的插件', () => {
    expect(pluginDocPageOf('@tnnevol/dsh-midscene')).toBe('dsh-midscene')
    expect(pluginDocPageOf('@tnnevol/dsh-failover-search')).toBe('dsh-failover-search')
  })

  it('已登记的插件仍按显式表解析', () => {
    expect(pluginDocPageOf('@tnnevol/dsh-codebuddy')).toBe('dsh-codebuddy')
    expect(pluginDocPageOf('@tnnevol/dsh-fnos')).toBe('dsh-fnos')
  })

  it('包名为空段时返回 undefined（不生成可疑路径）', () => {
    expect(pluginDocPageOf('@tnnevol/')).toBeUndefined()
    expect(pluginDocPageOf('')).toBeUndefined()
  })
})
