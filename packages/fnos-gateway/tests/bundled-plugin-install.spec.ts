import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

/**
 * Bundled-plugin install behaviour in `cmd/install_callback`.
 *
 * `dsh plugin` is a thin pnpm forwarder. For a `file:<archive>` dependency,
 * pnpm treats an unchanged spec as already satisfied, even when the archive at
 * that path was replaced with new bytes. The supported way to force the
 * package to be materialised again is `remove`, followed by `add`.
 *
 * These tests execute the real shell function extracted from the shipped script
 * and record its CLI calls instead of asserting on its source text.
 */

const scriptPath = new URL('../../../apps/fn-deepseek-harness/cmd/install_callback', import.meta.url)

async function functionSource(name: string): Promise<string> {
  const source = await readFile(scriptPath, 'utf8')
  const start = source.indexOf(`${name}() {`)
  if (start < 0) throw new Error(`function ${name} not found in install_callback`)
  const end = source.indexOf('\n}\n', start)
  if (end < 0) throw new Error(`function ${name} is not terminated`)
  return source.slice(start, end + 3)
}

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function makeProfile(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'fnos-bundled-plugin-'))
  temporaryDirectories.push(root)
  return root
}

/** Run a shell snippet with the real force-install function sourced. */
async function runShell(root: string, body: string): Promise<string> {
  const harness = join(root, 'harness.sh')
  const prelude = [
    '#!/bin/bash',
    `DSH_PROFILE_DIRECTORY=${JSON.stringify(join(root, 'profile'))}`,
    `DSH_BUNDLED_PLUGIN_DIRECTORY=${JSON.stringify(join(root, 'bundled'))}`,
    'fail_install() { printf "FAIL:%s\\n" "$1"; exit 99; }',
    'log_info() { :; }',
    // Record the forwarded CLI call instead of invoking pnpm.
    'run_dsh_plugin() { printf "%s:%s\\n" "$1" "$2"; }',
    'run_dsh_plugin_with_release_age() { printf "%s:%s:release-age-0\\n" "$1" "$2"; }',
    await functionSource('force_install_bundled_plugin'),
    body,
  ].join('\n')
  await writeFile(harness, prelude)
  return execFileSync('/bin/bash', [harness], { encoding: 'utf8' })
}

async function runPublishedPluginInstall(
  root: string,
  currentVersion: string,
  currentSpec = '',
  plugin: { name: string, version: string, source?: string } = { name: 'dshmarket', version: '1.66.3', source: 'thirdparty' },
): Promise<string> {
  const manifest = join(root, 'published-dsh-plugins.json')
  await writeFile(manifest, JSON.stringify({
    version: 1,
    plugins: [plugin],
    bundled: [],
  }))
  const row = [plugin.name, plugin.version, plugin.source === 'thirdparty' ? 'thirdparty' : ''].filter(Boolean).join('\\t')
  const harness = join(root, 'published-harness.sh')
  const prelude = [
    '#!/bin/bash',
    `DSH_PROFILE_DIRECTORY=${JSON.stringify(join(root, 'profile'))}`,
    `DSH_BUNDLED_PLUGIN_DIRECTORY=${JSON.stringify(join(root, 'bundled'))}`,
    `DSH_PUBLISHED_PLUGIN_MANIFEST=${JSON.stringify(manifest)}`,
    'fail_install() { printf "FAIL:%s\\n" "$1"; exit 99; }',
    'log_info() { :; }',
    'validate_plugin_spec() { :; }',
    `run_install_callback_helper() { [ "$1" = published-plugins ] && printf '${row}\\n'; }`,
    `installed_plugin_version() { [ "$1" = ${JSON.stringify(plugin.name)} ] && printf ${JSON.stringify(currentVersion)}; }`,
    `profile_dependency_version() { [ "$1" = ${JSON.stringify(plugin.name)} ] && printf ${JSON.stringify(currentSpec)}; }`,
    'run_dsh_plugin() { printf "%s:%s\\n" "$1" "$2"; }',
    'run_dsh_plugin_with_release_age() { printf "%s:%s:release-age-0\\n" "$1" "$2"; }',
    await functionSource('install_published_dsh_plugins'),
    'install_published_dsh_plugins',
  ].join('\n')
  await writeFile(harness, prelude)
  return execFileSync('/bin/bash', [harness], { encoding: 'utf8' })
}

