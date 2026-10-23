/**
 * 插件市场索引的重新生成。
 *
 * 索引（`docs/public/plugins/market/index.json`）是**静态快照**：它由上游生成器读取
 * **npm 上已发布版本**的 tarball 产出，不会随本地源码或 `npm publish` 自动变化。
 * 因此每轮发布插件新版本之后都必须重新生成，否则「发现」页显示的是旧版本，而且
 * 没有任何报错——只是安静地落后。
 *
 * 本模块把这一步接到 `publish` 的尾部。为什么不接在 `version`：版本命令只改本地
 * 版本号，npm 上的版本此时还没变；索引跟随的是**已发布版本**，只有发布之后生成才
 * 有意义。
 *
 * 生成器不在本仓库内，位于上游检出。定位顺序与测试规范一致：优先
 * `DSH_DESKTOP_APP_DIR`，否则在本仓库的同级/上两级工作区目录里找
 * `fork-pj/deepseek-harness`。找不到时**降级为警告**而不是抛错——包已经发出去了，
 * 索引是事后可补的动作，中断只会让发布结果看起来失败。
 *
 * @module fnos-dsh-cli/market-index
 */

import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { repositoryRoot } from '../config/paths.js'
import { runCommand } from './process.js'

/** 生成器在上游检出中的相对路径。 */
const GENERATOR_APP = join('apps', 'plugin-market-generator')

/** 生成器包的 filter 名。 */
const GENERATOR_PACKAGE = '@deepseek-ai/dsh-plugin-market-generator'

/** 索引与源列表在本仓库中的相对路径。 */
const INDEX_PATH = join('docs', 'public', 'plugins', 'market', 'index.json')
const SOURCES_PATH = join('docs', 'public', 'plugins', 'market', 'plugins.txt')
const CACHE_PATH = join('tmp', 'plugin-market-cache')

/** 索引的展示元数据；与 `plugins.txt` 顶部注释里记录的口径一致。 */
const TITLE = '飞牛 fnOS DSH 插件'
const DESCRIPTION = '为飞牛 fnOS 维护的 DSH 插件：模型提供方、搜索故障转移、浏览器自动化与系统集成。'

/** 索引里插件图标的外链目录（相对索引文件所在目录）。 */
const ICONS_PATH = join('docs', 'public', 'plugins', 'market', 'icons')

/**
 * 包名 → 本仓库中的插件目录。
 *
 * 约定是 `@tnnevol/dsh-<x>` ↔ `plugins/dsh-<x>-plugin`；目录不存在时返回
 * `undefined`，调用方据此跳过（索引里可能含本仓库之外的来源）。
 *
 * @param packageName - 索引条目里的 `name`。
 * @returns 插件目录的绝对路径。
 */
function pluginDirectoryOf(packageName: string): string | undefined {
  const shortName = packageName.split('/').pop() ?? ''
  if (shortName.length === 0) return undefined
  const directory = join(repositoryRoot, 'plugins', `${shortName}-plugin`)
  return existsSync(directory) ? directory : undefined
}

/**
 * 用本地插件元数据覆盖索引里的中文标题与图标。
 *
 * 生成器读的是 **npm 上已发布版本**的 tarball，因此「改本地标题／换本地图标」要等到
 * 下次发版才会进入索引——在那之前界面会一直显示旧值。这里在生成之后补一步本地归一化：
 * 本地文件永远为准，重新生成也不会把旧值带回来。
 *
 * 只改 `title.zh` 与 `icon`，其余字段（版本、描述、仓库信息）仍然完全由生成器决定，
 * 避免这份归一化悄悄盖掉发布信息。图标按生成器的同一规则落到
 * `icons/<sha256 前 16 位>.<扩展名>`，因此同一份图标重算出的文件名保持稳定。
 *
 * @returns 实际被改写的插件数。
 */
