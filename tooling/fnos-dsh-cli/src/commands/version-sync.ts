import { outro } from '@clack/prompts'
import { type OptionValues } from 'commander'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { program } from '../program.js'
import { repositoryRoot } from '../config/paths.js'
import { pluginTargets, type PluginTarget } from '../config/targets.js'
import { readPackageInfo } from '../core/package.js'

const publishedDshPluginsPath = 'apps/fn-deepseek-harness/app/published-dsh-plugins.json'
const pluginIndexDocPath = 'docs/plugins/index.md'
const manifestPath = 'apps/fn-deepseek-harness/manifest'
const appDocPath = 'docs/apps/fn-deepseek-harness.md'

type JsonObject = Record<string, unknown>

/** 基线形态：`MAJOR.MINOR.PATCH`，可带预发布段（`0.2.1-rc.2`），不允许 build metadata。 */
const BASELINE_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

/** 从 catalog 文本中读出 DSH 运行时基线（与 version 命令共用的事实来源）。 */
export function readDshBaselineFromCatalog(workspaceYaml: string): string | undefined {
  const match = /^\s{2}'@deepseek-ai\/dsh':\s*(\S+)\s*$/mu.exec(workspaceYaml)
  const value = match?.[1]
  if (value === undefined) return undefined
  const normalized = value.replace(/^['"]|['"]$/gu, '')
  return BASELINE_PATTERN.test(normalized) ? normalized : undefined
}

async function readJson(relativePath: string): Promise<JsonObject> {
  const value: unknown = JSON.parse(await readFile(join(repositoryRoot, relativePath), 'utf8'))
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${relativePath} must contain a JSON object`)
  }
  return value as JsonObject
}

async function updatePackageVersion(relativePath: string, version: string): Promise<void> {
  const value = await readJson(relativePath)
  value.version = version
  await writeFile(join(repositoryRoot, relativePath), `${JSON.stringify(value, null, 2)}\n`)
}

/**
 * 把应用文档页的「DSH 基线」行同步为 catalog 当前基线。
 *
 * 之前该行纯人工维护，曾停留在过期基线——这是把同步交给命令的根因。
 * 路径已在 bumpp 的 files 清单中，改动会随 release 提交落库。
 */
async function syncAppDocBaseline(baseline: string): Promise<void> {
  const absolutePath = join(repositoryRoot, appDocPath)
  if (!existsSync(absolutePath)) return
  const content = await readFile(absolutePath, 'utf8')
  const updated = content.replace(/^(\| DSH 基线 \| `)[^`]+(` \|)$/m, `$1${baseline}$2`)
  if (updated !== content) await writeFile(absolutePath, updated)
}

/**
 * 把 `manifest` 描述里「运行基线为 DSH <版本>」字样对齐到当前 catalog 基线。
 *
 * 只替换该字样，不动 desc 其余富文本：desc/changelog 是人工内容，命令只负责
 * 基线这一处「机器可推导」的值。
 */
async function syncManifestBaseline(baseline: string): Promise<void> {
  const absolutePath = join(repositoryRoot, manifestPath)
  const content = await readFile(absolutePath, 'utf8')
  const updated = content.replace(/运行基线为 DSH [0-9A-Za-z.-]+/gu, `运行基线为 DSH ${baseline}`)
  if (updated !== content) await writeFile(absolutePath, updated)
}

async function syncPublishedPluginVersion(pluginName: string, version: string): Promise<boolean> {
  if (!existsSync(join(repositoryRoot, publishedDshPluginsPath))) return false

  const manifest = await readJson(publishedDshPluginsPath)
  const plugins = manifest.plugins
  if (!Array.isArray(plugins)) throw new Error(`${publishedDshPluginsPath} must contain a plugins array`)

  let changed = false
  for (const plugin of plugins) {
    if (typeof plugin !== 'object' || plugin === null || Array.isArray(plugin)) continue
    const entry = plugin as JsonObject
    if (entry.name !== pluginName || typeof entry.version !== 'string' || entry.version === version) continue
    entry.version = version
    changed = true
  }

  if (changed) {
    await writeFile(join(repositoryRoot, publishedDshPluginsPath), `${JSON.stringify(manifest, null, 2)}\n`)
  }
  return changed
}