describe('bundled plugin install', () => {
  it('persists the selected npm registry before installing registry plugins', async () => {
    const source = await readFile(scriptPath, 'utf8')
    const main = source.slice(source.indexOf('main() {'))
    expect(main.indexOf('persist_npm_registry')).toBeGreaterThanOrEqual(0)
    expect(main.indexOf('install_published_dsh_plugins')).toBeGreaterThan(main.indexOf('persist_npm_registry'))
  })

  it('uses force install for bundled archives instead of the version-match skip', async () => {
    const source = await readFile(scriptPath, 'utf8')
    expect(source).toMatch(/force_install_bundled_plugin "\$\{plugin_name\}" "\$\{plugin_version\}" "\$\{bundled_plugin\}" "\$\{current_version\}"/u)
    expect(source).not.toMatch(/Keeping bundled .*exact local version already matches\./u)
  })

  it('allows release-age validation for FPK archive replacement', async () => {
    const source = await readFile(scriptPath, 'utf8')
    expect(source).toMatch(/run_dsh_plugin_with_release_age remove "\$\{plugin_name\}"/u)
    expect(source).toMatch(/run_dsh_plugin_with_release_age add "file:\$\{bundled_plugin\}"/u)
    expect(source).toContain('--config.minimum-release-age=0')
  })

  it('removes an installed plugin before adding the FPK archive, even at the same version', async () => {
    const root = await makeProfile()
    const installed = join(root, 'profile', 'node_modules', '@tnnevol', 'dsh-fnos')
    await mkdir(installed, { recursive: true })

    const output = await runShell(root, [
      `force_install_bundled_plugin '@tnnevol/dsh-fnos' '0.1.5-rc.2' '${join(root, 'bundled', 'dsh-fnos.tgz')}' '0.1.5-rc.2'`,
    ].join('\n'))

    expect(output).toContain('remove:@tnnevol/dsh-fnos')
    expect(output).toContain(`add:file:${join(root, 'bundled', 'dsh-fnos.tgz')}`)
    expect(output).toContain('release-age-0')
    expect(output.indexOf('remove:@tnnevol/dsh-fnos')).toBeLessThan(output.indexOf('add:file:'))
  })

  it('does not remove a missing plugin, but still adds the bundled archive', async () => {
    const root = await makeProfile()
    const archive = join(root, 'bundled', 'dsh-fnos.tgz')
    const output = await runShell(root, [
      `force_install_bundled_plugin '@tnnevol/dsh-fnos' '0.1.5-rc.2' '${archive}' ''`,
    ].join('\n'))

    expect(output).not.toContain('remove:')
    expect(output).toContain(`add:file:${archive}`)
    expect(output).not.toContain('FAIL:')
  })

  it('always adds the FPK archive path, never a registry version', async () => {
    const root = await makeProfile()
    const archive = join(root, 'bundled', 'dsh-fnos.tgz')
    const output = await runShell(root, [
      `force_install_bundled_plugin 'dsh-fnos' '1.0.0' '${archive}' '1.0.0'`,
    ].join('\n'))

    expect(output).toContain(`add:file:${archive}`)
    expect(output).not.toContain('dsh-fnos@1.0.0')
  })

  it('installs dshmarket from the manifest when it is missing', async () => {
    const root = await makeProfile()
    const output = await runPublishedPluginInstall(root, '')

    expect(output).toContain('add:dshmarket@1.66.3:release-age-0')
  })

  it('updates dshmarket when the installed version differs from the manifest', async () => {
    const root = await makeProfile()
    const output = await runPublishedPluginInstall(root, '1.64.0')

    expect(output).toContain('add:dshmarket@1.66.3:release-age-0')
  })

  it('keeps dshmarket when the installed version already matches', async () => {
    const root = await makeProfile()
    const output = await runPublishedPluginInstall(root, '1.66.3')

    expect(output).toBe('')
  })

  // FNOS-009-12: the callback installs only the versions this application
  // ships in its own manifest, so every plugin it installs takes the
  // release-age exception. A plugin left on the strict path fails as soon as
  // its version is published inside pnpm's cooldown window, and the reported
  // violation names whichever plugin it validated first.
  const ownedPlugin = { name: '@tnnevol/dsh-codebuddy', version: '0.2.0-rc.2.0' }

  it('installs an owned plugin through the release-age exception', async () => {
    const root = await makeProfile()
    const output = await runPublishedPluginInstall(root, '', '', ownedPlugin)

    expect(output).toContain('add:@tnnevol/dsh-codebuddy@0.2.0-rc.2.0:release-age-0')
  })

  it('updates an owned plugin through the release-age exception', async () => {
    const root = await makeProfile()
    const output = await runPublishedPluginInstall(root, '0.1.7-rc.2.2', '', ownedPlugin)

    expect(output).toContain('add:@tnnevol/dsh-codebuddy@0.2.0-rc.2.0:release-age-0')
  })

  it('still reinstalls an owned plugin that is linked instead of installed', async () => {
    const root = await makeProfile()
    const output = await runPublishedPluginInstall(root, '0.2.0-rc.2.0', 'link:/tmp/somewhere', ownedPlugin)

    expect(output).toContain('add:@tnnevol/dsh-codebuddy@0.2.0-rc.2.0:release-age-0')
  })

  it('keeps an owned plugin whose exact version already matches', async () => {
    const root = await makeProfile()
    const output = await runPublishedPluginInstall(root, '0.2.0-rc.2.0', '', ownedPlugin)

    expect(output).toBe('')
  })

  it('never routes an installed plugin through the strict CLI path', async () => {
    const source = await readFile(scriptPath, 'utf8')
    // The strict wrapper is gone entirely: one install path, one policy.
    expect(source).not.toMatch(/^run_dsh_plugin\(\)/mu)
    expect(source).not.toMatch(/run_dsh_plugin add /u)
    expect(source).toContain('--config.minimum-release-age=0')
  })
})

