import { intro } from '@clack/prompts'
import { type OptionValues } from 'commander'
import { spawnSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { program } from '../program.js'
import { addBooleanArgs, addNegatedArgs } from '../core/command-args.js'
import { repositoryRoot } from '../config/paths.js'
import { parseVersionOptions } from '../core/args.js'
import { readPackageInfo } from '../core/package.js'

/** 基线形态：`MAJOR.MINOR.PATCH`，可带预发布段（`0.2.1-rc.2`），不允许 build metadata。 */
const BASELINE_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

/** 纯净项目版本形态：`MAJOR.MINOR.PATCH`，不带预发布段与 build metadata。 */
const CLEAN_VERSION_PATTERN = /^\d+\.\d+\.\d+$/u

/**
 * 从 catalog 文本中读出 DSH 运行时基线。
 *
 * 权威来源是 `pnpm-workspace.yaml` 里的 `'@deepseek-ai/dsh'` 条目——它与各插件
 * `peerDependencies` 用的 `catalog:dsh` 是同一份事实。
 */
export function readDshBaselineFromCatalog(workspaceYaml: string): string | undefined {
  const match = /^\s{2}'@deepseek-ai\/dsh':\s*(\S+)\s*$/mu.exec(workspaceYaml)
  const value = match?.[1]
  if (value === undefined) return undefined
  const normalized = value.replace(/^['"]|['"]$/gu, '')
  return BASELINE_PATTERN.test(normalized) ? normalized : undefined
}

/**
 * 校验仓库侧守卫：档位语义与版本形态（FNOS-028）。
 *
 * bumpp 自己接受 `prerelease`/`next` 等档位与任意 semver 串；本仓库只认
 * patch/minor/major 与纯净三段式版本。无位置参数走 bumpp 原生菜单（prompt），
 * 由菜单选定后的目标版本在 bumpp 内再次校验（见 version-sync 与 config）。
 */
function assertRepositoryReleasePolicy(release: string, baseline: string | undefined): void {
  if (release === 'prompt') {
    if (baseline !== undefined) {
      throw new Error('携带 --baseline 时必须显式传 major 档位：pnpm run version -- major --baseline <新基线>')
    }
    return
  }
  const isExplicitVersion = /^v?\d+\.\d+\.\d+$/u.test(release)
  if (!isExplicitVersion && release !== 'patch' && release !== 'minor' && release !== 'major') {
    throw new Error(
      `不支持版本档位 "${release}"。`
      + '本仓库使用纯净 semver：patch（修复）/ minor（新功能且基线不变）/ major（基线变更或重大调整），'
      + '或传完整三段式版本号（如 5.10.1）。',
    )
  }
  if (baseline !== undefined && release !== 'major' && !isExplicitVersion) {
    throw new Error(`基线变更必须走 major 档位（当前档位 "${release}"）：请使用 pnpm run version -- major --baseline <新基线>`)
  }
}

/**
 * 把 catalog 中的 `@deepseek-ai/dsh` 条目改成新基线。
 *
 * 只改这一行；不碰其它 catalog 条目，也不改动任何插件里对 DSH 的依赖声明——
 * 依赖升级由 `pnpm install` 单独完成，与本命令职责分离。
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

/**
 * 版本维护的入口：**直接调用 bumpp CLI**（与 release:notes 透传 changelogithub
 * 同一模式），仓库约定由根 `bump.config.ts` 承载（files、execute 同步钩子、
 * tag/push）， bumpp 的原生交互（release 菜单、commits 摘要、Bump? 确认）
 * 通过 inherit stdio 完整保留。
 *
 * 转发层只做 bumpp 不知道的三件事：
 * 1. **仓库守卫**：档位语义、`--baseline` 仅与 major 搭配、插件同号核对、
 *    工作区干净（bumpp 提交用 all 模式，脏改动会被卷进 release 提交）；
 * 2. **参数翻译**：`--yes/--no-commit/--no-tag` → bumpp 对应参数；`--baseline`
 *    在确认后改写 catalog（ bumpp 启动前完成，依赖校验看到的是旧状态）；
 * 3. **spawn bumpp**：位置参数（档位/版本串）原样透传。
 */
export async function runVersion(args: string[]): Promise<void> {
  intro('fn-os-apps 版本维护（bumpp）')
  // 历史参数 `project` / `plugin` 仍被接受，但不再分叉成两套流程。
  const filtered = args.filter((arg, index) => {
    if (arg.startsWith('-')) return true
    const positionalIndex = args.slice(0, index).filter(a => !a.startsWith('-')).length
    return !(positionalIndex === 0 && (arg === 'project' || arg === 'plugin'))
  })
  const options = parseVersionOptions(filtered)
  const release = String(options.release)

  // 发版前工作区必须干净：bumpp 的 release 提交以 all 模式收口。
  const status = spawnSync('git', ['status', '--porcelain'], { cwd: repositoryRoot, encoding: 'utf8' })
  if (status.status !== 0) throw new Error('git status failed')
  if (status.stdout.trim() !== '') {
    throw new Error(
      `工作区不干净，拒绝发版：\n${status.stdout.trim()}\n`
      + '请先提交或贮藏以上改动（bumpp 的 release 提交会包含工作区全部改动）。',
    )
  }

  const workspaceYaml = await readFile(join(repositoryRoot, 'pnpm-workspace.yaml'), 'utf8')
  const currentBaseline = readDshBaselineFromCatalog(workspaceYaml)
  if (currentBaseline === undefined) {
    throw new Error("pnpm-workspace.yaml 的 catalog 未声明 '@deepseek-ai/dsh'，无法确定 DSH 基线")
  }

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
  if (!CLEAN_VERSION_PATTERN.test(project.version.replace(/^v/u, ''))) {
    throw new Error(
      `当前项目版本 "${project.version}" 不是纯净三段式（MAJOR.MINOR.PATCH）。`
      + 'FNOS-028 起项目版本为纯净 semver（如 5.10.0）；若仍为旧小尾巴形态（如 5.9.0-0.2.1-rc.2.52），'
      + '请先按 FNOS-028 完成版本统一。',
    )
  }

  // `--baseline <新基线>`：确认后、bumpp 启动前改写 catalog。此时新版本尚未
  // `pnpm install`——之所以敢在 spawn 前改，是因为 `pnpm run` 的启动前依赖校验
  // 发生在本进程启动之前（看到的还是旧 catalog），而 bumpp 与 version-sync
  // 由本进程直接 spawn，不再经过 pnpm 的校验。
  if (options.baseline !== undefined) {
    await writeDshBaselineToCatalog(workspaceYaml, options.baseline)
  }

  // 参数翻译 + 原样透传：位置参数（prompt/patch/minor/major/版本串）直接交给
  // bumpp；`--yes` → `-y`（跳过 Bump? 确认，非交互场景必须携带）；提交开关 →
  // bumpp 对应 flag。stdio inherit：原生菜单/摘要/确认完整呈现给调用者。
  //
  // bumpp 是本 CLI（tooling/fnos-dsh-cli）的依赖而非根 devDependency，从其
  // node_modules/.bin 直接解析 bin；cwd 保持仓库根——bumpp 由此发现根目录的
  // bump.config.ts。
  const bumppArgs: string[] = [release]
  if (!options.confirm) bumppArgs.push('-y')
  if (options.noCommit) bumppArgs.push('--no-commit')
  if (options.noTag) bumppArgs.push('--no-tag')

  const bumppBin = join(repositoryRoot, 'tooling/fnos-dsh-cli/node_modules/.bin/bumpp')
  const result = spawnSync('node', [bumppBin, ...bumppArgs], {
    cwd: repositoryRoot,
    stdio: 'inherit',
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`bumpp 退出码 ${result.status ?? 'unknown'}；版本发布未完成`)
  }
}

program
  .command('version [args...]')
  .description('Bump the project and every plugin by invoking bumpp (native prompts); repo rules live in bump.config.ts')
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
    const baseline = typeof options.baseline === 'string' ? options.baseline : undefined
    await runVersion(baseline === undefined ? args : [...args, '--baseline', baseline])
  })
