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
    },
    {
      value: 'fnos',
      label: 'fnOS',
      name: '@tnnevol/dsh-fnos',
      filter: '@tnnevol/dsh-fnos...',
      path: 'plugins/dsh-fnos-plugin/package.json',
      slug: 'dsh-fnos',
    },
  ],
}))
vi.mock('../src/ui/prompts.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/ui/prompts.js')>()),
  askPlugin: mocks.askPlugin,
}))

const { runVersion } = await import('../src/commands/version.js')

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

describe('统一版本命令（项目 + 全部插件一次发布）', () => {
  /**
   * 固定起点：项目版本合法；插件版本带预发布段且**彼此不同**——真实仓库就是这样
   * （fnos 0.2.1-rc.2.5、midscene 0.2.1-rc.2.3、其余 0.2.1-rc.2.2）。用不同版本
   * 是為了守住「逐个在自己值上递增、不强行对齐」这条。
   */
  const PLUGIN_START: Record<string, string> = {
    '@tnnevol/dsh-codebuddy': '0.2.1-rc.2.2',
    '@tnnevol/dsh-fnos': '0.2.1-rc.2.5',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.readPackageInfo.mockImplementation(async (path: string) => {
      if (path === 'package.json') return { name: 'fn-os-apps', version: '5.9.0-0.2.1-rc.2.4' }
      if (path.includes('dsh-fnos')) return { name: '@tnnevol/dsh-fnos', version: '0.2.1-rc.2.5' }
      return { name: '@tnnevol/dsh-codebuddy', version: '0.2.1-rc.2.2' }
    })
    mocks.versionBump.mockResolvedValue({
      currentVersion: '5.9.0-0.2.1-rc.2.4',
      newVersion: '5.9.0-0.2.1-rc.2.5',
    })
    mocks.confirm.mockResolvedValue(true)
    mocks.readFile.mockImplementation(async (path: string) => {
      if (path.endsWith('pnpm-workspace.yaml')) return "catalog:\n  '@deepseek-ai/dsh': 0.2.1-rc.2\n"
      if (path.endsWith('published-dsh-plugins.json')) {
        return JSON.stringify({
          version: 1,
          plugins: Object.entries(PLUGIN_START).map(([name, version]) => ({ name, version })),
        })
      }
      if (path.endsWith('.md')) {
        // 安装命令必须跟随发版版本，否则用户照抄会装到旧包。
        return [
          '# plugin',
          '',
          '```sh',
          'dsh plugin --profile web add @tnnevol/dsh-fnos@0.2.1-rc.2.5',
          '```',
          '',
          '| `@tnnevol/dsh-fnos` | `0.2.1-rc.2.5` | x |',
        ].join('\n')
      }
      return JSON.stringify({ name: 'package', version: '5.9.0-0.2.1-rc.2.4' })
    })
    mocks.spawnSync.mockReturnValue({ status: 0, error: undefined, stderr: '', stdout: '' })
  })

  it('一次发布同时推进项目迭代号与全部插件版本，落同一条提交', async () => {
    await runVersion(['--yes'])

    // 项目侧交给 bumpp 的是算好的具体版本串（不是档位关键字），且不让它抢先提交。
    expect(mocks.versionBump).toHaveBeenCalledWith(expect.objectContaining({
      currentVersion: '5.9.0-0.2.1-rc.2.4',
      release: '5.9.0-0.2.1-rc.2.5',
      commit: false,
      tag: false,
    }))

    const written = mocks.writeFile.mock.calls.map(call => [String(call[0]), String(call[1])])
    // 两个插件各自递增：0.2.1-rc.2.2 → .3，0.2.1-rc.2.5 → .6
    const codebuddy = written.find(([path]) => path.includes('dsh-codebuddy') && path.endsWith('package.json'))
    const fnos = written.find(([path]) => path.includes('dsh-fnos') && path.endsWith('package.json'))
    expect(codebuddy?.[1]).toContain('"version": "0.2.1-rc.2.3"')
    expect(fnos?.[1]).toContain('"version": "0.2.1-rc.2.6"')
  })

  it('插件版本各不相同也能合并发布（不强行对齐到同一版本）', async () => {
    // 若强行对齐，从未改动的插件会凭空跳号，已发布版本的历史也会被改写。
    await expect(runVersion(['--yes'])).resolves.toBeUndefined()

    const written = mocks.writeFile.mock.calls.map(call => [String(call[0]), String(call[1])])
    expect(written.find(([p2]) => p2.includes('dsh-fnos') && p2.endsWith('package.json'))?.[1])
      .toContain('"version": "0.2.1-rc.2.6"')
    expect(written.find(([p2]) => p2.includes('dsh-codebuddy') && p2.endsWith('package.json'))?.[1])
      .toContain('"version": "0.2.1-rc.2.3"')
  })

  it('对带预发布段的插件版本，patch 不会丢掉预发布段（否则等于降级）', async () => {
    // `0.2.1-rc.2.5` 用字面 patch 会得到 `0.2.1`——预发布段被丢弃，版本反而变小。
    // 命令内部把默认档位换成 prerelease，这里锁住该行为。
    await runVersion(['patch', '--no-commit', '--yes'])

    const written = mocks.writeFile.mock.calls.map(call => [String(call[0]), String(call[1])])
    const fnos = written.find(([path]) => path.includes('dsh-fnos') && path.endsWith('package.json'))
    expect(fnos?.[1]).toContain('"version": "0.2.1-rc.2.6"')
    expect(fnos?.[1]).not.toContain('"version": "0.2.1"')
  })

  it('重写安装命令与清单版本，避免用户照抄装到旧包', async () => {
    await runVersion(['--no-commit', '--yes'])

    const writtenMarkdown = mocks.writeFile.mock.calls.filter(call => String(call[0]).endsWith('.md'))
    // 用后缀比对：`repositoryRoot` 相对导入模块解析，打包版与源码版前缀不同。
    expect(writtenMarkdown.map(call => String(call[0]).replace(/^.*?(?=docs\/|plugins\/)/u, '')))
      .toEqual(['docs/plugins/index.md', 'plugins/dsh-fnos-plugin/README.md', 'docs/plugins/dsh-fnos.md'])
    for (const [, content] of writtenMarkdown) {
      expect(String(content)).toContain('add @tnnevol/dsh-fnos@0.2.1-rc.2.6')
      expect(String(content)).not.toContain('add @tnnevol/dsh-fnos@0.2.1-rc.2.5')
    }
    expect(String(writtenMarkdown[0]?.[1])).toContain('| `@tnnevol/dsh-fnos` | `0.2.1-rc.2.6` |')
  })

  it('--no-commit 时只写文件不提交', async () => {
    await runVersion(['--no-commit', '--yes'])

    expect(mocks.writeFile).toHaveBeenCalled()
    expect(mocks.spawnSync).not.toHaveBeenCalled()
  })

  it('拒绝裸 MAJOR.MINOR.PATCH 的项目版本（形态校验）', async () => {
    mocks.readPackageInfo.mockImplementation(async (path: string) => {
      if (path === 'package.json') return { name: 'fn-os-apps', version: '5.9.0' }
      return { name: '@tnnevol/dsh-fnos', version: '0.2.1-rc.2.5' }
    })

    await expect(runVersion(['--yes'])).rejects.toThrow(/FNOS-019/u)
    expect(mocks.versionBump).not.toHaveBeenCalled()
  })

  it('catalog 未声明 DSH 基线时报错，不猜测', async () => {
    mocks.readFile.mockImplementation(async (path: string) => {
      if (path.endsWith('pnpm-workspace.yaml')) return 'catalog:\n  foo: 1.0.0\n'
      return JSON.stringify({ name: 'package', version: '5.9.0-0.2.1-rc.2.4' })
    })

    await expect(runVersion(['--yes'])).rejects.toThrow(/deepseek-ai\/dsh/u)
    expect(mocks.versionBump).not.toHaveBeenCalled()
  })

  it('不再弹出「选择要维护版本的区域」', async () => {
    // 区域选择已移除；命令不带位置参数即可跑完，不该调用任何选择/文本输入提示。
    await runVersion(['--yes'])

    expect(mocks.select).not.toHaveBeenCalled()
    expect(mocks.text).not.toHaveBeenCalled()
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
