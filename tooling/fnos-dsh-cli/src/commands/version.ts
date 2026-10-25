import { confirm, intro, isCancel, outro } from '@clack/prompts'
import { type OptionValues } from 'commander'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dirname } from 'node:path'
import { versionBump, type VersionBumpRelease } from 'bumpp'
import { program } from '../program.js'
import { addBooleanArgs, addNegatedArgs } from '../core/command-args.js'
import { projectVersionFiles, repositoryRoot } from '../config/paths.js'
import { pluginTargets, type PluginTarget } from '../config/targets.js'
import { parseVersionOptions } from '../core/args.js'
import { readPackageInfo } from '../core/package.js'

const publishedDshPluginsPath = 'apps/fn-deepseek-harness/app/published-dsh-plugins.json'
const pluginIndexDocPath = 'docs/plugins/index.md'
const manifestPath = 'apps/fn-deepseek-harness/manifest'
const appDocPath = 'docs/apps/fn-deepseek-harness.md'
const projectVersionPackageFiles = [
  'docs/package.json',
  'tooling/fnos-dsh-cli/package.json',
]
const projectVersionTextFiles = [
  manifestPath,
  'docs/development/manifest.md',
]

type JsonObject = Record<string, unknown>

/** 基线形态：`MAJOR.MINOR.PATCH`，可带预发布段（`0.2.1-rc.2`），不允许 build metadata。 */
const BASELINE_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

/** 纯净项目版本形态：`MAJOR.MINOR.PATCH`，不带预发布段与 build metadata。 */
const CLEAN_VERSION_PATTERN = /^\d+\.\d+\.\d+$/u

/**
 * 从 catalog 文本中读出 DSH 运行时基线。
 *
 * 权威来源是 `pnpm-workspace.yaml` 里的 `'@deepseek-ai/dsh'` 条目——它与各插件
 * `peerDependencies` 用的 `catalog:dsh` 是同一份事实，避免在版本命令里再维护一个常量。
 *
 * @param workspaceYaml `pnpm-workspace.yaml` 文本。
 * @returns 基线版本号；未声明时返回 `undefined`。
 */
