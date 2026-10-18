import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

/**
 * 插件市场索引守卫（FNOS-016-04）。
 *
 * 索引是静态快照：它不会自动跟随 npm。发布新版本后忘了重新生成，用户在「发现」页
 * 看到的就是旧版本，而且没有任何报错——只是版本落后。这条用例把「索引里每个插件
 * 的最高版本」与「npm 上该插件 next 标签指向的版本」钉在一起。
 *
 * 离线时跳过而不是失败：索引本身的格式正确性由独立的格式校验覆盖，联网失败不该
 * 表现为「索引有问题」。
 */

const INDEX = new URL('../../../docs/public/plugins/market/index.json', import.meta.url)

interface MarketIndex {
  format: number
  plugins: Array<{ name: string, versions: Array<{ version: string }> }>
}

/** npm registry 的 dist-tags；网络不可用时返回 undefined，由用例跳过。 */
async function nextTag(name: string): Promise<string | undefined> {
  try {
    const response = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2F')}`, {
      signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok) return undefined
    const document = await response.json() as { 'dist-tags'?: Record<string, string> }
    return document['dist-tags']?.next
  } catch {
    return undefined
  }
}

describe('插件市场索引', () => {
  it('是合法的 format 1 文档且列出六个插件', async () => {
    const index = JSON.parse(await readFile(INDEX, 'utf8')) as MarketIndex
    expect(index.format).toBe(1)
    expect(index.plugins.length).toBe(6)
    for (const plugin of index.plugins) {
      expect(plugin.versions.length).toBeGreaterThan(0)
    }
  })

  it('每个插件都有 keywords（发现页搜索依赖它）', async () => {
    const index = JSON.parse(await readFile(INDEX, 'utf8')) as MarketIndex & {
      plugins: Array<{ name: string, metadata?: { keywords?: string[] } }>
    }
    for (const plugin of index.plugins) {
      expect(plugin.metadata?.keywords?.length ?? 0, plugin.name).toBeGreaterThan(0)
    }
  })

  it('每个插件的最高版本等于 npm 的 next 标签', async () => {
    const index = JSON.parse(await readFile(INDEX, 'utf8')) as MarketIndex
    const results = await Promise.all(index.plugins.map(async (plugin) => ({
      name: plugin.name,
      indexed: plugin.versions[0]?.version,
      published: await nextTag(plugin.name),
    })))
    const unreachable = results.filter(result => result.published === undefined)
    if (unreachable.length > 0) {
      // 离线或 registry 不可达：本用例不判定索引有误。
      console.warn(`skipped version check for ${unreachable.map(r => r.name).join(', ')}: registry unreachable`)
      return
    }
    for (const result of results) {
      expect(result.indexed, `${result.name} 索引落后于 npm next；请重新生成索引`).toBe(result.published)
    }
  }, 60_000)
})
