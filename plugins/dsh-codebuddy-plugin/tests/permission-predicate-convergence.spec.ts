import { describe, expect, it } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * 权限判定单点收敛（FNOS-011-05 / TC-016）。
 *
 * 各插件对凭据文件权限的判定必须引用 `@tnnevol/dsh-plugin-kit` 的共享实现；
 * 源码里不允许再出现手写的判定条件（`0o077` 位运算 / `isOwnerOnly` /
 * `assertOwnerOnly` 的本地重写）。
 */

const HERE = dirname(fileURLToPath(import.meta.url))
// tests/ 的上一级是插件目录，再上一级才是 plugins/。
const PLUGINS = join(HERE, '..', '..')  // → <repo>/plugins
const PLUGIN_SRC = (slug: string): string => join(PLUGINS, slug, 'src')

/** 需要收敛判定的插件目录（宿主侧凭据存储的使用方）。 */
const CONSUMERS = ['dsh-codebuddy-plugin', 'dsh-codex-auth-plugin'] as const

/**
 * 手写判定条件的特征：出现即说明判定逻辑被复制了一份。
 *
 * 注释里复述旧条件（如「旧条件 (mode & 0o077) !== 0」）不算重复实现——判定
 * 语义必须随共享包更新，注释解释历史反而有价值。检查先剥掉注释再匹配。
 */
const DUPLICATE_PATTERNS: ReadonlyArray<{ pattern: RegExp, label: string }> = [
  { pattern: /0o077/u, label: '手写 group/other 位掩码（0o077）' },
  { pattern: /\bisOwnerOnly\b/u, label: '本地 isOwnerOnly 实现' },
]

/** 剥掉块注释与行注释，让检查只看代码。 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/(^|[^:])\/\/.*$/gmu, '$1')
}

async function visitSourceFiles(root: string, visit: (path: string, source: string) => void): Promise<void> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) await visitSourceFiles(path, visit)
    else if (/\.(?:ts|tsx)$/u.test(entry.name)) {
      visit(path, stripComments(await readFile(path, 'utf8')))
    }
  }
}

describe('凭据权限判定单点收敛', () => {
  it('接入插件引用共享实现且源码无重复判定', async () => {
    for (const directory of CONSUMERS) {
      const src = PLUGIN_SRC(directory)
      const found = { kit: 0, duplicates: [] as string[] }
      await visitSourceFiles(src, (path, source) => {
        if (source.includes('@tnnevol/dsh-plugin-kit')) found.kit += 1
        for (const { pattern, label } of DUPLICATE_PATTERNS) {
          if (pattern.test(source)) found.duplicates.push(`${path}: ${label}`)
        }
      })
      expect(found.kit, `${directory} 应引用 @tnnevol/dsh-plugin-kit`).toBeGreaterThan(0)
      expect(found.duplicates, directory).toEqual([])
    }
  })

  it('共享包自身承载唯一的位掩码实现', async () => {
    const kit = await readFile(join(PLUGINS, '..', 'packages', 'dsh-plugin-kit', 'src', 'credential-permission.ts'), 'utf8')
    expect(kit).toContain('0o077')
    expect(kit).toContain('0o400')
  })
})