export function readDshBaselineFromCatalog(workspaceYaml: string): string | undefined {
  // 只认顶层 catalog 下的直系条目：`  '@deepseek-ai/dsh': 0.2.1-rc.2`。
  // 缩进更深的是 catalog 分组（如 `dsh:`），那些条目的键是子包名，不能当作基线。
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
 * 必须在 versionBump 之前执行：release 提交由本命令在 bump 之后统一创建，bump
 * 之后的文件改动进不了提交，会遗留在工作区。先对齐到当前版本，bumpp 的
 * 文本替换（当前版本串 → 新版本）才能命中该行，并把它纳入 release 提交
 * 与 tag。路径必须同时出现在 projectVersionFiles 清单里，否则 bumpp 不会
 * 处理它。
 */
async function syncAppDocVersion(version: string): Promise<void> {
  const absolutePath = join(repositoryRoot, appDocPath)
  if (!existsSync(absolutePath)) return
  const content = await readFile(absolutePath, 'utf8')
  const updated = content.replace(/^(\| 应用版本 \| `)[^`]+(` \|)$/m, `$1${version}$2`)
  if (updated !== content) await writeFile(absolutePath, updated)
}

/**
 * 把应用文档页的「DSH 基线」行同步为 catalog 当前基线。
 *
 * 与 `syncAppDocVersion` 同理：先对齐旧值，bumpp 不处理该行（不含版本串），
 * 因此这里直接写目标基线；路径已在 projectVersionFiles 中，进 release 提交。
 * 之前该行纯人工维护，曾停留在过期基线（0.2.0-rc.2）——这是把同步交给命令的根因。
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
 * 基线这一处「机器可推导」的值，避免与实际构建基线漂移。
 */
async function syncManifestBaseline(baseline: string): Promise<void> {
  const absolutePath = join(repositoryRoot, manifestPath)
  const content = await readFile(absolutePath, 'utf8')
  const updated = content.replace(/运行基线为 DSH [0-9A-Za-z.-]+/gu, `运行基线为 DSH ${baseline}`)
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
 * 只在本机维护的插件的目录前缀。
 *
 * 这些插件的源码被 `.gitignore` 忽略，路径一旦进暂存列表，`git add` 就会以「该路径
 * 被忽略」失败（退出码 1），把整个版本命令打断。它们照常升版本号、照常发布到 npm，
 * 只是改动不落进仓库。
 */
function localOnlyPrefixes(targets: readonly PluginTarget[]): string[] {
  return targets
    .filter(target => target.localOnly)
    .map(target => `${dirname(target.path)}/`)
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
  baselineChange?: { from: string, to: string },
): Promise<boolean> {
  const detail = plan.map(item => `  ${item.name}: ${item.from} -> ${item.to}`).join('\n')
  // 基线切换与普通 +1 产出的版本号形态完全不同，所以单独一行点明；没换基线时不显示，
  // 避免每次发布都被无关信息干扰。
  const baselineLine = baselineChange === undefined
    ? ''
    : `\nDSH 基线 ${baselineChange.from} -> ${baselineChange.to}（major 发布）\n`
  const result = await confirm({
    message: `${baselineLine}项目 ${projectFrom} -> ${projectTo}\n插件（${plan.length} 个）：\n${detail}\n\n继续吗？`,
    initialValue: true,
  })
  return isCancel(result) ? false : result
}

/** 项目版本的 tag 名。 */
function formatTag(version: string): string {
  return `v${version}`
}

/**
 * 用 bumpp 原生档位计算目标版本（不写文件），供流程在「先对齐、后 bump」之间复用。
 *
 * @param currentVersion 当前项目版本。
 * @param release 档位（patch/minor/major/显式版本串）。
 * @returns 目标版本串。
 */
async function resolveNextVersion(currentVersion: string, release: VersionBumpRelease): Promise<string> {
  const result = await versionBump({
    cwd: repositoryRoot,
    files: [],
    currentVersion,
    release,
    commit: false,
    tag: false,
    push: false,
    ignoreScripts: true,
    confirm: false,
  })
  return result.newVersion ?? currentVersion
}

/**
 * 版本维护的唯一入口。
 *
 * **版本号是纯净 semver（6.0.0 起），档位语义固定**（FNOS-028）：
 * - `patch`：无新功能的修复；
 * - `minor`：新功能且 DSH 基线不变；
 * - `major`：DSH 基线变更（携带 `--baseline <新基线>`）或导致用户无法回退的重大调整。
 * 每次发布对应段 +1，由 bumpp 原生计算；插件与项目**同号**，直接沿用项目目标版本。
 * DSH 基线不再进入版本号，由 FPK 产物命名与 manifest 描述承载。
 *
 * `--baseline` 是 major 档位专属参数：DSH 基线变更必须走 major，防止被小档位
 * 静默掩盖。catalog 在**确认之后**才改写——否则用户取消后会留下「catalog 已换、
 * 版本号没动」的不一致状态，且 `pnpm run` 的依赖校验看到的就是变化前的状态。
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

  const release = String(options.release)
  const isExplicitVersion = /^v?\d+\.\d+\.\d+$/u.test(release)
  if (!isExplicitVersion && release !== 'patch' && release !== 'minor' && release !== 'major') {
    throw new Error(
      `不支持版本档位 "${release}"。`
      + '本仓库使用纯净 semver：patch（修复）/ minor（新功能且基线不变）/ major（基线变更或重大调整），'
      + '或传完整三段式版本号（如 6.0.1）。',
    )
  }

  const workspaceYaml = await readFile(join(repositoryRoot, 'pnpm-workspace.yaml'), 'utf8')
  const currentBaseline = readDshBaselineFromCatalog(workspaceYaml)
  if (currentBaseline === undefined) {
    throw new Error("pnpm-workspace.yaml 的 catalog 未声明 '@deepseek-ai/dsh'，无法确定 DSH 基线")
  }

  // `--baseline` 只能搭配 major：基线变更 = major 发布（FNOS-028 档位语义）。
  if (options.baseline !== undefined) {
    if (release !== 'major' && !isExplicitVersion) {
      throw new Error(`基线变更必须走 major 档位（当前档位 "${release}"）：请使用 pnpm run version -- major --baseline <新基线>`)
    }
    if (!BASELINE_PATTERN.test(options.baseline)) {
      throw new Error(`--baseline 的值 "${options.baseline}" 形态应为 MAJOR.MINOR.PATCH，可带预发布段（如 0.2.1-rc.5）`)
    }
    if (options.baseline === currentBaseline) {
      throw new Error(`--baseline 与当前基线相同（${currentBaseline}）：基线未变时请使用 patch/minor 或纯 major`)
    }
  }

  const project = await readPackageInfo('package.json')
  // 项目版本必须是纯净三段式：旧「基础段-基线.迭代号」小尾巴是 FNOS-019 方案，
  // 已被 FNOS-028 取代；发现小尾巴说明版本文件尚未统一，直接指引而不是误算。
  if (!CLEAN_VERSION_PATTERN.test(project.version.replace(/^v/u, ''))) {
    throw new Error(
      `当前项目版本 "${project.version}" 不是纯净三段式（MAJOR.MINOR.PATCH）。`
      + 'FNOS-028 起项目版本为纯净 semver（如 6.0.0）；若仍为旧小尾巴形态（如 5.9.0-0.2.1-rc.2.52），'
      + '请先按 FNOS-028 完成版本统一。',
    )
  }

  const targets = pluginTargets
  const packages = await Promise.all(targets.map(target => readPackageInfo(target.path)))

  // 插件与项目同号：目标版本就是项目目标版本本身，不再做字符串派生。
  // 发布前核对现状：若有插件与项目不同号，说明版本文件被绕过本命令改过。
  // 此时**报错而不是默默拉平**——静默改写会让「谁在何时改了版本」无从追溯。
  const drifted = packages.filter(pkg => pkg.version !== project.version)
  if (drifted.length > 0) {
    const detail = drifted.map(pkg => `${pkg.name}@${pkg.version}`).join('、')
    throw new Error(
      `插件版本与项目版本不同号，拒绝发布：${detail}。`
      + `项目当前版本 ${project.version}，请先把上述插件统一到该值。`,
    )
  }

  const nextProject = await resolveNextVersion(project.version, options.release)
  if (!CLEAN_VERSION_PATTERN.test(nextProject)) {
    throw new Error(
      `目标版本 "${nextProject}" 含预发布段或后缀。本仓库不使用预发布版本号；`
      + '请使用 patch/minor/major 或完整三段式版本（如 6.0.1）。',
    )
  }
  if (nextProject === project.version) {
    // 显式传「与当前相同」的版本号（如统一后重复执行 version 6.0.0）：没有文件
    // 变化可提交，空提交会被 git 拒绝。这里明确说明后直接返回，而不是报错——
    // 版本已就位本身就是期望状态。
    outro(`项目 ${project.version} 已是目标版本，无需变更`)
    for (const item of targets) outro(`${item.name}: ${project.version}（同号）`)
    return
  }

  const plan = targets.map((target, index) => {
    const pkg = packages[index]!
    return { target, name: pkg.name, from: pkg.version, to: nextProject }
  })

  if (options.confirm && !await confirmUnifiedRelease(
    project.version,
    nextProject,
    plan,
    options.baseline === undefined ? undefined : { from: currentBaseline, to: options.baseline },
  )) return

  // 确认之后才改 catalog：取消时不留下「catalog 已换基线、版本号没动」的状态。
  if (options.baseline !== undefined) {
    await writeDshBaselineToCatalog(workspaceYaml, options.baseline)
  }
  const targetBaseline = options.baseline ?? currentBaseline

  // 项目侧：先对齐历史遗留的版本文件与基线字样，再交给 bumpp 完成替换。
  // 提交与 tag 都由本函数统一处理（两套版本必须落在同一条提交里）。
  await alignProjectVersionPackageFiles(project.version)
  await alignProjectVersionTextFiles(project.version)
  await syncAppDocVersion(project.version)
  await syncAppDocBaseline(targetBaseline)
  await syncManifestBaseline(targetBaseline)
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
  const localOnly = localOnlyPrefixes(targets)
  const isLocalOnlyPath = (path: string) => localOnly.some(prefix => path.startsWith(prefix))
  for (const item of plan) {
    await updatePackageVersion(item.target.path, item.to)
    // 只在本机维护的插件照常升版本号，但它的路径不进暂存列表（源码被 git 忽略）。
    if (!item.target.localOnly) changedPaths.add(item.target.path)
    if (await syncPublishedPluginVersion(item.name, item.to)) changedPaths.add(publishedDshPluginsPath)
    if (await syncPluginIndexDocVersion(item.name, item.to)) changedPaths.add(pluginIndexDocPath)
    const pluginDirectory = item.target.path.split('/')[1] ?? ''
    for (const path of await syncPluginInstallVersions(item.name, pluginDirectory, item.to)) {
      if (!isLocalOnlyPath(path)) changedPaths.add(path)
    }
  }

  if (!options.noCommit) {
    // 只暂存本命令写过的路径（`projectVersionFiles` 里的 glob 由 git 自己展开）。
    // 不用 `git add -A`——那会把调用者工作区里的无关改动一并卷进 release 提交，
    // 属于最难排查的一类事故。
    //
    // 只在本机维护的插件路径额外过滤掉：它们被 `.gitignore` 忽略，`git add` 碰到
    // 被忽略的路径会以退出码 1 失败，把整个版本命令打断。
    const stagedPaths = [...changedPaths].filter(path => !isLocalOnlyPath(path))
    runGit(['add', '--', ...stagedPaths])
    runGit(['commit', '-m', `chore: release v${nextProject}`])
    if (!options.noTag) runGit(['tag', formatTag(nextProject)])
  }

  outro(`项目 ${result.currentVersion} -> ${nextProject}`)
  for (const item of plan) outro(`${item.name}: ${item.from} -> ${item.to}`)
}

/**
 * 把 catalog 中的 `@deepseek-ai/dsh` 条目改成新基线。
 *
 * 只改这一行；不碰其它 catalog 条目，也不改动任何插件里对 DSH 的依赖声明——
 * 依赖升级由 `pnpm install` 单独完成，与本命令职责分离。
 *
 * @param workspaceYaml 当前 `pnpm-workspace.yaml` 文本。
 * @param baseline 新基线版本号。
 */
async function writeDshBaselineToCatalog(workspaceYaml: string, baseline: string): Promise<void> {
  const updated = workspaceYaml.replace(
    /^(\s{2}'@deepseek-ai\/dsh':\s*)\S+(\s*)$/mu,
    `$1${baseline}$2`,
  )
  if (updated === workspaceYaml) {
    throw new Error("未能改写 pnpm-workspace.yaml 中的 '@deepseek-ai/dsh' 条目；请检查该行格式")
  }
  await writeFile(join(repositoryRoot, 'pnpm-workspace.yaml'), updated)
}

program
  .command('version [args...]')
  .description('Bump the project and every plugin in lockstep using bumpp release levels (patch/minor/major)')
  .option('--no-commit', 'only update version files')
  .option('--no-tag', 'do not create a version tag')
  .option('--no-push', 'do not push tags')
  .option('--baseline <version>', 'switch the catalog DSH baseline; only valid with the major release')
  .option('--yes', 'skip the version confirmation')
  .action(async (args: string[], options: OptionValues) => {
    addNegatedArgs(args, options, [
      ['commit', '--no-commit'],
      ['tag', '--no-tag'],
      ['push', '--no-push'],
    ])
    addBooleanArgs(args, options, ['yes'])
    // `--baseline <版本>` 的值要连同选项一起传下去：它会被当成位置参数过滤掉，
    // 由 `parseVersionOptions` 单独解析。
    const baseline = typeof options.baseline === 'string' ? options.baseline : undefined
    await runVersion(baseline === undefined ? args : [...args, '--baseline', baseline])
  })
