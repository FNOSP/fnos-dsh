import { mkdir, readdir, readFile, rename, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { type OptionValues } from 'commander'
import { program } from '../program.js'
import { repositoryRoot } from '../config/paths.js'
import { findPluginTarget } from '../config/targets.js'
import { readFpkApps, readGatewayName, type FpkApp } from '../config/workspace.js'
import { runDocsBuild } from './docs.js'
import { optionValue } from '../core/args.js'
import { requireDshBaseline } from '../core/dsh-baseline.js'
import { fpkReleaseFileName, renameFpkToRelease } from '../core/fpk-artifacts.js'
import { addBooleanArgs, addOptionalValueArg } from '../core/command-args.js'
import { captureCommandOutput, runCommand } from '../core/process.js'
import { runTurbo } from '../core/turbo.js'
import { askBuildSelection, askBundleDshPlugins, askFpkApps, askPlugins } from '../ui/prompts.js'

const DSH_PUBLISHED_PLUGIN_MANIFEST = 'app/published-dsh-plugins.json'
const DSH_BUNDLED_PLUGIN_DIRECTORY = 'app/bundled-dsh-plugins'
const PNPM_VERSION = '11.7.0'
/** 三方插件在清单里的固定标识；版本本身由清单持有，不在校验代码里重复书写。 */
const DSHMARKET_NAME = 'dshmarket'
/**
 * The runtime plugins the FPK bundles.
 *
 * Only the **names** are policy — which plugins ship inside the package is a
 * product decision. Versions deliberately are not listed here: each plugin
 * owns its own version in `plugins/<name>/package.json`, and the published
 * manifest must agree with that file. Copying a version into this file creates
 * a second place to forget, and forgetting it once already broke a release:
 * the plugins moved to `0.1.7-rc.2.1` while a constant here still said
 * `0.1.7-rc.2`, so the build failed on a value that duplicated the real one.
 */
// FPK 内置的自有插件白名单：**必含集合 + 允许的额外清单**。
//
// 早期这里只有一份三元素集合，同时用它的长度做「清单恰好这么长」的校验。随着
// Failover Search、Midscene 陆续加入内置清单，那个长度断言就成了过期常量：清单
// 合法增长到 4、5 个时构建直接失败，而报错信息还写着「exactly the three」——
// 指向的规则早已不成立。
//
// 现在两侧都写明确：`FPK_REQUIRED_BUNDLED_PLUGIN_NAMES` 必须在清单里，其余内置
// 插件必须落在 `FPK_OPTIONAL_BUNDLED_PLUGIN_NAMES` 内。**允许清单是显式的**——
// 新增内置插件要在这里登记，而不是像「有源码就放行」那样自动通过；漏登记会在
// 构建期报错并点名，避免清单被无意改动后无人发现。
const FPK_REQUIRED_BUNDLED_PLUGIN_NAMES = [
  '@tnnevol/dsh-codex-auth',
  '@tnnevol/dsh-fnos',
]

// 可随 FPK 内置、但不强制在内的自有插件。新增内置插件时在此登记。
//
// `@tnnevol/dsh-midscene` **刻意不在此列**：它面向浏览器自动化场景、用完即走的
// 插件，不随 FPK 分发，由需要的人自行安装。
const FPK_OPTIONAL_BUNDLED_PLUGIN_NAMES = [
  '@tnnevol/dsh-failover-search',
]

type PublishedDshPluginManifest = {
  plugins?: Array<{ name?: unknown, version?: unknown, source?: unknown }>
  bundled?: Array<{ name?: unknown, version?: unknown }>
}

function dshPublishedPluginManifestPath(app: FpkApp): string {
  return join(repositoryRoot, 'apps', app.name, DSH_PUBLISHED_PLUGIN_MANIFEST)
}

function hasDshPluginManifest(app: FpkApp): boolean {
  return existsSync(dshPublishedPluginManifestPath(app))
}

async function readPublishedDshPluginNames(app: FpkApp): Promise<string[]> {
  const manifestPath = dshPublishedPluginManifestPath(app)
  if (!existsSync(manifestPath)) return []

  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as PublishedDshPluginManifest
  if (!Array.isArray(manifest.plugins) || manifest.plugins.length === 0) {
    throw new Error(`Published DSH plugin manifest is empty: ${manifestPath}`)
  }

  return manifest.plugins.map((plugin, index) => {
    if (typeof plugin?.name !== 'string' || plugin.name.length === 0) {
      throw new Error(`Invalid DSH plugin at ${manifestPath} (index ${index})`)
    }
    if (plugin.source !== undefined && plugin.source !== 'thirdparty') {
      throw new Error(`Invalid DSH plugin source at ${manifestPath} (index ${index})`)
    }
    return plugin
  }).filter(plugin => plugin.source !== 'thirdparty').map(plugin => plugin.name as string)
}

async function readDshPluginManifest(app: FpkApp): Promise<PublishedDshPluginManifest> {
  const manifestPath = dshPublishedPluginManifestPath(app)
  if (!existsSync(manifestPath)) return {}
  return JSON.parse(await readFile(manifestPath, 'utf8')) as PublishedDshPluginManifest
}

async function packPluginPackage(sourceDirectory: string, targetDirectory: string, expected: { name: string, version: string }): Promise<void> {
  const packageManifest = JSON.parse(await readFile(join(sourceDirectory, 'package.json'), 'utf8')) as {
    name?: unknown
    version?: unknown
    dependencies?: Record<string, string>
  }
  if (packageManifest.name !== expected.name || packageManifest.version !== expected.version) {
    throw new Error(`Plugin package metadata mismatch for ${expected.name}@${expected.version}`)
  }
  for (const [name, version] of Object.entries(packageManifest.dependencies ?? {})) {
    if (version.startsWith('workspace:') || version.startsWith('link:')) {
      throw new Error(`Bundled plugin ${expected.name} has an unpackable runtime dependency: ${name}@${version}`)
    }
  }
  await mkdir(dirname(targetDirectory), { recursive: true })
  await runCommand('pnpm', ['pack', '--pack-destination', dirname(targetDirectory)], sourceDirectory)
  const packedName = expected.name.replace(/^@/u, '').replaceAll('/', '-')
  const generated = join(dirname(targetDirectory), `${packedName}-${expected.version}.tgz`)
  await rename(generated, targetDirectory)
}

async function validateDshReleaseInputs(app: FpkApp): Promise<void> {
  if (app.name !== 'fn-deepseek-harness') return
  const manifestPath = dshPublishedPluginManifestPath(app)
  const manifest = await readDshPluginManifest(app)
  if (!Array.isArray(manifest.plugins) || manifest.plugins.length === 0) {
    throw new Error(`Published DSH plugin manifest is empty: ${manifestPath}`)
  }
  for (const [index, plugin] of manifest.plugins.entries()) {
    if (typeof plugin?.name !== 'string' || typeof plugin.version !== 'string' ||
        plugin.version.length === 0 || !/^[0-9A-Za-z][0-9A-Za-z.+-]*$/u.test(plugin.version)) {
      throw new Error(`Published DSH plugin must use an exact version at ${manifestPath} (index ${index})`)
    }
    if (plugin.source !== undefined && plugin.source !== 'thirdparty') {
      throw new Error(`Published DSH plugin source must be thirdparty when specified at ${manifestPath} (index ${index})`)
    }
  }
  const bundledPlugins = manifest.plugins.filter(plugin => plugin.source !== 'thirdparty')
  if (bundledPlugins.length === 0) {
    throw new Error(`Published DSH plugin manifest must bundle at least one runtime plugin: ${manifestPath}`)
  }
  if (Array.isArray(manifest.bundled) && manifest.bundled.length > 0) {
    throw new Error(`Published DSH plugin manifest must place third-party plugins in plugins with source=thirdparty: ${manifestPath}`)
  }
  // Each version is read from the plugin's own package.json rather than compared
  // against a constant here. The manifest is a *copy* of that version, so the
  // guard's job is to prove the copy still matches its source — not to restate
  // the value. A restated value silently rots the moment the plugin is released
  // on its own, which is exactly how the v5.5.0 build failed.
  for (const name of FPK_REQUIRED_BUNDLED_PLUGIN_NAMES) {
    if (!bundledPlugins.some(candidate => candidate?.name === name)) {
      throw new Error(`The published DSH plugin manifest must bundle ${name}: ${manifestPath}`)
    }
  }
  // 内置清单里除必含集合外的每一项，都必须落在允许清单内。三方插件已由
  // source=thirdparty 排除在外，不参与本判定。
  const allowedBundled = new Set([
    ...FPK_REQUIRED_BUNDLED_PLUGIN_NAMES,
    ...FPK_OPTIONAL_BUNDLED_PLUGIN_NAMES,
  ])
  const unlistedBundled = bundledPlugins.filter(plugin => !allowedBundled.has(String(plugin.name)))
  if (unlistedBundled.length > 0) {
    throw new Error(
      `Published DSH plugin manifest bundles a plugin outside the FPK allowlist: `
      + `${unlistedBundled.map(plugin => String(plugin.name)).join(', ')}; `
      + `register it in FPK_OPTIONAL_BUNDLED_PLUGIN_NAMES (or FPK_REQUIRED_BUNDLED_PLUGIN_NAMES) to bundle it`,
    )
  }
  // 走到这里，内置清单已全部通过允许清单，说明每一项都是「登记过该内置」的自有插件。
  // 此时若仍找不到源码，就是登记了却没在 plugins/ 下建包（或目录名与包名不复用），
  // 构建取不到归档，会以更晦涩的「Missing exact version」失败。
  const sourcelessBundled = bundledPlugins.filter(plugin =>
    findPluginTarget(String(plugin.name)) === undefined)
  if (sourcelessBundled.length > 0) {
    throw new Error(`Published DSH plugin manifest bundles a plugin without source under plugins/: ${sourcelessBundled.map(plugin => String(plugin.name)).join(', ')}`)
  }

  // 逐个核对**所有**内置插件（含允许清单内的）的版本与源码一致——不只必含的那几个。
  // 打包阶段也会比对版本，但那里报的是「包元数据不匹配」，不指明清单还是源码该改。
  for (const plugin of bundledPlugins) {
    const name = String(plugin.name)
    const target = findPluginTarget(name)
    if (target === undefined) {
      // 上面已按允许清单 + 源码存在性拦下，这里不可到达，只为类型收窄。
      throw new Error(`FPK-bundled DSH plugin ${name} has no source package under plugins/`)
    }
    const source = JSON.parse(await readFile(join(repositoryRoot, target.path), 'utf8')) as { version?: unknown }
    if (typeof source.version !== 'string' || source.version.length === 0) {
      throw new Error(`${target.path} must declare an exact version for ${name}`)
    }
    if (plugin.version !== source.version) {
      throw new Error(`The published DSH plugin manifest must agree with ${target.path}: expected ${name}@${source.version}, declared ${String(plugin.version)}`)
    }
  }
  // Codex must stay bundled: the registry only carries builds whose DSH
  // baseline predates 0.1.7-rc.2, and installing one of those breaks Web
  // startup on the missing `settingsNamespace` export. Keep the removal
  // guard inverted so a manifest edit cannot silently drop it again.
  const codex = manifest.plugins.find(plugin => typeof plugin?.name === 'string' && plugin.name.includes('codex'))
  if (codex === undefined) {
    throw new Error(`The published DSH plugin manifest must bundle the Codex plugin: ${manifestPath}`)
  }
  // CodeBuddy 曾在此处有「必须内置」的守卫。它已于 2026-10-22 下架：上游对非官方
  // 客户端通道收紧拦截，插件无法再稳定可用。守卫随之移除——保留它只会让清单
  // 永远无法合法地少一个插件。
  // 三方插件的版本由清单持有。这里只校验它存在且为精确版本——把版本写进校验代码
  // 会让「升级插件」变成「同时改两处」，漏改一处就构建失败（`dshmarket` 从 1.66.3
  // 升到 1.66.11 时正是如此）。清单值的正确性由 peer 覆盖与真机安装验证来保证。
  const dshmarket = manifest.plugins.find(plugin => plugin?.name === DSHMARKET_NAME && plugin.source === 'thirdparty')
  if (dshmarket === undefined) {
    throw new Error(`The published DSH plugin manifest must pin third-party ${DSHMARKET_NAME} in plugins`)
  }
  const callback = await readFile(join(repositoryRoot, 'apps', app.name, 'cmd/install_callback'), 'utf8')
  const dshVersion = requireDshBaseline()
  if (!callback.includes(`DSH_VERSION="${dshVersion}"`) || !callback.includes(`PNPM_VERSION="${PNPM_VERSION}"`)) {
    throw new Error(`install_callback is not aligned with DSH ${dshVersion} and pnpm ${PNPM_VERSION}`)
  }
  const shellVariable = (name: string) => '$' + '{' + name + '}'
  const main = await readFile(join(repositoryRoot, 'apps', app.name, 'cmd/main'), 'utf8')
  const gatewayRuntimeEnv = await readFile(join(repositoryRoot, 'packages/fnos-gateway/src/config/dsh-runtime-env.ts'), 'utf8')
  if (!main.includes(`DSH_REAL_BIN="${shellVariable('DSH_HOME')}/.npm-global/bin/dsh"`) ||
      !main.includes(`DSH_BIN="${shellVariable('DSH_REAL_BIN')}"`) ||
      main.includes('DSH_WRAPPER=') || main.includes('DSH_PROCESS_BIN=')) {
    throw new Error('cmd/main must pass the real DSH CLI to the gateway; it must not use a CLI wrapper')
  }
  if (main.includes('dsh_running()') || main.includes(`is_runtime_process "${shellVariable('pid')}" dsh`)) {
    throw new Error('cmd/main must not manage DSH Web processes; the gateway owns the Web lifecycle')
  }
  // The DSH Web terminal resolves its default shell from the DSH process
  // environment and otherwise falls back to the package account's login shell,
  // which is /usr/sbin/nologin on fnOS and exits immediately. The gateway owns
  // the child environment, so protect that boundary rather than requiring a
  // duplicate adaptation in cmd/main.
  if (!gatewayRuntimeEnv.includes('resolveTerminalShell') || !gatewayRuntimeEnv.includes('environment.SHELL')
    || !gatewayRuntimeEnv.includes('resolveUtf8Locale') || !gatewayRuntimeEnv.includes('environment.LC_CTYPE')) {
    throw new Error('gateway DSH runtime environment must provide a usable default SHELL and UTF-8 locale for the in-app terminal')
  }
  if (main.includes('resolve_terminal_shell') || main.includes('resolve_utf8_locale')) {
    throw new Error('cmd/main must not duplicate the gateway terminal SHELL/locale adaptation')
  }
  // fnOS exposes no root-free way for a normal caller to become the application
  // user: `runuser` refuses non-root, `su` demands a password, and the SDD
  // forbids setuid/ungoverned sudo. A public `dsh` entry point therefore cannot
  // keep the fixed application identity it promises, so the app ships none.
  if (callback.includes('CLI_WRAPPER=') || callback.includes('setup_cli_wrapper')) {
    throw new Error('install_callback must not create the dsh CLI wrapper; the app does not expose a public dsh command')
  }
  const resource = await readFile(join(repositoryRoot, 'apps', app.name, 'config/resource'), 'utf8')
  if (resource.includes('/bin/dsh') || resource.includes('usr-local-linker')) {
    throw new Error('config/resource must not register a dsh CLI wrapper')
  }
  await validateCatalogVersionedDependencies()
}

/**
 * Every dependency whose version is maintained in pnpm-workspace.yaml must
 * use a catalog protocol in source manifests. pnpm rewrites `catalog:dsh` to
 * the resolved version when packing, so published packages still pin the
 * version; a literal here creates a second place to forget on the next
 * baseline bump. This deliberately covers peer, optional, development and
 * runtime dependencies, including `@earendil-works/pi-ai`, rather than only
 * packages in the `@deepseek-ai` namespace.
 */
async function validateCatalogVersionedDependencies(): Promise<void> {
  const workspace = await readFile(join(repositoryRoot, 'pnpm-workspace.yaml'), 'utf8')
  const catalogPackages = parseCatalogPackageNames(workspace)
  const manifestPaths = [join(repositoryRoot, 'package.json')]
  for (const workspaceRoot of ['apps', 'docs', 'packages', 'plugins', 'tooling']) {
    const root = join(repositoryRoot, workspaceRoot)
    if (!existsSync(root)) continue
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (entry.isDirectory()) manifestPaths.push(join(root, entry.name, 'package.json'))
    }
  }

  for (const manifestPath of manifestPaths) {
    if (!existsSync(manifestPath)) continue
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const) {
      const block = manifest[field]
      if (typeof block !== 'object' || block === null) continue
      for (const [name, range] of Object.entries(block as Record<string, unknown>)) {
        if (!catalogPackages.has(name)) continue
        // DSH 运行时版本只有 catalog 一个事实来源：插件的 peer 与开发依赖一律写
        // `catalog:dsh`，兼容判定改由 manifest 的 `engines.dsh` 承担（声明了
        // engines.dsh 时 DSH 只按它判定、忽略 peerDependencies）。pnpm 在 pack
        // 时会把 `catalog:dsh` 解析成当时的真实版本，发布产物仍是精确范围。
        if (typeof range === 'string' && range.startsWith('catalog:')) continue
        throw new Error(
          `${manifestPath} must declare ${name} through the pnpm catalog (catalog: or catalog:<name>), not ${String(range)}`,
        )
      }
    }
  }
}

