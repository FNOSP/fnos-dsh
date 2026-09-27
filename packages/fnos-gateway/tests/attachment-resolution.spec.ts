import { mkdir, writeFile } from 'node:fs/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { findPackageDirectory } from '../src/install-callback-helper/common.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('findPackageDirectory', () => {
  it('resolves a production dependency nested under a DSH bundle', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fnos-package-resolution-'))
    temporaryRoots.push(root)
    const packageDirectory = join(root, 'node_modules', '@deepseek-ai', 'dsh-base', 'node_modules', '@deepseek-ai', 'dsh-attachment-local')
    await mkdir(packageDirectory, { recursive: true })
    await writeFile(join(packageDirectory, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-attachment-local' }))

    await expect(findPackageDirectory(join(root, 'node_modules'), '@deepseek-ai/dsh-attachment-local'))
      .resolves.toBe(packageDirectory)
  })

  it('does not resolve a package outside the DSH dependency root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fnos-package-resolution-'))
    temporaryRoots.push(root)
    const outside = join(root, 'outside', '@deepseek-ai', 'dsh-attachment-local')
    await mkdir(outside, { recursive: true })
    await writeFile(join(outside, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-attachment-local' }))

    await expect(findPackageDirectory(join(root, 'node_modules'), '@deepseek-ai/dsh-attachment-local'))
      .resolves.toBeUndefined()
  })
})
