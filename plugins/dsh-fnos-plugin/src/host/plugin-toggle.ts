/**
 * 插件的启用/禁用：读写 profile 的 `cordis.patch.yml`。
 *
 * ## 为什么不是简单删掉依赖
 *
 * 禁用（而不是卸载）是一个独立需求：用户想先关掉一个出问题的插件，但不希望丢掉
 * 它的配置与已下载的模块。官方 `dsh-plugin-manager` 的做法是在 profile patch 里
 * 给该条目加 `disabled: true`——组合加载时跳过它，依赖仍在。这里照做。
 *
 * ## 需要 entry id，不是包名
 *
 * patch 里的条目形如 `{ id: plugin-market, name: '@deepseek-ai/dsh-plugin-market' }`。
 * `id` 是组合里的标识（由 bundle 定义），`name` 才是包名。一个包可能有多条
 * （比如客户端与服务端分开挂载），因此禁用要按 **id** 逐条处理。
 *
 * ## 写文件必须原子
 *
 * patch 是 YAML，被破坏会让整个 profile 起不来。先写临时文件再 rename。
 *
 * @module dsh-fnos/plugin-toggle
 */

import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveRepairEnvironment } from './dependency-repair.ts'

/** 一个组合条目的启用状态。 */
export interface PluginEntryState {
  /** 组合 entry id。 */
  readonly id: string
  /** 包名（patch 里的 `name`）。 */
  readonly name: string
  /** 是否启用。 */
  readonly enabled: boolean
}

/** profile patch 文件路径。 */
function patchPath(): string | undefined {
  const environment = resolveRepairEnvironment()
  if (environment === undefined) return undefined
  return join(environment.profileDirectory, 'cordis.patch.yml')
}

/**
 * 从 patch 文本里读出条目与它们的 disabled 值。
 *
 * 刻意不引入 YAML 解析器：这里只需要「某个 id 下有没有 `disabled: true`」这一件事，
 * 而引入解析器会带进一整棵依赖。patch 由本工具与官方工具写入，格式可控；
 * 解析失败时如实报错、不猜。
 *
 * @param text - patch 文本。
 * @returns 条目列表。
 */
