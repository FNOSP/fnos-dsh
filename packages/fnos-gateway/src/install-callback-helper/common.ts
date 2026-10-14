import { chmod, cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

export type JsonObject = Record<string, unknown>

type PluginManifestEntry = {
  name?: unknown
  version?: unknown
  source?: unknown
}

function asJsonObject(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : undefined
}

export async function readJson(path: string): Promise<JsonObject | undefined> {
  try {
    return asJsonObject(JSON.parse(await readFile(path, 'utf8')))
  } catch {
    return undefined
  }
}

export async function readJsonStrict(path: string): Promise<JsonObject> {
  const value = asJsonObject(JSON.parse(await readFile(path, 'utf8')))
  if (value === undefined) throw new Error(`Expected a JSON object at ${path}`)
  return value
}

/** Resolve a package from an application-private dependency tree, including nested pnpm/npm installs. */
export async function findPackageDirectory(root: string, packageName: string): Promise<string | undefined> {
  let manifest: JsonObject | undefined
  try {
    manifest = await readJson(join(root, 'package.json'))
  } catch {
    manifest = undefined
  }
  if (manifest?.name === packageName) return root

  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return undefined
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === '.bin') continue
    const found = await findPackageDirectory(join(root, entry.name), packageName)
    if (found !== undefined) return found
  }
  return undefined
}

/** Replace the installed user's trim-cli skill with the package-provided copy. */
export async function copyTrimCliSkill(packageDirectory: string, targetDirectory: string): Promise<void> {
  const sourceDirectory = join(packageDirectory, 'skill')
  try {
    if (!(await stat(sourceDirectory)).isDirectory()) throw new Error('skill path is not a directory')
    await stat(join(sourceDirectory, 'SKILL.md'))
  } catch {
    throw new Error(`The installed @trimjs/trim-cli package does not contain a usable skill at ${sourceDirectory}`)
  }

  const temporaryDirectory = `${targetDirectory}.tmp-${process.pid}`
  await rm(temporaryDirectory, { recursive: true, force: true })
  try {
    await cp(sourceDirectory, temporaryDirectory, { recursive: true, force: true })
    await mkdir(dirname(targetDirectory), { recursive: true })
    await rm(targetDirectory, { recursive: true, force: true })
    await rename(temporaryDirectory, targetDirectory)
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true })
    throw error
  }
}

async function fileMode(path: string, fallback: number): Promise<number> {
  try {
    return (await stat(path)).mode & 0o777
  } catch {
    return fallback
  }
}

async function requiredFileMode(path: string): Promise<number> {
  return (await stat(path)).mode & 0o777
}

export async function removeLegacyPnpmStoreConfig(configPath: string): Promise<void> {
  const source = await readFile(configPath, 'utf8')
  const lines = source.split(/\r?\n/)
  const filtered = lines.filter(line => !/^\s*store-dir\s*=/.test(line))
  if (filtered.length === lines.length) return

  while (filtered.at(-1) === '') filtered.pop()
  const mode = await requiredFileMode(configPath)
  const temporaryPath = `${configPath}.tmp-${process.pid}`
  await writeFile(temporaryPath, `${filtered.join('\n')}\n`, { mode })
  await chmod(temporaryPath, mode)
  await rename(temporaryPath, configPath)
}

