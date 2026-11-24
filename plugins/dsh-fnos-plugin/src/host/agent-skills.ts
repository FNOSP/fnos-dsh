/**
 * 清理应用曾经代装到 `~/.agents/skills` 下的 agent skill。
 *
 * ## 为什么需要这个入口
 *
 * 应用早前把 `trim-cli` 与 `fnos-cli` 两个 skill 装到用户 home 的
 * `~/.agents/skills` 下。那是**用户的 agent 环境**，不该由应用单方面写入：
 * 同一件事一旦有两份来源（应用装的 + 用户自己装的），就无法判断该保留哪份。
 *
 * 新版安装流程不再写这两个目录，并在安装回调里顺手删一次；但那只覆盖「升级时
 * 恰好存在」的情况——用户在其它版本装过、或删失败，都需要一个可重复执行的入口。
 *
 * ## 只动这两个名字
 *
 * 只删 `trim-cli` 与 `fnos-cli` 两个目录，不扫其它 skill：`~/.agents/skills`
 * 是用户的目录，应用没有资格做通用清理。
 *
 * @module dsh-fnos/host/agent-skills
 */

import { readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { convertPathsForDisplay } from './authorized-directories.ts'

/** 应用曾经代装、现在要清理掉的 skill 目录名。 */
export const BUNDLED_SKILL_NAMES: readonly string[] = ['trim-cli', 'fnos-cli']

/** 清理状态。 */
export interface AgentSkillsStatus {
  /** skills 根目录；无法解析 home 时为 undefined。 */
  readonly root: string | undefined
  /** 已存在的、属于本应用清理范围的目录名。 */
  readonly present: readonly string[]
  /**
   * 每个目录的完整绝对路径，以及 fnOS 的语义化展示形式。
   *
   * 确认框要告诉用户「到底删哪个位置」——只给目录名（`fnos-cli`）看不出它在
   * 哪块存储、哪个账号下。语义化形式由 `trim.file.convertPath` 给出，拿不到时
   * 退回 `存储空间2/...` 这类可读路径。
   */
  readonly entries: readonly { name: string, path: string, displayPath: string }[]
}

/** 清理结果。 */
export interface AgentSkillsCleanupResult {
  /** 成功删掉的目录名。 */
  readonly removed: readonly string[]
  /** 删失败的目录名与原因。 */
  readonly failed: readonly { name: string, message: string }[]
}

/**
 * 解析 `~/.agents/skills`。
 *
 * 优先用 `HOME`（安装回调把 home 指向 `@appshare/<app>`）；缺失时退回
 * `DSH_HOME/..`，与 `resolveRepairEnvironment` 对平台布局的推导一致。
 *
 * @param env - 环境变量。
 * @returns 目录路径；无法解析时 undefined。
 */
export function resolveAgentSkillsRoot(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const home = env.HOME?.trim()
  if (home !== undefined && home !== '') return join(home, '.agents', 'skills')
  const dshHome = env.DSH_HOME?.trim()
  if (dshHome === undefined || dshHome === '') return undefined
  /* `<storage>/@apphome/<app>` → 兄弟目录 `@appshare/<app>`。 */
  const parent = join(dshHome, '..', '..', '@appshare', dshHome.split('/').pop() ?? '')
  return join(parent, '.agents', 'skills')
}

/**
 * 判断一个路径是否为目录。
 * @param path - 待判断路径。
 * @returns 是否目录。
 */
async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/**
 * 读出当前存在、属于清理范围的 skill 目录。
 * @param root - skills 根目录。
 * @returns 存在的目录名。
 */
async function presentSkills(root: string): Promise<string[]> {
  let entries: string[]
  try {
    entries = await readdir(root)
  } catch {
    /* 目录不存在：没有可清理的。 */
    return []
  }
  const present: string[] = []
  for (const name of BUNDLED_SKILL_NAMES) {
    if (entries.includes(name) && await isDirectory(join(root, name))) present.push(name)
  }
  return present
}

/**
 * 查清理状态：界面据此决定按钮是否可用。
 * @param env - 环境变量。
 * @returns 根目录与存在的目录名。
 */
export async function readAgentSkillsStatus(
  env: NodeJS.ProcessEnv = process.env,
  language = 'zh',
): Promise<AgentSkillsStatus> {
  const root = resolveAgentSkillsRoot(env)
  if (root === undefined) return { root: undefined, present: [], entries: [] }
  const present = await presentSkills(root)
  if (present.length === 0) return { root, present, entries: [] }
  /*
    语义化要调 fnOS 后端接口，失败不应让整个状态读不出来——退回目录名本身，
    确认框至少还能显示「要删的是哪一项」。
  */
  const paths = present.map(name => join(root, name))
  let displays: string[] = paths
  try {
    displays = (await convertPathsForDisplay(paths, language)).map(item => item.semanticPath)
  } catch {
    /* 保持退回值。 */
  }
  return {
    root,
    present,
    entries: present.map((name, index) => ({
      name,
      path: paths[index] ?? '',
      displayPath: displays[index] ?? paths[index] ?? name,
    })),
  }
}

/**
 * 删掉存在的 skill 目录。
 *
 * 每个目录独立处理：一个失败不影响其它，失败原因逐条返回——界面要能说清
 * 「哪一项没删掉、为什么」。
 *
 * @param env - 环境变量。
 * @param onLine - 每行的进度回调（写进任务日志）。
 * @returns 成功与失败的清单。
 */
export async function cleanupAgentSkills(
  env: NodeJS.ProcessEnv = process.env,
  onLine?: (line: string) => void,
): Promise<AgentSkillsCleanupResult> {
  const log = (line: string): void => { onLine?.(line) }
  const root = resolveAgentSkillsRoot(env)
  if (root === undefined) {
    log('无法解析 ~/.agents/skills，跳过清理。')
    return { removed: [], failed: [] }
  }
  log(`检查 ${root}`)

  const present = await presentSkills(root)
  if (present.length === 0) {
    log('没有需要清理的 skill。')
    return { removed: [], failed: [] }
  }

  const removed: string[] = []
  const failed: { name: string, message: string }[] = []
  for (const name of present) {
    const target = join(root, name)
    log(`删除 ${target}`)
    try {
      await rm(target, { recursive: true, force: true })
      /* 删完再确认一次：`rm` 成功不代表目录真的没了。 */
      if (await isDirectory(target)) throw new Error('directory still exists')
      removed.push(name)
      log(`已删除 ${name}`)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      failed.push({ name, message })
      log(`删除 ${name} 失败：${message}`)
    }
  }
  return { removed, failed }
}
