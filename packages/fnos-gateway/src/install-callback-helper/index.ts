#!/usr/bin/env node

import { Command, CommanderError } from 'commander'
import {
  bundledPluginVersion,
  copyTrimCliSkill,
  danglingBundledOwnPlugins,
  findPackageDirectory,
  packageField,
  persistPnpmStoreDir,
  profileDependencyVersion,
  profileStoreDir,
  publishedPluginVersions,
  orphanOwnPlugins,
  publishedPlugins,
  removeLegacyPnpmStoreConfig,
  removeProfileBuildArtifacts,
  staleReleaseAgeExclusions,
} from './common.ts'
import { patchDshAttachmentLocal } from './attachment-patch.ts'
import { migrateCwdPromptVariable } from './cwd-migration.ts'
import { createLogger, InstallHelperError } from './logger.ts'
import { prepareNodePty } from './node-pty.ts'

const logger = createLogger('install-callback-helper')

export function createProgram(): Command {
  const program = new Command()
    .name('install-callback-helper')
    .description('Run DeepSeek Harness install callback helper operations')
    .exitOverride()
    .configureOutput({
      writeErr: message => logger.error(message.trimEnd()),
    })

  program
    .command('remove-legacy-pnpm-store-config')
    .description('Remove the legacy pnpm store-dir entry from an npm config file')
    .argument('<config-path>')
    .action(removeLegacyPnpmStoreConfig)

  program
    .command('persist-pnpm-store-dir')
    .description('Persist the pnpm store path and remove the legacy npm config entry')
    .argument('<config-path>')
    .argument('<store-path>')
    .argument('<store-file>')
    .action(persistPnpmStoreDir)

  program
    .command('package-version')
    .description('Read a package.json version')
    .argument('<package-path>')
    .action(path => packageField(path, 'version'))

  program
    .command('find-package')
    .description('Find a package directory inside an application-private dependency tree')
    .argument('<root>')
    .argument('<package-name>')
    .action(async (root, packageName) => {
      const directory = await findPackageDirectory(root, packageName)
      if (directory !== undefined) process.stdout.write(directory)
    })

  program
    .command('copy-trim-cli-skill')
    .description('Copy the trim-cli package skill into the user agents directory')
    .argument('<package-directory>')
    .argument('<target-directory>')
    .action(copyTrimCliSkill)

  program
    .command('profile-dependency-version')
    .description('Read a dependency version from a profile package manifest')
    .argument('<manifest-path>')
    .argument('<package-name>')
    .action(profileDependencyVersion)

  program
    .command('profile-store-dir')
    .description('Read the pnpm store directory from profile metadata')
    .argument('<metadata-path>')
    .action(profileStoreDir)

  program
    .command('stale-release-age-exclusions')
    .description('Print minimumReleaseAgeExclude entries whose version no longer matches the install target, one per line')
    .argument('<workspace-path>')
    .argument('<manifest-path>')
    .argument('[published-manifest-path]', 'published plugin manifest supplying the authoritative install pins')
    .action(async (workspacePath, manifestPath, publishedManifestPath) => {
      const installedVersions = publishedManifestPath === undefined
        ? {}
        : await publishedPluginVersions(publishedManifestPath)
      for (const stale of await staleReleaseAgeExclusions(workspacePath, manifestPath, installedVersions)) {
        process.stdout.write(`${stale}\n`)
      }
    })

  program
    .command('remove-profile-build-artifacts')
    .description('Remove rebuildable profile artifacts (pnpm-lock.yaml and node_modules) for the dependency rebuild')
    .argument('<lockfile-path>')
    .argument('<modules-path>')
    .action(removeProfileBuildArtifacts)

  program
    .command('published-plugins')
    .description('Print published plugins as tab-separated name and version rows')
    .argument('<manifest-path>')
    .action(publishedPlugins)

  program
    .command('orphan-own-plugins')
    .description('Print own plugins (@tnnevol/*) that the profile still depends on but the manifest no longer publishes')
    .argument('<profile-package-json-path>')
    .argument('<manifest-path>')
    .action(orphanOwnPlugins)

  program
    .command('dangling-bundled-own-plugins')
    .description('Print own plugins (@tnnevol/*) the profile pins to a bundled archive this release does not ship')
    .argument('<profile-package-json-path>')
    .argument('<manifest-path>')
    .action(danglingBundledOwnPlugins)

  program
    .command('bundled-plugin-version')
    .description('Read a bundled plugin version from the plugin manifest')
    .argument('<manifest-path>')
    .argument('<package-name>')
    .action(bundledPluginVersion)

  program
    .command('prepare-node-pty')
    .description('Prepare node-pty lifecycle scripts and native files')
    .action(prepareNodePty)

  program
    .command('patch-attachment-local')
    .description('Apply the fnOS attachment-local persistence patch')
    .action(patchDshAttachmentLocal)

  program
    .command('migrate-cwd-prompt-variable')
    .description('Remove the removed cwd prompt variable from a DSH profile (FNOS-031)')
    .action(migrateCwdPromptVariable)

  return program
}

export async function main(argv: string[] = process.argv): Promise<void> {
  await createProgram().parseAsync(argv)
}

main().catch((error: unknown) => {
  if (error instanceof CommanderError) {
    process.exitCode = error.exitCode
    return
  }
  if (error instanceof InstallHelperError) {
    createLogger(error.scope).error(error.message)
    process.exitCode = 1
    return
  }
  logger.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
