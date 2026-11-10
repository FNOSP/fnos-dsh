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

  const entries = parsePatchEntries(text)
  const targets = entries.filter(entry => entry.name === name)
  const lines = text.split('\n')

  if (targets.length === 0) {
    // 没有现成条目：追加一条禁用指令。
    if (enabled) return { ok: true }
    const appended = `${text.trimEnd()}\n- id: ${name}\n  disabled: true\n`
    await writeAtomic(path, appended)
    return { ok: true }
  }

  // 逐条改 disabled：在 `name:` 之后插入或替换。
  let currentId: string | undefined
  const out: string[] = []
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    const idMatch = /^\s*-\s+id:\s*(.+?)\s*$/u.exec(line)
    if (idMatch !== null) currentId = idMatch[1]
    const isTarget = currentId !== undefined && targets.some(entry => entry.id === currentId)
    out.push(line)

    if (!isTarget) continue
    const nameMatch = /^\s+name:/u.test(line)
    if (!nameMatch) continue
    // 该条目之后紧跟的 disabled 行需要跳过（下面重写）。
    let j = i + 1
    while (j < lines.length && /^\s+disabled:\s*(?:true|false)\s*$/u.test(lines[j] ?? '')) j += 1
    const indent = /^(\s+)/u.exec(lines[i + 1] ?? '  ')![1]
    if (!enabled) out.push(`${indent}disabled: true`)
    i = j - 1
  }

  const updated = out.join('\n')
  try {
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
