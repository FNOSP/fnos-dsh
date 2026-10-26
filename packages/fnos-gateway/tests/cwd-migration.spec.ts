import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  migrateProfileDirectory,
  removeCwdClauses,
} from '../src/install-callback-helper/cwd-migration.ts'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function profileWith(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'fnos-cwd-migration-'))
  roots.push(root)
  for (const [name, body] of Object.entries(files)) await writeFile(join(root, name), body, 'utf8')
  return root
}

const CLAUSE = 'Your working directory is {{' + 'cwd' + '}}.'

describe('removeCwdClauses', () => {
  it('FNOS-031-01-AC-03: 移除整句并保留同字段的其余文本', () => {
    const input = `${CLAUSE} Always answer in Chinese. Be concise.`
    const result = removeCwdClauses(input)
    expect(result.removed).toBe(1)
    expect(result.text).toBe('Always answer in Chinese. Be concise.')
  })

  it('移除整行，不留下残句', () => {
    const input = `You are a coding agent.\n${CLAUSE}\nUse tools when needed.`
    const result = removeCwdClauses(input)
    expect(result.text).toBe('You are a coding agent.\nUse tools when needed.')
  })

  it('多处引用全部移除并计数', () => {
    const input = `${CLAUSE} ${CLAUSE}`
    const result = removeCwdClauses(input)
    expect(result.removed).toBe(2)
  })

  it('未命中时原样返回且不改动', () => {
    const input = 'You are a coding agent. Workspace {{model}}.'
    const result = removeCwdClauses(input)
    expect(result.removed).toBe(0)
    expect(result.text).toBe(input)
  })

  it('不破坏 YAML 单引号结构（实测缺陷回归）', () => {
    const input = "personaSuffix: 'Your working directory is {{" + "cwd" + "}}. Reply briefly.'"
    const result = removeCwdClauses(input)
    const quoteCount = (result.text.match(/'/gu) ?? []).length
    // 引号必须成对（偶数）：YAML 结构未被破坏
    expect(quoteCount % 2, `引号必须成对，实际输出：${result.text}`).toBe(0)
    expect(result.text).toBe("personaSuffix: 'Reply briefly.'")
    expect(result.text).not.toContain('{{')
  })

  it('不误伤包含 cwd 字样的普通文本', () => {
    const input = 'Change directory with cd. The cwd is implicit.'
    expect(removeCwdClauses(input)).toEqual({ text: input, removed: 0 })
  })

  it('PLAN-FNOS-031-T02-02: 多行文本只移除目标子句，其它变量引用与文本逐字保留', () => {
    const input = [
      'You are a coding agent.',
      `${CLAUSE} Workspace {{model}} must stay.`,
      'Use tools when needed.',
    ].join('\n')
    const result = removeCwdClauses(input)
    expect(result.removed).toBe(1)
    expect(result.text).toBe([
      'You are a coding agent.',
      'Workspace {{model}} must stay.',
      'Use tools when needed.',
    ].join('\n'))
  })

  it('整段只有目标子句时清空字段值而不留残句', () => {
    const input = `personaSuffix: '${CLAUSE}'`
    const result = removeCwdClauses(input)
    expect(result.removed).toBe(1)
    expect(result.text).toBe("personaSuffix: ''")
  })
})

describe('migrateProfileDirectory', () => {
  it('FNOS-031-02-AC-01: 改写前写带时间戳备份，内容等于原文', async () => {
    const body = `# persona\npersonaSuffix: '${CLAUSE} Reply briefly.'\n`
    const root = await profileWith({ 'cordis.patch.yml': body })

    const result = await migrateProfileDirectory(root)
    expect(result.removed).toBe(1)
    expect(result.rewritten).toBe(1)

    const files = await readdir(root)
    const backup = files.find(name => name.startsWith('cordis.patch.yml.fnos-migrate.bak-'))
    expect(backup, '应写备份文件').toBeDefined()
    expect(await readFile(join(root, backup!), 'utf8')).toBe(body)

    const migrated = await readFile(join(root, 'cordis.patch.yml'), 'utf8')
    expect(migrated).toContain('Reply briefly.')
    expect(migrated).not.toContain('{{')
  })

  it('FNOS-031-02-AC-02: 未命中时不改内容、不改 mtime、不写备份', async () => {
    const body = 'personaSuffix: Reply briefly.\n'
    const root = await profileWith({ 'cordis.patch.yml': body })
    const before = await stat(join(root, 'cordis.patch.yml'))

    const result = await migrateProfileDirectory(root)
    expect(result).toEqual({ rewritten: 0, removed: 0, skipped: [] })

    expect(await readFile(join(root, 'cordis.patch.yml'), 'utf8')).toBe(body)
    expect((await stat(join(root, 'cordis.patch.yml'))).mtimeMs).toBe(before.mtimeMs)
    expect((await readdir(root)).filter(name => name.includes('fnos-migrate'))).toEqual([])
  })

  it('FNOS-031-02-AC-03: 幂等——二次执行不再改动、不新增备份', async () => {
    const root = await profileWith({ 'cordis.patch.yml': `personaSuffix: '${CLAUSE} Reply briefly.'\n` })
    await migrateProfileDirectory(root)
    const afterFirst = await readFile(join(root, 'cordis.patch.yml'), 'utf8')
    const backupsAfterFirst = (await readdir(root)).filter(name => name.includes('fnos-migrate')).length

    const second = await migrateProfileDirectory(root)
    expect(second).toEqual({ rewritten: 0, removed: 0, skipped: [] })
    expect(await readFile(join(root, 'cordis.patch.yml'), 'utf8')).toBe(afterFirst)
    expect((await readdir(root)).filter(name => name.includes('fnos-migrate')).length).toBe(backupsAfterFirst)
  })

  it('处理 package.json 里的 persona 字段', async () => {
    const manifest = {
      name: 'profile',
      dsh: { profile: { bundles: [], personaSuffix: `${CLAUSE} Reply briefly.` } },
    }
    const root = await profileWith({ 'package.json': JSON.stringify(manifest, null, 2) })

    const result = await migrateProfileDirectory(root)
    expect(result.removed).toBe(1)
    const migrated = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as typeof manifest
    expect(migrated.dsh.profile.personaSuffix).toBe('Reply briefly.')
  })

  it('PLAN-FNOS-031-T02-02: package.json 只改 persona 值，其余字段与格式逐字保留', async () => {
    const before = [
      '{',
      '  "name": "profile",',
      '  "private": true,',
      '  "dependencies": {',
      '    "dshmarket": "1.66.47"',
      '  },',
      '  "dsh": {',
      '    "profile": {',
      '      "bundles": [',
      '        "search",',
      '        "pet"',
      '      ],',
      `      "personaSuffix": "${CLAUSE} Reply briefly."`,
      '    }',
      '  }',
      '}',
      '',
    ].join('\n')
    const root = await profileWith({ 'package.json': before })

    const result = await migrateProfileDirectory(root)
    expect(result.removed).toBe(1)

    // 除被移除的子句外，其余行（字段、顺序、缩进）逐字不变
    const after = await readFile(join(root, 'package.json'), 'utf8')
    expect(after).toBe(before.replace(`${CLAUSE} `, ''))
  })

  it('文件缺失时不报错', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fnos-cwd-migration-empty-'))
    roots.push(root)
    expect(await migrateProfileDirectory(root)).toEqual({ rewritten: 0, removed: 0, skipped: [] })
  })

  it('损坏的 JSON 只告警并跳过，不影响其它文件与调用方', async () => {
    const root = await profileWith({
      'package.json': '{ not json',
      'cordis.patch.yml': `personaSuffix: '${CLAUSE} Reply briefly.'\n`,
    })
    const result = await migrateProfileDirectory(root)
    expect(result.skipped.length).toBe(1)
    expect(result.skipped[0]).toContain('package.json')
    // 另一个文件仍被迁移
    expect(result.removed).toBe(1)
    // 损坏文件保持原样
    expect(await readFile(join(root, 'package.json'), 'utf8')).toBe('{ not json')
  })
})
