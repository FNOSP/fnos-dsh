import { type OptionValues } from 'commander'
import { program } from '../program.js'
import { addBooleanArgs } from '../core/command-args.js'
import { runCheckSdd } from './check-sdd.js'
import { runDocsBuild } from './docs.js'
import { runTurbo } from '../core/turbo.js'
import { askCheckSelection, type CheckSelection } from '../ui/prompts.js'

const flags = new Set(['--all', '--sdd', '--docs', '--packages', '--plugins', '--tooling'])

function selectionsFromArgs(args: string[]): CheckSelection[] {
  const unknown = args.filter(arg => !flags.has(arg))
  if (unknown.length > 0) throw new Error(`Unknown check option: ${unknown.join(', ')}`)
  if (args.includes('--all')) return ['sdd', 'docs', 'packages', 'plugins', 'tooling']
  return [
    ...(args.includes('--sdd') ? ['sdd' as const] : []),
    ...(args.includes('--docs') ? ['docs' as const] : []),
    ...(args.includes('--packages') ? ['packages' as const] : []),
    ...(args.includes('--plugins') ? ['plugins' as const] : []),
    ...(args.includes('--tooling') ? ['tooling' as const] : []),
  ]
}

export async function runCheck(args: string[]): Promise<void> {
  let selection = selectionsFromArgs(args)
  if (selection.length === 0) {
    const prompted = await askCheckSelection()
    if (prompted === undefined) return
    selection = prompted
  }

  const tasks: Promise<void>[] = []
  if (selection.includes('sdd')) tasks.push(runCheckSdd())
  if (selection.includes('docs')) tasks.push(runDocsBuild())

  // `tooling/*` is checked here on purpose: CI triggers on `tooling/**`, and the
  // release guards under test live there. Leaving it out of `--all` let four
  // separate drifts (a stale version pin, two stale compatibility lists, and
  // eight stale install commands) pass every gate and reach a release tag.
  const turboFilters = [
    ...(selection.includes('packages') ? ['./packages/*'] : []),
    ...(selection.includes('plugins') ? ['./plugins/*'] : []),
    ...(selection.includes('tooling') ? ['./tooling/*'] : []),
  ]
  if (turboFilters.length > 0) tasks.push(runTurbo(['check'], turboFilters))
  await Promise.all(tasks)
}

program
  .command('check')
  .description('Select SDD, docs, packages, plugins, or tooling to validate')
  .option('--all', 'run every check')
  .option('--sdd', 'check SDD documents')
  .option('--docs', 'build project documentation')
  .option('--packages', 'check shared packages')
  .option('--plugins', 'check DSH plugins')
  .option('--tooling', 'check build tooling')
  .action(async (options: OptionValues) => {
    const args: string[] = []
    addBooleanArgs(args, options, ['all', 'sdd', 'docs', 'packages', 'plugins', 'tooling'])
    await runCheck(args)
  })
