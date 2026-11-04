import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * fnOS 应用包的平台取值。
 *
 * 官方 `manifest` 只接受 `x86`、`arm`、`all`（见 fnOS Manifest 文档「平台支持」）。
 * 这里**不收录 `all`**：`all` 的适用条件是「包内不含架构相关二进制」，本应用满足该
 * 条件，但发布方没有 ARM 设备、无法验证 ARM 装机结果。把仓库清单直接改成 `all` 等于
 * 让全部既有用户（含 x86）承担一次未验证的适用范围放大；issue #28 的回复口径是
 * 「Release 里额外提供一份 ARM 包」，出问题只影响主动选择 ARM 包的人。因此构建只
 * 提供这两个显式取值，`all` 留给真正验证过双平台的那一天再评估。
 */
export const FPK_PLATFORMS = ['x86', 'arm'] as const

export type FpkPlatform = typeof FPK_PLATFORMS[number]

export function isFpkPlatform(value: string): value is FpkPlatform {
  return (FPK_PLATFORMS as readonly string[]).includes(value)
}

/**
 * 解析 `--platform` 的取值：大小写不敏感、去重、保持传入顺序。
 *
 * 非法值**报错而不是忽略**：静默丢弃会让「以为打了 arm、实际只打了 x86」这种结果
 * 在产物列表里完全看不出来，而装机失败发生在用户侧。
 */
export function parseFpkPlatforms(values: string[]): FpkPlatform[] {
  const platforms: FpkPlatform[] = []
  for (const value of values) {
    const normalized = value.trim().toLowerCase()
    if (!isFpkPlatform(normalized)) {
      throw new Error(`Unknown FPK platform: ${value}. Supported platforms: ${FPK_PLATFORMS.join(', ')}`)
    }
    if (!platforms.includes(normalized)) platforms.push(normalized)
  }
  return platforms
}

/**
 * 把一份 `manifest` 文本里的 `platform` 值改成目标平台。
 *
 * 只替换等号右侧的值，**保留原有空白对齐**：本仓库的 `manifest` 是键值列对齐的 INI，
 * 重排空白会让 diff 看起来像改了整段配置。没有 `platform` 行时抛错——补一行等于替
 * 应用声明它原本没有的平台，那是猜。
 */
export function withManifestPlatform(manifest: string, platform: FpkPlatform): string {
  const line = /^(platform)(\s*=\s*)(\S+)(\s*)$/mu.exec(manifest)
  if (line === null) throw new Error(`manifest has no platform field; declare one of: ${FPK_PLATFORMS.join(', ')}`)
  return `${manifest.slice(0, Number(line.index))}${line[1]}${line[2]}${platform}${line[4]}${manifest.slice(Number(line.index) + line[0].length)}`
}

/** 读出 `manifest` 里 `platform` 的**原始值**，不做取值白名单判定。 */
export function readManifestPlatformValue(manifest: string): string | undefined {
  return /^platform\s*=\s*(\S+)\s*$/mu.exec(manifest)?.[1]
}

/**
 * 决定一次 FPK 构建要产出哪些平台。
 *
 * 缺省取应用 `manifest` 自己声明的 `platform`，于是「不加选择地构建」得到的仍是与
 * 平台维度之前等价的那一份包。声明缺失或取值不是构建目标时报错而不是默认 x86：
 * 默认值会让一个未声明平台的应用静默产出带平台段的包，名字声称支持某类设备、
 * 包内却没有任何依据。
 *
 * `all` 是清单合法值但**不是**构建目标——它意味着「一份包通吃」，与本需求「双包、
 * 出问题只影响主动选 ARM 包的用户」的取舍相反。因此单独说明，不混进「没声明平台」。
 */
export function resolveFpkPlatforms(options: {
  appName: string
  declared: string | undefined
  requested: FpkPlatform[] | undefined
}): FpkPlatform[] {
  const { appName, declared, requested } = options
  if (requested !== undefined && requested.length > 0) return requested
  if (declared !== undefined && isFpkPlatform(declared)) return [declared]
  const supported = `pass --platform explicitly (supported: ${FPK_PLATFORMS.join(', ')})`
  if (declared !== undefined) {
    throw new Error(`apps/${appName}/manifest declares platform = ${declared}, which is not a build target; ${supported}`)
  }
  throw new Error(`apps/${appName}/manifest declares no platform; add "platform = x86" or "platform = arm" or ${supported}`)
}

/** 就地改写指定目录里 `manifest` 的平台声明。 */
export async function writeManifestPlatform(directory: string, platform: FpkPlatform): Promise<void> {
  const manifestPath = join(directory, 'manifest')
  const manifest = await readFile(manifestPath, 'utf8')
  await writeFile(manifestPath, withManifestPlatform(manifest, platform))
}
