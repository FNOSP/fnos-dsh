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
  it('keeps the development host DSH CLI boundary separate from the FPK catalog', async () => {
    const rootPackage = JSON.parse(await readFile(new URL('../../../package.json', import.meta.url), 'utf8')) as {
      devDependencies: Record<string, string>
    }
    const workspace = await readFile(new URL('../../../pnpm-workspace.yaml', import.meta.url), 'utf8')
    expect(rootPackage.devDependencies['@deepseek-ai/dsh']).toBe('catalog:')
    expect(rootPackage.devDependencies['@deepseek-ai/dsh-llm-pi-ai']).toBe('catalog:development-dsh')
    expect(workspace).toMatch(/development-dsh:\s*\n\s+'@deepseek-ai\/dsh-llm-pi-ai':\s*0\.1\.5-rc\.2/u)
    expect(workspace).toMatch(/'@deepseek-ai\/dsh':\s*0\.1\.5-rc\.2/u)
    expect(workspace).toMatch(/'@deepseek-ai\/dsh-llm-pi-ai':\s*0\.1\.7-rc\.2/u)
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
      plugins: Array<{ name: string, version: string }>
      bundled: Array<{ name: string, version: string }>
    }
    expect(published.plugins).toEqual([
      { name: '@tnnevol/dsh-codebuddy', version: targetVersion },
      { name: '@tnnevol/dsh-codex-auth', version: targetVersion },
      { name: '@tnnevol/dsh-fnos', version: targetVersion },
      { name: '@tnnevol/dsh-semi-ui-showcase', version: targetVersion },
    ])
    expect(published.bundled).toContainEqual({ name: 'dshmarket', version: '1.65.1' })

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
      for (const name of Object.keys(packageManifest.peerDependencies)) {
        if (name.startsWith('@deepseek-ai/dsh')) sourcePackages.add(name)
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
