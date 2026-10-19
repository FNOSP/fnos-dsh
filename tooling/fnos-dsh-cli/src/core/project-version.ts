/**
 * 项目/FPK 版本号方案：`<基础段>-<DSH 基线>.<应用迭代号>`。
 *
 * 例：`5.9.0-0.2.1-rc.2.5`
 * - `5.9.0`：基础段，由版本号自身承载，**发布时原样继承、不主动改写**；
 * - `0.2.1-rc.2`：跟随 DSH 运行时基线（取自 `pnpm-workspace.yaml` 的 catalog）；
 * - `5`：本应用自身的迭代号，每次发布只递增这一段。
 *
 * 基础段**不写成代码常量**：它属于版本号自身的事实，代码只负责校验形态
 * （`MAJOR.MINOR.PATCH`）并在发布时原样沿用。这样调整基础段只需改版本文件，
 * 不必改代码；也避免代码里的常量与实际版本号悄悄不一致。
 *
 * 为什么不用 bumpp 的语义化档位：`patch`/`minor`/`major` 会改动前三段，而本方案要求
 * 前三段**永不移动**；递增点只有末尾那一段。因此项目版本的递增走本模块，插件版本仍
 * 走原有语义化流程。
 *
 * 与 semver 的关系：整串是合法的 semver **预发布版本**（`-` 之后为 prerelease），
 * 因此按 semver 判序时它小于同号的正式版——这是预期的：本方案不发布无小尾巴的正式版，
 * 比较只发生在两个预发布版本之间，而此时末尾迭代号能正确分出先后。
 */

/** 版本号中承载 DSH 运行时基线的那一段。 */
export type ProjectVersionParts = {
  /** 基础段，如 `5.9.0`；发布时原样继承。 */
  readonly base: string
  /** DSH 运行时基线，如 `0.2.1-rc.2`。 */
  readonly baseline: string
  /** 应用迭代号，从 0 开始每次发布 +1。 */
  readonly iteration: number
}

/** 基础段形态：必须是三段数字。 */
const BASE_PATTERN = /^\d+\.\d+\.\d+$/
// 基线本身允许带预发布段（`0.2.1-rc.2`），但不允许再带 build metadata。
const BASELINE_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
/** 迭代号形态：纯数字。 */
const ITERATION_PATTERN = /^\d+$/

/**
 * 解析项目版本串。
 *
 * 接受 `5.9.0-0.2.1-rc.2.5` 这种形态。基线自带预发布段（`rc.2`），所以尾部不能简单地
 * 按 `-` 切一刀：基线边界由正则的惰性匹配结合「末尾必须是 `.数字`」确定。
 *
 * **注意一处固有歧义**：`5.9.0-0.2.1-rc.2` 既可读作「基线 `0.2.1-rc.2`、无迭代号」，
 * 也可读作「基线 `0.2.1-rc`、迭代号 `2`」——两种解释产生完全相同的字符串，仅凭字符串
 * 无法区分。因此当调用方知道当前基线时（见 `nextProjectVersion`），必须用基线来消歧：
 * 若尾部恰好等于该基线，则视为**缺迭代号**。
 *
 * @param version 待解析的版本串。
 * @param knownBaseline 已知的 DSH 基线；提供时用于消除尾部歧义。
 * @returns 拆解结果；格式不符时返回 `undefined`，由调用方决定报错或回落。
 */
export function parseProjectVersion(version: string, knownBaseline?: string): ProjectVersionParts | undefined {
  const trimmed = version.trim().replace(/^v/u, '')

  // 通用形态：`<基础>-<尾部>`，尾部再由两种方式切出基线与迭代号。
  const head = /^(\d+\.\d+\.\d+)-(.+)$/u.exec(trimmed)
  if (head === null) return undefined
  const [, base, tail] = head as unknown as [string, string, string]

  if (knownBaseline !== undefined && BASELINE_PATTERN.test(knownBaseline)) {
    // 用已知基线拼出完整形态再整体匹配，比手工切分更不容易漏判：
    // 尾部要么是整段基线（缺迭代号），要么是 `<基线>.<数字>`。
    const escaped = knownBaseline.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
    const match = new RegExp(`^${escaped}(?:\\.(\\d+))?$`, 'u').exec(tail)
    if (match !== null) {
      return {
        base,
        baseline: knownBaseline,
        iteration: match[1] === undefined ? 0 : Number(match[1]),
      }
    }
    // 基线不匹配说明串里记的是**另一条基线**（如 DSH 刚从 0.2.1-rc.2 升到 0.2.2-rc.1，
    // 而当前版本还是旧基线的）。此时不能判定为非法，否则基线升级的那次发布会解析不了
    // 当前版本、迭代号被迫归零——正是本方案要避免的。落到下面的通用解析。
  }

  // 未知基线（或串内基线与已知基线不同）时按「末尾一段数字是迭代号」匹配。
  const match = /^(.+)\.(\d+)$/u.exec(tail)
  if (match === null) return undefined
  const [, baseline, iterationText] = match as unknown as [string, string, string]
  if (!BASELINE_PATTERN.test(baseline)) return undefined
  if (!ITERATION_PATTERN.test(iterationText)) return undefined
  return { base, baseline, iteration: Number(iterationText) }
}

