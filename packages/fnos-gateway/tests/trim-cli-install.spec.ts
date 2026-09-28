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

  it('installs the global latest package and copies its skill into HOME', async () => {
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
    expect(output).toContain(`helper:copy-trim-cli-skill:${packageDirectory}:${join(root, 'home', '.agents', 'skills', 'trim-cli')}`)
  })
})
