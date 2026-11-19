import { describe, expect, it } from 'vitest'
import { findCatalogDrift, formatCatalogDrift, scanPluginsForCatalogDrift } from '../src/core/catalog-drift.js'

/**
 * `pnpm install` 会把 `catalog:dsh` 解析成字面版本写回 `package.json`。
 * 这组用例锁住守卫的核心判定，避免它被改宽之后静默放行。
 */
describe('插件清单的 DSH 依赖必须走 catalog', () => {
  const clean = JSON.stringify({
    name: '@tnnevol/dsh-demo',
    engines: { dsh: '0.2.2-rc.5' },
    dependencies: { '@deepseek-ai/dsh': 'catalog:dsh' },
    peerDependencies: { '@deepseek-ai/dsh-llm': 'catalog:dsh', '@deepseek-ai/cordis': '^4.1.0' },
    devDependencies: { '@deepseek-ai/dsh-tools': 'catalog:dsh' },
  })

  it('全部写 catalog:dsh 时无违规（engines.dsh 不算依赖）', () => {
    expect(findCatalogDrift('dsh-demo-plugin', clean)).toEqual([])
  })

  it('命名 catalog 引用同样合法', () => {
    const manifest = JSON.stringify({ peerDependencies: { '@deepseek-ai/dsh-tools': 'catalog:dsh-a' } })
    expect(findCatalogDrift('dsh-demo-plugin', manifest)).toEqual([])
  })

  it('peerDependencies 里写死版本会被抓到——这正是第三次踩到的位置', () => {
    const manifest = JSON.stringify({
      peerDependencies: { '@deepseek-ai/dsh-llm': '0.2.2-rc.5' },
    })
    expect(findCatalogDrift('dsh-demo-plugin', manifest)).toEqual([
      { file: 'plugins/dsh-demo-plugin/package.json', field: 'peerDependencies', name: '@deepseek-ai/dsh-llm', range: '0.2.2-rc.5' },
    ])
  })

  it('四个依赖段都被检查', () => {
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const) {
      const manifest = JSON.stringify({ [field]: { '@deepseek-ai/dsh-atomic-write': '0.2.2-rc.5' } })
      const drifts = findCatalogDrift('dsh-demo-plugin', manifest)
      expect(drifts, field).toHaveLength(1)
      expect(drifts[0]?.field, field).toBe(field)
    }
  })

  it('非 DSH 包的普通版本不受影响', () => {
    const manifest = JSON.stringify({
      dependencies: { '@deepseek-ai/cordis': '^4.1.0', '@douyinfe/semi-icons': '2.90.2' },
    })
    expect(findCatalogDrift('dsh-demo-plugin', manifest)).toEqual([])
  })

  it('错误信息说清原因与修法，而不只是「不匹配」', () => {
    const message = formatCatalogDrift([
      { file: 'plugins/dsh-demo-plugin/package.json', field: 'peerDependencies', name: '@deepseek-ai/dsh-llm', range: '0.2.2-rc.5' },
    ])
    expect(message).toContain('必须通过 catalog 引用')
    expect(message).toContain('pnpm install')
    expect(message).toContain('peerDependencies.@deepseek-ai/dsh-llm 写成了 "0.2.2-rc.5"')
    expect(message).toContain('git checkout -- plugins/*/package.json')
  })
})

describe('扫描真实仓库', () => {
  it('当前仓库的插件清单没有 catalog 漂移', async () => {
    const root = new URL('../../../', import.meta.url).pathname
    await expect(scanPluginsForCatalogDrift(root)).resolves.toEqual([])
  })
})
