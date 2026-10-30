import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { installSkillIfAbsent } from '../src/install-callback-helper/common.ts'

/**
 * 随包 skill 的安装语义（FNOS-041）。
 *
 * 三条必须同时成立，否则会伤到用户：
 *
 *  1. 用户没装过 → 装一份（含 `scripts/` 里的启动器与可执行权限）；
 *  2. 用户装过 → **整目录跳过**，既不覆盖也不合并（用户可能自己升级或改过）；
 *  3. 随包目录不完整 → 明确报错，而不是装一个空壳把后续安装永久跳过。
 */

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'fnos-install-skill-'))
  temporaryRoots.push(root)
  return root
}

async function makeBundledSkill(root: string): Promise<string> {
  const source = join(root, 'app', 'skills', 'fnos-cli')
  await mkdir(join(source, 'scripts'), { recursive: true })
  await writeFile(join(source, 'SKILL.md'), 'bundled skill')
  await writeFile(join(source, 'scripts', 'fnos-cli'), '#!/bin/sh\n', { mode: 0o755 })
  return source
}

describe('installSkillIfAbsent', () => {
  it('installs the bundled skill when the user has none', async () => {
    const root = await makeRoot()
    const source = await makeBundledSkill(root)
    const target = join(root, 'home', '.agents', 'skills', 'fnos-cli')

    await expect(installSkillIfAbsent(source, target)).resolves.toBe('installed')

    await expect(readFile(join(target, 'SKILL.md'), 'utf8')).resolves.toBe('bundled skill')
    await expect(readFile(join(target, 'scripts', 'fnos-cli'), 'utf8')).resolves.toContain('#!/bin/sh')
    // 启动器必须保持可执行，否则首次调用会以「权限不足」失败。
    expect((await stat(join(target, 'scripts', 'fnos-cli'))).mode & 0o111).toBeGreaterThan(0)
  })

  it('keeps a user-installed skill untouched and reports skipped', async () => {
    const root = await makeRoot()
    const source = await makeBundledSkill(root)
    const target = join(root, 'home', '.agents', 'skills', 'fnos-cli')
    await mkdir(target, { recursive: true })
    await writeFile(join(target, 'SKILL.md'), 'user version')

    await expect(installSkillIfAbsent(source, target)).resolves.toBe('skipped')

    // 不覆盖、不合并：用户那份原样保留。
    await expect(readFile(join(target, 'SKILL.md'), 'utf8')).resolves.toBe('user version')
    await expect(stat(join(target, 'scripts', 'fnos-cli'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('treats an empty skill directory as already installed', async () => {
    // 上一次安装中断留下的空目录也算「存在」，不覆盖它——否则会掩盖失败现场。
    const root = await makeRoot()
    const source = await makeBundledSkill(root)
    const target = join(root, 'home', '.agents', 'skills', 'fnos-cli')
    await mkdir(target, { recursive: true })

    await expect(installSkillIfAbsent(source, target)).resolves.toBe('skipped')
  })

  it('rejects a bundled skill without SKILL.md', async () => {
    const root = await makeRoot()
    const source = join(root, 'app', 'skills', 'empty-skill')
    await mkdir(source, { recursive: true })
    const target = join(root, 'home', '.agents', 'skills', 'empty-skill')

    await expect(installSkillIfAbsent(source, target)).rejects.toThrow(/no SKILL\.md/u)
    await expect(stat(target)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('creates the skills parent directory when missing', async () => {
    const root = await makeRoot()
    const source = await makeBundledSkill(root)
    const target = join(root, 'home', '.agents', 'skills', 'fnos-cli')

    await expect(installSkillIfAbsent(source, target)).resolves.toBe('installed')
    await expect(readFile(join(target, 'SKILL.md'), 'utf8')).resolves.toBe('bundled skill')
  })

  it('leaves no temporary directory behind', async () => {
    const root = await makeRoot()
    const source = await makeBundledSkill(root)
    const target = join(root, 'home', '.agents', 'skills', 'fnos-cli')

    await installSkillIfAbsent(source, target)

    const { readdir } = await import('node:fs/promises')
    const entries = await readdir(join(root, 'home', '.agents', 'skills'))
    expect(entries).toEqual(['fnos-cli'])
  })
})