/** Read package keys from the two catalog sections without adding a parser dependency to the CLI. */
function parseCatalogPackageNames(workspace: string): Set<string> {
  const packages = new Set<string>()
  let section: 'catalog' | 'catalogs' | undefined
  for (const line of workspace.split(/\r?\n/u)) {
    if (line === 'catalog:') {
      section = 'catalog'
      continue
    }
    if (line === 'catalogs:') {
      section = 'catalogs'
      continue
    }
    if (/^[^\s#]/u.test(line)) {
      section = undefined
      continue
    }
    const indent = (line.match(/^ */u)?.[0].length ?? 0)
    const match = /^\s+(?:'([^']+)'|"([^"]+)"|([^:#][^:]*)):\s*/u.exec(line)
    if (match === null) continue
    const name = (match[1] ?? match[2] ?? match[3] ?? '').trim()
    if ((section === 'catalog' && indent === 2) || (section === 'catalogs' && indent === 4)) packages.add(name)
  }
  return packages
}

async function prepareDshPluginBundle(app: FpkApp, include: boolean): Promise<void> {
  const manifestPath = dshPublishedPluginManifestPath(app)
  const targetDirectory = join(repositoryRoot, 'apps', app.name, DSH_BUNDLED_PLUGIN_DIRECTORY)
  await rm(targetDirectory, { recursive: true, force: true })
  if (!existsSync(manifestPath) || !include) return

  const manifest = await readDshPluginManifest(app)
  const pluginNames = await readPublishedDshPluginNames(app)
  const pluginVersions = new Map((manifest.plugins ?? []).flatMap(plugin =>
    typeof plugin.name === 'string' && typeof plugin.version === 'string' ? [[plugin.name, plugin.version] as const] : []))
  const pluginTargets = pluginNames.flatMap(name => {
    const target = findPluginTarget(name)
    if (target === undefined) {
      console.log(`Skipping third-party DSH plugin ${name}; it remains a separate install.`)
      return []
    }
    return [target]
  })

  if (pluginTargets.length > 0) await runTurbo(['build'], pluginTargets.map(target => target.filter))
  await mkdir(targetDirectory, { recursive: true })
  for (const target of pluginTargets) {
    const sourceDirectory = dirname(join(repositoryRoot, target.path))
    const pluginArchive = join(targetDirectory, ...target.name.split('/')) + '.tgz'
    const version = pluginVersions.get(target.name)
    if (version === undefined) throw new Error(`Missing exact version for published DSH plugin ${target.name}`)
    await packPluginPackage(sourceDirectory, pluginArchive, { name: target.name, version })
  }
}

