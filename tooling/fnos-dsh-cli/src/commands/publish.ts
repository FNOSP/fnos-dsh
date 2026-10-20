import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { type OptionValues } from 'commander'
import { program } from '../program.js'
import { repositoryRoot } from '../config/paths.js'
import { findPluginTarget, pluginTargets, type PluginTarget } from '../config/targets.js'
import { optionValue } from '../core/args.js'
import { runCommand } from '../core/process.js'
import { addBooleanArgs, addOptionalValueArg } from '../core/command-args.js'
import { maintainLatestTag, npmDistTag } from './publish-latest.js'
import { askPublishPlugins } from '../ui/prompts.js'
import { regenerateMarketIndex } from '../core/market-index.js'
import { checkPublishAuth } from '../core/npm-auth.js'

/**
 * 确定本次要发布哪些插件。
 *
 * 三种入口：`--all` 发全部、`--plugin <名字>` 发单个、都不给时进入交互多选。
 * `--all` 与 `--plugin` 同时给出属于调用错误，直接抛错而不是静默取其一——静默选择
 * 会让人以为「指定了某个插件」而实际发了全部，这类误发无法撤回。
 *
 * @param plugin `--plugin` 的取值。
 * @param all 是否传入 `--all`。
 * @returns 待发布插件列表；交互取消时返回 `undefined`。
 */
function selectPublishTargets(
  plugin?: string,
  all = false,
): PluginTarget[] | Promise<PluginTarget[] | undefined> {
  if (all && plugin !== undefined) {
    throw new Error('Cannot combine --all and --plugin')
  }
  // 按 targets 的既有顺序发布，与交互多选的结果顺序一致；串行发布由调用方负责。
  if (all) return [...pluginTargets]
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

/**
 * 用 `pnpm pack` 打出待发布产物，并**拒绝**仍含 `catalog:` 的产物。
 *
 * 为什么要自己 pack 而不是让发布工具打包：`catalog:` 是 pnpm 工作区协议，**只有 pnpm
 * 会在打包时把它换成真实版本号**，npm 的打包器不认识它。实测事故——`pnpm publish` 因
 * 凭据问题报 E404 后改用 `npm publish`，于是六个插件全部带着未解析的 `catalog:` 发了出去：
 *
 * ```
 * [ERR_PNPM_SPEC_NOT_SUPPORTED_BY_ANY_RESOLVER] "dayjs@catalog:" isn't supported by any available resolver.
 * This error happened while installing the dependencies of @tnnevol/dsh-codebuddy@0.2.0-rc.2.4
 * ```
 *
 * 本机工作区里一切正常（`catalog:` 能解析），**只有外部消费者会炸** —— 最糟的暴露位置。
 * 因此这里先 pack 再校验，最后才交给 `npm publish`：pack 保证协议被解析，校验保证
 * 将来换任何打包方式都不会再把这类产物发出去。
 * @param packageDirectory 插件包目录。
 * @returns 产物 `.tgz` 的绝对路径。
 */
async function packForPublish(packageDirectory: string): Promise<string> {
  const { mkdtemp } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const destination = await mkdtemp(join(tmpdir(), 'fnos-publish-'))
  const { stdout } = await runCommandCaptured('pnpm', ['pack', '--pack-destination', destination], packageDirectory)
  const tarball = stdout.trim().split('\n').filter(Boolean).pop()
  if (tarball === undefined) throw new Error(`pnpm pack 未输出产物路径：${directoryLabel(packageDirectory)}`)
  await assertCatalogResolved(tarball)
  return tarball
}

/** 报错里用目录名指代包，比绝对路径可读。 */
function directoryLabel(packageDirectory: string): string {
  return packageDirectory.split('/').pop() ?? packageDirectory
}

/**
 * 校验产物清单里没有残留的 `catalog:` 协议。
 *
 * 导出是为了让用例能直接构造产物来验证守卫有效——这道守卫的价值全在于它**会拦**。
 */
export async function assertCatalogResolved(tarball: string): Promise<void> {
  const { stdout } = await runCommandCaptured('tar', ['-xzOf', tarball, 'package/package.json'], undefined)
  const manifest = JSON.parse(stdout) as Record<string, unknown>
  const leaked: string[] = []
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    const entries = manifest[field]
    if (typeof entries !== 'object' || entries === null) continue
    for (const [name, spec] of Object.entries(entries)) {
      if (typeof spec === 'string' && spec.includes('catalog:')) leaked.push(`${field}.${name}=${spec}`)
    }
  }
  if (leaked.length > 0) {
    throw new Error(
      `发布产物里仍有未解析的 catalog: 协议（外部消费者会装不上）：\n  ${leaked.join('\n  ')}\n`
      + '请用 `pnpm pack` 打包——只有 pnpm 会在打包时把 catalog: 换成真实版本号。',
    )
  }
}

