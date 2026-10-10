import { mkdir, writeFile } from 'node:fs/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  parseReleaseAgeExclusion,
  rangeAdmitsVersion,
  removeProfileBuildArtifacts,
  staleReleaseAgeExclusions,
} from '../src/install-callback-helper/common.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function createProfile(workspace: string | undefined, dependencies: Record<string, string>): Promise<{ workspace: string, manifest: string }> {
  const root = await mkdtemp(join(tmpdir(), 'fnos-release-age-'))
  temporaryRoots.push(root)
  await mkdir(join(root, 'profiles', 'web'), { recursive: true })
  const workspacePath = join(root, 'profiles', 'web', 'pnpm-workspace.yaml')
  const manifestPath = join(root, 'profiles', 'web', 'package.json')
  if (workspace !== undefined) await writeFile(workspacePath, workspace)
  await writeFile(manifestPath, JSON.stringify({ name: 'dsh-profile-web', private: true, dependencies }))
  return { workspace: workspacePath, manifest: manifestPath }
}

const WORKSPACE_WITH_STALE = `packages:
  - .

nodeLinker: hoisted
autoInstallPeers: false
minimumReleaseAgeExclude:
  - '@tnnevol/dsh-codebuddy@0.1.7-rc.2'
`

const WORKSPACE_WITH_CURRENT = WORKSPACE_WITH_STALE.replace('0.1.7-rc.2', '0.2.0-rc.2.0')

describe('staleReleaseAgeExclusions（FNOS-012-03 profile 依赖重建自愈）', () => {
  it('失效条目（豁免版本与清单不一致）被报告', async () => {
    const profile = await createProfile(WORKSPACE_WITH_STALE, { '@tnnevol/dsh-codebuddy': '0.2.0-rc.2.0' })
    expect(await staleReleaseAgeExclusions(profile.workspace, profile.manifest))
      .toEqual(['@tnnevol/dsh-codebuddy@0.1.7-rc.2'])
  })

  it('条目有效（版本一致）时不报告', async () => {
    const profile = await createProfile(WORKSPACE_WITH_CURRENT, { '@tnnevol/dsh-codebuddy': '0.2.0-rc.2.0' })
    expect(await staleReleaseAgeExclusions(profile.workspace, profile.manifest)).toEqual([])
  })

  it('无 minimumReleaseAgeExclude 字段的 profile 不受影响', async () => {
    const workspace = `packages:
  - .

nodeLinker: hoisted
`
    const profile = await createProfile(workspace, { '@tnnevol/dsh-codebuddy': '0.2.0-rc.2.0' })
    expect(await staleReleaseAgeExclusions(profile.workspace, profile.manifest)).toEqual([])
  })

  it('workspace 文件缺失时不报告', async () => {
    const profile = await createProfile(undefined, {})
    expect(await staleReleaseAgeExclusions(join(profile.workspace, '.missing'), profile.manifest)).toEqual([])
  })

  it('不传发布清单时，link: 开发 profile 的包不参与判定', async () => {
    const profile = await createProfile(WORKSPACE_WITH_STALE, { '@tnnevol/dsh-codebuddy': 'link:/some/dir' })
    expect(await staleReleaseAgeExclusions(profile.workspace, profile.manifest)).toEqual([])
  })

  it('link: 包回退到发布清单的权威 pin 后照常判定', async () => {
    const profile = await createProfile(WORKSPACE_WITH_STALE, { '@tnnevol/dsh-codebuddy': 'link:/some/dir' })
    // 发布清单要把 0.2.0-rc.2.0 装进去：0.1.7-rc.2 的豁免已失效。
    expect(await staleReleaseAgeExclusions(profile.workspace, profile.manifest, {
      '@tnnevol/dsh-codebuddy': '0.2.0-rc.2.0',
    })).toEqual(['@tnnevol/dsh-codebuddy@0.1.7-rc.2'])
    // 发布 pin 与豁免同代际时不算失效。
    expect(await staleReleaseAgeExclusions(profile.workspace, profile.manifest, {
      '@tnnevol/dsh-codebuddy': '0.1.7-rc.2.2',
    })).toEqual([])
  })

  it('前缀同代际（0.1.7 豁免 0.1.7-rc.2.2）视为有效', async () => {
    const workspace = WORKSPACE_WITH_STALE.replace('0.1.7-rc.2', '0.1.7')
    const profile = await createProfile(workspace, { '@tnnevol/dsh-codebuddy': '0.1.7-rc.2.2' })
    expect(await staleReleaseAgeExclusions(profile.workspace, profile.manifest)).toEqual([])
  })

  it('|| 联合范围按分支匹配', async () => {
    expect(rangeAdmitsVersion('0.1.7-rc.2 || 0.2.0-rc.2', '0.2.0-rc.2')).toBe(true)
    expect(rangeAdmitsVersion('0.1.7-rc.2 || 0.2.0-rc.2', '0.1.0-rc.7')).toBe(false)
  })

  it('parseReleaseAgeExclusion 拆分 scope 名与版本，无版本锚定时返回 undefined', () => {
    expect(parseReleaseAgeExclusion('@tnnevol/dsh-codebuddy@0.1.7-rc.2'))
      .toEqual({ name: '@tnnevol/dsh-codebuddy', range: '0.1.7-rc.2' })
    expect(parseReleaseAgeExclusion('react@^18')).toEqual({ name: 'react', range: '^18' })
    expect(parseReleaseAgeExclusion('react')).toBeUndefined()
  })

  it('removeProfileBuildArtifacts 只删两个重建产物，路径名不符即拒绝', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fnos-remove-artifacts-'))
    temporaryRoots.push(root)
    const lockfile = join(root, 'pnpm-lock.yaml')
    const modules = join(root, 'node_modules')
    await writeFile(lockfile, 'lockfileVersion: 9.0')
    await mkdir(join(modules, '.pnpm'), { recursive: true })
    await removeProfileBuildArtifacts(lockfile, modules)
    await expect(statExists(lockfile)).resolves.toBe(false)
    await expect(statExists(modules)).resolves.toBe(false)
    // 拒绝任意路径。
    await expect(removeProfileBuildArtifacts(join(root, 'settings.yaml'), modules)).rejects.toThrow(/unexpected lockfile path/)
    await expect(removeProfileBuildArtifacts(lockfile, join(root, 'sessions'))).rejects.toThrow(/unexpected node_modules path/)
  })

  async function statExists(path: string): Promise<boolean> {
    const { stat } = await import('node:fs/promises')
    try {
      await stat(path)
      return true
    } catch {
      return false
    }
  }
})
