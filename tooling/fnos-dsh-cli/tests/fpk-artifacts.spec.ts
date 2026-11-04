import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { fpkReleaseFileName, renameFpkToRelease } from '../src/core/fpk-artifacts.js'
import { FPK_PLATFORMS } from '../src/core/fpk-platform.js'

/**
 * FNOS-037：改写名的源文件必须按 fnpack 的固定产物名取。
 *
 * 此前的实现扫「目录里第一个 `.fpk`」。当目录残留上一轮的版本化产物时，那个旧包
 * 会排在前面被选中，算出目标名后与自身同名，函数直接返回——本次新包留在原名，
 * 旧包却顶着新名字。产物名字与内容对不上，且全过程不报错。
 *
 * FNOS-044 在同一套约定上加入平台段：一次构建可能产出多份只差平台的包，名字必须
 * 区分，且同一批里先产出的那份不能被当成残留告警。
 */

const dirs: string[] = []

async function makeDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'fpk-artifacts-'))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('fpkReleaseFileName', () => {
  it('与 CI 同模板：<app>-<platform>-<tag>-dsh-<baseline>.fpk', () => {
    expect(fpkReleaseFileName('fn-deepseek-harness', 'x86', 'v7.0.0', '0.2.1-rc.5'))
      .toBe('fn-deepseek-harness-x86-v7.0.0-dsh-0.2.1-rc.5.fpk')
    expect(fpkReleaseFileName('fn-deepseek-harness', 'arm', 'v7.0.0', '0.2.1-rc.5'))
      .toBe('fn-deepseek-harness-arm-v7.0.0-dsh-0.2.1-rc.5.fpk')
  })

  it('同一版本不同平台的产物名互不相同', () => {
    // 同名会让第二次构建静默覆盖第一次——两份包给两类不同设备用，代价是装机拿错。
    const names = FPK_PLATFORMS.map(platform => fpkReleaseFileName('app', platform, 'v7.0.0', '0.2.1-rc.5'))
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('renameFpkToRelease', () => {
  it('残留同名旧产物时，被改名的是本次新包而不是旧包', async () => {
    const dir = await makeDir()
    const target = fpkReleaseFileName('app', 'x86', 'v7.0.0', '0.2.1-rc.5')
    // 上一轮遗留：名字已经是目标名，但里面的内容属于上一次构建。
    await writeFile(join(dir, target), 'stale-build')
    // 本次 fnpack 产物：固定名。
    await writeFile(join(dir, 'app.fpk'), 'fresh-build')

    const result = await renameFpkToRelease(dir, 'app', target)

    // 目标名下的内容必须是本次新包——这正是缺陷发生时会反过来的地方。
    expect(await readFile(join(dir, target), 'utf8')).toBe('fresh-build')
    expect(result.replacedStaleTarget).toBe(true)
    expect(result.from).toBe('app.fpk')
    expect(result.leftovers).toEqual([])
    // 固定名不应再残留。
    expect(await readdir(dir)).toEqual([target])
  })

  it('残留旧包名与目标不同时保留并从 leftovers 报告', async () => {
    const dir = await makeDir()
    const target = fpkReleaseFileName('app', 'x86', 'v7.1.0', '0.2.1-rc.5')
    await writeFile(join(dir, 'app-v7.0.0-dsh-0.2.1-rc.3.fpk'), 'old')
    await writeFile(join(dir, 'app.fpk'), 'fresh')

    const result = await renameFpkToRelease(dir, 'app', target)

    expect(await readFile(join(dir, target), 'utf8')).toBe('fresh')
    expect(result.replacedStaleTarget).toBe(false)
    // 旧包不被静默删除，但必须报出来——装错包的代价比多看一眼高。
    expect(result.leftovers).toEqual(['app-v7.0.0-dsh-0.2.1-rc.3.fpk'])
    expect(await readFile(join(dir, 'app-v7.0.0-dsh-0.2.1-rc.3.fpk'), 'utf8')).toBe('old')
  })

  it('同一批多平台构建里先产出的那份不算残留', async () => {
    // 打完 x86 再打 arm 时，x86 的产物已经在目录里。它是本次构建的成果，报成
    // 「装机时容易拿错」会让每次双平台构建都无端告警，久而久之真残留也被忽略。
    const dir = await makeDir()
    const x86 = fpkReleaseFileName('app', 'x86', 'v7.1.0', '0.2.1-rc.5')
    const arm = fpkReleaseFileName('app', 'arm', 'v7.1.0', '0.2.1-rc.5')
    await writeFile(join(dir, x86), 'x86-build')
    await writeFile(join(dir, 'app.fpk'), 'arm-build')

    const result = await renameFpkToRelease(dir, 'app', arm, [x86, arm])

    expect(result.leftovers).toEqual([])
    expect(await readFile(join(dir, arm), 'utf8')).toBe('arm-build')
    expect(await readFile(join(dir, x86), 'utf8')).toBe('x86-build')
  })

  it('没有 fnpack 固定名产物时直接报错，不去猜别的 .fpk', async () => {
    const dir = await makeDir()
    await writeFile(join(dir, 'some-old.fpk'), 'old')

    await expect(renameFpkToRelease(dir, 'app', 'app-x86-v7.0.0-dsh-0.2.1-rc.5.fpk'))
      .rejects.toThrow(/fnpack produced no app\.fpk/u)
  })
})
