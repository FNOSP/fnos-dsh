import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { copyTrimCliSkill } from '../src/install-callback-helper/common.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('copyTrimCliSkill', () => {
  it('copies the packaged skill into the user agents directory and removes stale files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fnos-trim-cli-skill-'))
    temporaryRoots.push(root)
    const packageDirectory = join(root, 'node_modules', '@trimjs', 'trim-cli')
    const skillDirectory = join(packageDirectory, 'skill')
    const targetDirectory = join(root, 'home', '.agents', 'skills', 'trim-cli')
    await mkdir(skillDirectory, { recursive: true })
    await writeFile(join(skillDirectory, 'SKILL.md'), 'latest skill')
    await mkdir(targetDirectory, { recursive: true })
    await writeFile(join(targetDirectory, 'stale.md'), 'stale')

    await copyTrimCliSkill(packageDirectory, targetDirectory)

    await expect(readFile(join(targetDirectory, 'SKILL.md'), 'utf8')).resolves.toBe('latest skill')
    await expect(readFile(join(targetDirectory, 'stale.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('creates the target skill directory when it does not exist', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fnos-trim-cli-skill-'))
    temporaryRoots.push(root)
    const packageDirectory = join(root, 'node_modules', '@trimjs', 'trim-cli')
    const skillDirectory = join(packageDirectory, 'skill')
    const targetDirectory = join(root, 'home', '.agents', 'skills', 'trim-cli')
    await mkdir(skillDirectory, { recursive: true })
    await writeFile(join(skillDirectory, 'SKILL.md'), 'latest skill')

    await copyTrimCliSkill(packageDirectory, targetDirectory)

    await expect(readFile(join(targetDirectory, 'SKILL.md'), 'utf8')).resolves.toBe('latest skill')
  })
})
