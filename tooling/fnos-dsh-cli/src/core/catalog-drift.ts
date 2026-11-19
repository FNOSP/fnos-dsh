/**
 * 提交前守卫：`plugins/*\/package.json` 的 DSH 依赖必须是 `catalog:dsh`。
 *
 * ## 为什么需要一条独立的快速检查
 *
 * `pnpm install` 会把 workspace 的 `catalog:dsh` 引用**解析成字面版本号并写回
 * `package.json`**。这个副作用不会报错、不进 git 提示，只要 `git add -A` 就会
 * 把污染提交进去。实测连续踩到三次：
 *
 * 1. 基线升级 rc.4 → rc.5 时，96 处 `catalog:dsh` 变成 `0.2.2-rc.5`；
 * 2. 只修了 `dependencies`，漏掉 `peerDependencies` 的另外 96 处；
 * 3. FPK 构建因此失败：构建校验要求「必须通过 catalog 引用」。
 *
 * 仓库里本来有覆盖同一事实的断言（`tests/fnos-007-baseline.spec.ts`），但它属于
 * `check --tooling`，只在 pre-push 阶段跑——那时污染已经进了提交历史，且报错
 * 信息是「版本不匹配」而不是「你被 pnpm 写脏了」。
 *
 * 因此这里做一次**极小范围、极快**的检查：只读七个插件清单，只在 pre-commit
 * 跑。它与 `check --tooling` 的断言刻意重复——一个拦在源头，一个兜在最外层。
 *
 * ## 判定
 *
 * 四个依赖段（dependencies / devDependencies / peerDependencies /
 * optionalDependencies）里，`@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-*` 的 range
 * 必须是 `catalog:dsh` 或 `catalog:<命名 catalog>`。
 *
 * `engines.dsh` 不在此列：它按设计写具体基线版本（如 `0.2.2-rc.5`），用来做
 * 兼容判定，与依赖引用是两件事。
 */

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** 依赖里指向 DSH 运行时的那一段前缀。 */
const DSH_PACKAGE_PREFIX = '@deepseek-ai/dsh'

/** 承载依赖的四个字段。 */
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const

/** 一处违规：哪个文件、哪个字段、哪个包写成了什么。 */
export interface CatalogDrift {
  readonly file: string
  readonly field: string
  readonly name: string
  readonly range: string
}

/** 合法的 catalog 引用：`catalog:dsh` 或 `catalog:<名称>`。 */
function isCatalogRange(range: string): boolean {
  return /^catalog:[a-z0-9-]+$/u.test(range)
}

/**
 * 扫描一个插件的清单，返回其中写死的 DSH 依赖。
 *
 * @param directory - 插件目录名。
 * @param manifestText - 该插件 `package.json` 的文本。
 * @returns 违规项；空数组表示干净。
 */
export function findCatalogDrift(directory: string, manifestText: string): CatalogDrift[] {
  const manifest = JSON.parse(manifestText) as Record<string, unknown>
  const drifts: CatalogDrift[] = []
  for (const field of DEPENDENCY_FIELDS) {
    const section = manifest[field]
    if (section === null || typeof section !== 'object') continue
    for (const [name, range] of Object.entries(section as Record<string, unknown>)) {
      if (!name.startsWith(DSH_PACKAGE_PREFIX)) continue
      if (typeof range !== 'string' || isCatalogRange(range)) continue
      drifts.push({ file: `plugins/${directory}/package.json`, field, name, range })
    }
  }
  return drifts
}

/**
 * 检查仓库里每个插件的 DSH 依赖是否都走 catalog。
 *
 * @param repositoryRoot - 仓库根目录。
 * @returns 全部违规项，已按文件与字段排序，便于稳定输出。
 * @throws 当 `plugins/` 下读不到任何 `package.json` 时——那说明路径算错了，
 *         静默通过比报错更危险。
 */
export async function scanPluginsForCatalogDrift(repositoryRoot: string): Promise<CatalogDrift[]> {
  const pluginsDirectory = join(repositoryRoot, 'plugins')
  const directories = (await readdir(pluginsDirectory, { withFileTypes: true }))
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)

  const drifts: CatalogDrift[] = []
  let inspected = 0
  for (const directory of directories) {
    let text: string
    try {
      text = await readFile(join(pluginsDirectory, directory, 'package.json'), 'utf8')
    } catch {
      continue // 不是插件目录（没有 package.json），跳过。
    }
    inspected += 1
    drifts.push(...findCatalogDrift(directory, text))
  }

  if (inspected === 0) {
    throw new Error('在 plugins/ 下没有找到任何 package.json；路径可能算错了，拒绝静默通过')
  }

  return drifts.sort((left, right) =>
    left.file.localeCompare(right.file)
    || left.field.localeCompare(right.field)
    || left.name.localeCompare(right.name))
}

/** 违规项的提示文案：说清原因与修法，而不是只报「不匹配」。 */
export function formatCatalogDrift(drifts: readonly CatalogDrift[]): string {
  const lines = drifts.map(drift =>
    `  - ${drift.file} 的 ${drift.field}.${drift.name} 写成了 "${drift.range}"`)
  return [
    '插件清单里的 DSH 依赖必须通过 catalog 引用，不能写死版本号。',
    '',
    ...lines,
    '',
    '这是 `pnpm install` 的副作用：它会把 catalog:dsh 解析成字面版本并写回 package.json。',
    '修复方式（只改这几个文件，不要带上别的改动）：',
    '',
    '  git checkout -- plugins/*/package.json',
    '  # 然后按需重新补上 engines.dsh，再提交',
  ].join('\n')
}
