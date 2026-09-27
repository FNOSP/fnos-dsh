import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { patchDshAttachmentLocal } from '../src/install-callback-helper/attachment-patch.ts'

const temporaryRoots: string[] = []
const originalEnvironment = {
  packageDirectory: process.env.DSH_ATTACHMENT_LOCAL_DIR,
  packageVersion: process.env.DSH_ATTACHMENT_LOCAL_VERSION,
  trimPkgvar: process.env.TRIM_PKGVAR,
}

afterEach(async () => {
  process.env.DSH_ATTACHMENT_LOCAL_DIR = originalEnvironment.packageDirectory
  process.env.DSH_ATTACHMENT_LOCAL_VERSION = originalEnvironment.packageVersion
  process.env.TRIM_PKGVAR = originalEnvironment.trimPkgvar
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function createPackage(source: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'fnos-attachment-patch-'))
  temporaryRoots.push(root)
  await mkdir(join(root, 'lib'), { recursive: true })
  await writeFile(join(root, 'package.json'), JSON.stringify({
    name: '@deepseek-ai/dsh-attachment-local',
    version: '0.1.7-rc.2',
  }))
  await writeFile(join(root, 'lib', 'index.js'), source)
  return root
}

function targetSource(): string {
  return `import { dirname, join, parse, resolve } from "node:path";
const durableHomes = new Set();
async function ensureDurableHome(path) {
\tconst home = resolve(path);
\tif (!durableHomes.has(home)) {
\t\tawait ensureDurableDirectory(home, parse(home).root);
\t\tdurableHomes.add(home);
\t}
\treturn home;
}
class LocalAttachmentStore {
\tconstructor(ctx, config) {
\t\tconst dshHome = resolveDshHome(config.dshHome);
\t\tthis.root = join(dshHome, "attachments", "v1");
\t\tthis.cacheRoot = dshCachePath({ dshHome }, "attachments");
\t}
}`
}

describe('patchDshAttachmentLocal', () => {
  it('patches the 0.1.7 root and cache anchors and is idempotent', async () => {
    const packageDirectory = await createPackage(targetSource())
    process.env.DSH_ATTACHMENT_LOCAL_DIR = packageDirectory
    process.env.DSH_ATTACHMENT_LOCAL_VERSION = '0.1.7-rc.2'
    process.env.TRIM_PKGVAR = '/var/packages/fn-deepseek-harness/var'

    await patchDshAttachmentLocal()
    const indexPath = join(packageDirectory, 'lib', 'index.js')
    const first = await readFile(indexPath, 'utf8')
    expect(first).toContain('const attachmentHome = process.env.TRIM_PKGVAR || config.dshHome;')
    expect(first).toContain('this.cacheRoot = dshCachePath({ dshHome }, "attachments");')
    expect(first).toContain('attachment-local: TRIM_PKGVAR is not an ancestor')

    await patchDshAttachmentLocal()
    expect(await readFile(indexPath, 'utf8')).toBe(first)
  })

  it('does not write a partial patch when a target anchor is missing', async () => {
    const packageDirectory = await createPackage('export const broken = true\n')
    process.env.DSH_ATTACHMENT_LOCAL_DIR = packageDirectory
    process.env.DSH_ATTACHMENT_LOCAL_VERSION = '0.1.7-rc.2'
    process.env.TRIM_PKGVAR = '/var/packages/fn-deepseek-harness/var'
    const indexPath = join(packageDirectory, 'lib', 'index.js')
    const before = await readFile(indexPath, 'utf8')

    await expect(patchDshAttachmentLocal()).rejects.toThrow('path imports expected one match')
    expect(await readFile(indexPath, 'utf8')).toBe(before)
  })
})
