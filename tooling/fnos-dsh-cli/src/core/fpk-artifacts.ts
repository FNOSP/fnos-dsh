import { existsSync } from 'node:fs'
import { readdir, rename } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * 发布用 FPK 文件名：`<app>-<releaseTag>-dsh-<baseline>.fpk`。
 *
 * 与 `.github/workflows/build-app.yml` 的 `VERSIONED_FPK` 同模板，本地产物与
 * Release 附件可以直接对照。
 */
export function fpkReleaseFileName(appName: string, releaseTag: string, baseline: string): string {
  return `${appName}-${releaseTag}-dsh-${baseline}.fpk`
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
 */
export async function renameFpkToRelease(
  appDir: string,
  appName: string,
  target: string,
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

  const leftovers = (await readdir(appDir))
    .filter(entry => entry.endsWith('.fpk') && entry !== target)
    .sort()

  return { from, to: target, replacedStaleTarget, leftovers }
}