/**
 * Orphan own-plugin removal in `cmd/install_callback`.
 *
 * Dropping a plugin from the FPK bundle leaves the Web profile's dependency on
 * it in place while the new archive no longer ships its `.tgz`, so the
 * dependency rebuild dies with ENOENT and the upgrade fails with
 * "Unable to update fn-deepseek-harness". Measured on 5.7.1 → 5.7.2 with the
 * removed `@tnnevol/dsh-midscene`.
 *
 * These tests run the real shell function and record the CLI calls it makes.
 */
async function runOrphanRemoval(
  root: string,
  profileDependencies: Record<string, string>,
  publishedNames: string[],
): Promise<string> {
  await mkdir(join(root, 'profile'), { recursive: true })
  await writeFile(join(root, 'profile', 'package.json'), JSON.stringify({
    name: 'web-profile',
    dependencies: profileDependencies,
  }))
  const manifest = join(root, 'published-dsh-plugins.json')
  await writeFile(manifest, JSON.stringify({
    version: 1,
    plugins: publishedNames.map(name => ({ name, version: '0.0.1' })),
    bundled: [],
  }))
  const harness = join(root, 'orphan-harness.sh')
  const prelude = [
    '#!/bin/bash',
    `DSH_PROFILE_DIRECTORY=${JSON.stringify(join(root, 'profile'))}`,
    `DSH_PUBLISHED_PLUGIN_MANIFEST=${JSON.stringify(manifest)}`,
    'fail_install() { printf "FAIL:%s\\n" "$1"; exit 99; }',
    'log_info() { :; }',
    'validate_plugin_spec() { :; }',
    'run_dsh_plugin_with_release_age() { printf "%s:%s\\n" "$1" "$2"; }',
    // Forward to the real helper CLI (built into the app dir) so the orphan
    // computation is exercised too, not just the shell plumbing.
    `run_install_callback_helper() { node ${JSON.stringify(new URL('../../../apps/fn-deepseek-harness/app/scripts/install-callback-helper.mjs', import.meta.url).pathname)} "$@"; }`,
    await functionSource('remove_orphan_own_plugins'),
    'remove_orphan_own_plugins',
  ].join('\n')
  await writeFile(harness, prelude)
  return execFileSync('/bin/bash', [harness], { encoding: 'utf8' })
}

describe('remove_orphan_own_plugins', () => {
  it('removes an own plugin the release no longer publishes', async () => {
    const root = await makeProfile()
    const output = await runOrphanRemoval(
      root,
      {
        '@tnnevol/dsh-fnos': 'file:/app/bundled-dsh-plugins/@tnnevol/dsh-fnos.tgz',
        '@tnnevol/dsh-midscene': 'file:/app/bundled-dsh-plugins/@tnnevol/dsh-midscene.tgz',
      },
      ['@tnnevol/dsh-fnos'],
    )
    expect(output).toContain('remove:@tnnevol/dsh-midscene')
    expect(output).not.toContain('remove:@tnnevol/dsh-fnos')
  })

  it('does nothing when every own plugin is still published', async () => {
    const root = await makeProfile()
    const output = await runOrphanRemoval(
      root,
      { '@tnnevol/dsh-fnos': 'file:/app/bundled-dsh-plugins/@tnnevol/dsh-fnos.tgz' },
      ['@tnnevol/dsh-fnos'],
    )
    expect(output.trim()).toBe('')
  })

  it('never removes third-party plugins (their manifest entry means "ensure present")', async () => {
    const root = await makeProfile()
    const output = await runOrphanRemoval(
      root,
      {
        '@tnnevol/dsh-fnos': 'file:/app/bundled-dsh-plugins/@tnnevol/dsh-fnos.tgz',
        dshmarket: 'file:/app/bundled-dsh-plugins/dshmarket-1.66.3.tgz',
        'some-user-plugin': '^1.0.0',
      },
      ['@tnnevol/dsh-fnos', 'dshmarket'],
    )
    expect(output).not.toContain('some-user-plugin')
    expect(output).not.toContain('remove:dshmarket')
  })
})

