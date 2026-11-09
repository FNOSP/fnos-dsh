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
      // 内置归档目录用于重装步骤走 file: 规格（不是 registry）。
      bundledDirectory: '/vol4/@appcenter/fn-deepseek-harness/bundled-dsh-plugins',
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

/**
 * 真机带回来的真实失效现场（2026-11-09，用户提供）。
 *
 * 这是从 NAS profile 里抄下来的**原始形态**：16 条豁免，其中 10 条是历史累积的
 * `||` 联合写法，6 条是干净的精确钉版。它的价值在于覆盖了真实世界的两种分布：
 *
 * - 多数条目是 `||` 联合（历史上为绕开 pnpm 的 First-Match-Wins 而合并）；
 * - 只有 2 个包出现在发布清单里（`dsh-fnos`、`dshmarket`），其余 14 个是用户自己
 *   装的插件——按设计它们的版本不归本应用判定，但 `||` 格式残留仍要清。
 *
 * 期望值不是手写的：`||` 一律判 `pipe-union`（与版本是否匹配无关），清单内的包
 * 再看版本。因此 10 条失效、6 条保留是规则推出来的，不是猜的。
 */
const REAL_WORKSPACE = `packages:
  - .

nodeLinker: hoisted
autoInstallPeers: false
minimumReleaseAgeExclude:
  - '@tnnevol/dsh-codebuddy@0.2.0-rc.2.0 || 0.2.1-rc.2.12 || 0.2.1-rc.2.16 || 0.2.1-rc.2.17 || 0.2.1-rc.2.18 || 0.2.1-rc.2.27 || 6.0.0'
  - '@tnnevol/dsh-codex-auth@0.2.0-rc.2.0 || 6.0.0 || 6.0.6 || 7.0.1 || 8.0.0 || 8.1.1'
  - dshmarket@1.66.14 || 1.66.45 || 1.73.12
  - '@tnnevol/dsh-semi-ui-showcase@0.2.0-rc.2.0'
  - '@tnnevol/dsh-failover-search@0.2.0-rc.2.1 || 0.2.1-rc.2.17 || 6.0.0 || 6.0.6 || 7.0.1 || 8.0.0 || 8.1.1 || 8.1.3'
  - '@tnnevol/dsh-midscene@0.2.1-rc.2.19 || 6.0.0 || 6.0.6 || 7.0.1 || 8.0.0 || 8.1.1'
  - '@tnnevol/dsh-opencode@0.2.1-rc.2.38 || 0.2.1-rc.2.41 || 6.0.0 || 6.0.6 || 7.0.1 || 8.0.0 || 8.1.1 || 8.1.3'
  - dsh-connect-trae@4.5.2
  - '@tnnevol/dsh-zcode@6.0.0 || 6.0.6 || 7.0.1 || 8.0.0 || 8.1.1'
  - '@dmh2002/dsh-connect-qoder@1.15.0 || 1.16.1 || 1.17.4 || 1.19.0'
  - '@deepseek-ai/dsh-brand@0.2.1-rc.5'
  - '@deepseek-ai/dsh-sdk-protocol@0.2.1-rc.5'
  - '@deepseek-ai/dsh-subagent-codex@0.2.1-rc.5'
  - '@deepseek-ai/dsh-tool-subagent@0.2.1-rc.5'
  - dsh-offwork-countdown@1.0.1 || 1.1.0 || 1.2.0
  - dsh-pet@0.4.4 || 0.4.5
`

/** 该现场对应的发布清单：只有两个包受本应用管理。 */
const REAL_TARGETS = { '@tnnevol/dsh-fnos': '8.1.8', dshmarket: '1.73.12' }

