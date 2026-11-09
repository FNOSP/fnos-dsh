import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  diagnoseDependencyRepair,
  findStaleExclusions,
  isRebuildableArtifact,
  parseExclusions,
  rangeAdmitsVersion,
  removeExclusionLines,
  resolveRepairEnvironment,
  targetVersionsFromManifest,
} from '../../src/host/dependency-repair.ts'

const WORKSPACE = `packages:
  - .

nodeLinker: hoisted
autoInstallPeers: false
minimumReleaseAgeExclude:
  - dshmarket@1.73.5
  - '@tnnevol/dsh-codex-auth@6.0.0'
  - '@tnnevol/dsh-fnos@8.1.3'
  - '@tnnevol/dsh-opencode@8.1.3 || 8.1.2'
  - react
`

const MANIFEST = {
  plugins: [
    { name: '@tnnevol/dsh-fnos', version: '8.1.3' },
    { name: 'dshmarket', version: '1.73.12', source: 'thirdparty' },
  ],
}

const temporaryDirectories: string[] = []

async function makeProfile(workspace: string | undefined, manifest: unknown): Promise<{
  readonly profile: string
  readonly manifestPath: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-fnos-repair-'))
  temporaryDirectories.push(root)
  const profile = join(root, 'profiles', 'web')
  await mkdir(profile, { recursive: true })
  if (workspace !== undefined) await writeFile(join(profile, 'pnpm-workspace.yaml'), workspace, 'utf8')
  const manifestPath = join(root, 'published-dsh-plugins.json')
  await writeFile(manifestPath, JSON.stringify(manifest), 'utf8')
  return { profile, manifestPath }
}

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true })
  }
})

describe('环境推导', () => {
  it('从 DSH_HOME 与 NPM_CONFIG_PREFIX 推导 profile 与可执行文件', () => {
    const environment = resolveRepairEnvironment({
      DSH_HOME: '/vol4/@apphome/fn-deepseek-harness',
      NPM_CONFIG_PREFIX: '/vol4/@apphome/fn-deepseek-harness/.npm-global',
      TRIM_APPDEST: '/vol4/@appcenter/fn-deepseek-harness',
    })
    expect(environment).toEqual({
      profileDirectory: '/vol4/@apphome/fn-deepseek-harness/profiles/web',
      manifestPath: '/vol4/@appcenter/fn-deepseek-harness/published-dsh-plugins.json',
      pnpmBin: '/vol4/@apphome/fn-deepseek-harness/.npm-global/bin/pnpm',
      dshBin: '/vol4/@apphome/fn-deepseek-harness/.npm-global/bin/dsh',
    })
  })

  it('没有 DSH_HOME 时不可用（非 fnOS 宿主）', () => {
    expect(resolveRepairEnvironment({})).toBeUndefined()
    expect(resolveRepairEnvironment({ DSH_HOME: '   ' })).toBeUndefined()
  })

  it('缺少可选变量时不编造路径', () => {
    const environment = resolveRepairEnvironment({ DSH_HOME: '/h' })
    expect(environment).toEqual({ profileDirectory: '/h/profiles/web' })
  })
})

describe('豁免条目解析', () => {
  it('只解析该段内的条目，保留原始行', () => {
    const entries = parseExclusions(WORKSPACE)
    expect(entries.map(entry => `${entry.name}@${entry.range}`)).toEqual([
      'dshmarket@1.73.5',
      '@tnnevol/dsh-codex-auth@6.0.0',
      '@tnnevol/dsh-fnos@8.1.3',
      '@tnnevol/dsh-opencode@8.1.3 || 8.1.2',
    ])
  })

  it('没有该段时返回空数组', () => {
    expect(parseExclusions('packages:\n  - .\n')).toEqual([])
  })

  it('列零的非列表行结束该段', () => {
    const text = 'minimumReleaseAgeExclude:\n  - a@1.0.0\nnodeLinker: hoisted\n  - b@2.0.0\n'
    expect(parseExclusions(text).map(entry => entry.name)).toEqual(['a'])
  })
})

describe('版本范围判定', () => {
  it('精确钉版按段边界前缀匹配', () => {
    expect(rangeAdmitsVersion('8.1.3', '8.1.3')).toBe(true)
    expect(rangeAdmitsVersion('8.1', '8.1.3')).toBe(true)
    expect(rangeAdmitsVersion('6.0.0', '8.1.3')).toBe(false)
  })

  it('|| 联合任一分支放行即可', () => {
    expect(rangeAdmitsVersion('8.1.3 || 8.1.2', '8.1.2')).toBe(true)
    expect(rangeAdmitsVersion('6.0.0 || 7.0.0', '8.1.3')).toBe(false)
  })

  it('非版本锚点不放行', () => {
    expect(rangeAdmitsVersion('latest', '8.1.3')).toBe(false)
  })
})

