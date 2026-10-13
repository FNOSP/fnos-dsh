/**
 * 浏览器自动化技能的内置分发（FNOS-013-13）。
 *
 * 插件在 `apply()` 中向 `ctx.skills.registerProvider()` 注册一个 SkillProvider，
 * 把包内 `skills/` 目录下的技能随插件分发出去——用户装完插件即可在会话里用
 * Midscene 技能，无需另行执行技能安装命令。注册随 Cordis 效果注销：插件卸载
 * 或 HMR 时技能同步消失（AC-03）。
 *
 * **不写入用户技能目录**（需求行为约束）：技能只在注册表里存在，宿主自己的
 * 发现优先级负责共存——项目目录 > 用户目录 > 插件注册，因此用户自行安装的
 * 同名技能天然胜出（AC-04），插件不覆盖也不重复提示。
 */
import { existsSync } from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SkillCandidate, SkillDefinition, SkillLookupOptions, SkillProvider, SkillRegistry } from '@deepseek-ai/dsh-skill'

/** SkillProvider 在注册表里的名字。 */
export const SKILL_PROVIDER_NAME = 'dsh-midscene'

/**
 * 插件注入的环境说明（**不改上游技能文件**）。
 *
 * 内置的官方 Midscene 技能原样保留——它们的「模型配置」节教 agent 去申请 Gemini／豆包等
 * 第三方 API key，那是 Midscene 的通用用法。但在本插件提供的环境里，模型来自 DSH：桥托管
 * 一个本地 OpenAI 兼容端点，用 DSH 已配置的模型，**不需要任何第三方密钥**。
 *
 * 因此分发时在正文前注入这段说明，让 agent 先看到「本环境用桥」再读官方原文。这样两边都
 * 成立：磁盘上的技能文件与上游**逐字节一致**（可核对、升级时直接覆盖），而 agent 收到的
 * 内容带上了环境约束。若把说明写进文件，就又是一份需要重新施加的补丁。
 */
export const BRIDGE_PRELUDE = `> **本环境说明（由 DSH Midscene 插件注入，非上游内容）**
>
> 本技能运行在 DeepSeek Harness 中，**模型由 DSH Midscene Bridge 提供**：
>
> - 配置是**固定四行**，基址指向本地桥、模型名固定 \`dsh-model\`、密钥是**桥的接入密钥**
>   （不是任何模型服务商的 key）。一条命令即可生成：
>   \`curl -s "http://127.0.0.1:<端口>/v1/midscene-env"\`（端口以 \`GET /v1/health\` 的 \`port\` 字段为准）。
> - **不要向用户索要模型 API key，也不要引导用户去申请第三方模型。** 本文档中出现的服务商、
>   模型与 key 示例仅作背景知识；实际使用哪个模型由桥决定。
> - 需要浏览器桥接模式时同样走桥：Midscene 侧的模型配置始终是上面这四行。
>
> 以下为上游原文。`


/**
 * 包内技能目录。
 *
 * 目录位置相对**包根**固定为 `skills/`，但本文件在两处位置运行：
 * - 构建产物：`lib/index.js` → 包根 → `skills/`（`../skills/`）；
 * - 源码（单测、开发态直接加载）：`src/host/skills.ts` → `../../skills/`。
 *
 * 因此逐个候选探测，取第一个真实存在的目录；都不存在时回落产物路径（让
 * 「技能缺失」表现为空列表而不是路径异常）。用 URL 解析而不是 `process.cwd()`，
 * 插件被装到任意 profile 目录下都能定位到自己包内的技能。
 * @returns 技能目录绝对路径。
 */