function requestedDshPluginBundle(args: string[]): boolean | undefined {
  const include = args.includes('--bundle-dsh-plugins')
  const skip = args.includes('--skip-bundle-dsh-plugins')
  if (include && skip) throw new Error('Cannot combine --bundle-dsh-plugins and --skip-bundle-dsh-plugins')
  if (include) return true
  if (skip) return false
  return undefined
}

async function selectDshPluginBundle(apps: FpkApp[], args: string[]): Promise<boolean | undefined> {
  if (!apps.some(hasDshPluginManifest)) return false
  const requested = requestedDshPluginBundle(args)
  return requested ?? askBundleDshPlugins()
}

function listFpkApps(): FpkApp[] {
  return readFpkApps()
}

async function buildFpkApps(apps: FpkApp[], options: { bundleDshPlugins?: boolean } = {}): Promise<void> {
  if (apps.some(app => app.requiresGateway)) {
    const gatewayName = readGatewayName()
    if (gatewayName === undefined) throw new Error('Unable to resolve the fnOS Gateway package')
    await runTurbo(['build:app'], [gatewayName])
  }
  for (const app of apps) {
    await validateDshReleaseInputs(app)
    await prepareDshPluginBundle(app, options.bundleDshPlugins === true)
    console.log(`\nBuilding FPK: ${app.name}`)
    await runCommand('fnpack', ['build'], join(repositoryRoot, 'apps', app.name))
    await renameFpkForRelease(app)
  }
}

