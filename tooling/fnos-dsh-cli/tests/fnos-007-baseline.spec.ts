import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 运行时基线只从 catalog 读取，不在测试里另写一份字面量。
 *
 * 把版本写死在这里，每次更新 DSH 基线都要同时改测试与 catalog 两处：漏改一处，
 * 守卫会在版本已经升级之后继续断言旧值——它与它保护的发布一起过期，报错信息却
 * 只说「不匹配」。仓库其它守卫已按同一理由改为「读来源、不重述值」。
 */
async function runtimeBaseline(): Promise<string> {
  const workspace = await readFile(new URL('../../../pnpm-workspace.yaml', import.meta.url), 'utf8')
  const match = workspace.match(/'@deepseek-ai\/dsh':\s*(\d[0-9A-Za-z.+-]*)/u)
  if (match?.[1] === undefined) throw new Error('pnpm-workspace.yaml must declare @deepseek-ai/dsh in the catalog')
  return match[1]
}

const targetVersion = await runtimeBaseline()
// 覆盖面刻意含 dsh-failover-search-plugin：本列表被多个仓库级守卫共用
// （基线、清单一致性、catalog 声明）。漏掉它曾使该插件的
// compatibility.json 清单无人守门——FNOS-012-05 立项的正是这个缺口，
// 而当时的守卫在变异检验下对该插件「恒真」。
// 新增插件必须一并加入本列表：漏项 = 该插件的清单与 catalog 声明无人守门。
const pluginDirectories = [
  'dsh-codex-auth-plugin',
  'dsh-failover-search-plugin',
  'dsh-fnos-plugin',
  'dsh-midscene-plugin',
  'dsh-semi-ui-showcase-plugin',
]

/**
 * The plugins with a source directory in this repo, mapped to that directory.
 *
 * `dsh-semi-ui-showcase-plugin` is intentionally absent: it is published but
 * not bundled into the package, so it has no entry in the manifest.
 *
 * CodeBuddy was removed from this list on 2026-10-22: it was delisted and no
 * longer bundled with the FPK (see FNOS-025).
 */
const bundledPluginDirectories = {
  '@tnnevol/dsh-codex-auth': 'dsh-codex-auth-plugin',
  '@tnnevol/dsh-failover-search': 'dsh-failover-search-plugin',
  '@tnnevol/dsh-fnos': 'dsh-fnos-plugin',
  '@tnnevol/dsh-midscene': 'dsh-midscene-plugin',
} as const