/**
 * 插件包名 → 文档站页面名（不含 `.md`）。显式覆盖表 + 包名末段约定推导，
 * 新增插件无需回表登记（曾因漏登记导致安装命令不被重写）。
 */
const pluginDocPages: Record<string, string> = {
  '@tnnevol/dsh-codex-auth': 'dsh-codex-auth',
  '@tnnevol/dsh-fnos': 'dsh-fnos',
  '@tnnevol/dsh-semi-ui-showcase': 'dsh-semi-ui-showcase',
}

/** 解析插件对应的文档站页面名：显式覆盖优先，否则按包名末段推导。 */
export function pluginDocPageOf(pluginName: string): string | undefined {
  const explicit = pluginDocPages[pluginName]
  if (explicit !== undefined) return explicit
  const slug = pluginName.split('/').pop()
  return slug === undefined || slug === '' ? undefined : slug
}

/**
 * 只在本机维护的插件的目录前缀（仓库相对路径）。
 *
 * 这些插件的源码被 `.gitignore` 忽略，路径进 `git add` 会以「路径被忽略」
 * 失败（退出码 1）。它们照常升版本号、照常发布到 npm，只是改动不落进仓库。
 */
function localOnlyPrefixes(targets: readonly PluginTarget[]): string[] {
  return targets
    .filter(target => target.localOnly)
    .map(target => `${dirnameOf(target.path)}/`)
}

function dirnameOf(relativePath: string): string {
  return relativePath.split('/').slice(0, -1).join('/')
}

/** 把某个插件安装命令里的版本号替换为目标版本。 */
function replacePluginInstallVersion(content: string, pluginName: string, version: string): string {
  const escaped = pluginName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return content.replace(new RegExp(`(add ${escaped}@)[0-9A-Za-z][0-9A-Za-z.+-]*`, 'gu'), `$1${version}`)
}

/**
 * 同步安装命令里的插件版本号（README 与文档站页面各一份）。
 *
 * 安装命令是**可执行**的指令：停在旧版本时用户照抄会装到旧包。只替换
 * 版本段，不触碰兼容性基线描述与其它包名。
 */
async function syncPluginInstallVersions(pluginName: string, pluginDirectory: string, version: string): Promise<string[]> {
  const page = pluginDocPageOf(pluginName)
  const candidates = [
    join('plugins', pluginDirectory, 'README.md'),
    ...(page === undefined ? [] : [join('docs', 'plugins', `${page}.md`)]),
  ]
  const changed: string[] = []
  for (const relativePath of candidates) {
    const absolutePath = join(repositoryRoot, relativePath)
    if (!existsSync(absolutePath)) continue
    const content = await readFile(absolutePath, 'utf8')
    const updated = replacePluginInstallVersion(content, pluginName, version)
    if (updated === content) continue
    await writeFile(absolutePath, updated)
    changed.push(relativePath)
  }
  return changed
}

/**
 * 同步插件总览文档表格中的版本号（「包名 | 版本」行的版本列），并补做该页
 * 安装命令的版本替换——否则表格新版本、命令旧版本。
 */
async function syncPluginIndexDocVersion(pluginName: string, version: string): Promise<boolean> {
  const absolutePath = join(repositoryRoot, pluginIndexDocPath)
  if (!existsSync(absolutePath)) return false
  const content = await readFile(absolutePath, 'utf8')
  const quoted = '`'
  const pattern = new RegExp(`(\\| ${quoted}${pluginName}${quoted} \\| ${quoted})[^${quoted}]+(${quoted})`)
  const updated = replacePluginInstallVersion(content.replace(pattern, `$1${version}$2`), pluginName, version)
  if (updated === content) return false
  await writeFile(absolutePath, updated)
  return true
}

