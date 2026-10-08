import { spawnSync } from 'node:child_process'
import { constants } from 'node:fs'
import { access, chmod, copyFile, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createLogger, fail } from './logger.ts'

const logger = createLogger('install-node-pty')

/** 持有 node-pty 依赖的上游包；用于日志与「上游移除依赖」时的可读说明。 */
const DSH_SUBPROCESS_PACKAGE = '@deepseek-ai/dsh-subprocess-local'

function failNodePty(message: string): never {
  return fail('install-node-pty', message)
}

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) failNodePty(`${name} is required`)
  return value
}

async function findNodePtyPackages(root: string, result: string[] = []): Promise<string[]> {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return result
  }

  for (const entry of entries) {
    const entryPath = join(root, entry.name)
    if (entry.isDirectory()) {
      await findNodePtyPackages(entryPath, result)
      continue
    }
    if (entry.isFile() && entry.name === 'package.json' && root.endsWith(join('node_modules', 'node-pty'))) {
      result.push(entryPath)
    }
  }
  return result
}

async function uniqueNodePtyPackages(roots: string[]): Promise<string[]> {
  const packages: string[] = []
  const seen = new Set<string>()
  for (const root of roots) {
    for (const packageJson of await findNodePtyPackages(root)) {
      if (seen.has(packageJson)) continue
      seen.add(packageJson)
      packages.push(packageJson)
    }
  }
  return packages
}

type PackageBackup = {
  backupPath: string
  packageJson: string
  mode: number
}

async function restorePackageMetadata(backups: PackageBackup[]): Promise<void> {
  for (const backup of backups) {
    await copyFile(backup.backupPath, backup.packageJson)
    await chmod(backup.packageJson, backup.mode)
  }
}

async function disableNodePtyInstallScripts(packageFiles: string[], backupDir: string): Promise<PackageBackup[]> {
  const backups: PackageBackup[] = []
  try {
    for (const [index, packageJson] of packageFiles.entries()) {
      const backupPath = join(backupDir, `${index}.json`)
      const mode = (await stat(packageJson)).mode & 0o777
      await copyFile(packageJson, backupPath)
      await chmod(backupPath, mode)
      backups.push({ backupPath, packageJson, mode })

      const manifest = JSON.parse(await readFile(packageJson, 'utf8')) as Record<string, unknown>
      const scripts = manifest.scripts !== null && typeof manifest.scripts === 'object'
        ? manifest.scripts as Record<string, unknown>
        : {}
      manifest.scripts = { ...scripts, install: 'node -e "process.exit(0)"' }
      await writeFile(packageJson, `${JSON.stringify(manifest, null, 2)}\n`)
    }
  } catch (error) {
    try {
      await restorePackageMetadata(backups)
    } catch {
      // Preserve the original failure; the caller reports the operation phase.
    }
    throw error
  }
  return backups
}

async function runDshDependencyScripts(
  packageFiles: string[],
  backupDir: string,
  npmBin: string,
): Promise<void> {
  const backups = await disableNodePtyInstallScripts(packageFiles, backupDir)
  logger.info(`Temporarily disabling lifecycle scripts for ${packageFiles.length} node-pty package(s); other DSH dependency scripts remain enabled.`)
  logger.info('Running DSH dependency lifecycle scripts with the node-pty native build left to the published prebuilds.')

  const startedAt = Date.now()
  logger.info('START: npm rebuild --global --foreground-scripts')
  const result = spawnSync(npmBin, ['rebuild', '--global', '--ignore-scripts=false', '--foreground-scripts'], {
    stdio: 'inherit',
  })
  const elapsed = Math.floor((Date.now() - startedAt) / 1000)
  if (result.error) logger.error(result.error.message)
  const status = result.status ?? 1
  if (status === 0) {
    logger.info(`DONE: npm rebuild --global --foreground-scripts (${elapsed}s)`)
  } else {
    logger.error(`FAILED: npm rebuild --global --foreground-scripts (exit=${status}, elapsed=${elapsed}s)`)
  }

  try {
    await restorePackageMetadata(backups)
  } catch {
    await rm(backupDir, { recursive: true, force: true })
    failNodePty('Unable to restore node-pty package metadata')
  }
  await rm(backupDir, { recursive: true, force: true })
  if (status !== 0) failNodePty('Failed to run DSH dependency lifecycle scripts')
  logger.info('DSH dependency lifecycle scripts completed.')
}