/**
 * 把 `fnpack` 产出的固定名 FPK 改成发布用的带版本名。
 *
 * 与 `.github/workflows/build-app.yml` 的「Rename FPK with DSH version」保持一致：
 *
 *   <appname>-<RELEASE_TAG>-dsh-<DSH_BASELINE>.fpk
 *
 * 本地构建以前只留 `fn-deepseek-harness.fpk`，与 CI 产物同名不同款——装机时
 * 分不清手上这份来自哪次构建、对应哪个 DSH 基线。统一格式后，本地产物与
 * Release 附件可以直接对照。
 *
 * `RELEASE_TAG` 在 CI 由 `inputs.release_tag` 提供，本地没有那层输入，改取当前
 * 提交命中的 tag（等价）。没有精确 tag 时退回 manifest 版本补 `v` 前缀——那正是
 * `pnpm run version` 会打出的形态。
 *
 * 取源文件一律用 fnpack 的固定产物名 `<app>.fpk`（见 `core/fpk-artifacts.ts`），
 * 不能扫目录里「第一个 .fpk」：上一次构建残留的版本化产物会排在前面，导致旧包
 * 被改名成新名字、新包留在原名，产物名字与内容对不上。
 */
async function renameFpkForRelease(app: FpkApp): Promise<void> {
  const appDir = join(repositoryRoot, 'apps', app.name)
  const target = fpkReleaseFileName(app.name, await resolveReleaseTag(), requireDshBaseline())
  const result = await renameFpkToRelease(appDir, app.name, target)
  console.log(`Release FPK: apps/${app.name}/${result.to}`)
  if (result.replacedStaleTarget) {
    console.log(`  已覆盖同名的上一轮产物（此前存在 ${result.to}）`)
  }
  if (result.leftovers.length > 0) {
    console.warn(`  警告：apps/${app.name} 下还有其它 FPK，装机时容易拿错：${result.leftovers.join('、')}`)
  }
}