function applyLocalMetadata(): number {
  const indexPath = join(repositoryRoot, INDEX_PATH)
  let index: unknown
  try {
    index = JSON.parse(readFileSync(indexPath, 'utf8'))
  } catch {
    return 0
  }
  if (typeof index !== 'object' || index === null) return 0
  const plugins = (index as { plugins?: unknown }).plugins
  if (!Array.isArray(plugins)) return 0

  let changed = 0
  for (const entry of plugins) {
    if (typeof entry !== 'object' || entry === null) continue
    const plugin = entry as { name?: unknown, title?: unknown, icon?: unknown }
    if (typeof plugin.name !== 'string') continue
    const directory = pluginDirectoryOf(plugin.name)
    if (directory === undefined) continue

    let touched = false

    // 中文标题
    try {
      const locale = JSON.parse(
        readFileSync(join(directory, 'locale', 'zh.json'), 'utf8'),
      ) as { meta?: { title?: unknown } }
      const title = locale.meta?.title
      const current = plugin.title
      if (typeof title === 'string' && title.length > 0
        && typeof current === 'object' && current !== null) {
        const titles = current as { zh?: unknown }
        if (titles.zh !== title) {
          titles.zh = title
          touched = true
        }
      }
    } catch {
      // 没有 locale 就跳过标题，不影响图标。
    }

    // 图标
    try {
      const manifest = JSON.parse(
        readFileSync(join(directory, 'package.json'), 'utf8'),
      ) as { icon?: unknown }
      if (typeof manifest.icon === 'string' && manifest.icon.length > 0) {
        const source = join(directory, manifest.icon)
        const bytes = readFileSync(source)
        const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16)
        const extension = extname(manifest.icon)
        const fileName = `${hash}${extension}`
        const target = join(repositoryRoot, ICONS_PATH, fileName)
        if (!existsSync(target)) {
          mkdirSync(dirname(target), { recursive: true })
          copyFileSync(source, target)
        }
        const reference = `icons/${fileName}`
        if (plugin.icon !== reference) {
          plugin.icon = reference
          touched = true
        }
      }
    } catch {
      // 没有图标就沿用生成器的结果。
    }

    if (touched) changed += 1
  }

  if (changed > 0) writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`)
  return changed
}

/**
 * 上游检出里生成器所在目录的候选路径。
 *
 * 刻意不写死绝对路径（[编码边界](/charter/sdd-workflow#禁止绝对路径)）：检出位置
 * 由环境变量或相对工作区的位置解析。实测两种相对位置都存在过——仓库直接位于工作区
 * 下时是 `../fork-pj/...`，仓库位于分层目录（如 `fn-packages/`）下时是
 * `../../fork-pj/...`——因此两个都试，以「生成器 `package.json` 存在」为准。
 *
 * @returns 候选目录（未做存在性校验）。
 */
function generatorCandidates(): string[] {
  const configured = process.env.DSH_DESKTOP_APP_DIR
  const candidates: string[] = []
  if (configured !== undefined && configured.trim().length > 0) {
    candidates.push(resolve(configured.trim()))
  }
  candidates.push(resolve(repositoryRoot, '..', 'fork-pj', 'deepseek-harness'))
  candidates.push(resolve(repositoryRoot, '..', '..', 'fork-pj', 'deepseek-harness'))
  return candidates
}

/**
 * 解析生成器所在的上游检出根目录。
 *
 * 判定依据是「该目录下存在生成器的 `package.json`」——只检查目录存在会把一个空的
 * `fork-pj` 目录当成可用检出，随后在生成阶段以更难读的错误失败。
 *
 * @returns 检出根目录；都不可用时返回 `undefined`。
 */
export function resolveGeneratorRoot(): string | undefined {
  for (const candidate of generatorCandidates()) {
    if (existsSync(join(candidate, GENERATOR_APP, 'package.json'))) return candidate
  }
  return undefined
}

/**
 * 构造重新生成索引的 pnpm 参数。
 *
 * 抽成纯函数便于单测：这里最容易出错的不是命令本身，而是**路径基准**——input/output
 * 必须指向本仓库，而 cwd 必须在上游检出。
 *
 * @returns `pnpm` 的参数数组。
 */
export function marketIndexArgs(generatorRoot: string = repositoryRoot): string[] {
  return [
    // `--dir` 必须是**生成器所在的检出**：pnpm 只在该目录下按 filter 找项目。
    // 指向本仓库会得到 `No projects matched the filters`——而 pnpm 对这种情形
    // 仍以 0 退出，于是「命令成功、索引没变」会伪装成同步完成。
    // 上游检出用 corepack 固定了自己的 pnpm 版本，与本仓库不一致时 pnpm 会直接拒绝
    // 运行（实测 11.28.5 vs 11.16.0）。生成器只用到 `start` 脚本，与包管理器版本无关，
    // 因此把该检查降级——否则同步这一步在正常环境里永远失败。
    '--pm-on-fail=ignore',
    '--dir', generatorRoot,
    '--filter', GENERATOR_PACKAGE,
    'start',
    '--input', join(repositoryRoot, SOURCES_PATH),
    '--output', join(repositoryRoot, INDEX_PATH),
    '--cache', join(repositoryRoot, CACHE_PATH),
    '--title', TITLE,
    '--description', DESCRIPTION,
  ]
}

/**
 * 读取索引文件的修改时间，读不到时返回 `undefined`。
 *
 * 不直接 `statSync`：索引可能尚不存在（首次生成）或位于只读挂载上，那些都不该
 * 让「同步索引」这一步抛错——它本来就是发布之后的可补动作。
 *
 * @returns 修改时间（毫秒）；不可读时为 `undefined`。
 */
function indexMtime(): number | undefined {
  try {
    return statSync(join(repositoryRoot, INDEX_PATH)).mtimeMs
  } catch {
    return undefined
  }
}

/**
 * 重新生成插件市场索引。
 *
 * 生成器读 npm 上已发布版本的 tarball，因此必须在发布**之后**调用。任何失败都降级
 * 为警告并给出可直接执行的命令：发布已经完成，这里中断只会让调用者误以为发布失败。
 *
 * @param options - 生成选项。
 * @param options.skip - 为真时跳过生成（调用方显式要求时）。
 */
export async function regenerateMarketIndex(options: { skip?: boolean } = {}): Promise<void> {
  if (options.skip === true) {
    console.log('\n已跳过插件市场索引同步（--skip-market-index）')
    return
  }

  const generatorRoot = resolveGeneratorRoot()
  if (generatorRoot === undefined) {
    console.warn('\n插件市场索引**未同步**：找不到上游生成器检出。')
    console.warn('  设置 DSH_DESKTOP_APP_DIR 指向 fork-pj/deepseek-harness 后重跑生成，或手动执行：')
    console.warn(`  pnpm --dir "$DSH_DESKTOP_APP_DIR" --filter ${GENERATOR_PACKAGE} start \\`)
    console.warn(`    --input ${SOURCES_PATH} --output ${INDEX_PATH} --cache ${CACHE_PATH}`)
    console.warn('  未重新生成时，「发现」页显示的是旧版本，且不会报错。')
    return
  }

  console.log(`\n同步插件市场索引（生成器：${generatorRoot}）`)
  const before = indexMtime()
  let retitled = 0
  try {
    await runCommand('pnpm', marketIndexArgs(generatorRoot), repositoryRoot)
  } catch (error) {
    // 生成器失败（例如源列表里有尚未发布的包，npm 回 404）时，索引可能停在一个
    // 由旧版本组成的半成品上；本地元数据归一化仍然要跑——它只依赖本仓库的文件，
    // 与生成器成败无关。因此这里只报错，不中断后续归一化。
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`  索引生成失败：${message.split('\n')[0]}`)
    console.warn('  将仅用本地元数据归一化现有索引；版本字段可能仍是旧值。')
    console.warn('  修好源列表后可重跑：pnpm exec fnos-dsh-cli market:index')
  }

  // 生成器读的是 npm 上已发布版本，本地改过的标题/图标要等下次发版才生效；这里
  // 用本地文件覆盖一遍，避免重新生成时又退回旧值。
  //
  // 必须在「未变化就 return」之前、且不受生成器成败影响地执行：索引没被重写时
  // 恰恰是**最需要**归一化的时候（只改了本地元数据，或生成本身没产出）。
  retitled = applyLocalMetadata()
  if (retitled > 0) console.log(`  已用本地元数据覆盖 ${retitled} 个插件的标题/图标`)

  // **不能只看退出码**：pnpm 在没有任何项目匹配 filter 时也以 0 退出，
  // 那时索引根本没被重写。以「文件是否真被改动」作为成功判据更可靠。
  const after = indexMtime()
  if (after === before && retitled === 0) {
    console.warn('  生成器已运行，但索引文件未变化——请确认生成器可用且索引确需更新。')
    console.warn('  若刚发版，可重跑：pnpm exec fnos-dsh-cli market:index')
    return
  }
  console.log('插件市场索引已同步。记得把 docs/public/plugins/market/index.json 一并提交。')
}

/**
 * 生成器检出的可用性，供诊断输出使用。
 * @returns 检出根目录或 `undefined`。
 */
export function generatorDirectoryForDiagnostics(): string | undefined {
  return resolveGeneratorRoot()
}

/** 便于诊断：本模块认为的索引绝对路径。 */
export function indexPath(): string {
  return join(repositoryRoot, INDEX_PATH)
}

/** 便于诊断：本模块认为的仓库根。 */
export function repositoryRootForDiagnostics(): string {
  return dirname(join(repositoryRoot, INDEX_PATH))
}
