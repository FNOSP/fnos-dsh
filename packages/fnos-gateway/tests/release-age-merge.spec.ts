import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { mergeReleaseAgeExclusions } from '../src/install-callback-helper/release-age-merge.ts'

const temporary: string[] = []

/**
 * 写一份临时工作区文件。
 * @param content - 文件内容。
 * @returns 路径。
 */
async function workspaceWith(content: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'release-age-merge-'))
  temporary.push(directory)
  const path = join(directory, 'pnpm-workspace.yaml')
  await writeFile(path, content, 'utf8')
  return path
}

afterEach(async () => {
  await Promise.all(temporary.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('minimumReleaseAgeExclude 合并', () => {
  it('同包多版本合并成一行并排序', async () => {
    /*
      pnpm 解析该列表是 First-Match-Wins：条目按包名逐条比对，第一条匹配即停止。
      同包写成两行时第二行永远不生效——

        - dshmarket@1.84.0     # 匹配包名，版本不符 → 短路
        - dshmarket@1.84.1     # 被跳过

      于是 lockfile 校验报 ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION，整个
      `dsh plugin remove/add` 失败。2026-11-25 真机实测：升级因此在 remove 阶段
      中断，插件被移出 profile 却装不回来，fnOS 全部界面入口消失。
    */
    const path = await workspaceWith(`packages:
  - .

minimumReleaseAgeExclude:
  - dshmarket@1.84.0
  - dshmarket@1.84.1
`)
    expect(await mergeReleaseAgeExclusions(path)).toBe(true)
    expect(await readFile(path, 'utf8')).toBe(`packages:
  - .

minimumReleaseAgeExclude:
  - dshmarket@1.84.0 || 1.84.1
`)
  })

  it('按数值比较版本，不是字典序', async () => {
    // 字典序会把 1.10.0 排在 1.9.0 前面，那是错的。
    const path = await workspaceWith(`minimumReleaseAgeExclude:
  - pkg@1.9.0
  - pkg@1.10.0
`)
    await mergeReleaseAgeExclusions(path)
    expect(await readFile(path, 'utf8')).toContain('pkg@1.9.0 || 1.10.0')
  })

  it('scope 包名与已是目标格式的条目不被打乱', async () => {
    const path = await workspaceWith(`minimumReleaseAgeExclude:
  - '@tnnevol/dsh-foo@1.0.0 || 2.0.0'
  - '@tnnevol/dsh-foo@0.9.0'
`)
    await mergeReleaseAgeExclusions(path)
    const text = await readFile(path, 'utf8')
    // 最后一个 @ 才是分隔符，scope 里那个不算。
    expect(text).toContain('@tnnevol/dsh-foo@0.9.0 || 1.0.0 || 2.0.0')
  })

  it('裸包名保留整包豁免语义，不被版本列表替代', async () => {
    const path = await workspaceWith(`minimumReleaseAgeExclude:
  - bare-pkg
  - bare-pkg@1.0.0
`)
    await mergeReleaseAgeExclusions(path)
    expect(await readFile(path, 'utf8')).toContain('  - bare-pkg')
  })

  it('无改动时返回 false，不重写文件', async () => {
    const content = `minimumReleaseAgeExclude:
  - pkg@1.0.0
`
    const path = await workspaceWith(content)
    expect(await mergeReleaseAgeExclusions(path)).toBe(false)
    expect(await readFile(path, 'utf8')).toBe(content)
  })

  it('段缺失时安全返回', async () => {
    const path = await workspaceWith('packages:\n  - .\n')
    expect(await mergeReleaseAgeExclusions(path)).toBe(false)
  })
})