/** 当前提交命中的 tag；没有则用 manifest 版本补 `v`，与 `pnpm run version` 一致。 */
async function resolveReleaseTag(): Promise<string> {
  const tag = (await captureCommandOutput('git', ['describe', '--tags', '--exact-match'], repositoryRoot))?.trim()
  if (tag !== undefined && tag.length > 0 && tag.startsWith('v')) return tag
  for (const app of listFpkApps()) {
    const manifest = await readFile(join(repositoryRoot, 'apps', app.name, 'manifest'), 'utf8')
    const version = /^version\s*=\s*(\S+)\s*$/mu.exec(manifest)?.[1]
    if (version !== undefined) return `v${version}`
  }
  throw new Error('Unable to determine the release tag: no v* tag on HEAD and no manifest version found')
}

async function selectPluginFilters(filter?: string): Promise<string[] | undefined> {
  if (filter !== undefined) {
    const target = findPluginTarget(filter)
    if (target === undefined) throw new Error(`Unknown plugin: ${filter}`)
    return [target.filter]
  }
  return askPlugins()
}

async function selectFpkApps(app?: string): Promise<FpkApp[] | undefined> {
  const apps = listFpkApps()
  if (app !== undefined) {
    const selected = apps.find(candidate => candidate.name === app)
    if (selected === undefined) throw new Error(`Unknown FPK application: ${app}`)
    return [selected]
  }
  return askFpkApps(apps)
}

