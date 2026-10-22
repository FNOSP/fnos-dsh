import { afterEach, describe, expect, it } from 'vitest'
import { lstat, mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { materializeProfileCopy, normalizeLinkedPluginManifest } from '../src/core/local-profile.js'

/**
 * profile 侧插件副本的物化（local-profile 的「只改副本、不改源码」保证）。
 *
 * 这里用**真实文件系统**而不是 mock：`node:fs/promises` 被 mock 时，测试运行器自身
 * 的文件操作也会拿到假实现（曾经把 vitest worker 打到 OOM）。而且这段逻辑的价值恰恰
 * 在于「写穿软链会改到源码」——用真实软链才验得住。
 *
 * 场景：profile 用 `link:` 装仓库插件，`node_modules/<name>` 是指向源码目录的软链。
 * 归一化 peer 版本时若直接写穿软链，仓库 manifest 里的 `catalog:dsh` 就会被改回
 * 字面量——源码因此失去 catalog 形式，工作区也被一条本应只读源码的命令弄脏。
 */

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(async root => {
    const { rm } = await import('node:fs/promises')
    await rm(root, { recursive: true, force: true })
  }))
})

/** 建一个临时的「源码包」目录。 */
async function makeSource(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-local-profile-'))
  tempRoots.push(root)
  const source = join(root, 'source')
  await mkdir(join(source, 'lib'), { recursive: true })
  await mkdir(join(source, 'skills'), { recursive: true })
  await mkdir(join(source, 'node_modules'), { recursive: true })
  await writeFile(join(source, 'package.json'), `${JSON.stringify({
    name: '@tnnevol/dsh-demo',
    peerDependencies: { '@deepseek-ai/dsh-llm': 'catalog:dsh' },
  }, null, 2)}\n`, 'utf8')
  return source
}

/** 建一个 profile 侧的条目路径：软链到源码，或直接是目录。 */
async function makeLinkEntry(source: string, asSymlink: boolean): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-local-profile-'))
  tempRoots.push(root)
  const linkPath = join(root, 'node_modules', '@tnnevol', 'dsh-demo')
  await mkdir(join(linkPath, '..'), { recursive: true })
  if (asSymlink) {
    await symlink(source, linkPath)
  } else {
    await mkdir(linkPath, { recursive: true })
    await writeFile(join(linkPath, 'package.json'), '{"name":"@tnnevol/dsh-demo"}\n', 'utf8')
  }
  return linkPath
}

describe('materializeProfileCopy', () => {
  it('把软链条目换成真实目录：package.json 之外的内容软链回源码', async () => {
    const source = await makeSource()
    const linkPath = await makeLinkEntry(source, true)

    await materializeProfileCopy(linkPath)

    // 条目不再是软链，而是真实目录。
    expect((await lstat(linkPath)).isSymbolicLink()).toBe(false)
    expect((await lstat(linkPath)).isDirectory()).toBe(true)

    // 除 package.json 与 node_modules 外，每个条目都软链回源码。
    const entries = await readdir(linkPath)
    expect(entries.sort()).toEqual(['lib', 'skills'])
    expect((await lstat(join(linkPath, 'lib'))).isSymbolicLink()).toBe(true)
    expect((await lstat(join(linkPath, 'skills'))).isSymbolicLink()).toBe(true)
  })

  it('不改源码：源码目录内容保持原样', async () => {
    const source = await makeSource()
    const before = await readFile(join(source, 'package.json'), 'utf8')
    const linkPath = await makeLinkEntry(source, true)

    await materializeProfileCopy(linkPath)

    expect(await readFile(join(source, 'package.json'), 'utf8')).toBe(before)
    expect((await lstat(source)).isDirectory()).toBe(true)
    expect((await lstat(join(source, 'lib'))).isDirectory()).toBe(true)
  })

  it('已经是真实目录时不动它', async () => {
    const linkPath = await makeLinkEntry(await makeSource(), false)
    const before = await readdir(linkPath)

    await materializeProfileCopy(linkPath)

    expect(await readdir(linkPath)).toEqual(before)
    expect((await lstat(linkPath)).isSymbolicLink()).toBe(false)
  })
})

describe('normalizeLinkedPluginManifest', () => {
  it('把 profile 副本的 peer 归一化为运行时基线，源码 manifest 不受影响', async () => {
    const source = await makeSource()
    const linkPath = await makeLinkEntry(source, true)
    const profileDir = join(linkPath, '..', '..', '..')

    await normalizeLinkedPluginManifest(profileDir, {
      name: '@tnnevol/dsh-demo',
      path: 'plugins/dsh-demo-plugin/package.json',
    } as never)

    // profile 副本：peer 是具体的运行时基线（profile 无法解析 workspace catalog）。
    const copied = JSON.parse(await readFile(join(linkPath, 'package.json'), 'utf8')) as {
      peerDependencies: Record<string, string>
    }
    expect(copied.peerDependencies['@deepseek-ai/dsh-llm']).toBe('0.2.1-rc.2')

    // 源码 manifest：仍是 catalog 形式，没有被写穿软链改掉。
    const sourceManifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8')) as {
      peerDependencies: Record<string, string>
    }
    expect(sourceManifest.peerDependencies['@deepseek-ai/dsh-llm']).toBe('catalog:dsh')
  })
})
