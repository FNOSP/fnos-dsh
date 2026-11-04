import { existsSync } from 'node:fs'
import { mkdir, readdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { FpkPlatform } from './fpk-platform.js'

/** 应用自己的 FPK 产物目录（相对应用目录）。 */
export const FPK_DIST_DIRECTORY = 'dist'

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

/**
 * 建好并清空应用的 `dist/` 目录，返回其绝对路径。
 *
 * **每次构建都从空目录开始**：产物目录里有什么，就等于「这一次构建产出了什么」。
 * 留着上一次的包，装机时就得先去猜哪个是新的——那正是本次改动要消灭的状态。
 *
 * 清空范围只有 `dist/` 本身，不越界到应用目录：应用根目录的职责是 Manifest、生命周期
 * 脚本与 FPK 输入；迁移前遗留的历史 `.fpk` 由使用者自行处置，构建不代删（删除不是
 * 构建的职权，且那些包可能被用于回滚对照）。
 */
export async function prepareFpkDistDirectory(appDirectory: string): Promise<string> {
  const dist = join(appDirectory, FPK_DIST_DIRECTORY)
  await rm(dist, { recursive: true, force: true })
  await mkdir(dist, { recursive: true })
  return dist
}

export interface FpkArtifactResult {
  /** fnpack 产出的固定名（`<app>.fpk`）。 */
  readonly from: string
  /** 落成后的发布名。 */
  readonly file: string
  /** 目标名在本次构建里已被前一份产物占用（不应发生，出现即说明命名撞了）。 */
  readonly replacedStaleTarget: boolean
  /** `dist/` 里不属于本次构建的 `.fpk`。目录每次都被清空过，出现即说明构建自身有问题。 */
  readonly unexpected: readonly string[]
}

/**
 * 把 `fnpack` 落在 `dist/` 的固定名产物落成发布名。
 *
 * **为什么还有一步落名**：`fnpack` 的产物名恒为清单 `appname` 派生的 `<appname>.fpk`，
 * 实测不受源目录名影响（把副本目录改名成目标文件名再打包，产物名仍是 `<appname>.fpk`），
 * 也没有输出名参数。唯一能让产物「直接叫最终名字」的办法是改写副本里的 `appname`——
 * 那不可接受：`appname` 是 fnOS 识别已安装应用的身份，两份包给出不同 `appname`
 * 会让 x86 与 ARM 被当成两个不同的应用。
 *
 * 所以这一步留在 `dist/` **内部**完成：产物从始至终不出现在应用根目录，使用者看到的
 * 产物目录里只有最终文件名，不存在「先有个怪名字再被改名」的中间状态。
 *
 * **必须按固定名取源**（FNOS-037）：扫「目录里第一个 `.fpk`」会在残留旧包排在前面时
 * 取到旧包，于是旧包顶着新名字、本次新包留在原名，名字与内容对不上且不报错。
 */
export async function finalizeFpkArtifact(options: {
  distDirectory: string
  appName: string
  target: string
  currentBuild: readonly string[]
}): Promise<FpkArtifactResult> {
  const { distDirectory, appName, target, currentBuild } = options
  const from = `${appName}.fpk`
  const source = join(distDirectory, from)
  if (!existsSync(source)) {
    throw new Error(`fnpack produced no ${from} in ${distDirectory}`)
  }

  const destination = join(distDirectory, target)
  const replacedStaleTarget = existsSync(destination)
  // POSIX rename 原子覆盖同名目标：目录里不会留重名。
  await rename(source, destination)

  const fromThisBuild = new Set([target, ...currentBuild])
  const unexpected = (await readdir(distDirectory))
    .filter(entry => entry.endsWith('.fpk') && !fromThisBuild.has(entry))
    .sort()

  return { from, file: target, replacedStaleTarget, unexpected }
}

/**
 * 列出应用根目录里遗留的 `.fpk`（FNOS-044 之前的产物落点）。
 *
 * 这些文件**不删**，只报告：迁移前攒下的历史包可能被用于回滚对照，删除不是构建的职权。
 * 报出来的目的是说清「它们已经不在产物路径上」，避免有人继续去根目录找本次的包。
 */
export async function listLegacyRootArtifacts(appDirectory: string): Promise<string[]> {
  const entries = await readdir(appDirectory, { withFileTypes: true })
  return entries
    .filter(entry => entry.isFile() && entry.name.endsWith('.fpk'))
    .map(entry => entry.name)
    .sort()
}
