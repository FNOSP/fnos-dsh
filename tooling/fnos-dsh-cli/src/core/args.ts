import type { VersionBumpRelease } from 'bumpp'

export type VersionOptions = {
  release: VersionBumpRelease
  /**
   * 目标 DSH 基线。**仅与 major 档位搭配**（基线变更 = major 发布，FNOS-028）：
   * 确认后把 catalog 的 `@deepseek-ai/dsh` 改成它。版本号本身是纯净 semver，
   * 基线不进入版本号，由 FPK 产物命名与 manifest 描述承载。
   *
   * 为什么在命令内部改 catalog：`pnpm run` 会在脚本执行**之前**做依赖校验，catalog
   * 若已指向尚未安装的版本，连脚本都跑不起来。让 catalog 到命令内部才变化，校验看到
   * 的就是变化前的状态，于是能正常进入命令。
   */
  baseline?: string
  noCommit: boolean
  noTag: boolean
  confirm: boolean
}

const versionFlags = new Set(['--no-commit', '--no-tag', '--no-push', '--yes'])

export function normalizeArgs(args: string[]): string[] {
  return args.filter(arg => arg !== '--')
}

export function parseVersionOptions(args: string[]): VersionOptions {
  // `--baseline <版本>` 的值不是位置参数，先摘掉再统计，否则会被当成发布档位。
  const baselineIndex = args.indexOf('--baseline')
  const baseline = baselineIndex < 0 ? undefined : args[baselineIndex + 1]
  if (baselineIndex >= 0 && (baseline === undefined || baseline.startsWith('-'))) {
    throw new Error('--baseline 需要一个版本号，例如 --baseline 0.2.1-rc.5')
  }
  const rest = baselineIndex < 0 ? args : [...args.slice(0, baselineIndex), ...args.slice(baselineIndex + 2)]

  const values = rest.filter(arg => !arg.startsWith('-'))
  const unknown = rest.filter(arg => arg.startsWith('-') && !versionFlags.has(arg))
  if (unknown.length > 0) throw new Error(`Unknown version option: ${unknown.join(', ')}`)
  return {
    // 缺省用 `prompt`：无位置参数时进入 bumpp 原生 release 菜单（各档位预览、
    // commits 摘要与 custom 输入由 bumpp 提供）。非交互场景必须显式传档位或
    // 版本串，否则会在菜单处等待输入。
    release: (values[0] ?? 'prompt') as VersionBumpRelease,
    ...(baseline === undefined ? {} : { baseline }),
    noCommit: rest.includes('--no-commit'),
    noTag: rest.includes('--no-tag'),
    confirm: !rest.includes('--yes'),
  }
}

export function optionValue(args: string[], option: string): string | undefined {
  const index = args.lastIndexOf(option)
  const value = index < 0 ? undefined : args[index + 1]
  return value?.startsWith('-') ? undefined : value
}