describe('FNOS-007 DSH baseline', () => {
  it('synchronizes the development host DSH CLI with the FPK catalog', async () => {
    const rootPackage = JSON.parse(await readFile(new URL('../../../package.json', import.meta.url), 'utf8')) as {
      devDependencies: Record<string, string>
    }
    const workspace = await readFile(new URL('../../../pnpm-workspace.yaml', import.meta.url), 'utf8')
    expect(rootPackage.devDependencies['@deepseek-ai/dsh']).toBe('catalog:')
    expect(rootPackage.devDependencies['@deepseek-ai/dsh-llm-pi-ai']).toBe('catalog:dsh')
    expect(workspace).toMatch(new RegExp(`'@deepseek-ai/dsh':\\s*${targetVersion.replaceAll('.', '\\.')}`, 'u'))
    expect(workspace).toMatch(new RegExp(`'@deepseek-ai/dsh-llm-pi-ai':\\s*${targetVersion.replaceAll('.', '\\.')}`, 'u'))
  })

  it('keeps every plugin DSH dependency on the catalog and its engines.dsh on the runtime baseline', async () => {
    // DSH 运行时版本只有 catalog 一处事实来源（FNOS-029）：插件 manifest 里的
    // peer 与开发依赖一律写 `catalog:dsh`，不写字面版本；兼容判定由
    // `engines.dsh` 承担，它必须等于 catalog 基线，否则本地联调会把插件整体跳过。
    for (const directory of pluginDirectories) {
      const manifest = JSON.parse(await readFile(new URL(`../../../plugins/${directory}/package.json`, import.meta.url), 'utf8')) as {
        dependencies?: Record<string, string>
        devDependencies?: Record<string, string>
        peerDependencies?: Record<string, string>
        optionalDependencies?: Record<string, string>
        engines?: { dsh?: string }
      }
      expect(manifest.engines?.dsh, `${directory}:engines.dsh`).toBe(targetVersion)
      for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const) {
        for (const [name, range] of Object.entries(manifest[field] ?? {})) {
          if (!name.startsWith('@deepseek-ai/dsh')) continue
          expect(range, `${directory}:${field}.${name}`).toBe('catalog:dsh')
        }
      }
    }
  })

  it('declares the runtime baseline in every plugin compatibility manifest', async () => {
    for (const directory of pluginDirectories) {
      const compatibility = JSON.parse(await readFile(new URL(`../../../plugins/${directory}/compatibility.json`, import.meta.url), 'utf8')) as {
        dshPluginApi: { version: string }
      }
      expect(compatibility.dshPluginApi.version, directory).toBe(targetVersion)
    }
  })

  it('keeps every documented install command on the released plugin version', async () => {
    // The install command is executable: a user pastes it. If it lags the
    // released version, `dsh plugin add` installs the old package while the
    // version table beside it claims the new one. `version -- plugin` now
    // rewrites these lines, and this test is the independent check that no
    // page was missed.
    const published = JSON.parse(await readFile(new URL('../../../apps/fn-deepseek-harness/app/published-dsh-plugins.json', import.meta.url), 'utf8')) as {
      plugins: Array<{ name: string, version: string }>
    }
    const documented: Array<[string, string]> = [
      ['plugins/dsh-codex-auth-plugin/README.md', '@tnnevol/dsh-codex-auth'],
      ['plugins/dsh-failover-search-plugin/README.md', '@tnnevol/dsh-failover-search'],
      ['plugins/dsh-fnos-plugin/README.md', '@tnnevol/dsh-fnos'],
      ['plugins/dsh-semi-ui-showcase-plugin/README.md', '@tnnevol/dsh-semi-ui-showcase'],
      ['docs/plugins/dsh-codex-auth.md', '@tnnevol/dsh-codex-auth'],
      ['docs/plugins/dsh-failover-search.md', '@tnnevol/dsh-failover-search'],
      ['docs/plugins/dsh-fnos.md', '@tnnevol/dsh-fnos'],
      ['docs/plugins/index.md', '@tnnevol/dsh-fnos'],
      ['docs/plugins/index.md', '@tnnevol/dsh-failover-search'],
      // midscene 不随 FPK 内置，但它同样发布到 npm、同样有可粘贴的安装命令。
      // 漏掉它曾让该页的安装版本停在旧值而无人报错（实测：文档 0.2.0-rc.2.0、
      // 实际已 0.2.0-rc.2.3，全靠人工核对才发现）。
      ['docs/plugins/dsh-midscene.md', '@tnnevol/dsh-midscene'],
      ['plugins/dsh-midscene-plugin/README.md', '@tnnevol/dsh-midscene'],
    ]
    const showcaseDirectory = 'dsh-semi-ui-showcase-plugin'
    const sourceVersions = new Map<string, string>()
    for (const [name, directory] of Object.entries({ ...bundledPluginDirectories, '@tnnevol/dsh-semi-ui-showcase': showcaseDirectory })) {
      const source = JSON.parse(await readFile(new URL(`../../../plugins/${directory}/package.json`, import.meta.url), 'utf8')) as { version: string }
      sourceVersions.set(name, source.version)
      // The manifest is a copy; when it carries the plugin it must agree.
      const publishedEntry = published.plugins.find(plugin => plugin.name === name)
      if (publishedEntry !== undefined) expect(publishedEntry.version, `${name} manifest version`).toBe(source.version)
    }
    for (const [file, name] of documented) {
      const content = await readFile(new URL(`../../../${file}`, import.meta.url), 'utf8')
      const match = new RegExp(`add ${name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}@([0-9A-Za-z][0-9A-Za-z.+-]*)`).exec(content)
      expect(match, `${file} must document an install command for ${name}`).not.toBeNull()
      expect(match?.[1], `${file} install version for ${name}`).toBe(sourceVersions.get(name))
    }
  })

  it('keeps the FPK plugin manifest pinned to each plugin source version', async () => {
    const published = JSON.parse(await readFile(new URL('../../../apps/fn-deepseek-harness/app/published-dsh-plugins.json', import.meta.url), 'utf8')) as {
      plugins: Array<{ name: string, version: string, source?: string }>
      registry?: string
      bundled?: Array<{ name: string, version: string }>
    }
    // The manifest is a copy of each plugin's own version, so assert the copy
    // against its source instead of restating the expected value here. A
    // literal in the test rots exactly like one in the build guard: both said
    // 0.2.0-rc.2 after the plugins moved to 0.2.0-rc.2.0, so the test went red
    // while the release it was meant to protect still shipped a stale pin.
    for (const name of ['@tnnevol/dsh-codex-auth', '@tnnevol/dsh-fnos'] as const) {
      const directory = bundledPluginDirectories[name]
      const source = JSON.parse(await readFile(new URL(`../../../plugins/${directory}/package.json`, import.meta.url), 'utf8')) as { version: string }
      expect(published.plugins.find(plugin => plugin.name === name), name).toEqual({ name, version: source.version })
    }
    // 两个自有插件（Codex Auth、fnOS）+ Failover Search（均随 FPK 安装）+ 三方 dshmarket。
    // `@tnnevol/dsh-midscene` 不随 FPK 分发，由需要的人自行安装。
    // CodeBuddy 已于 2026-10-22 下架，不再随 FPK 内置（见 FNOS-025）。
    expect(published.plugins).toHaveLength(4)
    // Third-party dshmarket has no local source, so its exact pin stays a
    // literal: the registry version is the contract, not a copy. 每次更新 DSH
    // 基线都要同步升级它，否则其 peer 范围可能不覆盖新基线而被兼容门禁拒绝。
    expect(published.plugins.find(plugin => plugin.name === 'dshmarket')).toEqual({ name: 'dshmarket', version: '1.66.47', source: 'thirdparty' })
    expect(published.registry).toBeUndefined()
    expect(published.bundled ?? []).toEqual([])

    // node-pty 使用随 npm 包发布的平台预编译产物，安装不再需要 g++，FPK 也不再
    // 内置原生产物；这里锁住该约束，避免旧的内置管线被重新引入。
    const callback = await readFile(new URL('../../../apps/fn-deepseek-harness/cmd/install_callback', import.meta.url), 'utf8')
    expect(callback).not.toContain('DSH_NATIVE_BUNDLE')
    expect(callback).not.toContain('has_bundled_node_pty')
    expect(callback).not.toContain('node-pty-versions')
  })

  it('aligns shared upstream support packages with the target checkout', async () => {
    const workspace = await readFile(new URL('../../../pnpm-workspace.yaml', import.meta.url), 'utf8')
    // 与上游 checkout 的 vendor 版本对齐；这里只断言「存在且为 4.x / 3.x」，
    // 具体补丁号随基线走，不在此重述。
    expect(workspace).toMatch(/'@deepseek-ai\/cordis':\s*\^4\./u)
    expect(workspace).toMatch(/'@deepseek-ai\/schemastery':\s*3\./u)
  })

  it('keeps terminal environment adaptation in the gateway runtime', async () => {
    const main = await readFile(new URL('../../../apps/fn-deepseek-harness/cmd/main', import.meta.url), 'utf8')
    const gatewayEnv = await readFile(new URL('../../../packages/fnos-gateway/src/config/dsh-runtime-env.ts', import.meta.url), 'utf8')
    expect(main).not.toContain('resolve_terminal_shell')
    expect(main).not.toContain('resolve_utf8_locale')
    expect(gatewayEnv).toContain('resolveTerminalShell')
    expect(gatewayEnv).toContain('resolveUtf8Locale')
    expect(gatewayEnv).toContain('environment.SHELL')
    expect(gatewayEnv).toContain('environment.LC_CTYPE')
  })

  it('keeps the install wizard localhost-only', async () => {
    const wizard = JSON.parse(await readFile(new URL('../../../apps/fn-deepseek-harness/wizard/install', import.meta.url), 'utf8')) as Array<{
      items: Array<{ field?: string, type: string, initValue?: string }>
    }>
    const items = wizard[0]?.items ?? []
    expect(items.find(item => item.field === 'wizard_host')).toBeUndefined()

    const main = await readFile(new URL('../../../apps/fn-deepseek-harness/cmd/main', import.meta.url), 'utf8')
    const defaultHost = ['REQUESTED_HOST="', '$', '{wizard_host:-127.0.0.1}', '"'].join('')
    expect(main).toContain(defaultHost)
  })

  it('keeps config and upgrade wizard fields aligned with install and puts npm registry last', async () => {
    type WizardItem = { field?: string, label?: string, type: string }
    const readWizardItems = async (name: string): Promise<WizardItem[]> => {
      const wizard = JSON.parse(await readFile(new URL(`../../../apps/fn-deepseek-harness/wizard/${name}`, import.meta.url), 'utf8')) as Array<{
        items: WizardItem[]
      }>
      return wizard[0]?.items.filter(item => item.field !== undefined) ?? []
    }
    const installItems = await readWizardItems('install')
    const configItems = await readWizardItems('config')
    const upgradeItems = await readWizardItems('upgrade')
    const expectedFields = [
      'wizard_port',
      'wizard_trusted_hosts',
      'wizard_npm_registry',
    ]

    expect(installItems.map(item => item.field)).toEqual(expectedFields)
    expect(configItems.map(item => item.field)).toEqual(expectedFields)
    expect(upgradeItems.map(item => item.field)).toEqual(expectedFields)
    expect(new Set(configItems.map(item => item.field))).toEqual(new Set(installItems.map(item => item.field)))
    expect(new Set(upgradeItems.map(item => item.field))).toEqual(new Set(installItems.map(item => item.field)))
    expect(installItems.find(item => item.field === 'wizard_npm_registry')?.label).not.toContain('（可选）')
    expect(configItems.find(item => item.field === 'wizard_npm_registry')?.label).not.toContain('（可选）')
    expect(upgradeItems.find(item => item.field === 'wizard_npm_registry')?.label).not.toContain('（可选）')
  })

  it('declares every DSH dependency through the pnpm catalog', async () => {
    // Versions live in pnpm-workspace.yaml only; a literal in a plugin manifest
    // is a second place to forget on the next baseline bump.
    for (const directory of pluginDirectories) {
      const manifest = JSON.parse(
        await readFile(new URL(`../../../plugins/${directory}/package.json`, import.meta.url), 'utf8'),
      ) as Record<string, Record<string, string> | undefined>
      for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        for (const [name, range] of Object.entries(manifest[field] ?? {})) {
          if (!name.startsWith('@deepseek-ai/')) continue
          if (field === 'peerDependencies' && name.startsWith('@deepseek-ai/dsh-')) continue
          expect(range, `${directory}:${field}:${name}`).toMatch(/^catalog:/u)
        }
      }
    }
  })

  it('never declares the inlined UI kit as a peer dependency', async () => {
    // `@tnnevol/dsh-semi-ui` 由 `packages/dsh-semi-ui/tsdown-client-deps.ts` 的
    // `alwaysBundle` **内联进客户端产物**，运行时不需要它；而它本身没有发布到 npm。
    // 一旦出现在 `peerDependencies` 里，`pnpm publish` 会把 `workspace:*` 解析成具体
    // 版本（实测 `5.7.3`），用户 `npm i` 时 npm 会去自动安装该 peer 并报
    // `E404 @tnnevol/dsh-semi-ui` —— **整包安装失败**。这台机器上完全静默（本仓
    // workspace 里它总是可解析），只在用户侧暴露，因此必须由静态守卫挡住。
    for (const directory of pluginDirectories) {
      const manifest = JSON.parse(
        await readFile(new URL(`../../../plugins/${directory}/package.json`, import.meta.url), 'utf8'),
      ) as { peerDependencies?: Record<string, string> }
      expect(
        manifest.peerDependencies?.['@tnnevol/dsh-semi-ui'],
        `${directory} 不得把内联的 UI kit 声明为 peer（会导致用户安装 E404）`,
      ).toBeUndefined()
    }
  })

  it('declares every catalog-managed workspace dependency through a catalog protocol', async () => {
    const workspace = await readFile(new URL('../../../pnpm-workspace.yaml', import.meta.url), 'utf8')
    const catalogPackages = new Set<string>()
    let section: 'catalog' | 'catalogs' | undefined
    for (const line of workspace.split(/\r?\n/u)) {
      if (line === 'catalog:') {
        section = 'catalog'
        continue
      }
      if (line === 'catalogs:') {
        section = 'catalogs'
        continue
      }
      if (/^[^\s#]/u.test(line)) {
        section = undefined
        continue
      }
      const indent = (line.match(/^ */u)?.[0].length ?? 0)
      const match = /^\s+(?:'([^']+)'|"([^"]+)"|([^:#][^:]*)):\s*/u.exec(line)
      if (match === null) continue
      const name = (match[1] ?? match[2] ?? match[3] ?? '').trim()
      if ((section === 'catalog' && indent === 2) || (section === 'catalogs' && indent === 4)) {
        catalogPackages.add(name)
      }
    }

    const manifests = [
      new URL('../../../package.json', import.meta.url),
      ...['apps', 'docs', 'packages', 'plugins', 'tooling'].flatMap(root =>
        readdir(new URL(`../../../${root}`, import.meta.url), { withFileTypes: true }).then(entries =>
          entries
            .filter(entry => entry.isDirectory())
            .map(entry => new URL(`../../../${root}/${entry.name}/package.json`, import.meta.url)),
        ),
      ),
    ]
    for (const manifestUrl of (await Promise.all(manifests)).flat()) {
      let manifest: Record<string, Record<string, string> | undefined>
      try {
        manifest = JSON.parse(await readFile(manifestUrl, 'utf8')) as Record<string, Record<string, string> | undefined>
      } catch {
        continue
      }
      for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        for (const [name, range] of Object.entries(manifest[field] ?? {})) {
          if (!catalogPackages.has(name)) continue
          if (field === 'peerDependencies' && name.startsWith('@deepseek-ai/dsh-')) continue
          expect(range, `${manifestUrl.pathname}:${field}:${name}`).toMatch(/^catalog:/u)
        }
      }
    }
  })

  it('keeps each compatibility package list aligned with source imports', async () => {
    for (const directory of pluginDirectories) {
      const sourcePackages = new Set<string>()
      const visit = async (root: string): Promise<void> => {
        for (const entry of await readdir(root, { withFileTypes: true })) {
          const path = join(root, entry.name)
          if (entry.isDirectory()) await visit(path)
          else if (/\.(?:ts|tsx)$/u.test(entry.name)) {
            const source = await readFile(path, 'utf8')
            // 采集面必须与下面 peerPackages 的过滤条件一致：除 `@deepseek-ai/dsh-*`
            // 外还含 `@deepseek-ai/schemastery`。只匹配 dsh-* 会让 schemastery 永远
            // 进不了 sourcePackages，导致「peer 必须被源码引用」这条断言对任何把
            // schemastery 声明为 peer 的插件恒假（FNOS-012-05 的同类缺口）。
            for (const match of source.matchAll(/(?:from|import\()\s*['"](@deepseek-ai\/(?:dsh-[^/'"]+|schemastery))[^'"]*['"]/gu)) sourcePackages.add(match[1]!)
          }
        }
      }
      await visit(new URL(`../../../plugins/${directory}/src`, import.meta.url).pathname)
      const packageManifest = JSON.parse(await readFile(new URL(`../../../plugins/${directory}/package.json`, import.meta.url), 'utf8')) as {
        peerDependencies: Record<string, string>
      }
      const peerPackages = Object.keys(packageManifest.peerDependencies).filter(name => name.startsWith('@deepseek-ai/dsh-') || name === '@deepseek-ai/schemastery')
      if (directory !== 'dsh-fnos-plugin') {
        expect(peerPackages.filter(name => !sourcePackages.has(name)), directory).toEqual([])
      } else {
        // FNOS keeps its existing host-contract package inventory; this audit
        // is scoped to the three non-fnOS plugins.
        for (const name of peerPackages) sourcePackages.add(name)
      }
      const compatibility = JSON.parse(await readFile(new URL(`../../../plugins/${directory}/compatibility.json`, import.meta.url), 'utf8')) as {
        dshPluginApi: { packages: string[] }
      }
      const declared = new Set(compatibility.dshPluginApi.packages)
      expect([...sourcePackages].filter(name => !declared.has(name)), directory).toEqual([])
      expect([...declared].filter(name => name.startsWith('@deepseek-ai/dsh') && !sourcePackages.has(name)), directory).toEqual([])
    }
  })
})