/**
 * 组装项目版本串。
 *
 * @param parts 拆解后的各部分。
 * @returns `<base>-<baseline>.<iteration>`。
 */
export function formatProjectVersion(parts: ProjectVersionParts): string {
  return `${parts.base}-${parts.baseline}.${parts.iteration}`
}

/**
 * 由项目版本推导对应的插件版本。
 *
 * 插件版本就是项目版本**去掉基础段**：`5.9.0-0.2.1-rc.2.5` → `0.2.1-rc.2.5`。
 * 这样两者永远共用同一个基线与迭代号，不存在各自递增而错位的可能。
 *
 * @param parts 项目版本的拆解结果。
 * @returns 插件版本串（`<基线>.<迭代号>`）。
 */
export function pluginVersionOf(parts: ProjectVersionParts): string {
  return `${parts.baseline}.${parts.iteration}`
}

/**
 * 计算下一次发布的项目版本。
 *
 * 规则：
 * 1. **基础段原样继承当前版本**（不推进、也不写死）；
 * 2. **基线跟随 DSH 运行时基线**；基线一旦变化，迭代号**重置为 0**；
 * 3. 基线未变时，迭代号在当前值上 +1。
 *
 * 举例：
 * ```text
 * 5.9.0-0.2.1-rc.2.5 → 5.9.0-0.2.1-rc.5.0   DSH 基线 0.2.1-rc.2 → 0.2.1-rc.5，重置
 * 5.9.0-0.2.1-rc.5.0 → 5.9.0-0.2.1-rc.5.1   同基线内修 bug，+1
 * 5.9.0-0.2.1-rc.5.1 → 5.9.0-0.2.2-rc.1.0   DSH 基线 → 0.2.2-rc.1，重置
 * ```
 *
 * 为什么重置是安全的：迭代号只在**同一基线内**才有比较意义。基线变了，版本号的
 * 排序由基线本身决定——`…-0.2.1-rc.5.0` 必然大于 `…-0.2.1-rc.2.5`、`…-0.2.2-rc.1.0`
 * 必然大于 `…-0.2.1-rc.x.y`，所以从 0 重新开始不会造成排序倒退。
 * 反过来说，**同一基线内**若把迭代号改小才会被判降级，因此那种情况必须继续 +1。
 *
 * @param current 当前版本串。
 * @param baseline 当前 DSH 运行时基线。
 * @param fallbackBase 当前版本无法解析时采用的基础段；缺省时要求版本可解析。
 * @returns 下一个版本串。
 * @throws 基线非法、或当前版本无法解析且未给 `fallbackBase` 时抛出。
 */
export function nextProjectVersion(
  current: string | undefined,
  baseline: string,
  fallbackBase?: string,
): string {
  if (!BASELINE_PATTERN.test(baseline)) {
    throw new Error(`Invalid DSH baseline for project version: ${baseline}`)
  }
  // 传 baseline 消歧：否则 `5.9.0-0.2.1-rc.2` 会被误读成「基线 0.2.1-rc、迭代号 2」，
  // 于是下一次发布算出 .3 而不是 .1，凭空跳号。
  const parsed = current === undefined ? undefined : parseProjectVersion(current, baseline)
  const base = parsed?.base ?? fallbackBase
  if (base === undefined || !BASE_PATTERN.test(base)) {
    throw new Error(
      `无法确定项目版本的基础段：当前版本 "${current ?? '(空)'}" 不符合 <基础>-<DSH 基线>.<迭代号> 形态，且未提供可用的基础段`,
    )
  }
  // 基线未变才 +1；基线变化（或无法解析当前版本）时从 0 起算。
  const iteration = parsed === undefined || parsed.baseline !== baseline ? 0 : parsed.iteration + 1
  return formatProjectVersion({ base, baseline, iteration })
}

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

/**
 * 校验当前项目版本符合本方案的形态，并返回拆解结果。
 *
 * 校验的是**形态**而不是某个具体值：基础段属于版本号自身的事实，代码不应认识它的字面量。
 * 这里的失败只表示版本号没按本方案表达（如仍是裸的 `5.9.0`，或被人为改坏），
 * 提示中会引用当前值本身，便于直接修正。
 *
 * @param currentVersion 当前项目版本串。
 * @param baseline 当前 DSH 基线，用于消歧。
 * @throws 当前版本不符合 `<基础>-<DSH 基线>.<迭代号>` 形态时抛出。
 */
export function assertProjectVersionShape(currentVersion: string, baseline: string): ProjectVersionParts {
  const parsed = parseProjectVersion(currentVersion, baseline)
  if (parsed === undefined) {
    throw new Error(
      `当前项目版本 "${currentVersion}" 不符合 <基础>-<DSH 基线>.<迭代号> 形态（基线 ${baseline}），无法按 FNOS-019 发布`,
    )
  }
  return parsed
}
