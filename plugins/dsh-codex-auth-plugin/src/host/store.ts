/** Owner-only persistent storage for the shared OpenAI Codex OAuth document. */

import { mkdir, readFile, rm, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { Credential, CredentialInfo, CredentialStore, OAuthCredential } from '@earendil-works/pi-ai'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { assessCredentialFile, ownerUnreadableError } from '@tnnevol/dsh-plugin-kit'
import { CODEX_PROVIDER } from '../contracts/provider.ts'

/** Re-exported so the host's existing `from './store.ts'` imports keep working. */
export { CODEX_PROVIDER }
/** Kept compatible with dsh-codex-connect so a login can be reused. */
export const CODEX_AUTH_FILENAME = '.openai-codex-auth.json'

const AUTH_FORMAT_VERSION = 1

interface AuthDocument {
  version: typeof AUTH_FORMAT_VERSION
  credential: OAuthCredential
}

function isENOENT(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

/**
 * 凭据文档必须仅属主可读，且属主**可读**。
 *
 * 判定收敛到 `@tnnevol/dsh-plugin-kit` 的共享实现（FNOS-011-05）：group/other
 * 位为空**且属主可读**。旧条件 `(mode & 0o077) !== 0` 只覆盖 group/other 位，
 * 属主不可读的 `0000` 会被放行，随后 `readFile` 抛出裸 `EACCES`。错误文案与
 * 既有「权限过宽」分支同构：路径 + 当前权限位 + 修复命令，不含凭据内容。
 * Windows 没有 POSIX mode，跳过检查（与上游 dsh-credentials-local 一致）。
 */
async function assertOwnerOnly(filename: string): Promise<void> {
  if (process.platform === 'win32') return
  const state = await assessCredentialFile((target) => stat(target), filename)
  if (state !== 'unusable') return
  const mode = (await stat(filename)).mode
  throw ownerUnreadableError(filename, mode, 'codex-auth')
}

function parseDocument(text: string, filename: string): AuthDocument {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error(`codex-auth: ${filename} is not valid JSON`)
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`codex-auth: ${filename} must contain an object`)
  }
  const document = value as Record<string, unknown>
  if (document.version !== AUTH_FORMAT_VERSION) {
    throw new Error(`codex-auth: ${filename} has unsupported auth format version ${String(document.version)}`)
  }
  if (Object.keys(document).some(key => key !== 'version' && key !== 'credential')) {
    throw new Error(`codex-auth: ${filename} contains an unknown top-level field`)
  }
  const raw = document.credential
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`codex-auth: ${filename} credential must be an object`)
  }
  const credential = raw as Record<string, unknown>
  if (Object.keys(credential).some(key => !['type', 'access', 'refresh', 'expires', 'accountId'].includes(key))) {
    throw new Error(`codex-auth: ${filename} credential contains an unknown field`)
  }
  if (credential.type !== 'oauth') throw new Error(`codex-auth: ${filename} credential type must be oauth`)
  for (const key of ['access', 'refresh', 'accountId'] as const) {
    if (typeof credential[key] !== 'string' || credential[key].length === 0) {
      throw new Error(`codex-auth: ${filename} credential ${key} must be a non-empty string`)
    }
  }
  if (typeof credential.expires !== 'number' || !Number.isFinite(credential.expires) || credential.expires <= 0) {
    throw new Error(`codex-auth: ${filename} credential expires must be a positive finite number`)
  }
  return { version: AUTH_FORMAT_VERSION, credential: credential as unknown as OAuthCredential }
}

export function codexAuthPath(dshHome?: string): string {
  return resolve(join(resolveDshHome(dshHome), CODEX_AUTH_FILENAME))
}

/** File-backed CredentialStore that owns only the Codex OAuth route. */
export class CodexCredentialStore implements CredentialStore {
  readonly filename: string

  constructor(filename: string = codexAuthPath()) {
    this.filename = resolve(filename)
  }

  private async readCurrent(): Promise<OAuthCredential | undefined> {
    await assertOwnerOnly(this.filename)
    let text: string
    try {
      text = await readFile(this.filename, 'utf8')
    } catch (error) {
      if (isENOENT(error)) return undefined
      throw error
    }
    return structuredClone(parseDocument(text, this.filename).credential)
  }

  async read(providerId: string): Promise<Credential | undefined> {
    return providerId === CODEX_PROVIDER ? this.readCurrent() : undefined
  }

  async list(): Promise<readonly CredentialInfo[]> {
    return await this.readCurrent() === undefined
      ? []
      : [{ providerId: CODEX_PROVIDER, type: 'oauth' }]
  }

  async modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
  ): Promise<Credential | undefined> {
    if (providerId !== CODEX_PROVIDER) {
      throw new Error(`codex-auth: credential store does not own provider "${providerId}"`)
    }
    await mkdir(dirname(this.filename), { recursive: true, mode: 0o700 })
    return withFileLock(this.filename, async () => {
      const current = await this.readCurrent()
      const candidate = await fn(current)
      if (candidate === undefined) return current
      const document = parseDocument(JSON.stringify({ version: AUTH_FORMAT_VERSION, credential: candidate }), this.filename)
      await writeFileAtomic(this.filename, `${JSON.stringify(document, null, 2)}\n`, {
        mode: 0o600,
        dirMode: 0o700,
      })
      return structuredClone(document.credential)
    })
  }

  async delete(providerId: string): Promise<void> {
    if (providerId !== CODEX_PROVIDER) return
    await mkdir(dirname(this.filename), { recursive: true, mode: 0o700 })
    await withFileLock(this.filename, () => rm(this.filename, { force: true }))
  }
}
