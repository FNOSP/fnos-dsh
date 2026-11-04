import { existsSync } from 'node:fs'
import { readdir, rename } from 'node:fs/promises'
import { join } from 'node:path'
import type { FpkPlatform } from './fpk-platform.js'

/**
 * 发布用 FPK 文件名：`<app>-<platform>-<releaseTag>-dsh-<baseline>.fpk`。
 *
 * 平台段自 FNOS-044 起进入命名。此前同一版本只需区分「项目版本 + DSH 基线」；引入
 * ARM 之后同一版本会产出两份**只差平台**的包，名字不含平台时它们完全同名，后打的
 * 直接顶掉先打的，而从文件名看不出哪份给哪类设备——正是 FNOS-037 消灭的那类「名字
 * 与内容对不上」。
 *
 * 与 `.github/workflows/build-app.yml` 的 `VERSIONED_FPK` 同模板，本地产物与
 * Release 附件可以直接对照；两侧一致性由 `tests/fpk-release-naming.spec.ts` 钉住。
 */
export function fpkReleaseFileName(
  appName: string,
  platform: FpkPlatform,
  releaseTag: string,
  baseline: string,
): string {
  return `${appName}-${platform}-${releaseTag}-dsh-${baseline}.fpk`
}

export interface FpkRenameResult {
  /** 被改名的源文件（fnpack 固定产物名）。 */
  readonly from: string
  /** 改名后的发布名。 */
  readonly to: string
  /** 目标名已存在，被本次产物覆盖。 */
  readonly replacedStaleTarget: boolean
  /** 改名后目录里仍然存在的其它 FPK（可能与本次构建无关的旧包）。 */
  readonly leftovers: readonly string[]
}

/**
 * 把 `fnpack` 刚产出的固定名 FPK 改名为发布名。
 *
 * **必须按固定名取源文件**：`fnpack build` 的产物名恒为 `<app>.fpk`。此前用
 * 「目录里第一个 `.fpk`」取源，当目录残留上一轮的版本化产物时会取到那个旧包，
 * 于是旧包被改成新名字、而本次新包留在原名——产物的名字与内容对不上，且不报错。
 *
 * `currentBuild` 是**本次构建将要产出的全部发布名**（FNOS-044 多平台）。打完第一个
 * 平台再打第二个时，第一个的产物已经在目录里；它是本次构建的成果，不能当成「可能拿
 * 错的旧包」报出来。省略时只排除当前这一个目标名。
 */
export async function renameFpkToRelease(
  appDir: string,
  appName: string,
  target: string,
  currentBuild: readonly string[] = [],
): Promise<FpkRenameResult> {
  const from = `${appName}.fpk`
  const source = join(appDir, from)
  if (!existsSync(source)) {
    throw new Error(`fnpack produced no ${from} in ${appDir}`)
  }

  const destination = join(appDir, target)
  const replacedStaleTarget = existsSync(destination)
  // POSIX rename 原子覆盖同名目标：本次产物直接顶掉旧包，目录不会留重名。
  await rename(source, destination)

  const fromThisBuild = new Set([target, ...currentBuild])
  const leftovers = (await readdir(appDir))
    .filter(entry => entry.endsWith('.fpk') && !fromThisBuild.has(entry))
    .sort()

  return { from, to: target, replacedStaleTarget, leftovers }
}