export async function persistPnpmStoreDir(
  configPath: string,
  storeDir: string,
  storeFile: string,
): Promise<void> {
  if (!configPath || !storeDir || !storeFile) {
    throw new Error('persist-pnpm-store-dir requires config, store, and store-file paths')
  }

  await mkdir(dirname(storeFile), { recursive: true })
  const storeMode = await fileMode(storeFile, 0o600)
  const storeTemporaryPath = `${storeFile}.tmp-${process.pid}`
  await writeFile(storeTemporaryPath, `${storeDir}\n`, { mode: storeMode })
  await chmod(storeTemporaryPath, storeMode)
  await rename(storeTemporaryPath, storeFile)

  let source = ''
  try {
    source = await readFile(configPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  const originalLines = source.split(/\r?\n/)
  const lines = originalLines.filter(line => !/^\s*store-dir\s*=/.test(line))
  if (lines.length === originalLines.length) return

  while (lines.at(-1) === '') lines.pop()
  const configMode = await fileMode(configPath, 0o600)
  await mkdir(dirname(configPath), { recursive: true })
  const configTemporaryPath = `${configPath}.tmp-${process.pid}`
  await writeFile(configTemporaryPath, `${lines.join('\n')}\n`, { mode: configMode })
  await chmod(configTemporaryPath, configMode)
  await rename(configTemporaryPath, configPath)
}

export async function packageField(path: string, field: string): Promise<void> {
  const packageJson = await readJson(path)
  const value = packageJson?.[field]
  if (typeof value === 'string') process.stdout.write(value)
}

export async function profileDependencyVersion(path: string, packageName: string): Promise<void> {
  const manifest = await readJson(path)
  const dependencies = {
    ...(manifest?.dependencies !== null && typeof manifest?.dependencies === 'object'
      ? manifest.dependencies as JsonObject
      : {}),
    ...(manifest?.devDependencies !== null && typeof manifest?.devDependencies === 'object'
      ? manifest.devDependencies as JsonObject
      : {}),
  }
  const value = dependencies[packageName]
  if (typeof value === 'string') process.stdout.write(value)
}

export async function profileStoreDir(path: string): Promise<void> {
  try {
    const text = await readFile(path, 'utf8')
    let value: unknown
    try {
      value = (JSON.parse(text) as { storeDir?: unknown }).storeDir
    } catch {
      value = text.match(/^storeDir:\s*(.+?)\s*$/m)?.[1]
    }
    if (typeof value === 'string' && value.length > 0) {
      process.stdout.write(value.replace(/\/v\d+\/?$/, ''))
    }
  } catch {
    // A missing or malformed pnpm metadata file means no reusable store.
  }
}

/** One parsed `minimumReleaseAgeExclude` entry: `@scope/name@range`. */
type ReleaseAgeExclusion = {
  /** Package name without the version suffix. */
  name: string
  /** Raw range text after the last `@` separator. */
  range: string
}

/**
 * Parse one `minimumReleaseAgeExclude` entry into name + range.
 *
 * Entries are `@scope/name@range` or `name@range` (the trailing separator is
 * the one after the package name — scoped names contain an inner `@`).
 * Ranges without an `@` at all cannot anchor a version and are not stale by
 * construction, so they return `undefined`.
 */
export function parseReleaseAgeExclusion(entry: string): ReleaseAgeExclusion | undefined {
  const separator = entry.lastIndexOf('@')
  if (separator <= 0) return undefined
  const name = entry.slice(0, separator)
  const range = entry.slice(separator + 1)
  if (name.length === 0 || range.length === 0) return undefined
  return { name, range }
}

/**
 * List `minimumReleaseAgeExclude` entries whose pinned version no longer
 * matches the profile manifest's dependency version for the same package.
 *
 * pnpm resolves each exclusion with First-Match-Wins semantics, so an entry
 * anchoring a superseded version silently stops exempting anything and, worse,
 * freezes a lockfile built around it. Stale means: the profile manifest pins a
 * concrete version for that package AND the exclusion's range no longer admits
 * it. Entries for packages the manifest does not pin, or ranges without a
 * version anchor, are left alone — the field's purpose (letting fresh plugin
 * releases bypass pnpm's publication cooldown) is untouched.
 * @param workspacePath - the profile's pnpm-workspace.yaml.
 * @param manifestPath - the profile's package.json.
 * @param installedVersions - authoritative name → version pins the profile is
 *   being driven toward (the application's published-plugin manifest). When a
 *   package appears here and the profile manifest does not pin a concrete
 *   version for it (a `link:` development profile, for instance), the
 *   published pin is the comparison basis — an exclusion anchored to an older
 *   generation is stale no matter what the local manifest says.
 * @returns stale `name@range` entries; empty when nothing needs rebuilding.
 */
export async function staleReleaseAgeExclusions(
  workspacePath: string,
  manifestPath: string,
  installedVersions: Readonly<Record<string, string>> = {},
): Promise<string[]> {
  let text: string
  try {
    text = await readFile(workspacePath, 'utf8')
  } catch {
    // No workspace file: no exclusions to audit.
    return []
  }
  const section = text.match(/^minimumReleaseAgeExclude:\s*$/m)
  if (section === undefined) return []
  const exclusions: ReleaseAgeExclusion[] = []
  let inSection = false
  for (const line of text.split(/\r?\n/)) {
    if (/^minimumReleaseAgeExclude:\s*$/.test(line)) {
      inSection = true
      continue
    }
    if (!inSection) continue
    // A non-list line at column zero ends the block.
    if (/^[^\s#-]/.test(line)) break
    const entry = line.match(/^\s+-\s*(.+?)\s*$/)
    if (entry === null) continue
    const parsed = parseReleaseAgeExclusion(entry[1]!.replace(/^['"]|['"]$/g, ''))
    if (parsed !== undefined) exclusions.push(parsed)
  }
  if (exclusions.length === 0) return []

  const manifest = await readJson(manifestPath)
  const dependencies = {
    ...(manifest?.dependencies !== null && typeof manifest?.dependencies === 'object'
      ? manifest.dependencies as JsonObject
      : {}),
    ...(manifest?.devDependencies !== null && typeof manifest?.devDependencies === 'object'
      ? manifest.devDependencies as JsonObject
      : {}),
  }
  const stale: string[] = []
  for (const exclusion of exclusions) {
    // Comparison basis: the profile manifest's concrete pin when it has one,
    // otherwise the published pin this install is driving toward.
    const local = dependencies[exclusion.name]
    const pinned = typeof local === 'string' && local.length > 0 && /^\d/.test(local)
      ? local
      : installedVersions[exclusion.name]
    if (typeof pinned !== 'string' || pinned.length === 0) continue
    if (!rangeAdmitsVersion(exclusion.range, pinned)) stale.push(`${exclusion.name}@${exclusion.range}`)
  }
  return stale
}

/**
 * Whether one exclusion range admits one pinned version.
 *
 * Supported range forms mirror what this profile actually writes: exact pins
 * (`0.1.7-rc.2`) and `||` unions of exact pins (`0.1.7-rc.2 || 0.2.0-rc.2`).
 * The pinned version is admitted when it equals any branch, or when a branch
 * is a proper prefix of the version at a segment boundary (`0.1.7` admits
 * `0.1.7-rc.2.2`). A branch without a version anchor (`^`, `latest`, empty)
 * never admits anything, which errs toward rebuilding dependencies, never
 * toward keeping a stale lockfile.
 */
export function rangeAdmitsVersion(range: string, version: string): boolean {
  return range.split('||').some(branch => {
    const pinned = branch.trim()
    if (pinned.length === 0) return false
    if (/^\D/.test(pinned)) return false
    return version === pinned || version.startsWith(`${pinned}.`) || version.startsWith(`${pinned}-`)
  })
}


/**
 * Read the authoritative install pins from the application's published-plugin
 * manifest: name → exact version for every plugin this install drives the
 * profile toward.
 * @param path - published-dsh-plugins.json.
 * @returns a plain record usable as `staleReleaseAgeExclusions` third argument.
 */
export async function publishedPluginVersions(path: string): Promise<Record<string, string>> {
  const manifest = await readJson(path)
  const plugins = Array.isArray(manifest?.plugins) ? manifest.plugins as PluginManifestEntry[] : []
  const versions: Record<string, string> = {}
  for (const plugin of plugins) {
    if (typeof plugin.name === 'string' && typeof plugin.version === 'string') {
      versions[plugin.name] = plugin.version
    }
  }
  return versions
}

/**
 * Remove rebuildable profile artifacts before a dependency rebuild.
 *
 * Only the two paths the caller names are removed, and each is verified to be
 * exactly the artifact its basename says it is — this function runs with
 * destructive force, so a miswired call must fail loud instead of deleting an
 * arbitrary directory.
 * @param lockfilePath - the profile's pnpm-lock.yaml.
 * @param modulesPath - the profile's node_modules directory.
 */
export async function removeProfileBuildArtifacts(lockfilePath: string, modulesPath: string): Promise<void> {
  if (basename(lockfilePath) !== 'pnpm-lock.yaml') {
    throw new Error(`Refusing to remove unexpected lockfile path: ${lockfilePath}`)
  }
  if (basename(modulesPath) !== 'node_modules') {
    throw new Error(`Refusing to remove unexpected node_modules path: ${modulesPath}`)
  }
  await rm(lockfilePath, { force: true })
  await rm(modulesPath, { recursive: true, force: true })
}

export async function publishedPlugins(path: string): Promise<void> {
  const manifest = await readJsonStrict(path)
  const plugins = Array.isArray(manifest.plugins) ? manifest.plugins as PluginManifestEntry[] : []
  for (const plugin of plugins) {
    if (typeof plugin.name === 'string' && typeof plugin.version === 'string') {
      const source = plugin.source === 'thirdparty' ? '\tthirdparty' : ''
      process.stdout.write(`${plugin.name}\t${plugin.version}${source}\n`)
    }
  }
}

/**
 * 打印「已不在发布清单里、但 profile 仍依赖」的自有插件名（每行一个）。
 *
 * ## 为什么需要它（实测的升级失败）
 *
 * 插件从 FPK 内置清单移出后（例如 `@tnnevol/dsh-midscene` 改为由用户自行安装），
 * 安装流程只做「增加/更新清单里的插件」，**从不移除已不在清单中的插件**。于是：
 *
 * 1. Web profile 的 `package.json` 仍依赖该插件；
 * 2. 新 FPK 不再提供它的 `.tgz`（清单里没有它，就不会被打包）；
 * 3. 安装回调重建依赖时 pnpm 找不到文件，升级以 `ENOENT` 失败：
 *
 * ```
 * ENOENT: no such file or directory,
 *   open '…/bundled-dsh-plugins/@tnnevol/dsh-midscene.tgz'
 * ```
 *
 * 实测证据：`5.7.1 → 5.7.2` 的升级在 `Reinstalling the Web profile dependencies from the
 * current manifest...` 之后立刻以该错误中止，用户侧看到「无法更新 fn-deepseek-harness」。
 *
 * ## 只报「自有插件」，不动第三方
 *
 * 判定范围限定为 `@tnnevol/` 前缀：第三方插件（如 `dshmarket`）的安装/升级由 DSH CLI
 * 与市场负责，且清单里的第三方项语义是「确保存在」而非「只能是这些」——把用户的第三方
 * 插件当孤儿移除会破坏用户环境。
 * @param profilePackageJsonPath - Web profile 的 `package.json` 路径。
 * @param manifestPath - 发布清单（`published-dsh-plugins.json`）路径。
 */
export async function orphanOwnPlugins(profilePackageJsonPath: string, manifestPath: string): Promise<void> {
  const profile = await readJsonStrict(profilePackageJsonPath)
  const manifest = await readJsonStrict(manifestPath)
  const dependencies = asJsonObject(profile.dependencies) ?? {}
  const published = new Set(
    (Array.isArray(manifest.plugins) ? manifest.plugins as PluginManifestEntry[] : [])
      .map(plugin => plugin.name)
      .filter((name): name is string => typeof name === 'string'),
  )
  for (const name of Object.keys(dependencies)) {
    // 只处理本仓库自有插件；第三方由 DSH CLI 与市场管理（见函数注释）。
    if (!name.startsWith('@tnnevol/')) continue
    if (published.has(name)) continue
    process.stdout.write(`${name}\n`)
  }
}

export async function bundledPluginVersion(path: string, packageName: string): Promise<void> {
  const manifest = await readJsonStrict(path)
  const bundled = Array.isArray(manifest.bundled) ? manifest.bundled as PluginManifestEntry[] : []
  const plugin = bundled.find(value => value.name === packageName)
  if (typeof plugin?.version === 'string') process.stdout.write(plugin.version)
}
