import { confirm, intro, isCancel, outro } from '@clack/prompts'
import { type OptionValues } from 'commander'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { versionBump, type VersionBumpRelease } from 'bumpp'
import { program } from '../program.js'
import { addBooleanArgs, addNegatedArgs } from '../core/command-args.js'
import { projectVersionFiles, repositoryRoot } from '../config/paths.js'
import { pluginTargets } from '../config/targets.js'
import { parseVersionOptions } from '../core/args.js'
import {
  assertProjectVersionShape,
  nextProjectVersion,
  parseProjectVersion,
  pluginVersionOf,
  readDshBaselineFromCatalog,
} from '../core/project-version.js'
import { readPackageInfo } from '../core/package.js'

const publishedDshPluginsPath = 'apps/fn-deepseek-harness/app/published-dsh-plugins.json'
const pluginIndexDocPath = 'docs/plugins/index.md'
const projectVersionPackageFiles = [
  'docs/package.json',
  'tooling/fnos-dsh-cli/package.json',
]
const projectVersionTextFiles = [
  'apps/fn-deepseek-harness/manifest',
  'docs/development/manifest.md',
]

type JsonObject = Record<string, unknown>

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

async function alignProjectVersionTextFiles(version: string): Promise<void> {
  for (const relativePath of projectVersionTextFiles) {
    const absolutePath = join(repositoryRoot, relativePath)
    const content = await readFile(absolutePath, 'utf8')
    const updated = content.replace(/^(\s*version\s*=\s*)\S+$/gm, `$1${version}`)
    if (updated !== content) await writeFile(absolutePath, updated)
  }
}

/**
 * 在 bumpp 之前把应用文档页的版本行对齐到当前版本。
 *
 * 必须在 versionBump 之前执行：release 提交由 bumpp 在其内部创建，bump
 * 之后的文件改动进不了提交，会遗留在工作区。先对齐到当前版本，bumpp 的
 * 文本替换（当前版本串 → 新版本）才能命中该行，并把它纳入 release 提交
 * 与 tag。路径必须同时出现在 projectVersionFiles 清单里，否则 bumpp 不会
 * 处理它。
 */
