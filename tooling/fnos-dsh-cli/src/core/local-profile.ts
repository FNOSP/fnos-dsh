import { readdir, readFile, realpath, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { dshHomeDirectory, repositoryRoot } from '../config/paths.js'
import { pluginTargets, type PluginTarget } from '../config/targets.js'
import { runRepoDsh, runTurbo } from './turbo.js'

/** Profile the local development instance boots; matches `dsh web`. */
const DEV_PROFILE = 'web'
const LOCAL_DSH_VERSION = '0.1.7-rc.2'

/**
 * Plugins that live in this repository but are not linked into the local
 * profile.
 *
 * `@tnnevol/dsh-fnos` is the FPK-only integration: it registers fnOS settings
 * namespaces, the fnOS JS SDK bridge and gateway-prefixed routes, so it has
 * nothing to serve outside the fnOS host and would only add failing rows to a
 * developer's local profile. The other repository plugins are usable from any
 * DSH client and are linked in.
 */
const LOCAL_PROFILE_EXCLUDED_PLUGINS = new Set(['@tnnevol/dsh-fnos'])

/** Repository plugins the local profile should carry, in stable plugin order. */
export const localProfilePlugins: PluginTarget[] = pluginTargets
  .filter(target => !LOCAL_PROFILE_EXCLUDED_PLUGINS.has(target.name))

type ProfileManifest = {
  dependencies?: Record<string, string>
  dsh?: { profile?: { bundles?: string[] } }
}

type LinkedPluginManifest = ProfileManifest & {
  peerDependencies?: Record<string, string>
}

function profileDirectory(): string {
  return join(dshHomeDirectory, 'profiles', DEV_PROFILE)
}

function pluginDirectory(target: PluginTarget): string {
  return dirname(join(repositoryRoot, target.path))
}

/**
 * pnpm creates executable shims in `.bin` as symlinks. A previous profile
 * install can leave a shim behind after its package disappears from the
 * hoisted tree; Turbo then follows the dangling link while starting its file
 * watcher and aborts before DSH Web is launched. Only repository-local
 * generated dependency trees are inspected, and only links whose targets no
 * longer resolve are removed.
 */
async function removeDanglingLocalSymlinks(directory: string): Promise<void> {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    const entryPath = join(directory, entry.name)
    if (entry.isSymbolicLink()) {
      try {
        await realpath(entryPath)
      } catch {
        await unlink(entryPath)
      }
      continue
    }
    if (entry.isDirectory()) await removeDanglingLocalSymlinks(entryPath)
  }
}

async function repairLocalWatcherTrees(): Promise<void> {
  await Promise.all([
    removeDanglingLocalSymlinks(join(repositoryRoot, 'node_modules')),
    removeDanglingLocalSymlinks(join(profileDirectory(), 'node_modules')),
    // DSH keeps shared profile dependencies one level above `web`; Turbo scans
    // both trees because DSH_HOME is the repository-local root.
    removeDanglingLocalSymlinks(join(dshHomeDirectory, 'profiles', 'node_modules')),
    // pnpm's repository-local store records temporary project links. Test
    // cleanup or a removed temp directory can leave one dangling, and Turbo
    // scans this ignored directory as part of the repository root as well.
    removeDanglingLocalSymlinks(join(repositoryRoot, '.pnpm-store', 'v11', 'projects')),
  ])
}

async function readProfileManifest(directory: string): Promise<ProfileManifest | undefined> {
  try {
    return JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as ProfileManifest
  } catch {
    return undefined
  }
}

/** True when the profile already links this plugin and lists it as a bundle layer. */
function manifestCarriesPlugin(manifest: ProfileManifest, target: PluginTarget, directory: string): boolean {
  const spec = manifest.dependencies?.[target.name]
  if (spec !== `link:${directory}`) return false
  return (manifest.dsh?.profile?.bundles ?? []).includes(target.name)
}

/**
 * Local source manifests use pnpm's catalog aliases, but a standalone DSH
 * profile cannot resolve workspace catalogs while checking plugin peers. Keep
 * the repository manifests catalog-based and normalize only the profile's
 * installed link copy to the current runtime version.
 */
async function normalizeLinkedPluginManifest(directory: string, target: PluginTarget): Promise<void> {
  const packageJsonPath = join(directory, 'node_modules', ...target.name.split('/'), 'package.json')
  let manifest: LinkedPluginManifest
  try {
    manifest = JSON.parse(await readFile(packageJsonPath, 'utf8')) as LinkedPluginManifest
  } catch {
    return
  }
  const peerDependencies = manifest.peerDependencies
  if (peerDependencies === undefined) return
  let changed = false
  for (const [name, range] of Object.entries(peerDependencies)) {
    if (name.startsWith('@deepseek-ai/dsh') && range === 'catalog:dsh') {
      peerDependencies[name] = LOCAL_DSH_VERSION
      changed = true
    }
  }
  if (changed) await writeFile(packageJsonPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}

/**
 * Link this repository's plugins into the local DSH Web profile.
 *
 * `DSH_HOME` points at the checkout, so the profile is local state that a fresh
 * clone does not have. Building first matters: the profile resolves each plugin
 * through its `exports` entry, which points at the tsdown output under `lib/`
 * (git-ignored), and `dsh plugin add` would otherwise link a package with no
 * loadable entry. Adding through the DSH CLI — rather than writing the profile
 * manifest directly — is what reconciles `dsh.profile.bundles` against the
 * installed state, so the plugin actually becomes a patch layer.
 *
 * @param pluginFilter - when set, only that plugin is (re)linked.
 */
export async function ensureLocalProfilePlugins(pluginFilter?: string): Promise<void> {
  const directory = profileDirectory()
  const targets = pluginFilter === undefined
    ? localProfilePlugins
    : localProfilePlugins.filter(target => target.filter === pluginFilter || target.name === pluginFilter || target.value === pluginFilter)
  if (targets.length === 0) return

  await runTurbo(['build'], targets.map(target => target.filter))
  await repairLocalWatcherTrees()

  const manifest = await readProfileManifest(directory)
  for (const target of targets) {
    const source = pluginDirectory(target)
    if (manifest === undefined || !manifestCarriesPlugin(manifest, target, source)) {
      console.log(`Linking ${target.name} into ${DEV_PROFILE} profile`)
      await runRepoDsh(['plugin', '--profile', DEV_PROFILE, 'add', source])
    }
    await normalizeLinkedPluginManifest(directory, target)
  }
  // `dsh plugin add` may update pnpm's hoisted links, so repair once more
  // after the profile reconciliation and immediately before Turbo watch.
  await repairLocalWatcherTrees()
}
