import { readFileSync } from 'node:fs'
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

  it('normalizes before persisting the npm registry', () => {
    expect(installCallback).toContain('run_install_callback_helper normalize-npm-registry')
    // 函数定义在文件前半段，调用点在 main() 里；正则要求归一调用之后还能找到
    // persist_npm_registry，确保不是只加了帮助器调用而没有接进写入路径。
    expect(installCallback).toMatch(/normalize-npm-registry[\s\S]+persist_npm_registry/u)
    expect(installCallback).toContain('NORMALIZED_NPM_REGISTRY')
  })

  it('reports the active registry when the pnpm install fails', () => {
    expect(installCallback).toMatch(/Unable to install pnpm@\$\{PNPM_VERSION\} from \$\{NPM_REGISTRY\}/u)
  })
})
