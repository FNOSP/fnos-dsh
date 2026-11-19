import { intro } from '@clack/prompts'
import { type OptionValues } from 'commander'
import { spawnSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { program } from '../program.js'
import { addBooleanArgs, addNegatedArgs } from '../core/command-args.js'
import { repositoryRoot } from '../config/paths.js'
import { parseVersionOptions } from '../core/args.js'
import { BASELINE_PATTERN, readDshBaselineFromCatalog } from '../core/dsh-baseline.js'
import { readPackageInfo } from '../core/package.js'

export { readDshBaselineFromCatalog }


/** 纯净项目版本形态：`MAJOR.MINOR.PATCH`，不带预发布段与 build metadata。 */
const CLEAN_VERSION_PATTERN = /^\d+\.\d+\.\d+$/u

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
 * 把 `pnpm-workspace.yaml` 里**三处**承载 DSH 基线的段落改到新基线。
 *
 * ## 为什么必须三处一起改
 *
 * `readDshBaselineFromCatalog()` 只读默认 catalog 那一行，它是「当前基线」的唯一
 * 事实来源；但**能决定装到哪个版本**的地方有三处：
 *
 * | 段落 | 作用 | 漏改的后果 |
 * | --- | --- | --- |
 * | 默认 catalog 的 `'@deepseek-ai/dsh'` | 声明基线 | —— |
 * | 命名 catalog `catalogs.dsh` | 插件用 `catalog:dsh` 引用它 | 顶层已是新基线，插件依赖仍按旧版解析 |
 * | `minimumReleaseAgeExclude` | 放行新发布的预发布版本 | 新版本被发布龄期策略拦下，安装直接失败 |
 *
 * 早前这里只改默认 catalog 那一行（注释还写着「只改这一行」）。实测踩到：升级
 * rc.4→rc.5 时 388 处里只改了 1 处，剩下 387 处停在 rc.4，插件的 `catalog:dsh`
 * 引用与豁免清单全部错位。
 *
 * ## 只改 DSH 系列条目
 *
 * 三段里混着大量与 DSH 无关的条目（其它 catalog 依赖、其它包的豁免）。改写范围
 * 严格限定在 `@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-*`：后者覆盖命名 catalog
 * 与豁免清单里的六十多个子包。
 *
 * @param workspaceYaml - 原始文件内容。
 * @param baseline - 新基线，如 `0.2.2-rc.5`。
 * @returns 改写后的内容，以及三处各自的改写次数，供调用方报告与断言。
 */
export function writeDshBaselineEverywhere(
  workspaceYaml: string,
  baseline: string,
): { readonly text: string; readonly counts: Readonly<Record<'catalog' | 'named' | 'exclude', number>> } {
  // 段边界：`catalogs:` 与 `minimumReleaseAgeExclude:` 都从行首零缩进开始。
  /*
    `allowBuilds` 段整段摘出来，不参与任何替换。

    那段写的是「允不允许跑安装脚本」，值是 `true` / `false`，不是版本号。它里面
    也有 `'@deepseek-ai/dsh-*'` 条目（如 `dsh-subprocess-local`），按 DSH 前缀扫
    会命中并把 `false` 改写成版本号——等于把一条「禁止构建」的声明静默变成「允许
    构建」：改完不报错，只有安全语义悄悄变了。实测踩到过这一条。

    取段方式：从 `allowBuilds:` 行首开始，到下一个行首零缩进的键为止。
  */
  const allowBuildsMatch = /^allowBuilds:[\s\S]*?(?=^\S|(?![\s\S]))/mu.exec(workspaceYaml)
  const withoutAllowBuilds = allowBuildsMatch === null
    ? workspaceYaml
    : workspaceYaml.slice(0, allowBuildsMatch.index)
      + workspaceYaml.slice(allowBuildsMatch.index + allowBuildsMatch[0].length)

  // 段边界在新文本上重新定位：`catalogs:` 与 `minimumReleaseAgeExclude:` 都从行首零缩进开始。
  const catalogsAt2 = withoutAllowBuilds.search(/^catalogs:\s*$/mu)
  const excludeAt2 = withoutAllowBuilds.search(/^minimumReleaseAgeExclude:\s*$/mu)

  const head = catalogsAt2 === -1 ? withoutAllowBuilds : withoutAllowBuilds.slice(0, catalogsAt2)
  const named = catalogsAt2 === -1
    ? ''
    : withoutAllowBuilds.slice(catalogsAt2, excludeAt2 === -1 ? undefined : excludeAt2)
  const tail = excludeAt2 === -1 ? '' : withoutAllowBuilds.slice(excludeAt2)

  const countOf = (text: string, pattern: RegExp): number => (text.match(pattern) ?? []).length

  // 默认 catalog 那一行：`  '@deepseek-ai/dsh': <版本>`
  const catalogPattern = /^(\s{2}'@deepseek-ai\/dsh':\s*)\S+(\s*)$/gmu
  const catalogCount = countOf(head, catalogPattern)
  const nextHead = head.replace(catalogPattern, `$1${baseline}$2`)

  // 命名 catalog 与豁免清单里的 DSH 系列条目：`'@deepseek-ai/dsh...': <版本>`
  // 与 `- '@deepseek-ai/dsh...@<版本>'` 两种形态。
  const namedPattern = /('@deepseek-ai\/dsh(?:-[^']+)?':\s*)\S+/gu
  const excludePattern = /(- '@deepseek-ai\/dsh(?:-[^']+)?@)\S+('\s*)$/gmu
  const namedCount = countOf(named, namedPattern)
  const excludeCount = countOf(tail, excludePattern)

  if (catalogCount !== 1) {
    throw new Error(
      `默认 catalog 必须恰好有一处 '@deepseek-ai/dsh' 条目，实际 ${catalogCount} 处；请检查 pnpm-workspace.yaml`,
    )
  }

  // 把摘出去的 allowBuilds 段按原位置插回：切分点相对 `withoutAllowBuilds`，
  // 而它比原文少了该段，因此插入位置取 `allowBuildsMatch.index`。
  const replaced = nextHead
    + named.replace(namedPattern, `$1${baseline}`)
    + tail.replace(excludePattern, `$1${baseline}$2`)
  const text = allowBuildsMatch === null
    ? replaced
    : replaced.slice(0, allowBuildsMatch.index)
      + allowBuildsMatch[0]
      + replaced.slice(allowBuildsMatch.index)

  return {
    text,
    counts: { catalog: catalogCount, named: namedCount, exclude: excludeCount },
  }
}

