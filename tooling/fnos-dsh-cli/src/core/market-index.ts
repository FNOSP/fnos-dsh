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

import { existsSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
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
  try {
    await runCommand('pnpm', marketIndexArgs(generatorRoot), repositoryRoot)
    // **不能只看退出码**：pnpm 在没有任何项目匹配 filter 时也以 0 退出，
    // 那时索引根本没被重写。以「文件是否真被改动」作为成功判据更可靠。
    const after = indexMtime()
    if (after === before) {
      console.warn('  生成器已运行，但索引文件未变化——请确认生成器可用且索引确需更新。')
      console.warn('  若刚发版，可重跑：pnpm exec fnos-dsh-cli market:index')
      return
    }
    console.log('插件市场索引已同步。记得把 docs/public/plugins/market/index.json 一并提交。')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`  索引同步失败（不影响本次发布）：${message.split('\n')[0]}`)
    console.warn('  可稍后重跑：pnpm run publish -- --skip-market-index 后再单独执行生成器。')
    console.warn('  未重新生成时，「发现」页显示的是旧版本，且不会报错。')
  }
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