async function syncAppDocVersion(version: string): Promise<void> {
  const absolutePath = join(repositoryRoot, 'docs/apps/fn-deepseek-harness.md')
  if (!existsSync(absolutePath)) return
  const content = await readFile(absolutePath, 'utf8')
  const updated = content.replace(/^(\| 应用版本 \| `)[^`]+(` \|)$/m, `$1${version}$2`)
  if (updated !== content) await writeFile(absolutePath, updated)
}

async function alignProjectVersionPackageFiles(version: string): Promise<void> {
  for (const relativePath of projectVersionPackageFiles) {
    const packageInfo = await readJson(relativePath)
    if (packageInfo.version !== version) await updatePackageVersion(relativePath, version)
  }
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
 * 插件包名 → 文档站页面名（不含 `.md`）。
 *
 * 这里是**显式覆盖表**，只在页面名与包名末段不一致时才需要登记。约定是
 * 「页面名 == 包名末段」（`@tnnevol/dsh-midscene` → `dsh-midscene`），
 * 未登记时按该约定推导，因此**新增插件不需要记得回来补这张表**。
 *
 * 之所以要兜底：`dsh-failover-search` 与 `dsh-midscene` 曾漏登记于此，
 * 后果是发版时 `docs/plugins/<页面>.md` 的安装命令**不被重写**、停在旧版本，
 * 用户照抄就装到旧包（守卫能报出来，但根本不该漏）。
 */
const pluginDocPages: Record<string, string> = {
  '@tnnevol/dsh-codebuddy': 'dsh-codebuddy',
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

/** 把某个插件安装命令里的版本号替换为目标版本。 */
function replacePluginInstallVersion(content: string, pluginName: string, version: string): string {
  const escaped = pluginName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return content.replace(new RegExp(`(add ${escaped}@)[0-9A-Za-z][0-9A-Za-z.+-]*`, 'gu'), `$1${version}`)
}

/**
 * 同步安装命令里的插件版本号。
 *
 * 安装命令 `dsh plugin --profile web add <包名>@<版本>` 里的版本是**可执行**
 * 的指令，不是描述文字：插件发版后它若停在旧版本，用户照抄就会装到旧包。
 * README 与文档站页面各有一份，必须一起更新——只改总览表格不足以让用户拿到
 * 新版本（总览页自己那条命令由 `syncPluginIndexDocVersion` 一并处理）。
 *
 * 只替换安装命令中的版本段，不触碰「要求 DSH `0.1.7-rc.2`」这类兼容性基线
 * 描述，也不触碰依赖该插件的其它包名。
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
 * 同步插件总览文档表格中的版本号，避免插件发版后文档版本过期。
 * 只替换「包名 | 版本」表格行中的版本列，不触碰正文中的兼容性基线描述。
 *
 * 总览页同时携带一条安装命令，因此这里补做一次命令版本替换：否则表格显示
 * 新版本、命令却指向旧版本，用户照抄安装会拿到旧包。
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
 * 统一发布确认：一张提示里列出项目版本与每个插件的目标版本。
 *
 * 两套版本会落在同一条提交里，所以必须在执行前让调用者一次看清全部变更——
 * 分成两次确认会出现「项目已改、插件未改」的中间态。
 *
 * @param projectFrom 项目当前版本。
 * @param projectTo 项目目标版本。
 * @param plan 每个插件的目标版本。
 * @returns 是否继续；取消返回 `false`。
 */
async function confirmUnifiedRelease(
  projectFrom: string,
  projectTo: string,
  plan: readonly { name: string, from: string, to: string }[],
): Promise<boolean> {
  const detail = plan.map(item => `  ${item.name}: ${item.from} -> ${item.to}`).join('\n')
  const result = await confirm({
    message: `项目 ${projectFrom} -> ${projectTo}\n插件（${plan.length} 个）：\n${detail}\n\n继续吗？`,
    initialValue: true,
  })
  return isCancel(result) ? false : result
}

/** 项目版本的 tag 名。 */
function formatTag(version: string): string {
  return `v${version}`
}

/**
 * 版本维护的唯一入口。
 *
 * **不再区分「项目」与「插件」两个区域**：一次执行同时推进两套版本——
 * 项目版本的迭代号 +1，并让**每个插件**在自身版本上递增，结果落在同一条提交里。
 * 原先的「选择要维护版本的区域」菜单已移除，避免同一件事有两种入口。
 *
 * **统一管理：项目与全部插件共用同一个迭代号。** 插件版本就是项目版本去掉基础段
 * 前缀（`5.9.0-0.2.1-rc.2.5` ↔ `0.2.1-rc.2.5`），因此迭代号只算一次，插件直接沿用。
 * 发出前还会核对现状：若有插件与项目不同号就报错，而不是默默拉平——静默改写会让
 * 「谁在何时改了版本」无从追溯。
 *
 * `project` / `plugin` 作为历史参数仍被接受，但语义已合并为同一条流程。
 */
export async function runVersion(args: string[]): Promise<void> {
  intro('fn-os-apps 版本维护')
  // 历史参数 `project` / `plugin` 仍被接受，但不再分叉成两套流程。
  const filtered = args.filter((arg, index) => {
    if (arg.startsWith('-')) return true
    const positionalIndex = args.slice(0, index).filter(a => !a.startsWith('-')).length
    // 只丢弃作为「区域」出现在首位的 project/plugin，保留其后可能的版本串。
    return !(positionalIndex === 0 && (arg === 'project' || arg === 'plugin'))
  })
  const options = parseVersionOptions(filtered)

  const workspaceYaml = await readFile(join(repositoryRoot, 'pnpm-workspace.yaml'), 'utf8')
  const baseline = readDshBaselineFromCatalog(workspaceYaml)
  if (baseline === undefined) {
    throw new Error("pnpm-workspace.yaml 的 catalog 未声明 '@deepseek-ai/dsh'，无法确定 DSH 基线")
  }
  await releaseAll(options, baseline)
}

/**
 * 同时推进项目版本与全部插件版本。
 *
 * @param options 解析后的版本选项（含 release 与提交/tag 开关）。
 * @param baseline 当前 DSH 运行时基线。
 */
async function releaseAll(
  options: ReturnType<typeof parseVersionOptions>,
  baseline: string,
): Promise<void> {
  // 本方案下所有版本共用一个迭代号，只能「+1」，没有 minor/major 的语义空间：
  // 前三段由基础段与 DSH 基线决定，都不归发布流程管。与其静默忽略，不如明确拒绝——
  // 否则调用者以为 `minor` 生效了，实际只是迭代号 +1。
  const release = String(options.release)
  // 完整版本号是允许的（用于切换 DSH 基线）：它自带基线与迭代号，不走 +1 逻辑。
  const isExplicitVersion = /^v?\d+\.\d+\.\d+-\d+\.\d+\.\d+/u.test(release)
  if (!isExplicitVersion && release !== 'patch' && release !== 'prerelease') {
    throw new Error(
      `不支持版本档位 "${release}"：项目与插件共用同一个迭代号，发布时只递增它。`
      + '请使用 `pnpm run version -- patch`，或传完整版本号（如 5.9.0-0.2.2-rc.1.0）以切换 DSH 基线。',
    )
  }

  const project = await readPackageInfo('package.json')
  // 校验项目版本形态（不认字面量）：裸 MAJOR.MINOR.PATCH 会被拒绝。
  const projectParts = assertProjectVersionShape(project.version, baseline)

  const targets = pluginTargets
  const packages = await Promise.all(targets.map(target => readPackageInfo(target.path)))

  // 统一管理：**项目与全部插件共用同一个迭代号**。
  //
  // 插件版本就是项目版本去掉基础段前缀（`5.9.0-0.2.1-rc.2.5` ↔ `0.2.1-rc.2.5`），
  // 所以迭代号只从项目版本算一次，插件直接沿用。原先让插件「各自递增」的做法虽然
  // 起点相同时能保持同步，但只要有人手工改过其中之一就会**永久错位**，那时统一管理
  // 名存实亡。
  const nextProject = nextProjectVersion(project.version, baseline)
  const nextProjectParts = parseProjectVersion(nextProject, baseline)
  if (nextProjectParts === undefined) {
    throw new Error(`无法从项目版本 "${nextProject}" 推导插件版本`)
  }
  const currentPluginVersion = pluginVersionOf(projectParts)
  const nextPluginVersion = pluginVersionOf(nextProjectParts)

  // 发布前核对现状：若有插件与项目不同号，说明版本文件被绕过本命令改过。
  // 此时**报错而不是默默拉平**——静默改写会让「谁在何时改了版本」无从追溯。
  const drifted = packages.filter(pkg => pkg.version !== currentPluginVersion)
  if (drifted.length > 0) {
    const detail = drifted.map(pkg => `${pkg.name}@${pkg.version}`).join('、')
    throw new Error(
      `插件版本与项目版本不同号，拒绝发布：${detail}。`
      + `项目当前对应插件版本 ${currentPluginVersion}，请先把上述插件统一到该值。`,
    )
  }

  const plan = targets.map((target, index) => {
    const pkg = packages[index]!
    return { target, name: pkg.name, from: pkg.version, to: nextPluginVersion }
  })

  if (options.confirm && !await confirmUnifiedRelease(project.version, nextProject, plan)) return

  // 项目侧：先对齐历史遗留的版本文件，再交给 bumpp 完成替换。
  // 提交与 tag 都由本函数统一处理（两套版本必须落在同一条提交里）。
  await alignProjectVersionPackageFiles(project.version)
  await alignProjectVersionTextFiles(project.version)
  await syncAppDocVersion(project.version)
  const result = await versionBump({
    cwd: repositoryRoot,
    files: projectVersionFiles,
    currentVersion: project.version,
    release: nextProject as VersionBumpRelease,
    commit: false,
    tag: false,
    push: false,
    ignoreScripts: true,
    confirm: false,
  })

  // 插件侧：逐个写入，并收集被改动的文档路径。
  const changedPaths = new Set<string>(projectVersionFiles)
  for (const item of plan) {
    await updatePackageVersion(item.target.path, item.to)
    changedPaths.add(item.target.path)
    if (await syncPublishedPluginVersion(item.name, item.to)) changedPaths.add(publishedDshPluginsPath)
    if (await syncPluginIndexDocVersion(item.name, item.to)) changedPaths.add(pluginIndexDocPath)
    const pluginDirectory = item.target.path.split('/')[1] ?? ''
    for (const path of await syncPluginInstallVersions(item.name, pluginDirectory, item.to)) {
      changedPaths.add(path)
    }
  }

  if (!options.noCommit) {
    // 只暂存本命令写过的路径（`projectVersionFiles` 里的 glob 由 git 自己展开）。
    // 不用 `git add -A`——那会把调用者工作区里的无关改动一并卷进 release 提交，
    // 属于最难排查的一类事故。
    runGit(['add', '--', ...changedPaths])
    runGit(['commit', '-m', `chore: release v${nextProject}`])
    if (!options.noTag) runGit(['tag', formatTag(nextProject)])
  }

  outro(`项目 ${result.currentVersion} -> ${nextProject}`)
  for (const item of plan) outro(`${item.name}: ${item.from} -> ${item.to}`)
}




program
  .command('version [args...]')
  .description('Version the project/FPK area or selected DSH plugins')
  .option('--no-commit', 'only update version files')
  .option('--no-tag', 'do not create a version tag')
  .option('--no-push', 'do not push tags')
  .option('--yes', 'skip the version confirmation')
  .action(async (args: string[], options: OptionValues) => {
    addNegatedArgs(args, options, [
      ['commit', '--no-commit'],
      ['tag', '--no-tag'],
      ['push', '--no-push'],
    ])
    addBooleanArgs(args, options, ['yes'])
    await runVersion(args)
  })
