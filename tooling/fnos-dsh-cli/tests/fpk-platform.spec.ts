import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  FPK_PLATFORMS,
  isFpkPlatform,
  parseFpkPlatforms,
  readManifestPlatformValue,
  resolveFpkPlatforms,
  withManifestPlatform,
  writeManifestPlatform,
} from '../src/core/fpk-platform.js'
import { withStagedFpkPlatform } from '../src/core/fpk-staging.js'
import { optionValues } from '../src/core/args.js'

/**
 * FNOS-044：FPK 的平台维度。
 *
 * `fnpack` 没有平台参数，包内平台声明完全来自被打包的那份 `manifest`。因此「出 ARM
 * 包」这件事的全部实现就是「换掉那一行再打包」，而换行的方式决定了两个必须守住的性质：
 *
 * 1. **仓库里那份清单不能被改动**——它是受版本管理的事实来源；
 * 2. **改写只能动 platform 那一行**——多改一行就等于在构建里偷偷改应用配置。
 */

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function makeDir(prefix = 'fpk-platform-'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

const MANIFEST = [
  'appname               = fn-demo',
  'version               = 1.0.0',
  'display_name          = Demo',
  'platform              = x86',
  'source                = thirdparty',
  '',
].join('\n')

describe('withManifestPlatform', () => {
  it('只替换 platform 的值，保留键值对齐的空白', () => {
    const updated = withManifestPlatform(MANIFEST, 'arm')
    expect(updated).toContain('platform              = arm')
    // 对齐靠空格维持；改成单空格会让 diff 看起来像重排了整段配置。
    expect(updated.split('\n')[3]).toMatch(/^platform {14}= arm$/u)
  })

  it('除 platform 行外其余内容逐字节不变', () => {
    const updated = withManifestPlatform(MANIFEST, 'arm')
    const before = MANIFEST.split('\n')
    const after = updated.split('\n')
    expect(after.length).toBe(before.length)
    before.forEach((line, index) => {
      if (line.startsWith('platform')) expect(after[index]).not.toBe(line)
      else expect(after[index]).toBe(line)
    })
  })

  it('没有 platform 行时报错，不替应用补一行它没声明的平台', () => {
    const source = 'appname = fn-demo\nversion = 1.0.0\n'
    expect(() => withManifestPlatform(source, 'x86')).toThrow(/no platform field/u)
  })
})

describe('readManifestPlatformValue', () => {
  it('读出清单声明的原始值', () => {
    expect(readManifestPlatformValue(MANIFEST)).toBe('x86')
    expect(readManifestPlatformValue(withManifestPlatform(MANIFEST, 'arm'))).toBe('arm')
  })

  it('缺失时返回 undefined', () => {
    expect(readManifestPlatformValue('appname = fn-demo\n')).toBeUndefined()
  })
})

describe('resolveFpkPlatforms', () => {
  it('显式选择优先于清单声明', () => {
    expect(resolveFpkPlatforms({ appName: 'demo', declared: 'x86', requested: ['arm'] })).toEqual(['arm'])
  })

  it('没有显式选择时取清单声明的那一份', () => {
    // 保证「不加平台参数」的构建与加平台维度之前等价。
    expect(resolveFpkPlatforms({ appName: 'demo', declared: 'x86', requested: undefined })).toEqual(['x86'])
  })

  it('清单没声明平台时报错，不默认 x86', () => {
    // 默认值会让一个未声明平台的应用静默产出带平台段的包：名字声称支持某类设备，
    // 包内却没有任何依据。
    expect(() => resolveFpkPlatforms({ appName: 'demo', declared: undefined, requested: undefined }))
      .toThrow(/apps\/demo\/manifest declares no platform/u)
  })

  it('清单声明 all 时说清「不是构建目标」，而不是谎称没声明', () => {
    // `all` 是 manifest 合法值；把它压成「没声明」会把读的人指向错的修改方向。
    expect(() => resolveFpkPlatforms({ appName: 'demo', declared: 'all', requested: undefined }))
      .toThrow(/platform = all, which is not a build target/u)
  })

  it('显式选择可以绕过清单里不能作为目标的声明', () => {
    expect(resolveFpkPlatforms({ appName: 'demo', declared: 'all', requested: ['arm'] })).toEqual(['arm'])
  })
})

describe('parseFpkPlatforms', () => {
  it('保持传入顺序并去重', () => {
    expect(parseFpkPlatforms(['arm', 'x86'])).toEqual(['arm', 'x86'])
    expect(parseFpkPlatforms(['x86', 'x86'])).toEqual(['x86'])
  })

  it('大小写与空白不参与判定', () => {
    expect(parseFpkPlatforms([' X86 '])).toEqual(['x86'])
  })

  it('非法取值报错并列出允许值，而不是静默忽略', () => {
    // 静默丢弃会让「以为打了 arm、实际只打了 x86」在产物列表里完全看不出来，
    // 而装机失败发生在用户侧。
    expect(() => parseFpkPlatforms(['x86', 'mips'])).toThrow(/Supported platforms: x86, arm/u)
  })

  it('`all` 不在构建可选项里', () => {
    // 官方允许 `all`，但它的适用条件是包内不含架构相关二进制且已验证；发布方无 ARM
    // 设备，提供 `all` 等于把未验证的适用范围推给全部用户。
    expect(FPK_PLATFORMS).not.toContain('all')
    expect(isFpkPlatform('all')).toBe(false)
  })
})

describe('optionValues', () => {
  it('收集重复选项的全部取值', () => {
    // `optionValue` 取最后一个；平台是集合，丢一次出现就等于少产一份包且不报错。
    expect(optionValues(['--platform', 'x86', '--app', 'a', '--platform', 'arm'], '--platform'))
      .toEqual(['x86', 'arm'])
  })

  it('选项后紧跟另一个选项时不把它的名字当成取值', () => {
    expect(optionValues(['--platform', '--app', 'a'], '--platform')).toEqual([])
  })
})

describe('withStagedFpkPlatform', () => {
  it('在副本里改写平台，源目录的清单保持不变', async () => {
    const source = await makeDir('fpk-src-')
    await writeFile(join(source, 'manifest'), MANIFEST)

    await withStagedFpkPlatform(source, 'arm', async stage => {
      expect(await readFile(join(stage, 'manifest'), 'utf8')).toContain('platform              = arm')
    })

    // 仓库清单被写脏之后，下一次构建会把脏值当作「原始值」捕获，永远还原不回 x86。
    expect(await readFile(join(source, 'manifest'), 'utf8')).toBe(MANIFEST)
  })

  it('回调结束后副本目录被删除', async () => {
    const source = await makeDir('fpk-src-')
    await writeFile(join(source, 'manifest'), MANIFEST)

    let stagePath = ''
    await withStagedFpkPlatform(source, 'x86', async stage => {
      stagePath = stage
    })
    expect(existsSync(stagePath)).toBe(false)
  })

  it('回调失败时同样删除副本目录并抛出原错误', async () => {
    const source = await makeDir('fpk-src-')
    await writeFile(join(source, 'manifest'), MANIFEST)

    let stagePath = ''
    await expect(withStagedFpkPlatform(source, 'arm', async stage => {
      stagePath = stage
      throw new Error('fnpack exited with code 1')
    })).rejects.toThrow(/fnpack exited with code 1/u)

    expect(existsSync(stagePath)).toBe(false)
    expect(await readFile(join(source, 'manifest'), 'utf8')).toBe(MANIFEST)
  })

  it('排除 tests/、node_modules/ 与历史 .fpk 产物', async () => {
    const source = await makeDir('fpk-src-')
    await writeFile(join(source, 'manifest'), MANIFEST)
    await mkdir(join(source, 'cmd'))
    await mkdir(join(source, 'tests'))
    await mkdir(join(source, 'node_modules'))
    await writeFile(join(source, 'cmd', 'main'), '#!/bin/sh\n')
    await writeFile(join(source, 'tests', 'e2e.spec.ts'), '// 真机取证产物，2.9 GB 量级')
    await writeFile(join(source, 'node_modules', 'left.js'), '// 依赖树')
    await writeFile(join(source, 'demo-x86-v1.0.0-dsh-0.1.0.fpk'), 'stale-artifact')

    await withStagedFpkPlatform(source, 'arm', async stage => {
      // fnpack 需要的输入必须在场。
      expect(await readFile(join(stage, 'manifest'), 'utf8')).toContain('platform              = arm')
      expect(existsSync(join(stage, 'cmd', 'main'))).toBe(true)
      // 不需要的大目录必须不在场：带上会让每次构建多复制 GB 级内容。
      expect(existsSync(join(stage, 'tests'))).toBe(false)
      expect(existsSync(join(stage, 'node_modules'))).toBe(false)
      expect(existsSync(join(stage, 'demo-x86-v1.0.0-dsh-0.1.0.fpk'))).toBe(false)
    })
  })

  it('应用目录本身位于名为 tests 或 node_modules 的父路径下时仍完整复制', async () => {
    // filter 拿到的是绝对源路径。若按绝对路径匹配排除段，检出被放在
    // `…/tests/fnos-dsh/apps/demo` 这类位置时整个应用会被排除干净，产出一个空包。
    const outer = await makeDir('fpk-nested-')
    const source = join(outer, 'tests', 'node_modules', 'apps', 'demo')
    await mkdir(source, { recursive: true })
    await writeFile(join(source, 'manifest'), MANIFEST)
    await mkdir(join(source, 'app'))
    await writeFile(join(source, 'app', 'payload.js'), '// 网关产物')

    await withStagedFpkPlatform(source, 'arm', async stage => {
      expect(await readFile(join(stage, 'app', 'payload.js'), 'utf8')).toContain('网关产物')
    })
  })

  it('保留生命周期脚本的可执行位', async () => {
    const source = await makeDir('fpk-src-')
    await writeFile(join(source, 'manifest'), MANIFEST)
    await mkdir(join(source, 'cmd'))
    await writeFile(join(source, 'cmd', 'install_callback'), '#!/bin/sh\n')
    await chmod(join(source, 'cmd', 'install_callback'), 0o755)

    await withStagedFpkPlatform(source, 'x86', async stage => {
      // fnpack 把文件模式带进包里；副本丢了执行位，装到 NAS 上生命周期脚本就跑不起来。
      const mode = (await stat(join(stage, 'cmd', 'install_callback'))).mode & 0o777
      expect(mode.toString(8)).toBe('755')
    })
  })
})

describe('writeManifestPlatform', () => {
  it('就地改写给定目录里的清单文件', async () => {
    const dir = await makeDir()
    await writeFile(join(dir, 'manifest'), MANIFEST)

    await writeManifestPlatform(dir, 'arm')

    expect(await readFile(join(dir, 'manifest'), 'utf8')).toContain('platform              = arm')
  })
})
