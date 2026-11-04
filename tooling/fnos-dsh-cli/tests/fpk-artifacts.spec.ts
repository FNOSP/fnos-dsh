import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  FPK_DIST_DIRECTORY,
  finalizeFpkArtifact,
  fpkReleaseFileName,
  listLegacyRootArtifacts,
  prepareFpkDistDirectory,
} from '../src/core/fpk-artifacts.js'
import { FPK_PLATFORMS } from '../src/core/fpk-platform.js'

/**
 * FNOS-037：落成发布名时的源文件必须按 fnpack 的固定产物名取。
 *
 * 此前的实现扫「目录里第一个 `.fpk`」。当目录残留上一轮的版本化产物时，那个旧包
 * 会排在前面被选中，算出目标名后与自身同名，函数直接返回——本次新包留在原名，
 * 旧包却顶着新名字。产物名字与内容对不上，且全过程不报错。
 *
 * FNOS-044 在同一套约定上加两件事：命名带平台段（一次构建可能产出多份只差平台的
 * 包，名字必须区分），产物落 `dist/` 且每次构建先清空（产物目录里有什么，就等于
 * 这一次产出了什么）。
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

describe('prepareFpkDistDirectory', () => {
  it('目录不存在时创建 dist', async () => {
    const app = await makeDir()
    const dist = await prepareFpkDistDirectory(app)

    expect(dist).toBe(join(app, FPK_DIST_DIRECTORY))
    expect(await readdir(dist)).toEqual([])
  })

  it('清空上一次构建的产物', async () => {
    // 产物目录里有什么，就等于「这一次构建产出了什么」。留着上一次的包，装机时
    // 就得先猜哪个是新的——那正是本次改动要消灭的状态。
    const app = await makeDir()
    const previous = join(app, FPK_DIST_DIRECTORY)
    await mkdir(previous, { recursive: true })
    await writeFile(join(previous, 'app-x86-v7.0.15-dsh-0.2.1-rc.5.fpk'), 'stale')

    const dist = await prepareFpkDistDirectory(app)

    expect(await readdir(dist)).toEqual([])
  })

  it('只清 dist，不越界到应用目录别处内容', async () => {
    const app = await makeDir()
    await mkdir(join(app, FPK_DIST_DIRECTORY), { recursive: true })
    await writeFile(join(app, FPK_DIST_DIRECTORY, 'old.fpk'), 'stale')
    await writeFile(join(app, 'manifest'), 'appname = app\n')
    await writeFile(join(app, 'app.fpk'), 'legacy-root-artifact')
    await mkdir(join(app, 'app'), { recursive: true })
    await writeFile(join(app, 'app', 'gateway-proxy.mjs'), '// 运行时输入')

    await prepareFpkDistDirectory(app)

    const rest = (await readdir(app)).sort()
    // 迁移前遗留的历史产物不被顺手删掉：删除不是构建的职权。
    expect(rest).toEqual(['app', 'app.fpk', 'dist', 'manifest'])
    expect(await readFile(join(app, 'app', 'gateway-proxy.mjs'), 'utf8')).toContain('运行时输入')
  })
})

describe('finalizeFpkArtifact', () => {
  it('在 dist 内部把固定名落成发布名，不跨目录搬运', async () => {
    const dist = await makeDir()
    const target = fpkReleaseFileName('app', 'x86', 'v7.0.0', '0.2.1-rc.5')
    await writeFile(join(dist, 'app.fpk'), 'fresh-build')

    const result = await finalizeFpkArtifact({
      distDirectory: dist,
      appName: 'app',
      target,
      currentBuild: [target],
    })

    expect(result.from).toBe('app.fpk')
    expect(result.file).toBe(target)
    expect(await readFile(join(dist, target), 'utf8')).toBe('fresh-build')
    // 固定名不应再残留：产物目录里只剩最终名字。
    expect(await readdir(dist)).toEqual([target])
  })

  it('同一批多平台构建里先产出的那份不算外来产物', async () => {
    // 打完 x86 再打 arm 时，x86 的产物已在 dist 里。它是本次构建的成果，报成
    // 「不属于本次构建」会让每次双平台构建都无端告警，久而久之真问题也被忽略。
    const dist = await makeDir()
    const x86 = fpkReleaseFileName('app', 'x86', 'v7.1.0', '0.2.1-rc.5')
    const arm = fpkReleaseFileName('app', 'arm', 'v7.1.0', '0.2.1-rc.5')
    await writeFile(join(dist, x86), 'x86-build')
    await writeFile(join(dist, 'app.fpk'), 'arm-build')

    const result = await finalizeFpkArtifact({
      distDirectory: dist,
      appName: 'app',
      target: arm,
      currentBuild: [x86, arm],
    })

    expect(result.unexpected).toEqual([])
    expect(await readFile(join(dist, arm), 'utf8')).toBe('arm-build')
    expect(await readFile(join(dist, x86), 'utf8')).toBe('x86-build')
  })

  it('dist 里出现非本次产物时报出来', async () => {
    // dist 每次构建都先清空，这里还能出现外来包，说明构建自身有问题，必须可见。
    const dist = await makeDir()
    const target = fpkReleaseFileName('app', 'x86', 'v7.1.0', '0.2.1-rc.5')
    await writeFile(join(dist, 'app-x86-v7.0.0-dsh-0.2.1-rc.3.fpk'), 'foreign')
    await writeFile(join(dist, 'app.fpk'), 'fresh')

    const result = await finalizeFpkArtifact({
      distDirectory: dist,
      appName: 'app',
      target,
      currentBuild: [target],
    })

    expect(result.unexpected).toEqual(['app-x86-v7.0.0-dsh-0.2.1-rc.3.fpk'])
  })

  it('目标名在本次构建内被重复占用时报告（命名模板缺平台段的信号）', async () => {
    const dist = await makeDir()
    const target = fpkReleaseFileName('app', 'x86', 'v7.1.0', '0.2.1-rc.5')
    await writeFile(join(dist, target), 'first')
    await writeFile(join(dist, 'app.fpk'), 'second')

    const result = await finalizeFpkArtifact({
      distDirectory: dist,
      appName: 'app',
      target,
      currentBuild: [target],
    })

    expect(result.replacedStaleTarget).toBe(true)
  })

  it('没有 fnpack 固定名产物时直接报错，不去猜别的 .fpk', async () => {
    // FNOS-037 的约定：兜底「取目录里第一个」正是当年错配的来源。
    const dist = await makeDir()
    await writeFile(join(dist, 'some-old.fpk'), 'old')

    await expect(finalizeFpkArtifact({
      distDirectory: dist,
      appName: 'app',
      target: 'app-x86-v7.0.0-dsh-0.2.1-rc.5.fpk',
      currentBuild: [],
    })).rejects.toThrow(/fnpack produced no app\.fpk/u)
  })
})

describe('listLegacyRootArtifacts', () => {
  it('列出应用根目录遗留的历史产物，供提示而不删除', async () => {
    const app = await makeDir()
    await writeFile(join(app, 'app-v7.0.16-dsh-0.2.1-rc.5.fpk'), 'legacy')
    await writeFile(join(app, 'app-v7.0.15-dsh-0.2.1-rc.5.fpk'), 'legacy')
    await writeFile(join(app, 'manifest'), 'appname = app\n')
    await mkdir(join(app, 'dist'), { recursive: true })
    await writeFile(join(app, 'dist', 'app-x86-v7.0.17-dsh-0.2.1-rc.5.fpk'), '本次产物')

    const legacy = await listLegacyRootArtifacts(app)

    // 只报根目录那层：dist 里的本次产物不是遗留物。
    expect(legacy).toEqual(['app-v7.0.15-dsh-0.2.1-rc.5.fpk', 'app-v7.0.16-dsh-0.2.1-rc.5.fpk'])
  })

  it('没有遗留产物时返回空数组', async () => {
    const app = await makeDir()
    await writeFile(join(app, 'manifest'), 'appname = app\n')

    expect(await listLegacyRootArtifacts(app)).toEqual([])
  })
})
