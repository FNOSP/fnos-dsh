/**
 * DSH 0.2.1 移除了内置提示词变量 `cwd`，含该引用的旧 profile 会在提示词组装阶段抛错，
 * 表现为「发消息没有任何响应」。本模块在升级时把该引用从用户 profile 里移除（FNOS-031）。
 *
 * 两个实现约束都来自上游口径：
 *
 * 1. **移除整个子句，而不是只删变量名**。上游 README 的原话是
 *    "Remove the `Your working directory is {{cwd}}.` clause … preserving unrelated text"。
 *    只删变量名会留下 `Your working directory is .` 这类残句，仍然污染提示词。
 * 2. **不猜测式改写**。解析不出结构、或字段形态与预期不同时跳过并告警——用户的 profile
 *    是他自己的数据，改错比不改更难排查。
 *
 * 迁移是**可失败且不阻塞安装**的：任何异常都只记 ERROR，原文件保持不变。
 *
 * @module install-callback-helper/cwd-migration
 */

import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { readJsonStrict } from './common.ts'
import { createLogger, fail } from './logger.ts'

const logger = createLogger('cwd-prompt-migration')

/** 待迁移的变量名。只处理这一个——其它变量缺少上游权威口径，不猜测。 */
const VARIABLE = 'cwd'

/** 备份文件后缀；带时间戳避免覆盖历史备份。 */
const BACKUP_SUFFIX = '.fnos-migrate.bak'

/** profile 里可能承载 persona 字段的文件，按处理顺序。 */
const CANDIDATE_FILES = ['cordis.patch.yml', 'package.json'] as const

/** 一次迁移的结果。 */
export interface MigrationResult {
  /** 被改写的文件数。 */
  readonly rewritten: number
  /** 移除的引用处数。 */
  readonly removed: number
  /** 跳过并告警的文件（`文件名: 原因`）。 */
  readonly skipped: readonly string[]
}

/** 一个文件的迁移结果。 */
interface FileOutcome {
  readonly rewritten: number
  readonly removed: number
}

/** 无状态判定用（`g` 标志会让 `test` 残留 lastIndex，导致偶发漏判）。 */
const HAS_REFERENCE = new RegExp('\\{\\{' + VARIABLE + '\\}\\}', 'u')
/** 迭代切除用。 */
const REFERENCE = new RegExp('\\{\\{' + VARIABLE + '\\}\\}', 'gu')

/**
 * 移除含变量的子句，保留其余文本。
 *
 * 两条实测得来的约束：
 *
 * 1. **不吞引号/括号**。YAML 的单双引号属于容器结构而不是句子内容；误删会留下不成对的
 *    引号并损坏 profile（实测：`'... {{cwd}}. Reply.'` 变成 `Reply.'`）。
 * 2. **保护行首结构前缀**。YAML 行形如 `key: 'value'`，而 `key: ` 之前没有句末标点，
 *    若直接「向左扩到句界」会把 `key: '` 一起吃掉。因此先剥离出结构前缀与包裹引号，
 *    只在**值本体**上做子句切除，最后原样拼回。
 *
 * 子句被删空时：值本体留空、该行整体删除。
 * @param text - 原始字段值（可以是多行 YAML 片段）。
 * @returns 改写后的值与移除的处数。
 */
