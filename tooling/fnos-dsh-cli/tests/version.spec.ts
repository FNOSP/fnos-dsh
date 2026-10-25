import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  askPlugin: vi.fn(),
  confirm: vi.fn(),
  select: vi.fn(),
  text: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  spawnSync: vi.fn(),
  readPackageInfo: vi.fn(),
  versionBump: vi.fn(),
}))

vi.mock('@clack/prompts', () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  confirm: mocks.confirm,
  isCancel: vi.fn(() => false),
  select: mocks.select,
  text: mocks.text,
}))
vi.mock('node:fs/promises', () => ({
  readFile: mocks.readFile,
  writeFile: mocks.writeFile,
}))
vi.mock('node:fs', async importOriginal => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  existsSync: vi.fn((path: unknown) => {
    const value = String(path)
    // Install commands live in each plugin README and its docs page.
    return value.endsWith('published-dsh-plugins.json') || value.endsWith('.md')
  }),
}))
vi.mock('node:child_process', () => ({ spawnSync: mocks.spawnSync }))
vi.mock('bumpp', () => ({ versionBump: mocks.versionBump }))
vi.mock('../src/core/package.js', () => ({ readPackageInfo: mocks.readPackageInfo }))
// 统一命令会遍历 `pluginTargets`。它按 `repositoryRoot` 扫描 plugins/ 目录，而 vitest
// 从源码路径加载时层级比打包产物多一层，扫描结果为空——那是加载路径差异，不是缺陷
// （打包后 `lib` → 包目录 → 仓库根可正确解析）。这里显式给出目标，让用例只验证命令
// 行为，不依赖真实目录扫描。
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

const { runVersion, readDshBaselineFromCatalog } = await import('../src/commands/version.js')

