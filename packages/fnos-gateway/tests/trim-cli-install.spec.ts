import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const scriptPath = new URL('../../../apps/fn-deepseek-harness/cmd/install_callback', import.meta.url)
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function functionSource(name: string): Promise<string> {
  const source = await readFile(scriptPath, 'utf8')
  const start = source.indexOf(`${name}() {`)
  if (start < 0) throw new Error(`function ${name} not found in install_callback`)
  const end = source.indexOf('\n}\n', start)
  if (end < 0) throw new Error(`function ${name} is not terminated`)
  return source.slice(start, end + 3)
}

describe('trim-cli install', () => {
  it('uses the application HOME npmrc instead of a manifest registry value', async () => {
    const installCallback = await readFile(scriptPath, 'utf8')
    const upgradeCallback = await readFile(new URL('../../../apps/fn-deepseek-harness/cmd/upgrade_callback', import.meta.url), 'utf8')

    const homeNpmrc = ['NPM_USER_CONFIG_FILE="', '$', '{APP_HOME}/.npmrc"'].join('')
    expect(installCallback).toContain(homeNpmrc)
    expect(upgradeCallback).toContain(homeNpmrc)
    expect(installCallback).not.toContain('published-dsh-plugins.json registry')
  })

  it('runs global trim-cli installation before DSH profile plugins', async () => {
    const source = await readFile(scriptPath, 'utf8')
    const trimCliCall = source.lastIndexOf('    install_trim_cli\n')
    const pluginCall = source.lastIndexOf('    install_published_dsh_plugins\n')

    expect(trimCliCall).toBeGreaterThan(-1)
    expect(trimCliCall).toBeLessThan(pluginCall)
  })

  it('installs the global latest package without copying any skill', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fnos-trim-cli-install-'))
    temporaryRoots.push(root)
    const prefix = join(root, 'prefix')
    const globalRoot = join(prefix, 'lib', 'node_modules')
    const packageDirectory = join(globalRoot, '@trimjs', 'trim-cli')
    const npm = join(root, 'npm')
    const calls = join(root, 'npm-calls')
    await mkdir(packageDirectory, { recursive: true })
    await writeFile(join(packageDirectory, 'package.json'), JSON.stringify({ name: '@trimjs/trim-cli' }))
    await writeFile(npm, `#!/bin/bash\nprintf '%s\\n' "$*" >>${JSON.stringify(calls)}\n`)
    await chmod(npm, 0o755)

    const harness = join(root, 'harness.sh')
    const script = [
      '#!/bin/bash',
      `HOME=${JSON.stringify(join(root, 'home'))}`,
      `NPM_BIN=${JSON.stringify(npm)}`,
      `NPM_CONFIG_PREFIX=${JSON.stringify(prefix)}`,
      'TRIM_CLI_PACKAGE="@trimjs/trim-cli"',
      'fail_install() { printf "FAIL:%s\\n" "$1"; exit 99; }',
      'log_info() { :; }',
      `global_package_root() { printf '%s' ${JSON.stringify(globalRoot)}; }`,
      'run_install_callback_helper() { printf "helper:%s:%s:%s\\n" "$1" "$2" "$3"; }',
      await functionSource('trim_cli_package_directory'),
      await functionSource('install_trim_cli'),
      'install_trim_cli',
    ].join('\n')
    await writeFile(harness, script)
    await chmod(harness, 0o755)

    const output = execFileSync('/bin/bash', [harness], { encoding: 'utf8' })

    expect(await readFile(calls, 'utf8')).toContain('@trimjs/trim-cli@latest -g --ignore-scripts')
    // trim-cli 的 skill 不再随包内置：老用户机器上已有的目录保持原样，
    // 这里也不应再发起任何复制。
    expect(output).not.toContain('copy-trim-cli-skill')
    expect(output).not.toContain('.agents/skills/trim-cli')
  })
})

describe('FNOS-041 内置 skill 换成 fnos-cli', () => {
  // 断言里要出现 shell 变量展开，直接写进字符串会触发 no-template-curly-in-string，
  // 这里按既有用例的做法拼出来。
  const dollar = '$'

  it('从包内 skills 目录安装到用户 agents 目录', async () => {
    const source = await readFile(scriptPath, 'utf8')
    expect(source).toContain('FNOS_CLI_SKILL_NAME="fnos-cli"')
    expect(source).toContain(`"${dollar}{APP_DEST}/skills/${dollar}{FNOS_CLI_SKILL_NAME}"`)
    expect(source).toContain(`"${dollar}{HOME}/.agents/skills/${dollar}{FNOS_CLI_SKILL_NAME}"`)
    expect(source).toContain('run_install_callback_helper install-skill')
  })

  it('用户已安装时只记日志，不覆盖也不失败', async () => {
    const source = await readFile(scriptPath, 'utf8')
    // helper 输出 skipped 时走「保留用户自己那份」分支。
    expect(source).toContain('skipped)')
    expect(source).toContain('Keeping the user-installed')
  })

  it('不再写入或删除 trim-cli skill 目录', async () => {
    // 去掉注释再断言：脚本里保留了「老用户的 trim-cli skill 保持原样」的说明，
    // 直接匹配全文会把这条说明误判成还在操作该目录。
    const source = (await readFile(scriptPath, 'utf8'))
      .replaceAll(/#[^\n]*/gu, '')
    expect(source).not.toContain('copy-trim-cli-skill')
    expect(source).not.toContain(`.agents/skills/trim-cli`)
    expect(source).not.toContain(`rm -rf "${dollar}{HOME}/.agents`)
  })

  it('随包 skill 目录里有可执行的启动器', async () => {
    const { stat } = await import('node:fs/promises')
    const base = new URL('../../../apps/fn-deepseek-harness/app/skills/fnos-cli/', import.meta.url)
    const skillStat = await stat(new URL('SKILL.md', base))
    const launcherStat = await stat(new URL('scripts/fnos-cli', base))

    expect(skillStat.isFile()).toBe(true)
    // 启动器丢了执行位，首次调用会以权限不足失败。
    expect(launcherStat.mode & 0o111).toBeGreaterThan(0)
  })
})
