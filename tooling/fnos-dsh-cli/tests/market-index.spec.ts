import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  runCommand: vi.fn(),
  existsSync: vi.fn(),
  statSync: vi.fn(),
}))

// `repositoryRoot` 由源码路径加载时层级比打包产物多一层（见 version.spec.ts 的同类说明），
// 因此这里显式给定，让用例只验证「命令怎么拼、路径指向哪」，不受加载路径影响。
vi.mock('../src/config/paths.js', () => ({
  repositoryRoot: '/fake/repo',
}))
vi.mock('../src/core/process.js', () => ({ runCommand: mocks.runCommand }))
vi.mock('node:fs', async importOriginal => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  existsSync: mocks.existsSync,
  statSync: mocks.statSync,
}))

const {
  resolveGeneratorRoot,
  marketIndexArgs,
  regenerateMarketIndex,
} = await import('../src/core/market-index.js')

beforeEach(() => {
  vi.resetAllMocks()
  // 默认让 statSync 可读，具体用例按需覆盖；未设置时视为索引不存在。
  mocks.statSync.mockReturnValue({ mtimeMs: 0 })
  delete process.env.DSH_DESKTOP_APP_DIR
})

describe('生成器检出定位', () => {
  it('优先使用 DSH_DESKTOP_APP_DIR', () => {
    process.env.DSH_DESKTOP_APP_DIR = '/custom/checkout'
    mocks.existsSync.mockReturnValue(true)
    expect(resolveGeneratorRoot()).toBe('/custom/checkout')
  })

  it('未设置环境变量时回落到工作区相对位置', () => {
    // 只让「上两级」的候选命中，模拟仓库位于分层目录（如 fn-packages/）下的实际布局。
    // 注意 `path.resolve` 会消掉 `..`，因此按规范化后的前缀匹配：
    // 上两级 → `/fork-pj/...`；上一级 → `/fake/fork-pj/...`。
    mocks.existsSync.mockImplementation((path: unknown) =>
      String(path).startsWith('/fork-pj/deepseek-harness/'))
    expect(resolveGeneratorRoot()).toBe('/fork-pj/deepseek-harness')
  })

  it('判定依据是生成器 package.json 存在，而不是目录存在', () => {
    // 全部候选都返回 false：空的 fork-pj 目录不算可用检出。
    mocks.existsSync.mockReturnValue(false)
    expect(resolveGeneratorRoot()).toBeUndefined()
  })
})

describe('生成器命令参数', () => {
  it('input/output 指向本仓库，且 filter 为生成器包名', () => {
    const args = marketIndexArgs('/upstream/checkout')
    expect(args).toContain('@deepseek-ai/dsh-plugin-market-generator')
    // 上游检出用 corepack 固定 pnpm 版本，与本仓库不一致时会被拒绝运行。
    expect(args).toContain('--pm-on-fail=ignore')
    expect(args).toContain('--input')
    expect(args).toContain('/fake/repo/docs/public/plugins/market/plugins.txt')
    expect(args).toContain('--output')
    expect(args).toContain('/fake/repo/docs/public/plugins/market/index.json')
    expect(args).toContain('--cache')
    expect(args).toContain('/fake/repo/tmp/plugin-market-cache')
  })

  it('--dir 指向生成器检出，而 input/output 仍指向本仓库', () => {
    const args = marketIndexArgs('/upstream/checkout')
    const dirIndex = args.indexOf('--dir')
    // pnpm 只在 --dir 下按 filter 找项目；指向本仓库会「No projects matched」且以 0 退出。
    expect(args[dirIndex + 1]).toBe('/upstream/checkout')
    const inputIndex = args.indexOf('--input')
    expect(args[inputIndex + 1]?.startsWith('/fake/repo/')).toBe(true)
  })
})

describe('重建索引的降级行为', () => {
  it('找不到生成器时只警告、不抛错（包已发布，不能让它看起来失败）', async () => {
    mocks.existsSync.mockReturnValue(false)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(regenerateMarketIndex()).resolves.toBeUndefined()
    expect(mocks.runCommand).not.toHaveBeenCalled()
    expect(warn.mock.calls.flat().join('\n')).toContain('未同步')
    warn.mockRestore()
  })

  it('生成器存在时以仓库根为 cwd 运行 pnpm', async () => {
    mocks.existsSync.mockReturnValue(true)
    // 索引 mtime 在运行前后变化，表示真的被重写。
    mocks.statSync
      .mockReturnValueOnce({ mtimeMs: 1000 })
      .mockReturnValueOnce({ mtimeMs: 2000 })
    mocks.runCommand.mockResolvedValue(undefined)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await regenerateMarketIndex()
    expect(mocks.runCommand).toHaveBeenCalledTimes(1)
    const [command, args, cwd] = mocks.runCommand.mock.calls[0] ?? []
    expect(command).toBe('pnpm')
    expect(args).toContain('@deepseek-ai/dsh-plugin-market-generator')
    expect(cwd).toBe('/fake/repo')
    log.mockRestore()
  })

  it('pnpm 退出 0 但索引未变化时告警（防止静默假成功）', async () => {
    mocks.existsSync.mockReturnValue(true)
    // 前后一致：模拟 filter 没匹配到项目时 pnpm 仍以 0 退出的情形。
    mocks.statSync.mockReturnValue({ mtimeMs: 1000 })
    mocks.runCommand.mockResolvedValue(undefined)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await regenerateMarketIndex()
    expect(warn.mock.calls.flat().join('\n')).toContain('未变化')
    warn.mockRestore()
  })

  it('生成失败时降级为警告而不是让发布失败', async () => {
    mocks.existsSync.mockReturnValue(true)
    mocks.runCommand.mockRejectedValue(new Error('generator blew up'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(regenerateMarketIndex()).resolves.toBeUndefined()
    expect(warn.mock.calls.flat().join('\n')).toContain('不影响本次发布')
    warn.mockRestore()
  })

  it('显式跳过时不运行生成器', async () => {
    mocks.existsSync.mockReturnValue(true)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await regenerateMarketIndex({ skip: true })
    expect(mocks.runCommand).not.toHaveBeenCalled()
    log.mockRestore()
  })
})