describe('统一版本命令（纯净 semver，项目与插件同号）', () => {
  /**
   * 固定起点：**项目与全部插件同号**（FNOS-028：插件直接沿用项目版本，
   * 不再有「去基础段前缀」的小尾巴派生）。
   */
  const PROJECT_START = '6.0.0'

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.readPackageInfo.mockImplementation(async (path: string) => {
      if (path === 'package.json') return { name: 'fn-os-apps', version: PROJECT_START }
      if (path.includes('dsh-fnos')) return { name: '@tnnevol/dsh-fnos', version: PROJECT_START }
      return { name: '@tnnevol/dsh-codebuddy', version: PROJECT_START }
    })
    mocks.versionBump.mockImplementation(async () => ({
      currentVersion: PROJECT_START,
      newVersion: '6.0.1',
    }))
    mocks.confirm.mockResolvedValue(true)
    mocks.readFile.mockImplementation(async (path: string) => {
      if (path.endsWith('pnpm-workspace.yaml')) return "catalog:\n  '@deepseek-ai/dsh': 0.2.1-rc.2\n"
      if (path.endsWith('published-dsh-plugins.json')) {
        return JSON.stringify({
          version: 1,
          plugins: [
            { name: '@tnnevol/dsh-fnos', version: PROJECT_START },
          ],
        })
      }
      if (path.endsWith('manifest')) {
        // fixture 里 desc 的基线字样故意是过期值，验证同步会把它改成 catalog 当前值。
        return `version = ${PROJECT_START}\ndesc = 插件化智能代理工具，运行基线为 DSH 0.2.0-rc.1。<br />主要功能\n`
      }
      if (path.endsWith('fn-deepseek-harness.md')) {
        return [
          '# DeepSeek Harness 应用',
          '',
          `| 应用版本 | \`${PROJECT_START}\` |`,
          '| DSH 基线 | `0.2.0-rc.2` |',
          '',
        ].join('\n')
      }
      if (path.endsWith('.md')) {
        // 安装命令必须跟随发版版本，否则用户照抄会装到旧包。
        return [
          '# plugin',
          '',
          '```sh',
          `dsh plugin --profile web add @tnnevol/dsh-fnos@${PROJECT_START}`,
          '```',
          '',
          `| \`@tnnevol/dsh-fnos\` | \`${PROJECT_START}\` | x |`,
        ].join('\n')
      }
      return JSON.stringify({ name: 'package', version: PROJECT_START })
    })
    mocks.spawnSync.mockReturnValue({ status: 0, error: undefined, stderr: '', stdout: '' })
  })

  it('patch 档位把项目与全部插件同号推进到 6.0.1', async () => {
    await runVersion(['--yes'])

    // 第一次调用是 dry-run 求目标版本：files 为空、传档位而非具体版本串。
    const dryRun = mocks.versionBump.mock.calls[0]?.[0] as { files?: string[], release?: string }
    expect(dryRun?.files).toEqual([])
    expect(dryRun?.release).toBe('patch')
    // 第二次写文件：以算好的具体版本串替换，且不让 bumpp 抢先提交。
    expect(mocks.versionBump).toHaveBeenLastCalledWith(expect.objectContaining({
      currentVersion: PROJECT_START,
      release: '6.0.1',
      commit: false,
      tag: false,
    }))

    const written: [string, string][] = mocks.writeFile.mock.calls.map(call => [String(call[0]), String(call[1])])
    const codebuddy = written.find(([p2]) => p2.includes('dsh-codebuddy') && p2.endsWith('package.json'))
    const fnos = written.find(([p2]) => p2.includes('dsh-fnos') && p2.endsWith('package.json'))
    // 插件与项目同号：都直接写 6.0.1。
    expect(codebuddy?.[1]).toContain('"version": "6.0.1"')
    expect(fnos?.[1]).toContain('"version": "6.0.1"')
  })

  it('minor / major 档位直接传给 bumpp 原生计算', async () => {
    mocks.versionBump.mockImplementation(async (options: { files?: string[], release?: string }) => ({
      currentVersion: PROJECT_START,
      newVersion: options.release === 'minor' ? '6.1.0' : '7.0.0',
    }))

    await runVersion(['minor', '--yes'])
    const minorDryRun = mocks.versionBump.mock.calls[0]?.[0] as { files?: string[], release?: string }
    expect(minorDryRun?.release).toBe('minor')

    mocks.versionBump.mockClear()
    await runVersion(['major', '--yes'])
    const majorDryRun = mocks.versionBump.mock.calls[0]?.[0] as { files?: string[], release?: string }
    expect(majorDryRun?.release).toBe('major')
  })

  it('只在本机维护的插件照常升版本，但路径不进暂存列表', async () => {
    await runVersion(['--yes'])

    // 版本号照常推进到本机文件——它还要靠这个版本号发布到 npm。
    const written: [string, string][] = mocks.writeFile.mock.calls.map(call => [String(call[0]), String(call[1])])
    const codebuddy = written.find(([path]) => path.includes('dsh-codebuddy') && path.endsWith('package.json'))
    expect(codebuddy?.[1]).toContain('"version": "6.0.1"')

    // 但它的路径不能进 `git add`：源码被 gitignore，git add 碰到被忽略的路径会以
    // 退出码 1 失败，把整个版本命令打断。
    const addCall = mocks.spawnSync.mock.calls.find(call => (call[1] as string[] | undefined)?.[0] === 'add')
    const staged = (addCall?.[1] ?? []).join(' ')
    expect(staged).not.toContain('dsh-codebuddy-plugin')
    expect(staged).toContain('dsh-fnos-plugin')
  })

  it('插件与项目不同号时拒绝发布，并指出是哪几个', async () => {
    // 有人绕过版本命令手工改过版本文件时，静默拉平会让「谁在何时改了版本」无从追溯，
    // 所以这里必须报错并点名。
    mocks.readPackageInfo.mockImplementation(async (path: string) => {
      if (path === 'package.json') return { name: 'fn-os-apps', version: PROJECT_START }
      if (path.includes('dsh-fnos')) return { name: '@tnnevol/dsh-fnos', version: '6.0.1' }
      return { name: '@tnnevol/dsh-codebuddy', version: PROJECT_START }
    })

    await expect(runVersion(['--yes'])).rejects.toThrow(/不同号/u)
    await expect(runVersion(['--yes'])).rejects.toThrow(/dsh-fnos@6\.0\.1/u)
    expect(mocks.versionBump).not.toHaveBeenCalled()
  })

  it('拒绝不支持的档位与旧小尾巴形态版本串', async () => {
    await expect(runVersion(['prerelease', '--yes'])).rejects.toThrow(/不支持版本档位/u)
    // 旧 FNOS-019 小尾巴习惯：传带预发布段的完整版本串必须被拒绝并指引。
    await expect(runVersion(['6.0.1-0.2.1-rc.2.1', '--yes'])).rejects.toThrow(/不支持版本档位/u)
    expect(mocks.versionBump).not.toHaveBeenCalled()
  })

  it('项目版本仍是旧小尾巴形态时拒绝并指引按 FNOS-028 统一', async () => {
    mocks.readPackageInfo.mockImplementation(async (path: string) => {
      if (path === 'package.json') return { name: 'fn-os-apps', version: '5.9.0-0.2.1-rc.2.52' }
      return { name: '@tnnevol/dsh-fnos', version: '0.2.1-rc.2.52' }
    })

    await expect(runVersion(['--yes'])).rejects.toThrow(/FNOS-028/u)
    expect(mocks.versionBump).not.toHaveBeenCalled()
  })

  it('重写安装命令与清单版本，避免用户照抄装到旧包', async () => {
    await runVersion(['--no-commit', '--yes'])

    const writtenMarkdown = mocks.writeFile.mock.calls
      .filter(call => String(call[0]).endsWith('.md') && !String(call[0]).endsWith('fn-deepseek-harness.md'))
    // 用后缀比对：`repositoryRoot` 相对导入模块解析，打包版与源码版前缀不同。
    expect(writtenMarkdown.map(call => String(call[0]).replace(/^.*?(?=docs\/|plugins\/)/u, '')))
      .toEqual(['docs/plugins/index.md', 'plugins/dsh-fnos-plugin/README.md', 'docs/plugins/dsh-fnos.md'])
    for (const [, content] of writtenMarkdown) {
      expect(String(content)).toContain('add @tnnevol/dsh-fnos@6.0.1')
      expect(String(content)).not.toContain('add @tnnevol/dsh-fnos@6.0.0')
    }
    expect(String(writtenMarkdown[0]?.[1])).toContain('| `@tnnevol/dsh-fnos` | `6.0.1` |')
  })

  it('同步 manifest 描述与应用文档页的 DSH 基线字样', async () => {
    await runVersion(['--no-commit', '--yes'])

    const manifestWrite = mocks.writeFile.mock.calls.find(call => String(call[0]).endsWith('/manifest'))
    // desc 中的基线字样对齐到 catalog 当前值（fixture 里 manifest 为过期的 0.2.0-rc.1，
    // 应用文档页为过期的 0.2.0-rc.2——两者都必须被同步）。
    expect(String(manifestWrite?.[1])).toContain('运行基线为 DSH 0.2.1-rc.2')

    const appDocWrite = mocks.writeFile.mock.calls.find(call => String(call[0]).endsWith('fn-deepseek-harness.md'))
    expect(String(appDocWrite?.[1])).toContain('| DSH 基线 | `0.2.1-rc.2` |')
    expect(String(appDocWrite?.[1])).not.toContain('0.2.0-rc.2')
  })

  it('--no-commit 时只写文件不提交', async () => {
    await runVersion(['--no-commit', '--yes'])

    expect(mocks.writeFile).toHaveBeenCalled()
    expect(mocks.spawnSync).not.toHaveBeenCalled()
  })

  it('catalog 未声明 DSH 基线时报错，不猜测', async () => {
    mocks.readFile.mockImplementation(async (path: string) => {
      if (path.endsWith('pnpm-workspace.yaml')) return 'catalog:\n  foo: 1.0.0\n'
      return JSON.stringify({ name: 'package', version: PROJECT_START })
    })

    await expect(runVersion(['--yes'])).rejects.toThrow(/deepseek-ai\/dsh/u)
    expect(mocks.versionBump).not.toHaveBeenCalled()
  })

  it('major --baseline 切换 DSH 基线：确认后改 catalog，版本走 major', async () => {
    mocks.versionBump.mockImplementation(async () => ({
      currentVersion: PROJECT_START,
      newVersion: '7.0.0',
    }))

    await runVersion(['major', '--baseline', '0.2.2-rc.1', '--no-commit', '--yes'])

    // catalog 被改写为新基线
    const yamlWrite = mocks.writeFile.mock.calls.find(call => String(call[0]).endsWith('pnpm-workspace.yaml'))
    expect(String(yamlWrite?.[1])).toContain("'@deepseek-ai/dsh': 0.2.2-rc.1")

    // 版本按 major 计算，与基线值无关（基线不进版本号）。
    const dryRun = mocks.versionBump.mock.calls[0]?.[0] as { release?: string }
    expect(dryRun?.release).toBe('major')

    // manifest 与应用文档页的基线字样同步到新基线。
    const manifestWrite = mocks.writeFile.mock.calls.find(call => String(call[0]).endsWith('/manifest'))
    expect(String(manifestWrite?.[1])).toContain('运行基线为 DSH 0.2.2-rc.1')
    const appDocWrite = mocks.writeFile.mock.calls.find(call => String(call[0]).endsWith('fn-deepseek-harness.md'))
    expect(String(appDocWrite?.[1])).toContain('| DSH 基线 | `0.2.2-rc.1` |')

    // 插件与项目同号推进到 major 版本。
    const written: [string, string][] = mocks.writeFile.mock.calls.map(call => [String(call[0]), String(call[1])])
    const fnos = written.find(([p2]) => p2.includes('dsh-fnos') && p2.endsWith('package.json'))
    expect(fnos?.[1]).toContain('"version": "7.0.0"')
  })

  it('--baseline 不触碰插件里的 DSH 依赖声明', async () => {
    mocks.versionBump.mockImplementation(async () => ({
      currentVersion: PROJECT_START,
      newVersion: '7.0.0',
    }))
    // 依赖升级由 pnpm install 单独完成，版本命令只改版本号。
    await runVersion(['major', '--baseline', '0.2.2-rc.1', '--no-commit', '--yes'])

    const written: [string, string][] = mocks.writeFile.mock.calls.map(call => [String(call[0]), String(call[1])])
    for (const [path, content] of written) {
      if (!path.endsWith('package.json')) continue
      // 只允许 version 字段变化；这里断言没把依赖写成新基线。
      expect(content).not.toMatch(/"@deepseek-ai\/dsh-[a-z-]+":\s*"0\.2\.2-rc\.1"/u)
    }
  })

  it('--baseline 搭配非 major 档位或与当前基线相同时被拒绝', async () => {
    await expect(runVersion(['patch', '--baseline', '0.2.2-rc.1', '--yes'])).rejects.toThrow(/major/u)
    await expect(runVersion(['minor', '--baseline', '0.2.2-rc.1', '--yes'])).rejects.toThrow(/major/u)
    // 与当前基线相同：走 major 档位时才会到达同值校验（档位校验在前）。
    await expect(runVersion(['major', '--baseline', '0.2.1-rc.2', '--yes'])).rejects.toThrow(/相同/u)
    await expect(runVersion(['--baseline', '--yes'])).rejects.toThrow(/--baseline/u)
    expect(mocks.versionBump).not.toHaveBeenCalled()
  })

  it('显式传与当前相同的版本号时幂等返回，不产生空提交', async () => {
    mocks.versionBump.mockImplementation(async () => ({
      currentVersion: PROJECT_START,
      newVersion: PROJECT_START,
    }))

    await runVersion(['6.0.0', '--yes'])

    // 没有文件要写、没有 git 调用（空提交会被 git 拒绝）。
    expect(mocks.writeFile).not.toHaveBeenCalled()
    expect(mocks.spawnSync).not.toHaveBeenCalled()
  })

  it('不再弹出「选择要维护版本的区域」', async () => {
    // 区域选择已移除；命令不带位置参数即可跑完，不该调用任何选择/文本输入提示。
    await runVersion(['--yes'])

    expect(mocks.select).not.toHaveBeenCalled()
    expect(mocks.text).not.toHaveBeenCalled()
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
  // 约定：页面名 == 包名末段，未显式登记时按此推导。这是一处**根因修复**：
  // `dsh-failover-search` 与 `dsh-midscene` 曾漏登记在显式表里，导致发版时
  // `docs/plugins/<页面>.md` 的安装命令不被重写、停在旧版本，用户照抄装到旧包。
  it('按包名末段推导未登记的插件', async () => {
    const { pluginDocPageOf } = await import('../src/commands/version.js')
    expect(pluginDocPageOf('@tnnevol/dsh-midscene')).toBe('dsh-midscene')
    expect(pluginDocPageOf('@tnnevol/dsh-failover-search')).toBe('dsh-failover-search')
  })

  it('已登记的插件仍按显式表解析', async () => {
    const { pluginDocPageOf } = await import('../src/commands/version.js')
    expect(pluginDocPageOf('@tnnevol/dsh-codebuddy')).toBe('dsh-codebuddy')
    expect(pluginDocPageOf('@tnnevol/dsh-fnos')).toBe('dsh-fnos')
  })

  it('包名为空段时返回 undefined（不生成可疑路径）', async () => {
    const { pluginDocPageOf } = await import('../src/commands/version.js')
    expect(pluginDocPageOf('@tnnevol/')).toBeUndefined()
    expect(pluginDocPageOf('')).toBeUndefined()
  })
})
