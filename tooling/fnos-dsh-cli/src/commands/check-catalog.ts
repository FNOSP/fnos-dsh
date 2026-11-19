/**
 * `check-catalog`：提交前守卫，检查插件清单的 DSH 依赖是否都走 catalog。
 *
 * 与 `check` 分开成一个独立命令，原因是**运行时机不同**：
 *
 * | 命令 | 时机 | 目的 |
 * | --- | --- | --- |
 * | `check --tooling` | pre-push | 全量校验，覆盖面广但慢 |
 * | `check-catalog` | pre-commit | 只读七个插件清单，毫秒级，拦在源头 |
 *
 * 单独成一个命令而不是塞进 `check` 的子项，是为了让 lefthook 能直接调用它，
 * 不必为一条「读七个 JSON」的检查去启动整个 turbo 流水线。
 */

import { program } from '../program.js'
import { repositoryRoot } from '../config/paths.js'
import { formatCatalogDrift, scanPluginsForCatalogDrift } from '../core/catalog-drift.js'

/**
 * 执行检查：发现写死的 DSH 依赖即抛错。
 *
 * @param root - 仓库根目录；默认取 CLI 解析出的根，测试可覆盖。
 * @throws 存在违规项时抛错，错误信息含每个文件的字段路径与修复命令。
 */
export async function runCheckCatalog(root: string = repositoryRoot): Promise<void> {
  const drifts = await scanPluginsForCatalogDrift(root)
  if (drifts.length === 0) {
    console.log('插件清单的 DSH 依赖全部走 catalog。')
    return
  }
  throw new Error(formatCatalogDrift(drifts))
}

program
  .command('check-catalog')
  .description('Verify plugin manifests reference DSH through the pnpm catalog')
  .action(async () => {
    await runCheckCatalog()
  })