/**
 * 改写 `pnpm-workspace.yaml` 的三处基线承载，并在改写量异常时拒绝落盘。
 *
 * 「异常」指某一段一处都没改到：段落改名、被删掉、或条目形态变了，都会让该段
 * 静默留旧值。三处必须同时成立才算成功——这正是 FNOS-057 修的缺陷。
 */
async function writeDshBaselineToCatalog(
  workspaceYaml: string,
  baseline: string,
): Promise<Readonly<Record<'catalog' | 'named' | 'exclude', number>>> {
  const { text, counts } = writeDshBaselineEverywhere(workspaceYaml, baseline)
  for (const [section, count] of Object.entries(counts)) {
    if (count === 0) {
      throw new Error(
        `pnpm-workspace.yaml 的 ${section} 段没有可改写的 DSH 条目；三处承载处必须同时改写，请检查该段格式`,
      )
    }
  }
  await writeFile(join(repositoryRoot, 'pnpm-workspace.yaml'), text)
  return counts
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
    const counts = await writeDshBaselineToCatalog(workspaceYaml, options.baseline)
    // 三处承载处都改到才算成功；把计数打出来，便于确认改写量符合预期。
    console.log(
      `基线改写 → ${options.baseline}：默认 catalog ${counts.catalog} 处、`
      + `命名 catalog ${counts.named} 处、豁免清单 ${counts.exclude} 处`,
    )
  }

  // 参数翻译 + 原样透传：位置参数（prompt/patch/minor/major/版本串）直接交给
  // bumpp；`--yes` → `-y`（跳过 Bump? 确认，非交互场景必须携带）；提交开关 →
  // bumpp 对应 flag。stdio inherit：原生菜单/摘要/确认完整呈现给调用者。
  //
  // bumpp 是本 CLI（tooling/fnos-dsh-cli）的依赖而非根 devDependency；其 bin
  // 由 package.json 的 `bin` 字段指向 mjs 入口（.bin 里是 shell 包装脚本，不能
  // 用 node 直接执行）。cwd 保持仓库根——bumpp 由此发现根目录的 bump.config.ts。
  const bumppArgs: string[] = [release]
  if (!options.confirm) bumppArgs.push('-y')
  if (options.noCommit) bumppArgs.push('--no-commit')
  if (options.noTag) bumppArgs.push('--no-tag')

  const bumppBin = join(repositoryRoot, 'tooling/fnos-dsh-cli/node_modules/bumpp/bin/bumpp.mjs')
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