export function bundledSkillsDir(): string {
  const candidates = [
    fileURLToPath(new URL('../skills/', import.meta.url)),
    fileURLToPath(new URL('../../skills/', import.meta.url)),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return candidates[0]!
}

/** 技能候选的 frontmatter 字段（只读取分发所需的那几个）。 */
interface SkillFrontmatter {
  name?: string
  description?: string
}

/**
 * 解析 SKILL.md 的 YAML frontmatter。
 *
 * 只做行级解析：技能 frontmatter 是上游维护的简单结构，引入 YAML 解析器只为读两个
 * 字段不划算；解析不出来的字段留空，由后续校验兜底。
 *
 * **必须支持块标量**（`description: |` 与 `description: >`）：上游技能的多行描述都用
 * 这两种写法，而技能描述会在发现阶段进入模型上下文——只取行内值会把描述解析成字面量
 * `"|"` / `">"`，等于技能没有描述，模型无从判断该不该调用它。
 * @param source - SKILL.md 全文。
 * @returns 解析出的字段。
 */
export function parseFrontmatter(source: string): SkillFrontmatter {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(source)
  if (match === null) return {}
  const lines = match[1]!.split(/\r?\n/u)
  const result: SkillFrontmatter = {}

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!
    // 缩进行属于上一个字段的内容（块标量的正文）或嵌套映射，不作为顶层字段解析。
    if (/^\s/u.test(line)) continue
    const field = /^(name|description):\s*(.*)$/u.exec(line.trim())
    if (field === null) continue
    const key = field[1] as 'name' | 'description'
    const inline = field[2]!.trim()

    if (/^[|>][-+]?$/u.test(inline)) {
      const folded = inline.startsWith('>')
      const block: string[] = []
      for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
        const next = lines[cursor]!
        if (next.trim().length === 0) {
          block.push('')
          continue
        }
        if (!/^\s/u.test(next)) break
        block.push(next.replace(/^\s+/u, ''))
      }
      index += block.length
      // 折叠块（`>`）：单换行变空格、空行变段落分隔；字面量块（`|`）：保留换行。
      const text = folded
        ? block.join('\n').replace(/([^\n])\n(?!\n)/gu, '$1 ').trim()
        : block.join('\n').trim()
      if (text.length > 0) result[key] = text
      continue
    }

    const value = inline.replace(/^["']|["']$/gu, '')
    if (value.length > 0) result[key] = value
  }

  return result
}

/**
 * 列出包内技能候选。
 *
 * 一个技能是 `skills/<slug>/SKILL.md`；返回时按目录名排序，保证目录顺序稳定
 * （测试与界面呈现都依赖稳定的顺序）。
 *
 * `rank`（同名校验中的优先级）取 0：插件注册的技能在宿主发现优先级里本就排在
 * 项目目录与用户目录之后，同层内没有需要调节的相对次序。`locator` 用技能目录
 * 的 slug，`get()` 据此回读。
 * @param root - 技能根目录。
 * @returns 候选列表；目录不存在时为空。
 */
export async function listBundledSkills(root: string): Promise<SkillCandidate[]> {
  let entries: string[]
  try {
    entries = await readdir(root)
  } catch {
    return []
  }
  const candidates: SkillCandidate[] = []
  for (const slug of entries.sort()) {
    const skillFile = join(root, slug, 'SKILL.md')
    let source: string
    try {
      if (!(await stat(skillFile)).isFile()) continue
      source = await readFile(skillFile, 'utf8')
    } catch {
      continue
    }
    const frontmatter = parseFrontmatter(source)
    candidates.push({
      name: frontmatter.name ?? slug,
      description: frontmatter.description ?? '',
      // 指令文件路径：宿主用它做展示与项目根判定。
      path: skillFile,
      rank: 0,
      locator: slug,
      provider: SKILL_PROVIDER_NAME,
      source: 'bundled',
      invocation: { modelInvocable: true, userInvocable: true },
      // 相对资源（技能目录下的参考文件）以目录形式交给宿主解析。
      resourceBase: { kind: 'directory', path: join(root, slug) },
    })
  }
  return candidates
}

/**
 * 加载一个候选的完整技能定义。
 * @param root - 技能根目录。
 * @param candidate - 先前列出的候选。
 * @returns 技能定义；文件缺失时 `undefined`（宿主会按「不再可加载」处理）。
 */
export async function loadBundledSkill(root: string, candidate: SkillCandidate): Promise<SkillDefinition | undefined> {
  const slug = typeof candidate.locator === 'string'
    ? candidate.locator
    : basename(candidate.resourceBase?.kind === 'directory' ? candidate.resourceBase.path : candidate.name)
  const file = join(root, slug, 'SKILL.md')
  try {
    const upstream = await readFile(file, 'utf8')
    return {
      name: candidate.name,
      description: candidate.description,
      path: candidate.path ?? file,
      provider: candidate.provider,
      source: candidate.source,
      invocation: candidate.invocation,
      ...candidate.resourceBase === undefined ? {} : { resourceBase: candidate.resourceBase },
      // 注入环境说明：磁盘文件保持与上游逐字节一致，说明只在分发时附加（见 BRIDGE_PRELUDE）。
      content: `${BRIDGE_PRELUDE}\n\n${upstream}`,
    }
  } catch {
    return undefined
  }
}

/**
 * 构造包内技能提供方。
 * @param root - 技能根目录；默认取包内 `skills/`。
 * @returns SkillProvider。
 */
export function createBundledSkillProvider(root: string = bundledSkillsDir()): SkillProvider {
  return {
    name: SKILL_PROVIDER_NAME,
    list: async (_options: SkillLookupOptions) => await listBundledSkills(root),
    get: async (candidate: SkillCandidate, _options: SkillLookupOptions) => await loadBundledSkill(root, candidate),
  }
}

/**
 * 注册包内技能提供方。
 * @param skills - 宿主技能注册表。
 * @param root - 技能根目录；默认取包内 `skills/`。
 * @returns 注销函数（由 Cordis 效果托管）。
 */
export function registerBundledSkills(skills: SkillRegistry, root?: string): () => void {
  return skills.registerProvider(() => createBundledSkillProvider(root))
}