/**
 * node-pty 在 fnOS 目标平台上的预编译目录名。
 *
 * 固定为 `linux-x64`：fnOS 应用只在 x86_64 的 Linux 上安装，node-pty 的加载器
 * 也按 `prebuilds/${process.platform}-${process.arch}` 查找，两者在目标平台一致。
 * 不做运行时平台判断，避免安装回调在非目标平台上得出误导性的结论。
 */
const FNOS_PREBUILD_DIRECTORY = 'linux-x64'

/**
 * 校验已安装的 node-pty 自带可用预编译产物。
 *
 * node-pty 的加载器按 `build/Release` → `build/Debug` → `prebuilds/<platform>-<arch>`
 * 的顺序查找 `pty.node`，因此只要预编译目录存在，就不需要 g++ 现场编译。
 * 这里只做存在性校验并记录选中的目录，不做任何复制：把产物强行拷进
 * `build/Release` 反而会掩盖预编译缺失这类真实问题。
 *
 * @param packageFiles - 已安装 node-pty 包的 `package.json` 绝对路径列表。
 * @returns 每个包解析到的预编译目录描述。
 */
async function verifyNodePtyPrebuilds(packageFiles: string[]): Promise<Array<{ packageJson: string, prebuildDirectory: string }>> {
  const resolved: Array<{ packageJson: string, prebuildDirectory: string }> = []
  for (const packageJson of packageFiles) {
    const packageRoot = dirname(packageJson)
    const prebuildDirectory = join(packageRoot, 'prebuilds', FNOS_PREBUILD_DIRECTORY)
    try {
      await stat(join(prebuildDirectory, 'pty.node'))
    } catch {
      failNodePty(
        `node-pty package at ${packageRoot} has no ${FNOS_PREBUILD_DIRECTORY} prebuild; ` +
        'the published package is expected to ship one and no compiler is required',
      )
    }
    resolved.push({ packageJson, prebuildDirectory })
  }
  return resolved
}

export async function prepareNodePty(): Promise<void> {
  const nodeBin = process.env.NODE_BIN || '/var/apps/nodejs_v24/target/bin'
  const npmBin = process.env.NPM_BIN || join(nodeBin, 'npm')
  const packageManager = process.env.PACKAGE_MANAGER || 'npm'
  const packageManagerBin = process.env.PACKAGE_MANAGER_BIN || npmBin
  const dshHome = requiredEnv('DSH_HOME')
  const packageDir = requiredEnv('DSH_PACKAGE_DIR')
  const npmGlobalRoot = requiredEnv('NPM_GLOBAL_ROOT')

  if (packageManager !== 'npm') failNodePty(`Unsupported package manager: ${packageManager}`)
  try {
    await access(packageManagerBin, constants.X_OK)
  } catch {
    failNodePty(`Package manager is not executable: ${packageManagerBin}`)
  }

  // node-pty 是否仍被 dsh 需要由依赖树决定，不写死在这里：包一旦被上游移除，
  // 下面的查找会返回空列表，流程自然跳过，而不是报一个过时的错误。
  const packageFiles = await uniqueNodePtyPackages([packageDir, npmGlobalRoot])
  if (packageFiles.length === 0) {
    logger.info(`${DSH_SUBPROCESS_PACKAGE} no longer depends on node-pty; nothing to prepare.`)
    return
  }
  logger.info(`Found ${packageFiles.length} node-pty package(s) in the installed dsh dependency tree.`)

  const runDependencyScripts = process.env.DSH_RUN_DEPENDENCY_SCRIPTS === '1'
  const backupDir = await mkdtemp(join(dshHome, '.node-pty-scripts.'))
  try {
    if (runDependencyScripts) await runDshDependencyScripts(packageFiles, backupDir, npmBin)
    else await rm(backupDir, { recursive: true, force: true })
  } finally {
    await rm(backupDir, { recursive: true, force: true })
  }

  // 依赖脚本运行后再校验，因为 `npm rebuild` 可能重装 node-pty 包。
  const resolved = await verifyNodePtyPrebuilds(await uniqueNodePtyPackages([packageDir, npmGlobalRoot]))
  for (const entry of resolved) {
    logger.info(`node-pty prebuilds available at ${entry.prebuildDirectory}.`)
  }
  logger.info('node-pty preparation completed; the published prebuilds are used without a compiler.')
}