/** 运行命令并捕获输出（`runCommand` 是继承 stdio 的，拿不到输出）。 */
async function runCommandCaptured(
  command: string,
  args: string[],
  cwd: string | undefined,
): Promise<{ stdout: string, stderr: string }> {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  return await promisify(execFile)(command, args, {
    ...(cwd === undefined ? {} : { cwd }),
    maxBuffer: 32 * 1024 * 1024,
  })
}

export async function runPublish(args: string[]): Promise<void> {
  const skipMarketIndex = args.includes('--skip-market-index')
  const targets = await selectPublishTargets(optionValue(args, '--plugin'), args.includes('--all'))
  if (targets === undefined) return

  /**
   * 发布前先确认 npm 已登录。
   *
   * 放在「选完插件之后、开始逐个发布之前」：此时用户已经表达了意图，而任何包都还没
   * 发出去——失败发生在第一个包上时最迷惑（npm 对无权限的 PUT 回 E404 而不是 401）。
   */
  const auth = await checkPublishAuth()
  if (!auth.ok) {
    throw new Error(auth.message)
  }

  // 逐个发布，不并发：同时启动会让 npm 在每个包上各弹一次 Web 授权，而第一个凭据
  // 还没落盘，于是同一个 registry 账号被反复要求授权。
  for (const target of targets) {
    const packageDirectory = join(repositoryRoot, dirname(target.path))
    console.log(`\nPublishing npm package: ${target.label}`)
    // 先 pack（解析 catalog: 并校验），再交给 npm 发布——`npm publish <tgz>` 用的是 npm
    // 自己的凭据，因此不受 pnpm 侧凭据问题影响（实测 `pnpm whoami` 401 而 `npm whoami` 正常）。
    // **发布前**捕获 next/rc：`npm publish --tag next` 一旦成功，next 就指向新版本，
    // 事后读到的不是「发布前的 next」。这两个值决定 latest 的落点。
    const before = {
      next: await npmDistTag(target.name, 'next'),
      rc: await npmDistTag(target.name, 'rc'),
    }
    const tarball = await packForPublish(packageDirectory)
    await runCommand('npm', ['publish', tarball, '--tag', 'next', '--access', 'public'], packageDirectory)
    // 发布后按代际规则维护 `latest`——新代际首版指向上一代最新稳定版，同代际迭代不动（FNOS-012-04）。
    //
    // 维护**失败不得中断整批发布**：`dist-tag` 需要写权限，而 `npm publish` 有浏览器
    // 授权兜底、`npm dist-tag` 没有，凭据过期时只有后者会 401。实测该失败曾中断循环，
    // 导致本批其余插件根本没被发布——而它们本可以成功。包已经发出去了，dist-tag 是
    // 事后可补的动作，因此这里降级为警告并给出可直接执行的补救命令。
    const version = await publishedVersion(packageDirectory)
    if (version === undefined) continue
    try {
      await maintainLatestTag(target.name, version, before)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`  latest: 维护失败（不影响本次发布）：${message.split('\n')[0]}`)
      console.warn(`  可稍后手动校正：npm dist-tag add ${target.name}@${version} latest`)
    }
  }

  // 索引由生成器读取 **npm 上已发布版本** 的 tarball 产出，因此必须放在发布之后。
  // 它不会自动跟随 npm：漏了这一步，「发现」页显示旧版本且不报错。
  await regenerateMarketIndex({ skip: skipMarketIndex })
}

program
  .command('publish')
  .description('Publish DSH plugins to npm using the next dist-tag')
  .option('--plugin [plugin]', 'publish one plugin, or prompt for plugins')
  .option('--all', 'publish every plugin without prompting (for CI and non-interactive runs)')
  .option('--skip-market-index', 'do not regenerate the plugin market index after publishing')
  .action(async (options: OptionValues) => {
    const args: string[] = []
    addOptionalValueArg(args, options, 'plugin')
    addBooleanArgs(args, options, ['all', 'skipMarketIndex'])
    await runPublish(args)
  })