export function removeCwdClauses(text: string): { text: string, removed: number } {
  if (!HAS_REFERENCE.test(text)) return { text, removed: 0 }

  let removed = 0
  const kept: string[] = []

  for (const line of text.split('\n')) {
    if (!HAS_REFERENCE.test(line)) {
      kept.push(line)
      continue
    }
    // 保护行首结构：`<缩进><key>:` + 可选空白 + 可选开引号
    const prefixMatch = /^(\s*(?:[\w.-]+\s*:\s*)?)(['"]?)(.*)$/u.exec(line)
    const prefix = prefixMatch?.[1] ?? ''
    const quote = prefixMatch?.[2] ?? ''
    let body = prefixMatch?.[3] ?? line

    for (;;) {
      REFERENCE.lastIndex = 0
      const match = REFERENCE.exec(body)
      if (match === null) break
      const at = match.index

      let start = at
      while (start > 0 && !/[.!?。！？]/u.test(body[start - 1] ?? '')) start -= 1
      let end = at
      while (end < body.length && !/[.!?。！？]/u.test(body[end] ?? '')) end += 1
      if (end < body.length) end += 1

      let left = start
      while (left > 0 && /[ \t]/u.test(body[left - 1] ?? '')) left -= 1
      let right = end
      while (right < body.length && /[ \t]/u.test(body[right] ?? '')) right += 1

      body = body.slice(0, left) + body.slice(right)
      removed += 1
    }

    const trimmedBody = body.replace(/[ \t]+$/u, '')
    if (trimmedBody.trim() === '') {
      // 值被删空：只保留结构前缀（无值时连该行一起丢）
      if (prefix.trim() === '') continue
      kept.push(prefix.replace(/[ \t]+$/u, ''))
    } else {
      kept.push(prefix + quote + trimmedBody)
    }
  }

  return { text: kept.join('\n'), removed }
}

/** 递归遍历结构，对每个字符串值尝试移除变量引用。 */
function migrateValue(value: unknown): { value: unknown, removed: number } {
  if (typeof value === 'string') {
    const outcome = removeCwdClauses(value)
    return { value: outcome.text, removed: outcome.removed }
  }
  if (Array.isArray(value)) {
    let removed = 0
    const next = value.map((item) => {
      const outcome = migrateValue(item)
      removed += outcome.removed
      return outcome.value
    })
    return { value: next, removed }
  }
  if (value !== null && typeof value === 'object') {
    let removed = 0
    const next: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const outcome = migrateValue(item)
      removed += outcome.removed
      next[key] = outcome.value
    }
    return { value: next, removed }
  }
  return { value, removed: 0 }
}

/** 原子写：先写临时文件再 rename，避免中断留下半个文件。 */
async function atomicWrite(path: string, source: string): Promise<void> {
  const temporary = path + '.fnos-migrate.tmp'
  await writeFile(temporary, source, 'utf8')
  try {
    await rename(temporary, path)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

/** 备份文件名后缀，用于回溯（FNOS-031-02-AC-01）。 */
function backupStamp(): string {
  const now = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '-',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('')
}

/** 写备份并原子覆盖原文件。 */
async function rewriteWithBackup(path: string, original: string, next: string, removed: number): Promise<FileOutcome> {
  await writeFile(path + BACKUP_SUFFIX + '-' + backupStamp(), original, 'utf8')
  await atomicWrite(path, next)
  logger.info('Removed ' + String(removed) + ' ' + VARIABLE + ' reference(s) from ' + basename(path) + '.')
  return { rewritten: 1, removed }
}

/** 迁移一个 JSON 文件；未命中时不写文件，保持内容与 mtime 不变。 */
async function migrateJsonFile(path: string): Promise<FileOutcome> {
  const parsed = migrateValue(await readJsonStrict(path))
  if (parsed.removed === 0) return { rewritten: 0, removed: 0 }
  const original = await readFile(path, 'utf8')
  const next = JSON.stringify(parsed.value, null, 2) + '\n'
  return await rewriteWithBackup(path, original, next, parsed.removed)
}

/** 迁移一个纯文本文件；未命中时不写文件。 */
async function migrateTextFile(path: string): Promise<FileOutcome> {
  const original = await readFile(path, 'utf8')
  const migrated = removeCwdClauses(original)
  if (migrated.removed === 0) return { rewritten: 0, removed: 0 }
  return await rewriteWithBackup(path, original, migrated.text, migrated.removed)
}

/**
 * 迁移一个 profile 目录里可能引用该变量的文件。
 *
 * 文件不存在视为未命中；读取或写入失败只告警并跳过该文件，不影响其它文件与安装流程。
 * @param profileDirectory - profile 根目录（通常是 TRIM_PKGHOME/profiles/web）。
 * @returns 汇总结果，供 shell 侧记录日志。
 */
export async function migrateProfileDirectory(profileDirectory: string): Promise<MigrationResult> {
  const skipped: string[] = []
  let rewritten = 0
  let removed = 0

  for (const name of CANDIDATE_FILES) {
    const path = join(profileDirectory, name)
    try {
      const info = await stat(path)
      if (!info.isFile()) continue
      const outcome = name.endsWith('.json') ? await migrateJsonFile(path) : await migrateTextFile(path)
      rewritten += outcome.rewritten
      removed += outcome.removed
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') continue
      const message = error instanceof Error ? error.message : String(error)
      skipped.push(name + ': ' + message)
      logger.error('Skipped ' + name + ': ' + message)
    }
  }

  if (removed === 0) logger.info('No ' + VARIABLE + ' prompt variable reference found.')
  return { rewritten, removed, skipped }
}

/**
 * CLI 入口：迁移 DSH_PROFILE_DIRECTORY 指向的 profile。
 *
 * 只要求环境变量存在；迁移本身的失败已被逐文件吸收，因此这里不会让安装失败。
 */
export async function migrateCwdPromptVariable(): Promise<void> {
  const profileDirectory = process.env.DSH_PROFILE_DIRECTORY
  if (!profileDirectory) return fail('cwd-prompt-migration', 'DSH_PROFILE_DIRECTORY is required')

  const result = await migrateProfileDirectory(profileDirectory)
  process.stdout.write(
    'cwd-migration: rewritten=' + String(result.rewritten) + ' removed=' + String(result.removed) + ' skipped=' + String(result.skipped.length) + '\n',
  )
}
