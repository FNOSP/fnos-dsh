import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const temporaryDirectories: string[] = []

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(temporaryDirectories.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

const mocks = vi.hoisted(() => ({
  runCommand: vi.fn(),
  execFile: vi.fn(),
  maintainLatestTag: vi.fn(),
  askPublishPlugins: vi.fn(),
  readFile: vi.fn(),
}))

const targets = [
  {
    value: 'alpha',
    label: 'Plugin Alpha',
    name: '@tnnevol/dsh-codebuddy',
    filter: '@tnnevol/dsh-codebuddy...',
    path: 'plugins/dsh-codebuddy-plugin/package.json',
    slug: 'dsh-codebuddy',
  },
  {
    value: 'beta',
    label: 'Plugin Beta',
    name: '@tnnevol/dsh-codex-auth',
    filter: '@tnnevol/dsh-codex-auth...',
    path: 'plugins/dsh-codex-auth-plugin/package.json',
    slug: 'dsh-codex-auth',
  },
]

vi.mock('../src/config/targets.js', () => ({ pluginTargets: targets, findPluginTarget: vi.fn() }))
vi.mock('../src/core/process.js', () => ({ runCommand: mocks.runCommand }))
vi.mock('../src/commands/publish-latest.js', () => ({ maintainLatestTag: mocks.maintainLatestTag }))
vi.mock('../src/ui/prompts.js', () => ({ askPublishPlugins: mocks.askPublishPlugins }))
// 发布流程先用 `pnpm pack` 出产物再校验（只有 pnpm 会解析 catalog:），用例里用假产物替代。
vi.mock('node:child_process', async importOriginal => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  execFile: mocks.execFile,
}))
vi.mock('node:fs/promises', async importOriginal => ({
  ...(await importOriginal<typeof import('node:fs/promises')>()),
  readFile: mocks.readFile,
}))

const { runPublish } = await import('../src/commands/publish.js')

describe('publish：latest 维护失败不中断整批发布', () => {
  // 实测背景：`dist-tag` 需要写权限，而 `pnpm publish` 有浏览器授权兜底、`npm dist-tag`
  // 没有——凭据过期时只有后者 401。该失败曾中断循环，导致本批其余插件根本没被发布，
  // 而它们本可以成功。包已发出，dist-tag 是事后可补的动作，不该拖垮发布本身。
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.askPublishPlugins.mockResolvedValue(targets)
    mocks.runCommand.mockResolvedValue(undefined)
    mocks.readFile.mockResolvedValue(JSON.stringify({ name: 'x', version: '1.2.3' }))
    // `pnpm pack` 输出产物路径；`tar -xzOf` 输出已解析 catalog: 的清单。
    //
    // 必须一并提供 `util.promisify.custom`：真实 `execFile` 自带该符号（解析为
    // `{stdout, stderr}`），只替换 `execFile` 会丢掉它，promisify 退化为「等回调」——
    // 而这里的桩返回 Promise、从不调回调，于是整个用例挂到超时（实测踩到）。
    const impl = (command: string): Promise<{ stdout: string, stderr: string }> => {
      if (command === 'pnpm') return Promise.resolve({ stdout: '/tmp/fake-package.tgz\n', stderr: '' })
      if (command === 'tar') {
        return Promise.resolve({
          stdout: JSON.stringify({ name: '@tnnevol/dsh-x', version: '1.2.3', dependencies: { dayjs: '^1.11.13' } }),
          stderr: '',
        })
      }
      return Promise.reject(new Error(`unexpected command ${command}`))
    }
    mocks.execFile.mockImplementation(impl)
    Object.defineProperty(mocks.execFile, Symbol.for('nodejs.util.promisify.custom'), {
      value: impl,
      configurable: true,
    })
  })

  it('某个插件的 latest 维护抛错时，仍发布其余插件且不抛出', async () => {
    mocks.maintainLatestTag
      .mockRejectedValueOnce(new Error('npm error code E401'))
      .mockResolvedValueOnce(undefined)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(runPublish([])).resolves.toBeUndefined()

    // 两个插件都执行了 `pnpm run publish:next`
    expect(mocks.runCommand).toHaveBeenCalledTimes(2)
    const published = mocks.runCommand.mock.calls.map(call => String(call[2]))
    expect(published.some(dir => dir.includes('dsh-codebuddy-plugin'))).toBe(true)
    expect(published.some(dir => dir.includes('dsh-codex-auth-plugin'))).toBe(true)
    // 第二个插件的维护仍被调用（循环没有在第一处断掉）
    expect(mocks.maintainLatestTag).toHaveBeenCalledTimes(2)
    // 失败被降级为警告，并给出可执行的补救命令
    const warnings = warn.mock.calls.flat().join('\n')
    expect(warnings).toContain('不影响本次发布')
    expect(warnings).toContain('npm dist-tag add @tnnevol/dsh-codebuddy@1.2.3 latest')
    warn.mockRestore()
  })

  it('发布本身失败时仍然抛出（不吞掉真正的失败）', async () => {
    mocks.runCommand.mockRejectedValueOnce(new Error('npm publish 失败'))

    await expect(runPublish([])).rejects.toThrow('npm publish 失败')
  })
})
