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

describe('plugin version command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.askPlugin.mockResolvedValue(targets)
    mocks.readPackageInfo.mockImplementation(async (path: string) => ({
      name: path.includes('codex-auth') ? '@tnnevol/dsh-codex-auth' : '@tnnevol/dsh-fnos',
      version: '1.2.3',
    }))
    mocks.versionBump.mockResolvedValue({ currentVersion: '1.2.3', newVersion: '1.2.4' })
    mocks.select.mockResolvedValue('patch')
    mocks.text.mockResolvedValue('1.2.3')
    mocks.confirm.mockResolvedValue(true)
    mocks.readFile.mockImplementation(async (path: string) => {
      if (path.endsWith('published-dsh-plugins.json')) {
        return JSON.stringify({
          version: 1,
          plugins: [
            { name: '@tnnevol/dsh-codex-auth', version: '1.2.2' },
            { name: '@tnnevol/dsh-fnos', version: '1.2.2' },
          ],
        })
      }
      // Markdown carries the user-facing install command, which must track the
      // released version like the manifest does.
      if (path.endsWith('.md')) {
        return [
          '# plugin',
          '',
          '```sh',
          `dsh plugin --profile web add ${path.includes('codex-auth') ? '@tnnevol/dsh-codex-auth' : '@tnnevol/dsh-fnos'}@1.2.2`,
          '```',
          '',
          '| `@tnnevol/dsh-fnos` | `1.2.2` | x |',
        ].join('\n')
      }
      return JSON.stringify({ name: 'plugin', version: '1.2.3' })
    })
    mocks.spawnSync.mockReturnValue({ status: 0, error: undefined, stderr: '', stdout: '' })
  })

  it('updates selected plugin packages and the published plugin manifest in one commit', async () => {
    await runVersion(['plugin', '--yes'])

    expect(mocks.versionBump).not.toHaveBeenCalled()
    const writtenPaths = mocks.writeFile.mock.calls.map(call => String(call[0]))
    expect(writtenPaths.filter(path => path.endsWith('/package.json'))).toHaveLength(2)
    expect(writtenPaths.filter(path => path.endsWith('published-dsh-plugins.json'))).toHaveLength(2)
    expect(mocks.spawnSync).toHaveBeenNthCalledWith(1, 'git', ['add', '--', ...targets.map(target => target.path), 'apps/fn-deepseek-harness/app/published-dsh-plugins.json', 'docs/plugins/index.md', 'plugins/dsh-codex-auth-plugin/README.md', 'docs/plugins/dsh-codex-auth.md', 'plugins/dsh-fnos-plugin/README.md', 'docs/plugins/dsh-fnos.md'], expect.any(Object))
    expect(mocks.spawnSync).toHaveBeenNthCalledWith(2, 'git', ['commit', '-m', 'chore(plugin): release selected plugins v1.2.4'], expect.any(Object))
  })

  it('updates one plugin and synchronizes its matching manifest entry', async () => {
    mocks.askPlugin.mockResolvedValue([targets[1]])
    mocks.readPackageInfo.mockResolvedValue({ name: '@tnnevol/dsh-fnos', version: '1.2.3' })
    await runVersion(['plugin', '--yes'])

    // package.json + manifest + index table + README install command + docs install command
    expect(mocks.writeFile).toHaveBeenCalledTimes(5)
    expect(mocks.spawnSync).toHaveBeenNthCalledWith(2, 'git', ['commit', '-m', 'chore(plugin): release @tnnevol/dsh-fnos v1.2.4'], expect.any(Object))
  })

  it('rewrites the install command version so a released plugin is not installed stale', async () => {
    mocks.askPlugin.mockResolvedValue([targets[1]])
    mocks.readPackageInfo.mockResolvedValue({ name: '@tnnevol/dsh-fnos', version: '1.2.3' })
    await runVersion(['plugin', '--no-commit', '--yes'])

    const writtenMarkdown = mocks.writeFile.mock.calls.filter(call => String(call[0]).endsWith('.md'))
    // Assert on suffixes: `repositoryRoot` resolves relative to the importing
    // module, so the absolute prefix differs between the bundled CLI and the
    // source layout vitest loads.
    expect(writtenMarkdown.map(call => String(call[0]).replace(/^.*?(?=docs\/|plugins\/)/u, ''))).toEqual([
      'docs/plugins/index.md',
      'plugins/dsh-fnos-plugin/README.md',
      'docs/plugins/dsh-fnos.md',
    ])
    for (const [, content] of writtenMarkdown) {
      const text = String(content)
      expect(text).toContain('add @tnnevol/dsh-fnos@1.2.4')
      // The DSH compatibility baseline is prose, not an install command: it
      // must survive the rewrite untouched.
      expect(text).not.toContain('add @tnnevol/dsh-fnos@1.2.2')
    }
    // Another plugin's install line must not be rewritten.
    expect(String(writtenMarkdown[0]?.[1])).toContain('| `@tnnevol/dsh-fnos` | `1.2.4` |')
  })

  it('accepts a custom version from the interactive release prompt', async () => {
    mocks.askPlugin.mockResolvedValue([targets[1]])
    mocks.readPackageInfo.mockResolvedValue({ name: '@tnnevol/dsh-fnos', version: '1.2.3' })
    mocks.select.mockResolvedValue('custom')
    mocks.text.mockResolvedValue('2.0.0-beta.1')

    await runVersion(['plugin', '--no-commit', '--yes'])

    expect(mocks.text).toHaveBeenCalledWith(expect.objectContaining({
      message: '输入新的版本号',
      initialValue: '1.2.3',
      validate: expect.any(Function),
    }))
    const textOptions = mocks.text.mock.calls[0]?.[0] as { validate: (value: string) => string | undefined }
    expect(textOptions.validate('invalid')).toBe('无效的插件版本号')
    expect(textOptions.validate(' v2.0.0 ')).toBeUndefined()
    const writtenPackage = mocks.writeFile.mock.calls.find(call => String(call[0]).endsWith('package.json'))
    expect(writtenPackage?.[1]).toContain('2.0.0-beta.1')
  })

  it('rejects a combined release when plugin versions differ', async () => {
    mocks.readPackageInfo
      .mockResolvedValueOnce({ name: '@tnnevol/dsh-codex-auth', version: '1.2.3' })
      .mockResolvedValueOnce({ name: '@tnnevol/dsh-fnos', version: '1.2.2' })

    await expect(runVersion(['plugin'])).rejects.toThrow('same current version')
    expect(mocks.versionBump).not.toHaveBeenCalled()
  })

  it('does not commit when --no-commit is provided', async () => {
    await runVersion(['plugin', '--no-commit', '--yes'])

    expect(mocks.writeFile).toHaveBeenCalled()
    expect(mocks.spawnSync).not.toHaveBeenCalled()
  })

  it('aligns the docs and CLI packages, Harness manifest, and docs example for project releases', async () => {
    // 项目版本按 FNOS-019 是 `<基础段>-<DSH 基线>.<迭代号>`：基础段原样继承当前版本，
    // 基线取自 catalog，只递增迭代号。这里让当前版本是该形态的 .4，断言发布后落在 .5。
    mocks.readPackageInfo.mockResolvedValue({ name: 'fn-os-apps', version: '5.9.0-0.2.1-rc.2.4' })
    mocks.readFile.mockImplementation(async (path: string) => {
      if (path.endsWith('pnpm-workspace.yaml')) return "catalog:\n  '@deepseek-ai/dsh': 0.2.1-rc.2\n"
      // 这两个包故意给旧版本：align 只在「与根版本不同」时才写盘，若给同版本就测不到
      // 对齐行为本身了（原测试也是这么构造的）。
      if (path.endsWith('docs/package.json')) return JSON.stringify({ name: '@tnnevol/fn-os-apps-docs', version: '5.9.0-0.2.1-rc.2.3' })
      if (path.endsWith('tooling/fnos-dsh-cli/package.json')) return JSON.stringify({ name: '@tnnevol/fnos-dsh-cli', version: '0.0.0' })
      if (path.endsWith('apps/fn-deepseek-harness/manifest')) return 'version               = 5.9.0-0.2.1-rc.2.3\n'
      if (path.endsWith('docs/development/manifest.md')) return 'version               = 5.9.0-0.2.1-rc.2.3\n'
      return JSON.stringify({ name: 'package', version: '5.9.0-0.2.1-rc.2.4' })
    })

    await runVersion(['project', 'patch', '--no-commit', '--no-tag', '--yes'])

    const writtenPaths = mocks.writeFile.mock.calls.map(call => String(call[0]))
    expect(writtenPaths.filter(path => path.endsWith('docs/package.json'))).toHaveLength(1)
    expect(writtenPaths.filter(path => path.endsWith('tooling/fnos-dsh-cli/package.json'))).toHaveLength(1)
    expect(writtenPaths.filter(path => path.endsWith('apps/fn-deepseek-harness/manifest'))).toHaveLength(1)
    expect(writtenPaths.filter(path => path.endsWith('docs/development/manifest.md'))).toHaveLength(1)
    expect(mocks.versionBump).toHaveBeenCalledWith(expect.objectContaining({
      files: expect.arrayContaining([
        'docs/package.json',
        'tooling/fnos-dsh-cli/package.json',
        'docs/development/manifest.md',
      ]),
      // 关键：交付给 bumpp 的是算好的具体版本串，不是 `patch` 之类的档位关键字
      // ——档位会移动前三段，与本方案「前三段固定」冲突。
      release: '5.9.0-0.2.1-rc.2.5',
    }))
  })

  it('rejects a project release when the version is still a bare MAJOR.MINOR.PATCH', async () => {
    // 裸版本缺基线与迭代号两段，不符合本方案形态；此时必须失败而不是照着发。
    // 注意校验的是**形态**，不认基础段的具体值——换个基础段照样合法。
    mocks.readPackageInfo.mockResolvedValue({ name: 'fn-os-apps', version: '5.9.0' })
    mocks.readFile.mockImplementation(async (path: string) => {
      if (path.endsWith('pnpm-workspace.yaml')) return "catalog:\n  '@deepseek-ai/dsh': 0.2.1-rc.2\n"
      return JSON.stringify({ name: 'package', version: '5.9.0' })
    })

    await expect(runVersion(['project', 'patch', '--no-commit', '--no-tag', '--yes']))
      .rejects.toThrow(/FNOS-019/u)
    expect(mocks.versionBump).not.toHaveBeenCalled()
  })

  it('rejects a project release when the catalog does not declare the DSH baseline', async () => {
    // 基线不可猜测：缺声明时直接失败，避免产出一个来路不明的基线段。
    mocks.readPackageInfo.mockResolvedValue({ name: 'fn-os-apps', version: '5.9.0-0.2.1-rc.2.4' })
    mocks.readFile.mockImplementation(async (path: string) => {
      if (path.endsWith('pnpm-workspace.yaml')) return 'catalog:\n  foo: 1.0.0\n'
      return JSON.stringify({ name: 'package', version: '5.9.0-0.2.1-rc.2.4' })
    })

    await expect(runVersion(['project', 'patch', '--no-commit', '--no-tag', '--yes']))
      .rejects.toThrow(/deepseek-ai\/dsh/u)
    expect(mocks.versionBump).not.toHaveBeenCalled()
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
