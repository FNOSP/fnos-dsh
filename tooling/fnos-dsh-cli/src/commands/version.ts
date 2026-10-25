import { intro, outro } from '@clack/prompts'
import { type OptionValues } from 'commander'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { versionBump } from 'bumpp'
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
 * 必须在 versionBump 之前执行：bumpp 的文本替换是「当前版本串 → 新版本」，先对齐
 * 到当前版本该行才能被命中并纳入 release 提交。路径必须同时在 projectVersionFiles
 * 清单里，否则 bumpp 不会处理它。
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
 * 该行不含版本串（bumpp 不会处理），因此直接写目标基线；路径已在
 * projectVersionFiles 中，进 release 提交。之前该行纯人工维护，曾停留在过期
 * 基线（0.2.0-rc.2）——这是把同步交给命令的根因。
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
    .map(target => `${join(repositoryRoot, dirnameOf(target.path))}/`)
}

/** `node:path.dirname` 的薄封装，避免在多个 import 行里重复路径工具。 */
function dirnameOf(relativePath: string): string {
  return relativePath.split('/').slice(0, -1).join('/')
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

function runGit(args: string[]): string {
  const result = spawnSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    const details = typeof result.stderr === 'string' ? result.stderr.trim() : ''
    throw new Error(`git ${args.join(' ')} failed${details === '' ? '' : `: ${details}`}`)
  }
  return typeof result.stdout === 'string' ? result.stdout : ''
}

/**
 * 校验仓库侧守卫：档位语义与版本形态。
 *
 * bumpp 自己接受 `prerelease`/`next` 等档位与任意 semver 串；本仓库的约束
 * （FNOS-028）在其之前收紧——守卫只认 patch/minor/major 与纯净三段式版本。
 */
function assertRepositoryReleasePolicy(release: string, baseline: string | undefined): void {
  const isExplicitVersion = /^v?\d+\.\d+\.\d+$/u.test(release)
  if (!isExplicitVersion && release !== 'patch' && release !== 'minor' && release !== 'major') {
    throw new Error(
      `不支持版本档位 "${release}"。`
      + '本仓库使用纯净 semver：patch（修复）/ minor（新功能且基线不变）/ major（基线变更或重大调整），'
      + '或传完整三段式版本号（如 6.0.1）。',
    )
  }
  if (baseline !== undefined && release !== 'major' && !isExplicitVersion) {
    throw new Error(`基线变更必须走 major 档位（当前档位 "${release}"）：请使用 pnpm run version -- major --baseline <新基线>`)
  }
}

