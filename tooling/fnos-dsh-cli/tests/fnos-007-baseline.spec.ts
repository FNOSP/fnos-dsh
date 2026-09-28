import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const targetVersion = '0.1.7-rc.2'
const pluginDirectories = [
  'dsh-codebuddy-plugin',
  'dsh-codex-auth-plugin',
  'dsh-fnos-plugin',
  'dsh-semi-ui-showcase-plugin',
]

describe('FNOS-007 DSH baseline', () => {
  it('synchronizes the development host DSH CLI with the FPK catalog', async () => {
    const rootPackage = JSON.parse(await readFile(new URL('../../../package.json', import.meta.url), 'utf8')) as {
      devDependencies: Record<string, string>
    }
    const workspace = await readFile(new URL('../../../pnpm-workspace.yaml', import.meta.url), 'utf8')
    expect(rootPackage.devDependencies['@deepseek-ai/dsh']).toBe('catalog:')
    expect(rootPackage.devDependencies['@deepseek-ai/dsh-llm-pi-ai']).toBe('catalog:dsh')
    expect(workspace).toMatch(/'@deepseek-ai\/dsh':\s*0\.1\.7-rc\.2/u)
    expect(workspace).toMatch(/'@deepseek-ai\/dsh-llm-pi-ai':\s*0\.1\.7-rc\.2/u)
  })

  it('keeps published DSH plugin peer ranges on the exact runtime baseline', async () => {
    for (const directory of pluginDirectories.filter(value => value !== 'dsh-fnos-plugin')) {
      const manifest = JSON.parse(await readFile(new URL(`../../../plugins/${directory}/package.json`, import.meta.url), 'utf8')) as {
        peerDependencies: Record<string, string>
      }
      for (const [name, range] of Object.entries(manifest.peerDependencies)) {
        if (name.startsWith('@deepseek-ai/dsh-')) expect(range, `${directory}:${name}`).toBe(targetVersion)
      }
    }
  })

  it('declares 0.1.7-rc.2 in every runtime plugin compatibility manifest', async () => {
    for (const directory of pluginDirectories) {
      const compatibility = JSON.parse(await readFile(new URL(`../../../plugins/${directory}/compatibility.json`, import.meta.url), 'utf8')) as {
        dshPluginApi: { version: string }
      }
      expect(compatibility.dshPluginApi.version, directory).toBe(targetVersion)
    }
  })

  it('keeps the FPK plugin manifest and native inputs exact', async () => {
    const published = JSON.parse(await readFile(new URL('../../../apps/fn-deepseek-harness/app/published-dsh-plugins.json', import.meta.url), 'utf8')) as {
      plugins: Array<{ name: string, version: string, source?: string }>
      registry?: string
      bundled?: Array<{ name: string, version: string }>
    }
    expect(published.plugins).toEqual([
      { name: '@tnnevol/dsh-codebuddy', version: targetVersion },
      { name: '@tnnevol/dsh-codex-auth', version: targetVersion },
      { name: '@tnnevol/dsh-fnos', version: targetVersion },
      { name: 'dshmarket', version: '1.66.3', source: 'thirdparty' },
    ])
    expect(published.registry).toBeUndefined()
    expect(published.bundled ?? []).toEqual([])

    const nativeConfig = await readFile(new URL('../../../.github/config/dsh-native-0.1.7-rc.2.env', import.meta.url), 'utf8')
    expect(nativeConfig).toContain('DSH_VERSION="0.1.7-rc.2"')
    expect(nativeConfig).toContain('NODE_MAJOR="24"')
    expect(nativeConfig).toContain('NODE_PTY_VERSION="1.2.0-beta.15"')
    expect(nativeConfig).toContain('NODE_GYP_VERSION="11.0.0"')
  })

  it('requires every DSH peer on the target runtime baseline', async () => {
    const workspace = await readFile(new URL('../../../pnpm-workspace.yaml', import.meta.url), 'utf8')
    const catalog = new Map<string, string>()
    let inDshCatalog = false
    for (const line of workspace.split(/\r?\n/u)) {
      if (line === '  dsh:') {
        inDshCatalog = true
        continue
      }
      if (inDshCatalog && /^ {2}[A-Za-z0-9_-]+:/u.test(line)) break
      if (inDshCatalog) {
        const match = /^ {4}(['"]?@[^:]+['"]?):\s*(\S+)$/u.exec(line)
        if (match !== null) catalog.set(match[1]!.replace(/^['"]|['"]$/gu, ''), match[2]!)
      }
    }

    for (const directory of pluginDirectories) {
      const manifest = JSON.parse(await readFile(new URL(`../../../plugins/${directory}/package.json`, import.meta.url), 'utf8')) as {
        peerDependencies: Record<string, string>
      }
      for (const [name, range] of Object.entries(manifest.peerDependencies)) {
        if (!name.startsWith('@deepseek-ai/dsh')) continue
        const resolved = range === 'catalog:dsh' ? catalog.get(name) : range
        expect(resolved, `${directory}:${name}`).toBe(targetVersion)
      }
    }
  })

  it('aligns shared upstream support packages with the target checkout', async () => {
    const workspace = await readFile(new URL('../../../pnpm-workspace.yaml', import.meta.url), 'utf8')
    expect(workspace).toMatch(/'@deepseek-ai\/cordis':\s*\^4\.0\.4/u)
    expect(workspace).toMatch(/'@deepseek-ai\/schemastery':\s*3\.18\.4/u)
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
            for (const match of source.matchAll(/(?:from|import\()\s*['"](@deepseek-ai\/(dsh-[^/'"]+))[^'"]*['"]/gu)) sourcePackages.add(match[1]!)
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