describe('真实失效现场（16 条，含历史 || 累积）', () => {
  it('16 条全部解析出来', () => {
    expect(parseExclusions(REAL_WORKSPACE)).toHaveLength(16)
  })

  it('10 条判失效，全部是 pipe-union', () => {
    const stale = findStaleExclusions(parseExclusions(REAL_WORKSPACE), REAL_TARGETS)
    expect(stale).toHaveLength(10)
    expect(stale.every(entry => entry.reason === 'pipe-union')).toBe(true)
    expect(stale.map(entry => entry.name)).toEqual([
      '@tnnevol/dsh-codebuddy',
      '@tnnevol/dsh-codex-auth',
      'dshmarket',
      '@tnnevol/dsh-failover-search',
      '@tnnevol/dsh-midscene',
      '@tnnevol/dsh-opencode',
      '@tnnevol/dsh-zcode',
      '@dmh2002/dsh-connect-qoder',
      'dsh-offwork-countdown',
      'dsh-pet',
    ])
  })

  it('6 条精确钉版且不带 || 的条目保留', () => {
    const exclusions = parseExclusions(REAL_WORKSPACE)
    const stale = findStaleExclusions(exclusions, REAL_TARGETS)
    const staleKeys = new Set(stale.map(entry => `${entry.name}@${entry.range}`))
    const kept = exclusions.filter(entry => !staleKeys.has(`${entry.name}@${entry.range}`))
    expect(kept.map(entry => entry.name)).toEqual([
      '@tnnevol/dsh-semi-ui-showcase',
      'dsh-connect-trae',
      '@deepseek-ai/dsh-brand',
      '@deepseek-ai/dsh-sdk-protocol',
      '@deepseek-ai/dsh-subagent-codex',
      '@deepseek-ai/dsh-tool-subagent',
    ])
  })

  it('按行删除后只少 10 行，保留行逐字不变', () => {
    const exclusions = parseExclusions(REAL_WORKSPACE)
    const stale = findStaleExclusions(exclusions, REAL_TARGETS)
    const result = removeExclusionLines(REAL_WORKSPACE, stale)

    expect(result.removedLines).toBe(10)
    const before = REAL_WORKSPACE.split('\n')
    const after = result.text.split('\n')
    expect(before.length - after.length).toBe(10)

    // 保留的每条原始行必须原样存在于输出中（排版与缩进都不能被重写）。
    const staleKeys = new Set(stale.map(entry => `${entry.name}@${entry.range}`))
    for (const entry of exclusions) {
      if (staleKeys.has(`${entry.name}@${entry.range}`)) continue
      expect(after).toContain(entry.line)
    }
    // 段头（packages / nodeLinker / autoInstallPeers）整体不变。
    const head = REAL_WORKSPACE.slice(0, REAL_WORKSPACE.indexOf('minimumReleaseAgeExclude:'))
    expect(result.text.startsWith(head)).toBe(true)
    // 被删的条目一条都不能残留。
    for (const entry of stale) {
      expect(result.text).not.toContain(`${entry.name}@${entry.range}`)
    }
  })

  it('清单外的包不因版本不匹配被判失效（只管格式残留）', () => {
    // dsh-codebuddy 等 14 个包不在清单里：它们的精确钉版不参与版本判定。
    // 用一份只含精确钉版、不含 || 的变体验证这一点。
    const exactOnly = REAL_WORKSPACE.replace(
      "  - '@tnnevol/dsh-codebuddy@0.2.0-rc.2.0 || 0.2.1-rc.2.12 || 0.2.1-rc.2.16 || 0.2.1-rc.2.17 || 0.2.1-rc.2.18 || 0.2.1-rc.2.27 || 6.0.0'",
      "  - '@tnnevol/dsh-codebuddy@0.2.0-rc.2.0'",
    )
    const stale = findStaleExclusions(parseExclusions(exactOnly), REAL_TARGETS)
    expect(stale.some(entry => entry.name === '@tnnevol/dsh-codebuddy')).toBe(false)
  })
})

/**
 * 重装步骤必须优先用随 FPK 内置的归档（2026-11-09 真机暴露）。
 *
 * 实测：本地构建的 `@tnnevol/dsh-fnos@8.1.8` 尚未发布到 npm，第三步按
 * `<name>@<version>` 去 registry 拉立刻失败，整次修复报 `ok=false`——尽管
 * 前两步（清条目、重建依赖）已经完全成功。应用内自愈不该依赖一个可能不存在的
 * registry 版本：能内置的插件就走 `file:` 归档，与 FPK 安装路径一致。
 */
describe('重装插件：内置归档优先', () => {
  const source = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8')
  const HOST = source('../../src/host/dependency-repair.ts')

  it('环境推导带上内置归档目录', () => {
    expect(HOST).toContain('bundledDirectory')
    expect(HOST).toMatch(/bundledDirectory: join\(appDest, 'bundled-dsh-plugins'\)/)
  })

  it('归档存在时用 file: 规格，缺失才退回 registry', () => {
    expect(HOST).toContain('bundledArchivePath')
    expect(HOST).toContain('pathExists(archive)')
    // 源码里的模板串字面量用正则断言：直接写 ${...} 会被 no-template-curly-in-string 判为误写。
    expect(HOST).toMatch(/`file:\$\{archive\}`/)
    expect(HOST).toMatch(/`\$\{name\}@\$\{version\}`/)
    // 两种分支都要留日志，排障时能看出走的是哪条。
    expect(HOST).toContain('使用内置归档')
    expect(HOST).toContain('无内置归档，改用 registry')
  })

  it('归档路径按 @scope/name 展开为两级目录', () => {
    // 目录布局是 bundled-dsh-plugins/@scope/name.tgz（见构建脚本）。
    expect(HOST).toMatch(/join\(directory, scope, `\$\{bare\}\.tgz`\)/)
    expect(HOST).toMatch(/join\(directory, `\$\{bare\}\.tgz`\)/)
  })

  it('缺失归档不阻断修复（回退而不是报错）', () => {
    // 瘦包发布时没有内置归档，此时必须回退到 registry，不能直接 fail。
    const block = HOST.slice(HOST.indexOf('const specs: string[] = []'), HOST.indexOf('log(`repair: reinstall 开始'))
    expect(block).not.toContain('return { ok: false')
  })
})