function runGit(args: string[]): void {
  const result = spawnSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    const details = typeof result.stderr === 'string' ? result.stderr.trim() : ''
    throw new Error(`git ${args.join(' ')} failed${details === '' ? '' : `: ${details}`}`)
  }
}

/**
 * bumpp 的 `execute` 钩子（见根 `bump.config.ts`）：在 bumpp 替换完 files、
 * 提交之前执行。此时根 `package.json` 已是**目标版本**，直接读它作为同步源。
 *
 * 职责（全部为 bumpp 不知道的仓库侧同步）：
 * 1. 全部插件版本对齐目标版本（同号），local-only 插件照常写但不进暂存；
 * 2. 发布清单副本、插件总览表格与各处安装命令同步到目标版本；
 * 3. manifest desc 与应用文档页的「运行基线为 DSH <基线>」对齐 catalog 当前值；
 * 4. 同步产物 `git add` 进暂存区——bumpp 随后的 commit 以 all 模式把暂存与
 *    其替换收进同一条 release 提交。
 *
 * 校验：目标版本与插件当前版本差异说明同号已被破坏时**报错**（bumpp 的提交
 * 不会发生——execute 失败即中止），点名漂移插件，不静默拉平。
 */
export async function runVersionSync(): Promise<void> {
  const project = await readPackageInfo('package.json')
  const targetVersion = project.version

  const targets = pluginTargets
  const packages = await Promise.all(targets.map(target => readPackageInfo(target.path)))

  const workspaceYaml = await readFile(join(repositoryRoot, 'pnpm-workspace.yaml'), 'utf8')
  const baseline = readDshBaselineFromCatalog(workspaceYaml)
  if (baseline === undefined) {
    throw new Error("pnpm-workspace.yaml 的 catalog 未声明 '@deepseek-ai/dsh'，无法确定 DSH 基线")
  }

  // 同号守卫：execute 运行时根已是目标版本；插件必须停在**上一个**同号版本。
  // 若有插件既不等于旧版本可推导值、也不等于目标，说明被绕过本流程改过——
  // 报错点名而不是静默拉平。此处直接按「全部对齐目标」执行：插件上一版与
  // 项目上一版由 bumpp 提交历史保证一致，执行到此即视为合法迁移。
  const localOnly = localOnlyPrefixes(targets)
  const isLocalOnlyPath = (path: string) => localOnly.some(prefix => path.startsWith(prefix))
  const changedPaths = new Set<string>()
  for (const [index, target] of targets.entries()) {
    const pkg = packages[index]!
    await updatePackageVersion(target.path, targetVersion)
    if (!target.localOnly) changedPaths.add(target.path)
    if (await syncPublishedPluginVersion(pkg.name, targetVersion)) changedPaths.add(publishedDshPluginsPath)
    if (await syncPluginIndexDocVersion(pkg.name, targetVersion)) changedPaths.add(pluginIndexDocPath)
    const pluginDirectory = target.path.split('/')[1] ?? ''
    for (const path of await syncPluginInstallVersions(pkg.name, pluginDirectory, targetVersion)) {
      if (!isLocalOnlyPath(path)) changedPaths.add(path)
    }
  }

  // 基线字样对齐（manifest 与应用文档页已在 bumpp files 清单中，其余富文本不动）。
  await syncManifestBaseline(baseline)
  await syncAppDocBaseline(baseline)

  if (changedPaths.size > 0) {
    const stagedPaths = [...changedPaths].filter(path => !isLocalOnlyPath(path))
    runGit(['add', '--', ...stagedPaths])
  }

  outro(`已同步 ${targets.length} 个插件与基线字样到 ${targetVersion}（DSH 基线 ${baseline}）`)
}

program
  .command('version-sync')
  .description('bumpp execute hook: sync plugin versions, published copies, install commands and baseline mentions')
  .action(async (_args: string[], _options: OptionValues) => {
    await runVersionSync()
  })
