import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

/**
 * FPK 产物命名必须与 CI 一致。
 *
 * 本地构建以前只留 `fn-deepseek-harness.fpk`，而 CI 的
 * `.github/workflows/build-app.yml` 会把产物重命名成带版本的名字。两份产物同名不同款，
 * 装机时分不清手上这份来自哪次构建、对应哪个 DSH 基线。
 *
 * 这个测试钉住两边**同名同格式**：只要有一侧改了模板，这里就红。它断言的是「同一套
 * 占位符与分隔符」，不是某个具体版本号——版本每次发布都会变，把版本写死会让测试与它
 * 保护的产线一起过期。
 *
 * 命名模板自 FNOS-037 起由 `core/fpk-artifacts.ts` 的 `fpkReleaseFileName` 提供
 * （原先内联在 `build.ts`）；FNOS-044 起模板再加平台段。
 */

const BUILD = await readFile(new URL('../src/commands/build.ts', import.meta.url), 'utf8')
const ARTIFACTS = await readFile(new URL('../src/core/fpk-artifacts.ts', import.meta.url), 'utf8')
const WORKFLOW = await readFile(new URL('../../../.github/workflows/build-app.yml', import.meta.url), 'utf8')

/** 从 `VERSIONED_FPK=` / `return ` 赋值里取出模板字面量。 */
function templateOf(source: string, pattern: RegExp): string {
  const match = pattern.exec(source)
  if (match?.[1] === undefined) throw new Error(`找不到命名模板：${String(pattern)}`)
  return match[1]
}

const open = '$' + '{'
const close = '}'
const slot = (name: string): string => open + name + close

/**
 * 把两侧各自的插值语法归一成同一套占位符。
 *
 * workflow 用 shell 的 `${VAR}`、本地侧用 JS 模板字符串的 `${var}`；应用名在 workflow
 * 侧写死、本地侧是 `${appName}`，都归一成同一个名字才能比较「形状」。
 */
function normalize(value: string): string {
  return value
    .replaceAll(slot('RELEASE_TAG'), '<tag>')
    .replaceAll(slot('releaseTag'), '<tag>')
    .replaceAll(slot('DSH_BASELINE'), '<baseline>')
    .replaceAll(slot('baseline'), '<baseline>')
    .replaceAll(slot('PLATFORM'), '<platform>')
    .replaceAll(slot('platform'), '<platform>')
    .replaceAll(slot('appName'), 'fn-deepseek-harness')
}

describe('FPK 产物命名与 CI workflow 一致', () => {
  const workflowTemplate = templateOf(WORKFLOW, /VERSIONED_FPK="([^"]+)"/u)
  const buildTemplate = templateOf(ARTIFACTS, /return `([^`]*\.fpk)`/u)

  it('workflow 侧读的是 catalog 基线，而不是写死版本', () => {
    expect(WORKFLOW).toContain('DSH_BASELINE="$(sed -nE')
    expect(WORKFLOW).toContain("'@deepseek-ai\\/dsh'")
  })

  it('本地构建侧同样从 catalog 读基线', () => {
    expect(BUILD).toContain('requireDshBaseline()')
    expect(ARTIFACTS).not.toMatch(/DSH_BASELINE\s*=\s*'0\./u)
  })

  it('两侧的占位符与分隔符完全一致', () => {
    expect(normalize(buildTemplate)).toBe(normalize(workflowTemplate))
  })

  it('两端都以 .fpk 结尾、以 -dsh- 分隔基线、并带平台段', () => {
    for (const template of [workflowTemplate, buildTemplate]) {
      expect(template.endsWith('.fpk')).toBe(true)
      expect(template).toContain('-dsh-')
      // FNOS-044：少了平台段，同一版本的 x86 与 arm 两份包就同名，后打的静默顶掉先打的。
      expect(normalize(template)).toContain('<platform>')
    }
  })

  it('CI 为两个平台各产一份，且显式传平台而不是依赖清单缺省', () => {
    // manifest 只声明 x86；CI 不显式传 `--platform arm` 就只会得到一份 x86 包。
    expect(WORKFLOW).toMatch(/--platform x86 --platform arm/u)
    expect(WORKFLOW).toMatch(/for PLATFORM in x86 arm/u)
  })

  it('CI 逐平台核对产物，不再取目录里第一个 .fpk', () => {
    // 两份平台包同时在目录里时，`find … -print -quit` 只会挑到其中一份：另一份既不
    // 检查也不上传，而步骤照样成功——Release 少一个平台的包是无声的。
    // 断言针对命令形状而不是关键词：注释里提到这个写法是说明原因，不该把用例判红。
    expect(WORKFLOW).not.toMatch(/find \. -maxdepth 1 -type f -name '\*\.fpk'/u)
    expect(WORKFLOW).not.toMatch(/ORIGINAL_FPK=/u)
    expect(WORKFLOW).toMatch(/if \[ ! -f "\$VERSIONED_FPK" \]/u)
    expect(WORKFLOW).toMatch(/was not produced/u)
  })

  it('CI 上传全部平台的产物，任一失败即整体失败', () => {
    expect(WORKFLOW).toMatch(/for ASSET_PATH in \$FPK_FILES/u)
    expect(WORKFLOW).toMatch(/unable to upload after/u)
  })

  it('构建流程在打包之后按平台改名', () => {
    // 只加函数不接线是最容易犯的错：产物仍是旧名，且没有任何报错。
    expect(BUILD).toMatch(
      /await runCommand\('fnpack', \['build', '--directory', stageDirectory\], appDir\)[\s\S]{0,200}await renameFpkForRelease\(app, artifact\.target, targets\)/u,
    )
  })

  it('平台与目标名配对成一条记录，不按下标对齐两个数组', () => {
    // 分两个数组按下标取名字，改动其中一个就会让产物顶着别的平台的名字。
    expect(BUILD).toMatch(/platform,\s*\n?\s*target: fpkReleaseFileName\(/u)
    expect(BUILD).not.toMatch(/targets\[index\]/u)
  })

  it('没有精确 tag 时退回 manifest 版本并补 v 前缀', () => {
    // 与 `pnpm run version` 打出的 tag 形态一致（v7.0.16）。
    expect(BUILD).toMatch(/return `v\$\{version\}`/u)
    expect(BUILD).toContain('git')
    expect(BUILD).toContain('--exact-match')
  })

  it('源文件按 fnpack 固定名取，不扫目录里第一个 .fpk', () => {
    // FNOS-037 的真实缺陷：残留的版本化产物会排在前面被选中，于是旧包被改成
    // 新名字、新包留在原名，产物名字与内容对不上且不报错。
    expect(ARTIFACTS).toMatch(/const from = `\$\{appName\}\.fpk`/u)
    expect(BUILD).not.toMatch(/readdir\(appDir\)\)\.find\(entry => entry\.endsWith\('\.fpk'\)\)/u)
  })
})
