import { execFileSync } from 'node:child_process'
import { accessSync, constants, readFileSync } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'

/** File recording the pnpm store the install callback resolved for this home. */
export const PNPM_STORE_FILE = '.pnpm-store-dir'

function isUsableExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** Resolve a bare command exactly as DSH's subprocess provider resolves it. */
function resolvePathExecutable(command: string, pathValue: string | undefined): string | undefined {
  for (const directory of (pathValue ?? '').split(delimiter)) {
    const candidate = join(directory === '' ? process.cwd() : directory, command)
    if (isUsableExecutable(candidate)) return candidate
  }
  return undefined
}

function resolveTerminalShell(base: NodeJS.ProcessEnv): string | undefined {
  // DSH's selector resolves the preferred SHELL first and then the bare
  // `bash` candidate through PATH. Use the exact PATH spelling for bash so the
  // preferred row and the candidate row collapse to one entry; readlink-based
  // canonicalization would turn /bin/bash into /usr/bin/bash and reintroduce
  // the duplicate on usrmerge systems.
  const bash = resolvePathExecutable('bash', base.PATH)
  if (bash !== undefined) return bash

  const inherited = base.SHELL
  if (inherited !== undefined && !/\/(?:nologin|false)$/u.test(inherited) && isUsableExecutable(inherited)) return inherited
  for (const candidate of ['/usr/bin/bash', '/bin/bash', '/usr/bin/sh', '/bin/sh']) {
    if (isUsableExecutable(candidate)) return candidate
  }
  return undefined
}

function localeKey(value: string): string {
  return value.trim().toLowerCase().replaceAll('-', '')
}

function resolveUtf8Locale(base: NodeJS.ProcessEnv): string | undefined {
  let available: string[]
  try {
    available = execFileSync('locale', ['-a'], {
      encoding: 'utf8',
      env: base,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).split(/\r?\n/u).map(localeKey).filter(Boolean)
  } catch {
    return undefined
  }
  const availableSet = new Set(available)
  for (const candidate of [base.LANG, base.LC_CTYPE, 'C.UTF-8', 'C.utf8', 'en_US.UTF-8', 'en_US.utf8']) {
    if (candidate === undefined || !/utf-?8$/iu.test(candidate)) continue
    if (availableSet.has(localeKey(candidate))) return candidate
  }
  return undefined
}

/**
 * Read the pnpm store directory persisted at install time.
 *
 * The install callback records the store actually referenced by the Web
 * profile so later runs reuse the same one. A missing, empty, or non-absolute
 * value means "no override", never a guess.
 */
export function readPersistedPnpmStoreDir(dshHome: string): string | undefined {
  let value: string
  try {
    value = readFileSync(join(dshHome, PNPM_STORE_FILE), 'utf8')
  } catch {
    return undefined
  }
  const storeDir = value.split('\n', 1)[0]?.trim() ?? ''
  if (storeDir === '' || !isAbsolute(storeDir)) return undefined
  return storeDir
}

/**
 * Build the fixed environment for the DSH Web child process.
 *
 * DSH forwards plugin installs and updates to `pnpm` in the Web profile
 * directory. pnpm pins the store it used into `node_modules/.modules.yaml` and
 * refuses every later operation with `ERR_PNPM_UNEXPECTED_STORE` once the
 * resolved store changes. `HOME` and `DSH_HOME` intentionally have different
 * meanings in the fnOS app: the gateway's HOME is the app-share runtime home,
 * while DSH_HOME is the package user's persistent Harness data root. Passing
 * the persisted store explicitly keeps runtime resolution identical to
 * install time, so `dsh plugin` and third-party market updates keep working.
 */
export function buildDshRuntimeEnv(dshHome: string, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ...base,
    HOME: base.HOME?.trim() === '' || base.HOME === undefined ? dshHome : base.HOME,
    DSH_HOME: dshHome,
    NPM_CONFIG_CACHE: `${dshHome}/.npm-cache`,
    NPM_CONFIG_PREFIX: `${dshHome}/.npm-global`,
    NPM_CONFIG_USERCONFIG: `${dshHome}/.npmrc`,
    XDG_CONFIG_HOME: `${dshHome}/.config`,
  }
  const shell = resolveTerminalShell(environment)
  if (shell !== undefined) environment.SHELL = shell
  const locale = resolveUtf8Locale(environment)
  if (locale !== undefined) {
    environment.LANG = locale
    environment.LC_CTYPE = locale
    if (environment.LC_ALL !== undefined && !/utf-?8$/iu.test(environment.LC_ALL)) delete environment.LC_ALL
  }
  const storeDir = readPersistedPnpmStoreDir(dshHome)
  if (storeDir === undefined) delete environment.PNPM_CONFIG_STORE_DIR
  else environment.PNPM_CONFIG_STORE_DIR = storeDir
  return environment
}
