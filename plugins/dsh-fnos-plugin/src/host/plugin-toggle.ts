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

/**
 * patch 文件读不到时的骨架。
 *
 * 与官方生成的文件同构：三行说明注释 + block sequence。写回时注释得以保留，
 * 语言风格也一致。
 */
const DEFAULT_PATCH_SKELETON = `# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries (id-targeted config
# overrides, disables, and insert lists; \`!!js\` expressions allowed).
`

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
    /*
      **保留没有 `name` 的条目。**

      早前只收「同时有 id 与 name」的条目，于是 `- id: X / disabled: true` 这种
      **只有 id 的禁用条目**在解析时被整个丢掉——`setPackageEnabled` 里的 `byId`
      匹配因此永远找不到它们。真机表现：patch 里明明有 4 条 wallpaper 的禁用条目，
      界面却一直是启用状态、点禁用还报错。

      `name` 用空串表示「该条目没有 name 字段」，调用方据此选择匹配方式。
    */
    if (current !== undefined && current.id !== '') {
      entries.push({ id: current.id, name: current.name ?? '', enabled: !current.disabled })
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
 * 从插件自身的 `cordis.patch.yml` 里解析出它贡献的组合 entry id。
 *
 * ## 为什么必须读这个文件
 *
 * 组合里的 entry id **不等于包名**。真机实例：`dsh-plugin-wallpaper-engine` 这个
 * bundle 贡献了 9 条 entry，id 分别是 `wallpaper-engine`、`wallpaper-engine-fx`、
 * `wallpaper-engine-parallax`……而包名一条都对不上。
 *
 * 早前直接写 `- id: <包名>`，结果那条补丁不指向任何条目——**禁用完全没生效**，
 * 界面上开关点下去又弹回去。这是「无法禁用插件」的真正原因。
 *
 * bundle 的 `package.json` 用 `dsh.bundle.patch` 指到这个文件，那里是 entry 集的
 * 唯一真相来源。
 *
 * @param profile - profile 目录。
 * @param name - 包名。
 * @returns 该包贡献的 entry id 列表（可能为空）。
 */
async function resolveEntryIds(profile: string, name: string): Promise<string[]> {
  const packageDirectory = join(profile, 'node_modules', ...name.split('/'))
  let patchRelative: string | undefined
  try {
    const manifest = JSON.parse(await readFile(join(packageDirectory, 'package.json'), 'utf8')) as {
      dsh?: { bundle?: { patch?: unknown } }
    }
    const declared = manifest.dsh?.bundle?.patch
    if (typeof declared === 'string') patchRelative = declared
  } catch {
    return []
  }
  if (patchRelative === undefined) return []

  let text: string
  try {
    text = await readFile(join(packageDirectory, patchRelative), 'utf8')
  } catch {
    return []
  }

  /*
    这个文件里的 entry 是嵌套在 `insert:` 列表下的，因此 id 行带缩进
    （`    - id: wallpaper-engine`）。用宽松匹配把每条都取出来。
  */
  const ids: string[] = []
  for (const line of text.split('\n')) {
    const match = /^\s*-\s+id:\s*['"]?(.+?)['"]?\s*$/u.exec(line)
    if (match?.[1] !== undefined) ids.push(match[1])
  }
  return [...new Set(ids)]
}

/**
 * 判断一个包是否为 **bundle**，并读出它的元信息。
 *
 * 官方 `dsh-plugin-manager` 的判据：`package.json` 里有 `dsh.bundle.patch` 就是
 * bundle（见其 `operations.ts` 的 `bundleManifest`）。
 *
 * @param profile - profile 目录。
 * @param name - 包名。
 * @returns 是否 bundle。
 */
async function isBundle(profile: string, name: string): Promise<boolean> {
  try {
    const manifest = JSON.parse(await readFile(join(profile, 'node_modules', ...name.split('/'), 'package.json'), 'utf8')) as {
      dsh?: { bundle?: { patch?: unknown } }
    }
    return typeof manifest.dsh?.bundle?.patch === 'string'
  } catch {
    return false
  }
}

/**
 * 启用/禁用一个 **bundle**：改 profile `package.json` 的 `dsh.profile.bundles`。
 *
 * ## 为什么 bundle 不能靠 patch 的 `disabled`
 *
 * 官方 `setBundleEnabled` 的做法是把这个包从 `bundles` 数组里增删——bundle 是一整层
 * 组合补丁，`disabled` 只能作用于单个 entry，去掉整个 bundle 层才是「不加载它」的
 * 语义。真机验证过：对 `dsh-plugin-wallpaper-engine` 写 patch 的 `disabled` 完全不
 * 生效，正是因为它属于 bundle 层。
 *
 * 与官方保持一致：启用时追加到数组末尾；禁用时从数组移除。写入前做原子替换，
 * 避免半份 JSON。
 *
 * @param profile - profile 目录。
 * @param name - 包名。
 * @param enabled - 目标状态。
 * @returns 是否成功。
 */
async function setBundleEnabled(profile: string, name: string, enabled: boolean): Promise<{ ok: boolean, error?: string }> {
  const manifestPath = join(profile, 'package.json')
  let manifest: Record<string, unknown> & { dsh?: { profile?: { bundles?: string[] } } }
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as typeof manifest
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }

  const previous = manifest.dsh?.profile?.bundles ?? []
  const next = enabled
    ? (previous.includes(name) ? previous : [...previous, name])
    : previous.filter(item => item !== name)

  if (JSON.stringify(previous) === JSON.stringify(next)) return { ok: true }

  manifest.dsh = {
    ...manifest.dsh,
    profile: { ...manifest.dsh?.profile, bundles: next },
  }
  try {
    await writeAtomic(manifestPath, `${JSON.stringify(manifest, undefined, 2)}\n`)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
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

  /*
    **bundle 走 `package.json`，非 bundle 才走 patch。**

    这与官方 `dsh-plugin-manager` 的分工一致（`setBundleEnabled` vs
    `setPluginEnabled`）：bundle 是一整层组合补丁，只有把它从 `dsh.profile.bundles`
    里增删才真正「不加载」；写 patch 的 `disabled` 对它无效——真机验证过。
  */
  const profileDirectory = resolveRepairEnvironment()?.profileDirectory
  if (profileDirectory !== undefined && await isBundle(profileDirectory, name)) {
    return setBundleEnabled(profileDirectory, name, enabled)
  }

  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    /*
      读不到时不要写 `[]`。

      真实文件是「三行 `#` 注释 + `- ` 列表」，而不是 `[]`——两者是不同的 YAML
      语法（flow sequence vs block sequence），混用会让写回的内容与原文件风格
      不一致，也丢掉那几行说明。这里给一份与官方同构的骨架。
    */
    text = DEFAULT_PATCH_SKELETON
  }

  try {
  const entries = parsePatchEntries(text)
  // name 非空时按 name 匹配；只有 id 的条目按 id 匹配（见下方 byId）。
  const targets = entries.filter(entry => entry.name !== '' && entry.name === name)
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
  /*
    匹配顺序：
      1. 按 `name` 匹配（patch 里直接写过该包的 name）；
      2. 按包名当 id 匹配（少数插件 id 恰好等于包名）；
      3. **读该包自己的 bundle patch，按它声明的真实 entry id 匹配**——这是
         `dsh-plugin-wallpaper-engine` 这类 bundle 唯一的正确路径。

    三者都没有才报错。
  */
  const byName = targets.length > 0
  const byId = entries.filter(entry => entry.id === name)
  let matchedIds = new Set((byName ? targets : byId).map(entry => entry.id))

  if (matchedIds.size === 0) {
    const profile = resolveRepairEnvironment()?.profileDirectory
    if (profile !== undefined) {
      const declared = await resolveEntryIds(profile, name)
      /*
        这些 id 通常**还不在** profile patch 里（它们由 bundle 层声明），所以不能
        只在「已有条目」里找。直接按它们追加禁用指令：loader 会把同 id 的补丁层
        叠加到 bundle 层的对应条目上。

        启用时则相反——把已有的这些 id 条目去掉 disabled。
      */
      matchedIds = new Set(declared)
    }
  }

  if (matchedIds.size === 0) {
    return { ok: false, error: 'entry-not-found' }
  }

  /*
    需要处理「id 尚不在 patch 中」的情形：为每个缺失的 id 追加一条
    `- id: X / disabled: true`（禁用），或什么都不做（启用时本来就该没有）。
  */
  const presentIds = new Set(entries.map(entry => entry.id))
  const missingIds = [...matchedIds].filter(id => !presentIds.has(id))

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
  const cleaned = dedupeAppendedEntries(out)

  // 为尚不在 patch 中的 entry id 追加禁用指令（仅禁用时需要）。
  if (!enabled) {
    for (const id of missingIds) {
      cleaned.push(`- id: ${id}`, '  disabled: true')
    }
  }
  const updated = cleaned.join('\n')
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
