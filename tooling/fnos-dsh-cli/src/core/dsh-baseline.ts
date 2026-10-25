import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 基线形态：`MAJOR.MINOR.PATCH`，可带预发布段（`0.2.1-rc.3`），不允许 build metadata。 */
export const BASELINE_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

/**
 * 从 catalog 文本中读出 DSH 运行时基线。
 *
 * `pnpm-workspace.yaml` 的 `'@deepseek-ai/dsh'` 条目是运行时版本的**唯一事实来源**：
 * 插件 manifest 用 `catalog:dsh` 引用它，构建校验与本地 profile 也必须读同一份值。
 * 在代码里再写一份字面量会在下一次基线升级时单向漂移——实测踩到过一次：
 * catalog 已升到新基线，而 CLI 常量仍停在旧值，构建因此报「install_callback 未对齐」。
 */
export function readDshBaselineFromCatalog(workspaceYaml: string): string | undefined {
  const match = /^\s{2}'@deepseek-ai\/dsh':\s*(\S+)\s*$/mu.exec(workspaceYaml)
  const value = match?.[1]
  if (value === undefined) return undefined
  const normalized = value.replace(/^['"]|['"]$/gu, '')
  return BASELINE_PATTERN.test(normalized) ? normalized : undefined
}

/**
 * 从本源文件所在目录向上找到仓库根（含 `pnpm-workspace.yaml` 的目录）。
 *
 * 不直接用 `config/paths.ts` 的 `repositoryRoot`：它按源码层级硬推两层，
 * 而测试运行器（vitest）解析出的模块路径层级不同，实测会指到 `tooling/`。
 * 向上查找对源码、构建产物与测试三种形态都成立。
 */
function findRepositoryRoot(): string {
  let current = dirname(fileURLToPath(import.meta.url))
  for (;;) {
    if (existsSync(join(current, 'pnpm-workspace.yaml'))) return current
    const parent = resolve(current, '..')
    if (parent === current) throw new Error('cannot locate the repository root: no pnpm-workspace.yaml found above this module')
    current = parent
  }
}

/** 读取本仓库 catalog 声明的 DSH 运行时基线；缺失或形态非法时抛错。 */
export function requireDshBaseline(): string {
  const workspaceYaml = readFileSync(join(findRepositoryRoot(), 'pnpm-workspace.yaml'), 'utf8')
  const baseline = readDshBaselineFromCatalog(workspaceYaml)
  if (baseline === undefined) {
    throw new Error("pnpm-workspace.yaml must declare @deepseek-ai/dsh in the catalog (e.g. '@deepseek-ai/dsh': 0.2.1-rc.3)")
  }
  return baseline
}
