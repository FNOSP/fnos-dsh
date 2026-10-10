import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { type OptionValues } from 'commander'
import { program } from '../program.js'
import { repositoryRoot } from '../config/paths.js'
import { findPluginTarget, type PluginTarget } from '../config/targets.js'
import { optionValue } from '../core/args.js'
import { runCommand } from '../core/process.js'
import { addOptionalValueArg } from '../core/command-args.js'
import { maintainLatestTag } from './publish-latest.js'
import { askPublishPlugins } from '../ui/prompts.js'

function selectPublishTargets(plugin?: string): PluginTarget[] | Promise<PluginTarget[] | undefined> {
  if (plugin === undefined) return askPublishPlugins()
  const target = findPluginTarget(plugin)
  if (target === undefined) throw new Error(`Unknown plugin: ${plugin}`)
  return [target]
}

/** 从插件 package.json 读取刚发布的版本号；缺失时返回 undefined（latest 维护跳过）。 */
async function publishedVersion(packageDirectory: string): Promise<string | undefined> {
  try {
    const manifest = JSON.parse(await readFile(join(packageDirectory, 'package.json'), 'utf8')) as {
      version?: unknown
    }
    return typeof manifest.version === 'string' ? manifest.version : undefined
  } catch {
    return undefined
  }
}

export async function runPublish(args: string[]): Promise<void> {
  const targets = await selectPublishTargets(optionValue(args, '--plugin'))
  if (targets === undefined) return

  // Publish in one npm-authenticated process at a time. Starting all
  // `pnpm publish` commands together makes npm launch one Web login flow per
  // package before the first credential has been persisted, which produces
  // several authorization prompts for the same registry account.
  for (const target of targets) {
    const packageDirectory = join(repositoryRoot, dirname(target.path))
    console.log(`\nPublishing npm package: ${target.label}`)
    await runCommand('pnpm', ['run', 'publish:next'], packageDirectory)
    // `pnpm publish` 发布的就是这份 package.json 的版本；发布后按代际规则维护
    // `latest`——新代际首版指向上一代最新稳定版，同代际迭代不动（FNOS-012-04）。
    const version = await publishedVersion(packageDirectory)
    if (version !== undefined) await maintainLatestTag(target.name, version)
  }
}

program
  .command('publish')
  .description('Publish selected DSH plugins to npm using the next dist-tag')
  .option('--plugin [plugin]', 'publish one plugin, or prompt for plugins')
  .action(async (options: OptionValues) => {
    const args: string[] = []
    addOptionalValueArg(args, options, 'plugin')
    await runPublish(args)
  })
