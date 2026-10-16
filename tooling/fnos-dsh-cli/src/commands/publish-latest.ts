import { runCommand } from '../core/process.js'

/**
 * npm `latest` dist-tag 维护（FNOS-012-04）。
 *
 * 发布链路只发 `next`（`publish:next` 固定 `--tag next`），npm 的 `latest` 只在
 * 无 tag 发布时才移动——因此自有插件的 `latest` 长期停在历史早期版本，
 * `npm i <pkg>` 默认装到旧版。本模块在每次发布成功后自动校正 `latest`：
 *
 * - **默认目标 = 发布前的 `next`**（即本次发布顶替掉的那个版本），`rc` 作为次选；
 *   两者都取不到时才回落到「上一代最新稳定版」的代际规则。
 * - **必须在发布前捕获**：`npm publish --tag next` 一旦成功，`next` 就已经指向新版本，
 *   事后读到的不是「发布前的 next」。
 *
 * 为什么以 `next` 为准：本仓库的 `next` 就是**当前推荐安装版本**，`latest` 跟着它走，
 * `npm i <pkg>` 才会装到我们真正想让用户用的那版。历史早期稳定版（如 `0.1.7-rc.2.2`）
 * 与新代际差异过大，把它留在 `latest` 会把用户带到旧世界上。
 */

/** 读取一个包的某个 dist-tag 指向的版本；不存在或读取失败时返回 undefined。 */
export async function npmDistTag(packageName: string, tag: string): Promise<string | undefined> {
  try {
    // `runCommand` 继承 stdio（不回传输出），这里要读值，因此直接用 execFile。
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const { stdout } = await promisify(execFile)('npm', ['view', packageName, `dist-tags.${tag}`, '--json'])
    const value: unknown = JSON.parse(stdout.trim() === '' ? 'null' : stdout)
    return typeof value === 'string' && value !== '' ? value : undefined
  } catch {
    return undefined
  }
}

/** 读取一个包的全部已知版本（npm view，失败即空——离线/权限缺失时跳过维护）。 */
export async function npmVersions(packageName: string): Promise<string[]> {
  try {
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const { stdout } = await promisify(execFile)('npm', ['view', packageName, 'versions', '--json'])
    const parsed: unknown = JSON.parse(stdout)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

/**
 * 取一个版本字符串的代际前缀：去掉最后一个修订段。
 *
 * 版本形态固定为 `<上游版本>.<修订>`，而上游版本自身带预发布号
 * （`0.2.0-rc.2`）。两者都以数字段结尾，单看最后一段无法区分，因此按**预发布
 * 连字符之后的点段数**判定：上游形态在连字符后恰有一个点段（`rc.2`）；带修订
 * 的形态有两个（`rc.2.0`）。无连字符的纯稳定号按「点段数 ≥ 4 视为带修订」
 * 处理（`1.0.0.0` = 上游 `1.0.0` + 修订 `0`）。
 *
 * `0.2.0-rc.2.0` → `0.2.0-rc.2`；裸上游号（`0.2.0-rc.2`、`0.1.0-rc.7`）与不完整
 * 形态返回 undefined。
 */
export function generationOf(version: string): string | undefined {
  const hyphen = version.indexOf('-')
  const after = hyphen === -1 ? version : version.slice(hyphen + 1)
  const segments = after.split('.')
  const hasRevision = hyphen === -1
    ? segments.length >= 4
    : segments.length >= 3
  if (!hasRevision) return undefined
  const cut = version.lastIndexOf('.')
  return cut <= 0 ? undefined : version.slice(0, cut)
}

/** 预发布代际的修订序：`0.2.0-rc.2.3` → 3（最后一段；解析失败为 -1）。 */
export function revisionOf(version: string): number {
  const cut = version.lastIndexOf('.')
  const tail = cut <= 0 ? '' : version.slice(cut + 1)
  const parsed = Number.parseInt(tail, 10)
  return Number.isFinite(parsed) ? parsed : -1
}

/**
 * 从全部已知版本中解析「上一代最新稳定版」。
 *
 * 规则：取代际与目标不同的版本里，代际序最大的那一代中的最大修订号。代际序
 * 按上游版本字符串比较（`0.2.0-rc.2` > `0.1.7-rc.2`），足以覆盖既有的
 * `<上游>.<修订>` 版本序列；出现新形态时先补规则再发布。
 * @param versions - npm 上的全部已知版本。
 * @param currentGeneration - 刚发布的版本的代际。
 * @returns 上一代最新版本；没有上一代时为 undefined。
 */
export function previousGenerationStable(versions: readonly string[], currentGeneration: string): string | undefined {
  const byGeneration = new Map<string, string[]>()
  for (const version of versions) {
    const generation = generationOf(version)
    if (generation === undefined) continue
    const bucket = byGeneration.get(generation) ?? []
    bucket.push(version)
    byGeneration.set(generation, bucket)
  }
  const generations = [...byGeneration.keys()].filter(candidate => candidate !== currentGeneration)
  if (generations.length === 0) return undefined
  // 代际序：按点分段逐段数值比较（0.2.0-rc.2 vs 0.1.7-rc.2 逐段即得）。
  const generationKey = (generation: string): number[] =>
    generation.split('.').map(part => Number.parseInt(part, 10))
  const newerFirst = generations.sort((left, right) => {
    const a = generationKey(left)
    const b = generationKey(right)
    for (let at = 0; at < Math.max(a.length, b.length); at += 1) {
      const diff = (b[at] ?? 0) - (a[at] ?? 0)
      if (diff !== 0) return diff
    }
    return 0
  })
  const previous = newerFirst[0]
  if (previous === undefined) return undefined
  const bucket = byGeneration.get(previous) ?? []
  // 最大修订号；若该代没有带修订段的版本（全部裸上游号），取字典序最大。
  return bucket.slice().sort((left, right) =>
    revisionOf(right) - revisionOf(left) || right.localeCompare(left))[0]
}

/**
 * 发布成功后维护 `latest`（或在不需要时说明原因）。
 * @param packageName - 已发布的 npm 包名。
 * @param publishedVersion - 刚发布的版本号。
 */
export async function maintainLatestTag(
  packageName: string,
  publishedVersion: string,
  previous?: { readonly next?: string | undefined, readonly rc?: string | undefined },
): Promise<void> {
  // 首选：发布前的 `next`（本次发布顶替掉的那版）——`next` 是本仓库的推荐安装版本。
  const target = previous?.next ?? previous?.rc
  if (target !== undefined) {
    const source = previous?.next === undefined ? 'rc' : 'next'
    await runCommand('npm', ['dist-tag', 'add', `${packageName}@${target}`, 'latest'], process.cwd())
    console.log(`  latest: ${target} (发布前的 ${source})`)
    return
  }

  // 兜底：拿不到发布前的 next/rc 时，仍按代际规则指向上一代最新稳定版。
  const generation = generationOf(publishedVersion)
  if (generation === undefined) {
    console.log(`  latest: skip — ${publishedVersion} does not carry a revision segment`)
    return
  }
  const versions = await npmVersions(packageName)
  if (versions.length === 0) {
    console.log('  latest: skip — npm view unavailable (offline or unauthorized); run `npm dist-tag add` manually if needed')
    return
  }
  const fallback = previousGenerationStable(versions, generation)
  if (fallback === undefined) {
    console.log(`  latest: skip — no previous generation of ${packageName} exists yet`)
    return
  }
  await runCommand('npm', ['dist-tag', 'add', `${packageName}@${fallback}`, 'latest'], process.cwd())
  console.log(`  latest: ${fallback} (previous-generation stable, generation rule)`)
}