/**
 * 版本维护的唯一入口：版本计算与 release 提交/tag **透传 bumpp**（FNOS-028）。
 *
 * bumpp 一次调用完成版本计算、projectVersionFiles 清单内文件的替换、
 * `chore: release v<版本>` 提交与本地 `v<版本>` tag（push 恒关，tag 推送由
 * 发布者手动执行）。CLI 只做 bumpp 不知道的仓库侧工作：
 *
 * 1. **守卫**：档位语义（patch=修复 / minor=新功能且基线不变 / major=基线变更
 *    或重大不可回退调整）、`--baseline` 仅与 major 搭配、插件与项目同号核对、
 *    发版前工作区必须干净（bumpp 提交用 `--all`，脏工作区的无关改动会被卷进
 *    release 提交——「干净才发版」由这里硬性保证，而不是靠人记住）；
 * 2. **前置同步**（全部在 bumpp 写文件之前）：把各版本文件对齐到当前版本（让
 *    bumpp 的「当前→新」文本替换命中全部副本）、插件版本与副本/总览/安装命令
 *    直写目标版本、基线字样（manifest desc、应用文档页）对齐 catalog；
 * 3. **提交收口**：同步产生的文件改动先 `git add`（local-only 插件路径除外，
 *    它们被 gitignore），bumpp 提交时以 `all` 模式把暂存区与自己的替换一并落进
 *    **同一条** release 提交——插件 package.json 不进 bumpp 的 files 清单（其
 *    版本串与项目不同名，bumpp 替换不命中，进了清单也只会被跳过）。
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

  // 发版前工作区必须干净：bumpp 的 release 提交以 all 模式收口，脏工作区里的
  // 无关改动会被一并卷进版本提交。这里直接拒绝并点名，把「干净才发版」从
  // 发布检查清单升级为命令硬约束。
  const status = runGit(['status', '--porcelain'])
  if (status.trim() !== '') {
    throw new Error(
      `工作区不干净，拒绝发版：\n${status.trim()}\n`
      + '请先提交或贮藏以上改动（bumpp 的 release 提交会包含工作区全部改动）。',
    )
  }

  const workspaceYaml = await readFile(join(repositoryRoot, 'pnpm-workspace.yaml'), 'utf8')
  const currentBaseline = readDshBaselineFromCatalog(workspaceYaml)
  if (currentBaseline === undefined) {
    throw new Error("pnpm-workspace.yaml 的 catalog 未声明 '@deepseek-ai/dsh'，无法确定 DSH 基线")
  }

  // 仓库守卫：档位语义、版本形态、baseline 与 major 的绑定。
  assertRepositoryReleasePolicy(release, options.baseline)
  if (options.baseline !== undefined) {
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

  // 同号核对：若有插件与项目不同号，说明版本文件被绕过本命令改过。
  // 此时**报错而不是默默拉平**——静默改写会让「谁在何时改了版本」无从追溯。
  const targets = pluginTargets
  const packages = await Promise.all(targets.map(target => readPackageInfo(target.path)))
  const drifted = packages.filter(pkg => pkg.version !== project.version)
  if (drifted.length > 0) {
    const detail = drifted.map(pkg => `${pkg.name}@${pkg.version}`).join('、')
    throw new Error(
      `插件版本与项目版本不同号，拒绝发布：${detail}。`
      + `项目当前版本 ${project.version}，请先把上述插件统一到该值。`,
    )
  }

  // 先干跑一次 bumpp（files 为空、不写不提交）求目标版本：同步写入与幂等返回
  // 都需要它。版本计算完全归 bumpp，CLI 不自己算。
  const dryRun = await versionBump({
    cwd: repositoryRoot,
    files: [],
    currentVersion: project.version,
    release: options.release,
    commit: false,
    tag: false,
    push: false,
    ignoreScripts: true,
    confirm: false,
  })
  const nextVersion = dryRun.newVersion ?? project.version
  if (!CLEAN_VERSION_PATTERN.test(nextVersion)) {
    throw new Error(
      `目标版本 "${nextVersion}" 含预发布段或后缀。本仓库不使用预发布版本号；`
      + '请使用 patch/minor/major 或完整三段式版本（如 6.0.1）。',
    )
  }
  if (nextVersion === project.version) {
    // 显式传「与当前相同」的版本号（如统一后重复执行 version 6.0.0）：没有文件
    // 变化可提交，空提交会被 git 拒绝。这里明确说明后直接返回，而不是报错——
    // 版本已就位本身就是期望状态。
    outro(`项目 ${project.version} 已是目标版本，无需变更`)
    for (const item of targets) outro(`${item.name}: ${project.version}（同号）`)
    return
  }

  // 确认之后才改 catalog：取消时不留下「catalog 已换基线、版本号没动」的状态，
  // 且 `pnpm run` 的启动前依赖校验看到的仍是变化前的状态。
  if (options.baseline !== undefined) {
    await writeDshBaselineToCatalog(workspaceYaml, options.baseline)
  }
  const targetBaseline = options.baseline ?? currentBaseline

  // 前置同步（全部在 bumpp 写文件之前完成）：
  // - 对齐历史遗留的版本文件到当前版本，让 bumpp 的「当前→新」文本替换命中全部副本；
  // - 插件版本直写目标版本（同号），并同步副本、总览与安装命令；
  // - 基线字样（manifest desc、应用文档页 DSH 基线行）对齐 catalog 目标值。
  await alignProjectVersionPackageFiles(project.version)
  await alignProjectVersionTextFiles(project.version)
  await syncAppDocVersion(project.version)
  await syncAppDocBaseline(targetBaseline)
  await syncManifestBaseline(targetBaseline)
  const localOnly = localOnlyPrefixes(targets)
  const isLocalOnlyPath = (path: string) => localOnly.some(prefix => path.startsWith(prefix))
  const changedPaths = new Set<string>()
  for (const [index, target] of targets.entries()) {
    await updatePackageVersion(target.path, nextVersion)
    const pkg = packages[index]!
    // 只在本机维护的插件照常升版本号，但它的路径不进暂存列表（源码被 git 忽略）。
    if (!target.localOnly) changedPaths.add(target.path)
    if (await syncPublishedPluginVersion(pkg.name, nextVersion)) changedPaths.add(publishedDshPluginsPath)
    if (await syncPluginIndexDocVersion(pkg.name, nextVersion)) changedPaths.add(pluginIndexDocPath)
    const pluginDirectory = target.path.split('/')[1] ?? ''
    for (const path of await syncPluginInstallVersions(pkg.name, pluginDirectory, nextVersion)) {
      if (!isLocalOnlyPath(path)) changedPaths.add(path)
    }
  }

  // 同步改动先暂存：bumpp 的 release 提交以 all 模式收口（git add --all + git
  // commit --all），暂存区内容与 bumpp 自己替换的文件落进同一条提交。工作区
  // 干净守卫已在上游把「卷入无关改动」的风险排除。
  if (!options.noCommit && changedPaths.size > 0) {
    const stagedPaths = [...changedPaths].filter(path => !isLocalOnlyPath(path))
    runGit(['add', '--', ...stagedPaths])
  }

  // 透传 bumpp：版本计算、projectVersionFiles 替换、release 提交与本地 tag 一次
  // 完成。提交消息与 tag 名用 bumpp 默认（`chore: release v{version}` /
  // `v{version}`），与仓库惯例一致；push 恒关（tag 只留本地）。
  const result = await versionBump({
    cwd: repositoryRoot,
    files: projectVersionFiles,
    currentVersion: project.version,
    release: options.release,
    commit: !options.noCommit,
    tag: !options.noCommit && !options.noTag,
    push: false,
    ignoreScripts: true,
    confirm: false,
    all: !options.noCommit,
  })

  outro(`项目 ${result.currentVersion} -> ${nextVersion}`)
  for (const pkg of packages) {
    outro(`${pkg.name}: ${pkg.version} -> ${nextVersion}`)
  }
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
  .description('Bump the project and every plugin in lockstep; release args are passed through to bumpp')
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
