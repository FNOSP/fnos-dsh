import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  runCommand: vi.fn(),
  execFile: vi.fn(),
}))

vi.mock('../src/core/process.js', () => ({ runCommand: mocks.runCommand }))
vi.mock('node:child_process', async importOriginal => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  execFile: mocks.execFile,
}))

const { maintainLatestTag } = await import('../src/commands/publish-latest.js')

/** 让 `npm view <pkg> versions --json` 返回给定版本列表。
 *
 * **必须一并提供 `util.promisify.custom`**：真实 `execFile` 自带该符号，解析结果是
 * `{ stdout, stderr }`；只替换 `execFile` 会丢掉它，`promisify` 退化为「原样返回回调
 * 第二个参数」，于是 `npmVersions` 里的 `const { stdout } = …` 拿到 `undefined`、
 * `JSON.parse` 抛错并被它自己的 try/catch 吞掉——表现为「读不到版本列表」，与真实的
 * 「读到了版本」是两条不同的分支（实测因此让断言假失败）。 */
function stubNpmVersions(versions: string[]): void {
  const impl = (): Promise<{ stdout: string, stderr: string }> =>
    Promise.resolve({ stdout: JSON.stringify(versions), stderr: '' })
  mocks.execFile.mockImplementation(impl)
  Object.defineProperty(mocks.execFile, Symbol.for('nodejs.util.promisify.custom'), {
    value: impl,
    configurable: true,
  })
}

/** 让 `npm view` 读取失败（离线/权限缺失）。
 *
 * 同样要写 `util.promisify.custom`——它是**函数对象上的属性**，`vi.clearAllMocks()`
 * 不会清掉，只设 `mockImplementation` 会仍走上一个测试残留的实现（实测踩到）。 */
function stubNpmVersionsFailure(error: Error): void {
  const impl = (): Promise<never> => Promise.reject(error)
  mocks.execFile.mockImplementation(() => {
    throw error
  })
  Object.defineProperty(mocks.execFile, Symbol.for('nodejs.util.promisify.custom'), {
    value: impl,
    configurable: true,
  })
}

/**
 * `maintainLatestTag` 的跳过分支（FNOS-012-04）。
 *
 * 三种「没有可指向的上一代」的情形都必须**优雅跳过**：不抛错、不调用 npm。
 * 初次发包正是其中一种（包上只有当前一个代际），此时 `latest` 保持不动——
 * 这是刻意的：rc 阶段不把预发布版推给默认安装的普通用户，发布者可在下次
 * 版本发布时按需重新指向。
 */
describe('maintainLatestTag：无上一代时优雅跳过', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.runCommand.mockResolvedValue(undefined)
  })

  it('初次发包：只有当前一个代际时不抛错，也不调用 npm dist-tag', async () => {
    // npm view 返回的版本里只有 0.2.0-rc.2 一代，另有不可解析的占位号
    stubNpmVersions(['0.0.0-stage', '0.2.0-rc.2.3'])
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await expect(maintainLatestTag('@tnnevol/dsh-midscene', '0.2.0-rc.2.4')).resolves.toBeUndefined()

    expect(mocks.runCommand, '无上一代时不应调用 npm').not.toHaveBeenCalled()
    expect(log.mock.calls.flat().join('\n')).toContain('no previous generation')
    log.mockRestore()
  })

  it('有上一代时正常指向上一代最新修订', async () => {
    stubNpmVersions(['0.1.7-rc.2.2', '0.2.0-rc.2.3', '0.2.0-rc.2.4'])
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await maintainLatestTag('@tnnevol/dsh-codebuddy', '0.2.0-rc.2.4')

    expect(mocks.runCommand).toHaveBeenCalledWith(
      'npm',
      ['dist-tag', 'add', '@tnnevol/dsh-codebuddy@0.1.7-rc.2.2', 'latest'],
      expect.anything(),
    )
    log.mockRestore()
  })

  it('读不到版本列表时跳过（离线或权限缺失不阻断发布）', async () => {
    stubNpmVersionsFailure(new Error('ENOTFOUND registry.npmjs.org'))
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await expect(maintainLatestTag('@tnnevol/dsh-codebuddy', '0.2.0-rc.2.4')).resolves.toBeUndefined()

    expect(mocks.runCommand).not.toHaveBeenCalled()
    expect(log.mock.calls.flat().join('\n')).toContain('npm view unavailable')
    log.mockRestore()
  })

  it('版本号无修订段时跳过（不臆造代际）', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await expect(maintainLatestTag('@tnnevol/dsh-codebuddy', '0.2.0-rc.2')).resolves.toBeUndefined()

    expect(mocks.runCommand).not.toHaveBeenCalled()
    expect(log.mock.calls.flat().join('\n')).toContain('does not carry a revision segment')
    log.mockRestore()
  })
})
