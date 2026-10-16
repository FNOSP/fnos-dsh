import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { assertCatalogResolved } from '../src/commands/publish.js'

/**
 * 发布产物守卫：拒绝带未解析 `catalog:` 的产物。
 *
 * 实测事故：`pnpm publish` 因凭据问题报 E404 后改用 `npm publish`，而 **npm 的打包器
 * 不认识 pnpm 工作区的 `catalog:` 协议**，于是六个插件全部带着未解析的 `catalog:` 发了
 * 出去。本机工作区一切正常（协议能解析），**只有外部消费者会炸**：
 *
 * ```
 * [ERR_PNPM_SPEC_NOT_SUPPORTED_BY_ANY_RESOLVER] "dayjs@catalog:" isn't supported by any available resolver.
 * This error happened while installing the dependencies of @tnnevol/dsh-codebuddy@0.2.0-rc.2.4
 * ```
 *
 * 这道守卫的价值全在于它**会拦** —— 所以这里用真实产物验证，不用桩。
 */
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

/** 造一个最小产物：`package/package.json` 打成 tgz。 */
async function makeTarball(manifest: Record<string, unknown>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'fnos-catalog-guard-'))
  temporaryDirectories.push(root)
  await mkdir(join(root, 'package'), { recursive: true })
  await writeFile(join(root, 'package', 'package.json'), JSON.stringify(manifest))
  const tarball = join(root, 'artifact.tgz')
  execFileSync('tar', ['-czf', tarball, '-C', root, 'package'])
  return tarball
}

describe('assertCatalogResolved', () => {
  it('产物含未解析 catalog: 时抛出并指名字段', async () => {
    const tarball = await makeTarball({
      name: '@tnnevol/dsh-broken',
      version: '0.0.1',
      dependencies: { dayjs: 'catalog:', echarts: 'catalog:' },
      peerDependencies: { react: 'catalog:' },
    })

    await expect(assertCatalogResolved(tarball)).rejects.toThrow(/catalog:/)
    await expect(assertCatalogResolved(tarball)).rejects.toThrow(/dependencies\.dayjs=catalog:/)
  })

  it('产物已解析时通过', async () => {
    const tarball = await makeTarball({
      name: '@tnnevol/dsh-ok',
      version: '0.0.1',
      dependencies: { dayjs: '^1.11.13' },
      peerDependencies: { react: '^19.0.0' },
    })

    await expect(assertCatalogResolved(tarball)).resolves.toBeUndefined()
  })
})
