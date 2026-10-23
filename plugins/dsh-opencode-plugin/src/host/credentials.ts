/**
 * OpenCode 凭据的宿主侧持久化。
 *
 * 只由本插件读写：账号 access/refresh token 或 API Key 落在一个属主可读的文件里
 * （0600，目录 0700），并通过 `@tnnevol/dsh-plugin-kit` 的共享判定拒绝 group/other
 * 位被放宽或被写成不可读的旧文件。浏览器侧永远拿不到凭据内容。
 *
 * @module dsh-opencode/credentials
 */

import { mkdir, readFile, rm, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { assessCredentialFile, ownerUnreadableError } from '@tnnevol/dsh-plugin-kit'
import type { OpenCodeCredentialRecord } from '../contracts/auth.ts'

/** 凭据文件名（位于 DSH home 下）。 */
export const OPENCODE_AUTH_FILENAME = '.dsh-opencode-auth.json'

const AUTH_FORMAT_VERSION = 1
const ALLOWED_KEYS = new Set([
  'version',
  'method',
  'access',
  'refresh',
  'expiresAt',
  'server',
  'orgId',
  'orgName',
  'accountId',
  'accountEmail',
])

interface AuthDocument {
  version: typeof AUTH_FORMAT_VERSION
  credential: OpenCodeCredentialRecord
}

function isENOENT(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

/** 解析落盘文档；任何不认识的字段都视为格式漂移，直接拒绝而不是忽略。 */
function parseDocument(text: string, filename: string): AuthDocument {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error(`opencode-auth: ${filename} 不是合法 JSON`)
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`opencode-auth: ${filename} 必须是对象`)
  }
  const document = value as Record<string, unknown>
  if (document.version !== AUTH_FORMAT_VERSION) {
    throw new Error(`opencode-auth: ${filename} 的格式版本 ${String(document.version)} 不受支持`)
  }
  const raw = document.credential
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`opencode-auth: ${filename} 缺少 credential 对象`)
  }
  const credential = raw as Record<string, unknown>
  for (const key of Object.keys(credential)) {
    if (!ALLOWED_KEYS.has(key)) throw new Error(`opencode-auth: ${filename} 含未知字段 ${key}`)
  }
  const method = credential.method
  if (method !== 'oauth' && method !== 'key') {
    throw new Error(`opencode-auth: ${filename} 的 method 必须是 oauth 或 key`)
  }
  if (typeof credential.access !== 'string' || credential.access.length === 0) {
    throw new Error(`opencode-auth: ${filename} 的 access 必须是非空字符串`)
  }
  if (method === 'oauth') {
    if (typeof credential.refresh !== 'string' || credential.refresh.length === 0) {
      throw new Error(`opencode-auth: ${filename} 的 OAuth 凭据必须有 refresh`)
    }
    if (typeof credential.expiresAt !== 'number' || !Number.isFinite(credential.expiresAt) || credential.expiresAt <= 0) {
      throw new Error(`opencode-auth: ${filename} 的 OAuth 凭据必须有正的 expiresAt`)
    }
  }
  return { version: AUTH_FORMAT_VERSION, credential: credential as unknown as OpenCodeCredentialRecord }
}

/** 凭据文件路径。 */
export function opencodeAuthPath(dshHome?: string): string {
  return resolve(join(resolveDshHome(dshHome), OPENCODE_AUTH_FILENAME))
}

/** 校验属主权限；Windows 无 POSIX mode，跳过。 */
async function assertOwnerOnly(filename: string): Promise<void> {
  if (process.platform === 'win32') return
  const state = await assessCredentialFile((target) => stat(target), filename)
  if (state !== 'unusable') return
  const mode = (await stat(filename)).mode
  throw ownerUnreadableError(filename, mode, 'opencode-auth')
}

/** 文件落盘的账号凭据存储。 */
export class OpenCodeCredentialStore {
  readonly filename: string

  constructor(filename: string = opencodeAuthPath()) {
    this.filename = resolve(filename)
  }

  /** 读取当前凭据；不存在或不可读时抛出可诊断错误。 */
  async read(): Promise<OpenCodeCredentialRecord | undefined> {
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

  /** 覆盖写入凭据（原子写 + 文件锁）。 */
  async write(credential: OpenCodeCredentialRecord): Promise<OpenCodeCredentialRecord> {
    await mkdir(dirname(this.filename), { recursive: true, mode: 0o700 })
    return withFileLock(this.filename, async () => {
      const candidate = parseDocument(
        JSON.stringify({ version: AUTH_FORMAT_VERSION, credential }),
        this.filename,
      )
      await writeFileAtomic(this.filename, `${JSON.stringify(candidate, null, 2)}\n`, {
        mode: 0o600,
        dirMode: 0o700,
      })
      return structuredClone(candidate.credential)
    })
  }

  /** 删除凭据；不存在时静默成功。 */
  async delete(): Promise<void> {
    await mkdir(dirname(this.filename), { recursive: true, mode: 0o700 })
    await withFileLock(this.filename, () => rm(this.filename, { force: true }))
  }
}
