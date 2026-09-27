import { Command } from 'commander'

export const program = new Command()
  .name('fnos-dsh-cli')
  .description('fnOS DSH repository CLI')
  .version('0.0.0')
  .showSuggestionAfterError()
  .exitOverride()
  .configureOutput({ outputError: () => {} })

program.addHelpText('after', `
Examples:
  fnos-dsh-cli build
  fnos-dsh-cli build --fpk --app fn-deepseek-harness
  fnos-dsh-cli build --plugin fnos
  fnos-dsh-cli build --docs
  fnos-dsh-cli start --web
  fnos-dsh-cli check --all
  fnos-dsh-cli check --sdd --plugins
  fnos-dsh-cli publish --plugin fnos
  fnos-dsh-cli version project patch
`)
