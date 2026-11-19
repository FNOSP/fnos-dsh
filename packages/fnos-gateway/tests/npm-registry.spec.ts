import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_NPM_REGISTRY, normalizeNpmRegistry } from '../src/install-callback-helper/npm-registry.ts'

/**
 * FNOS-055：向导移除失效 npm 源（issue #36）。
 *
 * 事故链路：向导提供 `npmMirror` → 值指向 `skimdb.npmjs.com/registry`（只读复制
 * 端点）→ 安装回调在装 pnpm 之前把它写进 `.npmrc` → pnpm 安装 404，失败安装也
 * 把坏值留在设备上 → 后续重装/升级继续沿用。
 *
 * 这里钉住三件事：失效地址的归一范围、用户自定义源不被误改、以及回调确实在
 * 写入配置之前做了归一并在失败信息里带出 registry。
 */

const RETIRED = [
  'https://skimdb.npmjs.com/registry/',
  'https://skimdb.npmjs.com/registry',
  'http://skimdb.npmjs.com/registry/',
  'https://SKIMDB.npmjs.com/registry/',
  'https://replicate.npmjs.com/registry/',
  'https://replicate.npmjs.com/registry',
  '  https://skimdb.npmjs.com/registry/  ',
]

const PRESERVED = [
  'https://registry.npmjs.org/',
  'https://registry.yarnpkg.com/',
  'https://mirrors.tencent.com/npm/',
  'https://r.cnpmjs.org/',
  'https://registry.npmmirror.com/',
  'https://repo.huaweicloud.com/repository/npm/',
  'https://npm.example.internal/',
  'https://skimdb.npmjs.com/',
  'https://skimdb.npmjs.com/registry/custom-path',
]

describe('FNOS-055 normalize retired npm registry', () => {
  it('replaces every known retired spelling with the official registry', () => {
    for (const value of RETIRED) {
      expect(normalizeNpmRegistry(value), value).toBe(DEFAULT_NPM_REGISTRY)
    }
  })

  it('keeps other registries unchanged apart from surrounding whitespace', () => {
    for (const value of PRESERVED) {
      expect(normalizeNpmRegistry(value), value).toBe(value)
    }
    expect(normalizeNpmRegistry('  https://npm.example.internal/  ')).toBe('https://npm.example.internal/')
  })

  it('keeps an empty value empty so the caller can apply its own default', () => {
    expect(normalizeNpmRegistry('')).toBe('')
    expect(normalizeNpmRegistry('   ')).toBe('')
  })

  it('is idempotent', () => {
    for (const value of [...RETIRED, ...PRESERVED, '']) {
      const once = normalizeNpmRegistry(value)
      expect(normalizeNpmRegistry(once), value).toBe(once)
    }
  })
})

describe('FNOS-055 install callback wiring', () => {
  const installCallback = readFileSync(
    new URL('../../../apps/fn-deepseek-harness/cmd/install_callback', import.meta.url),
    'utf8',
  )
  const upgradeCallback = readFileSync(
    new URL('../../../apps/fn-deepseek-harness/cmd/upgrade_callback', import.meta.url),
    'utf8',
  )

  it('normalizes before persisting the npm registry', () => {
    expect(installCallback).toContain('run_install_callback_helper normalize-npm-registry')
    // 函数定义在文件前半段，调用点在 main() 里；正则要求归一调用之后还能找到
    // persist_npm_registry，确保不是只加了帮助器调用而没有接进写入路径。
    expect(installCallback).toMatch(/normalize-npm-registry[\s\S]+persist_npm_registry/u)
    expect(installCallback).toContain('NORMALIZED_NPM_REGISTRY')
  })

  it('distinguishes an empty wizard value from a missing field', () => {
    // 空值 = 用户提交了空选择 → npm 官方源；字段缺失 = 老版本升级 → 本地持久化源。
    expect(installCallback).toMatch(/\$\{wizard_npm_registry\+x\}/u)
    expect(installCallback).toContain('resolve_npm_registry')
    expect(upgradeCallback).toContain('WIZARD_REGISTRY_SET')
    expect(upgradeCallback).toMatch(/\$\{wizard_npm_registry\+x\}/u)
    expect(upgradeCallback).toContain('unset wizard_npm_registry')
  })

  it('reports the active registry when the pnpm install fails', () => {
    expect(installCallback).toMatch(/Unable to install pnpm@\$\{PNPM_VERSION\} from \$\{NPM_REGISTRY\}/u)
  })
})

/**
 * 从安装回调里抽出 `resolve_npm_registry` 并按真实 shell 执行。
 *
 * 这是 FNOS-055 的场景规则：向导字段存在（含空值）时以提交值为准，空值落到 npm
 * 官方源；字段缺失才回落到本地持久化源。环境变量在 shell 里区分「未设置」与
 * 「设置为空」，用 JS 的 `undefined` 表达前者。
 */
async function runResolveRegistry(env: Record<string, string | undefined>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'fnos-npm-registry-'))
  try {
    const source = await readFile(new URL('../../../apps/fn-deepseek-harness/cmd/install_callback', import.meta.url), 'utf8')
    const start = source.indexOf('resolve_npm_registry() {')
    const end = source.indexOf('\n}\n', start)
    expect(start, 'resolve_npm_registry function').toBeGreaterThanOrEqual(0)
    expect(end, 'resolve_npm_registry terminator').toBeGreaterThan(start)
    const harness = join(root, 'harness.sh')
    await writeFile(harness, [
      '#!/bin/bash',
      'read_persisted_npm_registry() { printf "https://local.example/"; }',
      source.slice(start, end + 3),
      'resolve_npm_registry',
    ].join('\n'))
    const childEnv: NodeJS.ProcessEnv = { ...process.env }
    delete childEnv.wizard_npm_registry
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete childEnv[key]
      else childEnv[key] = value
    }
    return execFileSync('/bin/bash', [harness], { encoding: 'utf8', env: childEnv })
  }
  finally {
    await rm(root, { recursive: true, force: true })
  }
}

describe('FNOS-055 registry resolution by scenario', () => {
  it('uses npm official when the wizard submitted an empty value', async () => {
    expect(await runResolveRegistry({ wizard_npm_registry: '' })).toBe(DEFAULT_NPM_REGISTRY)
  })

  it('uses the submitted source when it is non-empty', async () => {
    expect(await runResolveRegistry({ wizard_npm_registry: 'https://registry.npmmirror.com/' })).toBe('https://registry.npmmirror.com/')
  })

  it('falls back to the persisted local source only when the field is absent', async () => {
    expect(await runResolveRegistry({})).toBe('https://local.example/')
  })
})
