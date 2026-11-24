import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const scriptPath = new URL('../../../apps/fn-deepseek-harness/cmd/install_callback', import.meta.url)

/** 去掉 shell 注释，避免断言匹配到说明性文字。 */
async function uncommented(): Promise<string> {
  return (await readFile(scriptPath, 'utf8')).replaceAll(/#[^\n]*/gu, '')
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
})

describe('应用不再代装 CLI 与 skill', () => {
  /*
    这两项都曾由应用单方面写进用户环境：

    - `@trimjs/trim-cli` 装在 npm global（`install_trim_cli`）；
    - `fnos-cli` skill 复制到 `~/.agents/skills`（`install_fnos_cli_skill`）。

    CLI 与 skill 都属于用户的 agent 环境，不该由应用代管。现在两者都不再由
    安装流程写入；老用户机器上已有的目录也不在升级时删——迁移要由用户自己在
    「飞牛设置 → 插件管理 → 工具箱」里发起。
  */

  it('没有 install_trim_cli，也不再有 TRIM_CLI_PACKAGE', async () => {
    const source = await uncommented()
    expect(source).not.toContain('install_trim_cli')
    expect(source).not.toContain('TRIM_CLI_PACKAGE')
    expect(source).not.toContain('trim_cli_package_directory')
  })

  it('没有 install_fnos_cli_skill，也不再调 install-skill', async () => {
    const source = await uncommented()
    expect(source).not.toContain('install_fnos_cli_skill')
    expect(source).not.toContain('FNOS_CLI_SKILL_NAME')
    expect(source).not.toContain('install-skill')
  })

  it('升级时也不删用户已有的 skill 目录', async () => {
    /**
     * `~/.agents/skills` 是**用户的目录**。在版本升级时悄悄抹掉它，等于用
     * 「我认为它没用了」覆盖「用户的实际情况」——而这轮改动的起因正是应用越权
     * 代装，用另一次越权去修它逻辑上自相矛盾。
     */
    const source = await uncommented()
    expect(source).not.toContain('remove_bundled_agent_skills')
    expect(source).not.toContain('rm -rf')
    expect(source).not.toContain('.agents/skills')
  })

  it('包内不再分发 skills 目录', async () => {
    const { stat } = await import('node:fs/promises')
    const skills = new URL('../../../apps/fn-deepseek-harness/app/skills/', import.meta.url)
    // 目录整个删掉了：安装流程已不读它，留着只会让后来者以为还有用。
    await expect(stat(skills)).rejects.toThrow()
  })
})
