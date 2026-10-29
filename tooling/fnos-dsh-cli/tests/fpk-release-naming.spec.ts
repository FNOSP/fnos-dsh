import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

/**
 * FPK 产物命名必须与 CI 一致。
 *
 * 本地构建以前只留 `fn-deepseek-harness.fpk`，而 CI 的
 * `.github/workflows/build-app.yml` 会把产物重命名成
 * `<appname>-<RELEASE_TAG>-dsh-<DSH_BASELINE>.fpk`。两份产物同名不同款，
 * 装机时分不清手上这份来自哪次构建、对应哪个 DSH 基线。
 *
 * 这个测试钉住两边**同名同格式**：只要有一侧改了模板，这里就红。
 * 它断言的是「同一套占位符与分隔符」，不是某个具体版本号——版本每次发布都会变，
 * 把版本写死会让测试与它保护的产线一起过期。
 */

const BUILD = await readFile(new URL('../src/commands/build.ts', import.meta.url), 'utf8')
const WORKFLOW = await readFile(new URL('../../../.github/workflows/build-app.yml', import.meta.url), 'utf8')

/** 从 `VERSIONED_FPK=` / `versioned = ` 赋值里取出模板字面量。 */
function templateOf(source: string, pattern: RegExp): string {
  const match = pattern.exec(source)
  if (match?.[1] === undefined) throw new Error(`找不到命名模板：${String(pattern)}`)
  return match[1]
}

describe('FPK 产物命名与 CI workflow 一致', () => {
  const workflowTemplate = templateOf(WORKFLOW, /VERSIONED_FPK="([^"]+)"/u)
  const buildTemplate = templateOf(BUILD, /const versioned = `([^`]+)`/u)

  it('workflow 侧读的是 catalog 基线，而不是写死版本', () => {
    expect(WORKFLOW).toContain('DSH_BASELINE="$(sed -nE')
    expect(WORKFLOW).toContain("'@deepseek-ai\\/dsh'")
  })

  it('本地构建侧同样从 catalog 读基线', () => {
    expect(BUILD).toContain('requireDshBaseline()')
    expect(BUILD).not.toMatch(/const DSL_BASELINE|DSH_BASELINE\s*=\s*'0\./u)
  })

  it('两侧的占位符与分隔符完全一致', () => {
    // workflow 用 shell 的 VAR 插值，build.ts 用模板字符串插值；先把两边各自
    // 的插值语法归一成同一个占位符，再比较「形状」是否一致。
    // 应用名一侧写死、一侧用 `${app.name}`：都归一成 <app> 才能比较。
    const open = '$' + '{'
    const close = '}'
    const slot = (name: string): string => open + name + close
    const normalize = (value: string): string => value
      .replaceAll(slot('RELEASE_TAG'), '<tag>')
      .replaceAll(slot('await resolveReleaseTag()'), '<tag>')
      .replaceAll(slot('DSH_BASELINE'), '<baseline>')
      .replaceAll(slot('requireDshBaseline()'), '<baseline>')
      .replaceAll(slot('app.name'), 'fn-deepseek-harness')
    expect(normalize(buildTemplate)).toBe(normalize(workflowTemplate))
  })

  it('两端都以 .fpk 结尾且都以 -dsh- 分隔基线', () => {
    for (const template of [workflowTemplate, buildTemplate]) {
      expect(template.endsWith('.fpk')).toBe(true)
      expect(template).toContain('-dsh-')
    }
  })

  it('构建流程在打包之后调用重命名', () => {
    // 只加函数不接线是最容易犯的错：产物仍是旧名，且没有任何报错。
    expect(BUILD).toMatch(/await runCommand\('fnpack', \['build'\][\s\S]{0,120}await renameFpkForRelease\(app\)/u)
  })

  it('没有精确 tag 时退回 manifest 版本并补 v 前缀', () => {
    // 与 `pnpm run version` 打出的 tag 形态一致（v6.2.2）。
    expect(BUILD).toMatch(/return `v\$\{version\}`/u)
    expect(BUILD).toContain('git')
    expect(BUILD).toContain('--exact-match')
  })
})