export function parsePatchEntries(text: string): PluginEntryState[] {
  const entries: PluginEntryState[] = []
  const lines = text.split('\n')
  let current: { id: string, name: string | undefined, disabled: boolean } | undefined

  const flush = (): void => {
    if (current?.id !== undefined && current.name !== undefined) {
      entries.push({ id: current.id, name: current.name, enabled: !current.disabled })
    }
    current = undefined
  }

  for (const line of lines) {
    // 顶层条目以 `- id:` 开头（允许前导空白）。
    const idMatch = /^\s*-\s+id:\s*(.+?)\s*$/u.exec(line)
    if (idMatch !== null) {
      flush()
      current = { id: idMatch[1] ?? '', name: undefined, disabled: false }
      continue
    }
    if (current === undefined) continue
    const nameMatch = /^\s+name:\s*['"]?(.+?)['"]?\s*$/u.exec(line)
    if (nameMatch !== null) {
      current.name = nameMatch[1]
      continue
    }
    const disabledMatch = /^\s+disabled:\s*(true|false)\s*$/u.exec(line)
    if (disabledMatch !== null) current.disabled = disabledMatch[1] === 'true'
  }
  flush()
  return entries
}

/**
 * 读某个包在 patch 里的全部条目。
 * @param name - 包名。
 * @returns 条目；profile 不可用时空数组。
 */
export async function readPackageEntries(name: string): Promise<PluginEntryState[]> {
  const path = patchPath()
  if (path === undefined) return []
  try {
    const text = await readFile(path, 'utf8')
    return parsePatchEntries(text).filter(entry => entry.name === name)
  } catch {
    return []
  }
}

/**
 * 设置某个包所有条目的启用状态。
 *
 * 已有条目就地改 `disabled`；没有条目时追加一条 `{ id, disabled: true }`
 * ——`id` 用包名兜底，官方加载器对「没有对应 bundle 条目」的 patch 会忽略，
 * 因此这样写是安全的最小干预。
 *
 * @param name - 包名。
 * @param enabled - 目标状态。
 * @returns 是否写入成功。
 */
export async function setPackageEnabled(name: string, enabled: boolean): Promise<{ ok: boolean, error?: string }> {
  const path = patchPath()
  if (path === undefined) return { ok: false, error: 'profile-unavailable' }

  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    text = '[]\n'
  }

  try {
  const entries = parsePatchEntries(text)
  const targets = entries.filter(entry => entry.name === name)
  const lines = text.split('\n')

  /*
    **按 name 找不到条目时，不要盲写「id = 包名」。**

    实测真机：`dsh-plugin-wallpaper-engine` 在 profile 依赖里、也确实被加载，
    但 patch 里没有它的 `name` 条目（它由 bundle 内部挂载，id 不一定等于包名）。
    这时写 `- id: dsh-plugin-wallpaper-engine` 只是在追加一条**对不上任何条目**的
    补丁——浏览器侧看起来「点了没反应」，而且每点一次就多一条（实测堆了 4 条）。

    所以这里先按 name 找；找不到就按 id 等于包名找（有些插件确实如此）；
    仍找不到则**如实报错**，让界面把原因显示出来，而不是静默追加垃圾条目。
  */
  const byName = targets.length > 0
  const byId = entries.filter(entry => entry.id === name)
  const matchedIds = new Set((byName ? targets : byId).map(entry => entry.id))

  if (matchedIds.size === 0) {
    return { ok: false, error: 'entry-not-found' }
  }

  // 逐条改 disabled：在对应条目的 `name:`（或 `id:`）之后插入或替换。
  let currentId: string | undefined
  const out: string[] = []
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    const idMatch = /^\s*-\s+id:\s*(.+?)\s*$/u.exec(line)
    if (idMatch !== null) currentId = idMatch[1]
    out.push(line)

    if (currentId === undefined || !matchedIds.has(currentId)) continue
    // 在条目的第一行之后决定插在哪：紧跟 `id:` 行最安全（name 可能不存在）。
    const isAnchor = idMatch !== null || /^\s+name:/u.test(line)
    if (!isAnchor) continue

    // 跳过紧跟其后的既有 disabled 行（下面按目标状态重写）。
    let j = i + 1
    while (j < lines.length && /^\s+disabled:\s*(?:true|false)\s*$/u.test(lines[j] ?? '')) j += 1
    const indent = /^(\s+)/u.exec(lines[i + 1] ?? '  ')![1]
    if (!enabled) out.push(`${indent}disabled: true`)
    i = j - 1
  }

  // 去掉重复的同 id 追加条目（早前版本会重复追加，实测堆过 4 条）。
  const deduped = dedupeAppendedEntries(out)
  const updated = deduped.join('\n')
  await writeAtomic(path, updated)
  return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * 原子写入：先写临时文件再改名，避免中途失败留下半个 YAML。
 * @param path - 目标。
 * @param content - 内容。
 */
async function writeAtomic(path: string, content: string): Promise<void> {
  const temporary = `${path}.dsh-plugin-toggle-${String(process.pid)}`
  await writeFile(temporary, content, { mode: 0o600 })
  await rename(temporary, path)
}

/**
 * 去掉重复的「仅含 id + disabled」的追加条目。
 *
 * 早前的实现每次点「禁用」都在文件末尾追加一条 `- id: X / disabled: true`，
 * 而在真机上 `X` 并不是组合里的 entry id，于是既没生效、又不断堆积（实测 4 条）。
 * 这里保留最后一条，把前面的删掉。
 *
 * @param lines - patch 的各行。
 * @returns 处理后的行。
 */
function dedupeAppendedEntries(lines: readonly string[]): string[] {
  const seen = new Set<string>()
  const keep: boolean[] = lines.map(() => true)

  // 从后往前扫：保留每个 id 的最后一条「仅 id + disabled」形条目。
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const idMatch = /^\s*-\s+id:\s*(.+?)\s*$/u.exec(lines[i] ?? '')
    if (idMatch === null) continue
    const id = idMatch[1]
    if (id === undefined) continue
    // 该条目是否只有一个 disabled 子行（没有 name / config）。
    const next = lines[i + 1] ?? ''
    const after = lines[i + 2] ?? ''
    const onlyDisabled = /^\s+disabled:\s*(?:true|false)\s*$/u.test(next) && !/^\s+\S/u.test(after)
    if (!onlyDisabled) continue
    if (seen.has(id)) keep[i] = false
    else seen.add(id)
  }
  return lines.filter((_, index) => keep[index])
}
