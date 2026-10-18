/**
 * 项目/FPK 版本号方案：`<固定基础>-<DSH 基线>.<应用迭代号>`。
 *
 * 例：`5.9.0-0.2.1-rc.2.5`
 * - `5.9.0`：**固定不变**的应用基础版本，不随发布递增；
 * - `0.2.1-rc.2`：跟随 DSH 运行时基线（取自 `pnpm-workspace.yaml` 的 catalog）；
 * - `5`：本应用自身的迭代号，每次发布只递增这一段。
 *
 * 为什么不用 bumpp 的语义化档位：`patch`/`minor`/`major` 会改动前三段，而本方案要求
 * 前三段**永不移动**；递增点只有末尾那一段。因此项目版本的递增走本模块，插件版本仍
 * 走原有语义化流程。
 *
 * 与 semver 的关系：整串是合法的 semver **预发布版本**（`-` 之后为 prerelease），
 * 因此按 semver 判序时它小于同号的正式版 `5.9.0`——这是预期的：本应用从不发布
 * `5.9.0` 正式版，比较只发生在两个预发布版本之间，而此时末尾迭代号能正确分出先后。
 */

/** 应用基础版本，固定不变。 */
export const PROJECT_BASE_VERSION = '5.9.0'

/** 版本号中承载 DSH 运行时基线的那一段。 */
export type ProjectVersionParts = {
  /** 固定基础版本，如 `5.9.0`。 */
  readonly base: string
  /** DSH 运行时基线，如 `0.2.1-rc.2`。 */
  readonly baseline: string
  /** 应用迭代号，从 0 开始每次发布 +1。 */
  readonly iteration: number
}

const BASE_PATTERN = /^\d+\.\d+\.\d+$/
// 基线本身允许带预发布段（`0.2.1-rc.2`），但不允许再带 build metadata。
const BASELINE_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

/**
 * 解析项目版本串。
 *
 * 接受 `5.9.0-0.2.1-rc.2.5` 这种形态。基线自带预发布段，所以不能简单地按 `-` 切一刀：
 * 末尾的迭代号是最后一个 `.` 之后的纯数字段，其余作为基线。
 *
 * **注意一处固有歧义**：`5.9.0-0.2.1-rc.2` 既可读作「基线 `0.2.1-rc.2`、无迭代号」，
 * 也可读作「基线 `0.2.1-rc`、迭代号 `2`」——两种解释产生完全相同的字符串，仅凭字符串
 * 无法区分。因此当调用方知道当前基线时（见 `nextProjectVersion`），必须用基线来消歧：
 * 若尾部恰好等于该基线，则视为**缺迭代号**。单参调用在没有基线时按「取末尾数字段」处理。
 *
 * @param version 待解析的版本串。
 * @param knownBaseline 已知的 DSH 基线；提供时用于消除尾部歧义。
 * @returns 拆解结果；格式不符时返回 `undefined`，由调用方决定报错或回落。
 */
export function parseProjectVersion(version: string, knownBaseline?: string): ProjectVersionParts | undefined {
  const trimmed = version.trim().replace(/^v/, '')
  const dashIndex = trimmed.indexOf('-')
  if (dashIndex < 0) return undefined
  const base = trimmed.slice(0, dashIndex)
  if (!BASE_PATTERN.test(base)) return undefined

  const tail = trimmed.slice(dashIndex + 1)
  if (knownBaseline !== undefined) {
    // 尾部正好是整段基线：说明这个版本漏了迭代号，按第 0 次迭代处理（不是迭代号 2）。
    if (tail === knownBaseline) return { base, baseline: knownBaseline, iteration: 0 }
    const prefix = `${knownBaseline}.`
    if (tail.startsWith(prefix)) {
      const rest = tail.slice(prefix.length)
      if (!/^\d+$/.test(rest)) return undefined
      return { base, baseline: knownBaseline, iteration: Number(rest) }
    }
  }

  const lastDot = tail.lastIndexOf('.')
  if (lastDot < 0) return undefined
  const iterationText = tail.slice(lastDot + 1)
  if (!/^\d+$/.test(iterationText)) return undefined
  const baseline = tail.slice(0, lastDot)
  if (!BASELINE_PATTERN.test(baseline)) return undefined

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
 * 计算下一次发布的项目版本。
 *
 * 规则：基础版本固定为 {@link PROJECT_BASE_VERSION}；基线取当前 DSH 运行时基线；
 * 迭代号在当前值上 +1。
 *
 * **基线变化时迭代号不重置**：版本号只需单调递增，而重置会让新号在排序上退回旧位置，
 * 于是设备会把它当降级而拒绝安装。基线本身已能表达 DSH 版本的变化。
 *
 * @param current 当前版本串；为空或无法解析时按第 0 次迭代处理。
 * @param baseline 当前 DSH 运行时基线。
 * @returns 下一个版本串。
 */
export function nextProjectVersion(current: string | undefined, baseline: string): string {
  if (!BASELINE_PATTERN.test(baseline)) {
    throw new Error(`Invalid DSH baseline for project version: ${baseline}`)
  }
  // 传 baseline 消歧：否则 `5.9.0-0.2.1-rc.2` 会被误读成「基线 0.2.1-rc、迭代号 2」，
  // 于是下一次发布算出 .3 而不是 .1，凭空跳号。
  const parsed = current === undefined ? undefined : parseProjectVersion(current, baseline)
  const iteration = parsed === undefined ? 0 : parsed.iteration + 1
  return formatProjectVersion({ base: PROJECT_BASE_VERSION, baseline, iteration })
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
 * 校验当前项目版本的基础段是否仍为固定值。
 *
 * 「`5.9.0` 静态不动」是本方案的硬约束，因此这里**显式失败**而不是静默改写：若基础段
 * 被人为改过，说明有流程绕过了本方案，继续发版会产出前后不一致的版本号。
 *
 * @param currentVersion 当前项目版本串。
 * @param baseline 当前 DSH 基线，用于消歧。
 * @throws 当前版本不含固定基础段时抛出。
 */
export function assertProjectBaseVersion(currentVersion: string, baseline: string): ProjectVersionParts {
  const parsed = parseProjectVersion(currentVersion, baseline)
  if (parsed === undefined) {
    throw new Error(
      `当前项目版本 "${currentVersion}" 不符合 <基础>-<DSH 基线>.<迭代号> 形态，无法按 FNOS-019 发布；请先修正为 ${PROJECT_BASE_VERSION}-${baseline}.<迭代号>`,
    )
  }
  if (parsed.base !== PROJECT_BASE_VERSION) {
    throw new Error(
      `当前项目版本的基础段是 "${parsed.base}"，但 FNOS-019 要求固定为 "${PROJECT_BASE_VERSION}"；请先修正版本号，不要发布漂移的基础段`,
    )
  }
  return parsed
}