/**
 * The sibling of `remove_orphan_own_plugins`: the plugin is **still in the
 * manifest**, but the profile pins it to a bundled archive this release does
 * not ship (measured: a locally built 5.7.3 — which bundles by default —
 * upgraded by the CI-built 5.7.4, which passes `--skip-bundle-dsh-plugins`).
 *
 * These tests run the real shell function and forward to the real helper CLI,
 * so both the detection and the removal are exercised.
 */
async function runDanglingRemoval(
  root: string,
  dependencies: Record<string, string>,
  publishedNames: string[],
  archives: string[] = [],
): Promise<string> {
  await mkdir(join(root, 'profile'), { recursive: true })
  await mkdir(join(root, 'bundled', '@tnnevol'), { recursive: true })
  await writeFile(join(root, 'profile', 'package.json'), JSON.stringify({
    name: 'web-profile',
    dependencies,
  }))
  for (const archive of archives) await writeFile(join(root, archive), 'tgz')
  const manifest = join(root, 'published-dsh-plugins.json')
  await writeFile(manifest, JSON.stringify({
    version: 1,
    plugins: publishedNames.map(name => ({ name, version: '0.0.1' })),
    bundled: [],
  }))
  const harness = join(root, 'dangling-harness.sh')
  const prelude = [
    '#!/bin/bash',
    `DSH_PROFILE_DIRECTORY=${JSON.stringify(join(root, 'profile'))}`,
    `DSH_PUBLISHED_PLUGIN_MANIFEST=${JSON.stringify(manifest)}`,
    'fail_install() { printf "FAIL:%s\\n" "$1"; exit 99; }',
    'log_info() { :; }',
    'validate_plugin_spec() { :; }',
    'run_dsh_plugin_with_release_age() { printf "%s:%s\\n" "$1" "$2"; }',
    // Forward to the real helper CLI so the detection is exercised too.
    `run_install_callback_helper() { node ${JSON.stringify(new URL('../../../apps/fn-deepseek-harness/app/scripts/install-callback-helper.mjs', import.meta.url).pathname)} "$@"; }`,
    await functionSource('remove_dangling_bundled_own_plugins'),
    'remove_dangling_bundled_own_plugins',
  ].join('\n')
  await writeFile(harness, prelude)
  return execFileSync('/bin/bash', [harness], { encoding: 'utf8' })
}

describe('remove_dangling_bundled_own_plugins', () => {
  it('removes own plugins pinned to a bundled archive the release does not ship', async () => {
    const root = await makeProfile()
    const output = await runDanglingRemoval(
      root,
      {
        '@tnnevol/dsh-codebuddy': `file:${join(root, 'bundled/@tnnevol/dsh-codebuddy.tgz')}`,
        '@tnnevol/dsh-codex-auth': `file:${join(root, 'bundled/@tnnevol/dsh-codex-auth.tgz')}`,
      },
      ['@tnnevol/dsh-codebuddy', '@tnnevol/dsh-codex-auth'],
    )
    expect(output).toContain('remove:@tnnevol/dsh-codebuddy')
    expect(output).toContain('remove:@tnnevol/dsh-codex-auth')
  })

  it('keeps own plugins whose bundled archive is actually present', async () => {
    const root = await makeProfile()
    const archive = 'bundled/@tnnevol/dsh-fnos.tgz'
    const output = await runDanglingRemoval(
      root,
      { '@tnnevol/dsh-fnos': `file:${join(root, archive)}` },
      ['@tnnevol/dsh-fnos'],
      [archive],
    )
    expect(output.trim()).toBe('')
  })

  it('keeps registry-pinned dependencies (nothing to dangle)', async () => {
    const root = await makeProfile()
    const output = await runDanglingRemoval(
      root,
      { '@tnnevol/dsh-codebuddy': '0.2.0-rc.2.4' },
      ['@tnnevol/dsh-codebuddy'],
    )
    expect(output.trim()).toBe('')
  })

  it('leaves plugins already dropped from the manifest to the orphan step', async () => {
    const root = await makeProfile()
    const output = await runDanglingRemoval(
      root,
      { '@tnnevol/dsh-midscene': `file:${join(root, 'bundled/@tnnevol/dsh-midscene.tgz')}` },
      ['@tnnevol/dsh-fnos'],
    )
    // 该插件已不在清单里：由 remove_orphan_own_plugins 负责，这里不报，避免重复移除。
    expect(output.trim()).toBe('')
  })

  it('never touches third-party plugins', async () => {
    const root = await makeProfile()
    const output = await runDanglingRemoval(
      root,
      { dshmarket: `file:${join(root, 'bundled/dshmarket-1.66.27.tgz')}` },
      ['dshmarket'],
    )
    expect(output.trim()).toBe('')
  })
})