export async function runBuild(args: string[]): Promise<void> {
  const app = optionValue(args, '--app')
  const plugin = optionValue(args, '--plugin')
  if (args.includes('--fpk')) {
    const apps = await selectFpkApps(app)
    if (apps !== undefined) {
      const bundleDshPlugins = await selectDshPluginBundle(apps, args)
      if (bundleDshPlugins !== undefined) {
        await buildFpkApps(apps, { bundleDshPlugins })
      }
    }
    return
  }
  if (args.includes('--plugin')) {
    const filters = await selectPluginFilters(plugin)
    if (filters !== undefined) await runTurbo(['build'], filters)
    return
  }
  if (args.includes('--docs')) {
    await runDocsBuild()
    return
  }

  const selection = await askBuildSelection()
  if (selection === undefined) return

  const pluginFilters = selection.includes('plugins') ? await selectPluginFilters() : undefined
  const fpkApps = selection.includes('fpk') ? await selectFpkApps() : undefined
  const bundleDshPlugins = fpkApps === undefined ? false : await selectDshPluginBundle(fpkApps, args)
  if (fpkApps !== undefined && bundleDshPlugins === undefined) return

  const tasks: Promise<void>[] = []
  if (pluginFilters !== undefined) tasks.push(runTurbo(['build'], pluginFilters))
  if (fpkApps !== undefined && bundleDshPlugins !== undefined) {
    tasks.push(buildFpkApps(fpkApps, { bundleDshPlugins }))
  }
  if (selection.includes('docs')) tasks.push(runDocsBuild())
  await Promise.all(tasks)
}

export { listFpkApps, buildFpkApps, type FpkApp }

program
  .command('build')
  .description('Select plugins, FPK applications, or documentation to build')
  .option('--plugin [plugin]', 'build one plugin, or prompt for plugins')
  .option('--fpk', 'build FPK applications')
  .option('--app <app>', 'select one FPK application')
  .option('--bundle-dsh-plugins', 'include published DSH plugins in the FPK')
  .option('--skip-bundle-dsh-plugins', 'do not include published DSH plugins in the FPK')
  .option('--docs', 'build documentation')
  .action(async (options: OptionValues) => {
    const args: string[] = []
    addOptionalValueArg(args, options, 'plugin')
    addBooleanArgs(args, options, ['fpk', 'docs'])
    if (options.bundleDshPlugins) args.push('--bundle-dsh-plugins')
    if (options.skipBundleDshPlugins) args.push('--skip-bundle-dsh-plugins')
    if (options.app !== undefined) args.push('--app', options.app)
    await runBuild(args)
  })
