import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, relative, sep } from 'node:path'
import { writeManifestPlatform, type FpkPlatform } from './fpk-platform.js'

/**
 * 不参与打包的目录与文件（按**相对应用目录**的路径判断）。
 *
 * 用**排除**而不是「只复制 fnpack 认识的输入」：白名单会随 fnpack 打包范围的演进而
 * 悄悄漏项，漏掉的内容打进包里是静默缺失；排除法只排除已知不需要的大目录。
 *
 * - `tests`：真机取证产物，实测单目录 2.9 GB，fnpack 不打包。
 * - `node_modules`：依赖树，fnpack 不打包；网关产物在 `app/` 下，不受影响。
 * - `*.fpk`：历史产物，打进新包既无意义又把包体积翻倍。
 *
 * 必须按相对路径判断：`cp` 的 filter 拿到的是绝对源路径，若检出本身位于某个
 * `node_modules` 或 `tests` 之下，按绝对路径匹配会把**整个应用**排除掉、产出一个
 * 空包。相对路径把判断范围钉在应用目录内。
 */
const STAGE_EXCLUDED_SEGMENTS = new Set(['tests', 'node_modules'])

function stageFilter(sourceRoot: string) {
  return (source: string): boolean => {
    const relativePath = relative(sourceRoot, source)
    if (relativePath === '') return true
    const segments = relativePath.split(sep)
    if (segments.some(segment => STAGE_EXCLUDED_SEGMENTS.has(segment))) return false
    return !source.endsWith('.fpk')
  }
}

/**
 * 在临时目录里准备一份「按目标平台改写清单后」的应用副本，把副本路径交给 `run`，
 * 结束后无条件删除副本。
 *
 * **为什么不就地改 `apps/<app>/manifest` 再改回来**：仓库那份清单是受版本管理的
 * 事实来源。就地改写意味着任何一次中途失败（进程被杀、fnpack 报错后提前返回）都可能
 * 把 `platform = arm` 留在仓库里；而下一次构建会把这份脏值当作「原始值」捕获，永远
 * 还原不回 x86——脏状态会自我固化。副本方案里仓库文件全程只读。
 *
 * 副本只改一行：`fnpack` 没有平台参数，包内平台声明完全来自被打包的那份清单
 * （2026-11-04 实测：改副本的 platform 值后打包，包内清单与既有产物逐行比对只有
 * 平台行与包自身校验值不同，成员清单完全一致）。
 *
 * `fnpack build --directory <副本>` 的产物落在**调用时的工作目录**（实测），因此
 * 调用方把 cwd 设为应用目录、`--directory` 设为这里给出的副本路径，产物就直接进发布
 * 目录，不需要跨设备搬运。
 *
 * 复制保留文件模式（生命周期脚本的 0755 由 fnpack 带进包里），并用 `dereference`
 * 展开软链接，避免副本里的链接指向构建机上不可达的位置。
 */
export async function withStagedFpkPlatform<T>(
  appDirectory: string,
  platform: FpkPlatform,
  run: (stageDirectory: string) => Promise<T>,
): Promise<T> {
  const stage = await mkdtemp(join(tmpdir(), `fpk-${basename(appDirectory)}-${platform}-`))
  try {
    await cp(appDirectory, stage, {
      recursive: true,
      dereference: true,
      filter: stageFilter(appDirectory),
    })
    await writeManifestPlatform(stage, platform)
    return await run(stage)
  }
  finally {
    await rm(stage, { recursive: true, force: true })
  }
}
