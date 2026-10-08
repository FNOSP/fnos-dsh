import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { prepareNodePty } from '../src/install-callback-helper/node-pty.ts'

/**
 * node-pty 免编译准备流程（FNOS-009-13）。
 *
 * 关键约束：NAS 上没有 g++ 时安装也必须成功。node-pty 的 npm 包自带
 * `prebuilds/<platform>-<arch>/pty.node`，其加载器会在 `build/Release`、
 * `build/Debug` 都缺失时回退到该目录，因此准备流程只做校验，不编译、不复制。
 */

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  vi.unstubAllEnvs()
})

/** fnOS 目标平台的预编译目录名；实现固定使用该值，不做运行时平台判断。 */
const PREBUILD_DIRECTORY = 'linux-x64'

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'fnos-node-pty-'))
  temporaryRoots.push(root)
  return root
}

/** 建一个依赖树，可选地放入带/不带预编译产物的 node-pty 包。 */
async function createDependencyTree(options: { nodePty?: 'with-prebuilds' | 'without-prebuilds' } = {}): Promise<string> {
  const packageDir = await createRoot()
  if (options.nodePty === undefined) return packageDir

  const nodePtyDir = join(packageDir, 'node_modules', 'node-pty')
  await mkdir(nodePtyDir, { recursive: true })
  await writeFile(join(nodePtyDir, 'package.json'), `${JSON.stringify({ name: 'node-pty', version: '1.2.0-beta.15' }, null, 2)}\n`)
  await writeFile(join(nodePtyDir, 'scripts-placeholder'), '')

  if (options.nodePty === 'with-prebuilds') {
    const prebuildDir = join(nodePtyDir, 'prebuilds', PREBUILD_DIRECTORY)
    await mkdir(prebuildDir, { recursive: true })
    await writeFile(join(prebuildDir, 'pty.node'), 'binary-placeholder')
  }
  return packageDir
}

/** 以最小环境运行准备流程；不启用依赖脚本，避免在测试机上执行 npm。 */
async function runPrepare(packageDir: string, options: { runDependencyScripts?: boolean } = {}): Promise<void> {
  const home = await createRoot()
  vi.stubEnv('DSH_HOME', home)
  vi.stubEnv('DSH_PACKAGE_DIR', packageDir)
  // 依赖树里没有全局安装时，该根目录不存在也应被容忍。
  vi.stubEnv('NPM_GLOBAL_ROOT', join(packageDir, 'absent-npm-global'))
  vi.stubEnv('NODE_BIN', process.execPath)
  vi.stubEnv('NPM_BIN', process.execPath)
  vi.stubEnv('DSH_RUN_DEPENDENCY_SCRIPTS', options.runDependencyScripts === true ? '1' : '0')
  await prepareNodePty()
}

describe('prepareNodePty', () => {
  it('succeeds without a compiler when the package ships the platform prebuild', async () => {
    const packageDir = await createDependencyTree({ nodePty: 'with-prebuilds' })

    // 没有 g++ 也应正常完成：这正是 FNOS-009-13-AC-01 的核心。
    await expect(runPrepare(packageDir)).resolves.toBeUndefined()
  })

  it('reports the missing platform directory when the package has no prebuild', async () => {
    const packageDir = await createDependencyTree({ nodePty: 'without-prebuilds' })

    await expect(runPrepare(packageDir)).rejects.toThrow(new RegExp(PREBUILD_DIRECTORY))
  })

  it('skips preparation when the upstream package no longer depends on node-pty', async () => {
    const packageDir = await createDependencyTree()

    // 上游移除依赖时是「无可准备」而不是错误（FNOS-009-13-AC-02）。
    await expect(runPrepare(packageDir)).resolves.toBeUndefined()
  })

  it('tolerates an absent global install root', async () => {
    const packageDir = await createDependencyTree({ nodePty: 'with-prebuilds' })

    // NPM_GLOBAL_ROOT 指向不存在的目录时，仅由本地依赖树满足校验。
    await expect(runPrepare(packageDir)).resolves.toBeUndefined()
  })

  it('keeps the installed package manifest intact after preparation', async () => {
    const packageDir = await createDependencyTree({ nodePty: 'with-prebuilds' })
    const packageJson = join(packageDir, 'node_modules', 'node-pty', 'package.json')
    const before = await readFile(packageJson, 'utf8')

    await runPrepare(packageDir)

    // 准备流程不复制产物、不改写清单；禁用脚本的临时替换必须被还原。
    await expect(readFile(packageJson, 'utf8')).resolves.toBe(before)
  })
})

describe('node-pty preparation source constraints', () => {
  it('never pins a registry and never downloads a package of its own', async () => {
    const source = await readFile(new URL('../src/install-callback-helper/node-pty.ts', import.meta.url), 'utf8')

    // FNOS-009-13-AC-04：沿用安装流程 .npmrc 里的源，不追加 --registry。
    expect(source).not.toContain("'--registry'")
    expect(source).not.toContain('"--registry"')
    // 不引入额外下载，因此也不需要任何 install/add 调用。
    expect(source).not.toMatch(/spawnSync\(\s*npmBin,\s*\[\s*['"]install['"]/)
    expect(source).not.toMatch(/spawnSync\(\s*npmBin,\s*\[\s*['"]add['"]/)
  })

  it('pins the fnOS target prebuild instead of detecting the host platform', async () => {
    const source = await readFile(new URL('../src/install-callback-helper/node-pty.ts', import.meta.url), 'utf8')
    // 注释里会提到 node-pty 加载器的平台约定，只检查可执行代码。
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

    // 固定使用 linux-x64，不再按运行时平台推导，避免在非目标平台上得出误导结论。
    expect(code).toContain("const FNOS_PREBUILD_DIRECTORY = 'linux-x64'")
    expect(code).not.toContain('process.platform')
    expect(code).not.toContain('process.arch')
  })

  it('does not consult a compiler at all', async () => {
    const source = await readFile(new URL('../src/install-callback-helper/node-pty.ts', import.meta.url), 'utf8')

    expect(source).not.toContain('hasCompiler')
    expect(source).not.toContain("'g++'")
  })
})