describe('失效判定', () => {
  const targets = targetVersionsFromManifest(MANIFEST)

  it('从清单读出目标版本', () => {
    expect(targets).toEqual({ '@tnnevol/dsh-fnos': '8.1.3', 'dshmarket': '1.73.12' })
  })

  it('版本不匹配判 stale，|| 联合判 pipe-union，仍有效的条目不报', () => {
    const stale = findStaleExclusions(parseExclusions(WORKSPACE), targets)
    // codex-auth 不在清单里（已移出内置），它的 6.0.0 条目不归本应用维护；
    // dsh-fnos@8.1.3 恰好等于目标版本，仍然有效。
    expect(stale).toEqual([
      { name: 'dshmarket', range: '1.73.5', reason: 'stale-version', targetVersion: '1.73.12' },
      { name: '@tnnevol/dsh-opencode', range: '8.1.3 || 8.1.2', reason: 'pipe-union' },
    ])
  })

  it('清单里没有的包不判失效（不替用户维护他自己装的插件）', () => {
    const stale = findStaleExclusions(parseExclusions(WORKSPACE), { dshmarket: '1.73.12' })
    expect(stale.map(entry => entry.name)).not.toContain('@tnnevol/dsh-codex-auth')
    expect(stale.map(entry => entry.name)).toContain('@tnnevol/dsh-opencode')
  })

  it('全部有效时返回空数组', () => {
    const text = 'minimumReleaseAgeExclude:\n  - dshmarket@1.73.12\n'
    expect(findStaleExclusions(parseExclusions(text), targets)).toEqual([])
  })
})

describe('删除失效条目', () => {
  it('按行精确删除，保留其它条目、注释与排版', () => {
    const stale = findStaleExclusions(parseExclusions(WORKSPACE), targetVersionsFromManifest(MANIFEST))
    const { text, removedLines } = removeExclusionLines(WORKSPACE, stale)
    expect(removedLines).toBe(stale.length)
    expect(text).toContain("  - '@tnnevol/dsh-fnos@8.1.3'")
    expect(text).toContain('nodeLinker: hoisted')
    expect(text).not.toContain('dshmarket@1.73.5')
    expect(text).not.toContain('dsh-opencode@8.1.3 || 8.1.2')
  })

  it('没有要删的条目时原样返回', () => {
    const result = removeExclusionLines(WORKSPACE, [])
    expect(result.text).toBe(WORKSPACE)
    expect(result.removedLines).toBe(0)
  })
})

describe('只读诊断', () => {
  it('真实失效 profile 能报出条目，且不修改文件', async () => {
    const { profile, manifestPath } = await makeProfile(WORKSPACE, MANIFEST)
    const before = await readFile(join(profile, 'pnpm-workspace.yaml'), 'utf8')
    const diagnosis = await diagnoseDependencyRepair({ profileDirectory: profile, manifestPath })
    const after = await readFile(join(profile, 'pnpm-workspace.yaml'), 'utf8')

    expect(diagnosis.available).toBe(true)
    expect(diagnosis.entries.length).toBeGreaterThan(0)
    expect(after).toBe(before)
  })

  it('profile 缺失时报 profile-missing', async () => {
    const diagnosis = await diagnoseDependencyRepair({ profileDirectory: '/nonexistent/profiles/web' })
    expect(diagnosis).toMatchObject({ available: false, reason: 'profile-missing' })
  })

  it('没有环境时报 fnos-host-unavailable', async () => {
    expect(await diagnoseDependencyRepair(undefined))
      .toMatchObject({ available: false, reason: 'fnos-host-unavailable' })
  })

  it('清单缺失时不误判（无从比较目标版本）', async () => {
    const { profile } = await makeProfile('minimumReleaseAgeExclude:\n  - a@1.0.0\n', {})
    const diagnosis = await diagnoseDependencyRepair({ profileDirectory: profile })
    expect(diagnosis.available).toBe(true)
    expect(diagnosis.entries).toEqual([])
  })
})

describe('可重建产物守卫', () => {
  it('只认 lockfile 与 node_modules', () => {
    expect(isRebuildableArtifact('/x/pnpm-lock.yaml')).toBe(true)
    expect(isRebuildableArtifact('/x/node_modules')).toBe(true)
    expect(isRebuildableArtifact('/x/.dsh-opencode-auth.json')).toBe(false)
    expect(isRebuildableArtifact('/x/sessions')).toBe(false)
  })
})

/**
 * 日志可观测性。
 *
 * 这个功能会删 `node_modules` 并重装依赖，用户报「点了没反应」时只能靠日志区分
 * 三种情况：请求没到、到了但判定为健康、命令执行失败。因此诊断判定与每步命令
 * 都必须留痕，且前缀统一，便于在宿主输出里检索。
 */
describe('依赖修复日志', () => {
  // 源码断言用同步读取：describe 回调不是 async，不能在里面 await。
  const source = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8')
  const HOST = source('../../src/host/dependency-repair.ts')
  const ROUTES = source('../../src/host/dependency-repair-routes.ts')

  it('统一前缀，可被检索', () => {
    expect(HOST).toContain("const LOG_PREFIX = '[dsh-fnos][dependency-repair]'")
  })

  it('诊断输出判定依据（豁免条数、清单目标、失效条数）', () => {
    expect(HOST).toMatch(/diagnose: profile=.*豁免=.*条.*清单目标=.*个.*失效=.*条/s)
  })

  it('每条失效条目单独一行，含原因与目标版本', () => {
    expect(HOST).toContain('diagnose: 失效')
    expect(HOST).toContain('entry.reason')
  })

  it('修复的每一步都记录命令与退出码', () => {
    expect(HOST).toContain('repair: clean 退出码=')
    expect(HOST).toContain('repair: install 退出码=')
    expect(HOST).toContain('repair: reinstall 退出码=')
  })

  it('路由入口记录请求到达，区分「没触发」与「判定为健康」', () => {
    expect(ROUTES).toContain('请求到达')
    expect(ROUTES).toContain('修复结束')
  })
})
