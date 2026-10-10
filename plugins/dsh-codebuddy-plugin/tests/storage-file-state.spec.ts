import { afterEach, describe, expect, it } from 'vitest'
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadStorage, saveStorage, storageFileState } from '../src/host/storage.ts'
import type { CodeBuddyAccountEntry, CodeBuddyStorage } from '../src/host/storage.ts'

/**
 * 凭据文件三态区分（FNOS-011-04 / TC-013、TC-014 的自动化部分）。
 *
 * 「凭据文件存在但属主不可读（0000）」与「文件不存在」必须可区分：前者是
 * 凭据异常（界面提示修复方式），后者是普通未登录。读取路径两者都按「没有
 * 可用凭据」处理（行为不变），本套件锁定 storageFileState 的三态与
 * panelStatus 载荷的区分字段。
 */

let workdir: string | undefined

function useTempAuthFile(): string {
  workdir = mkdtempSync(join(tmpdir(), 'codebuddy-storage-state-'))
  const path = join(workdir, 'codebuddy-auth.json')
  process.env.DSH_CODEBUDDY_AUTH_FILE = path
  return path
}

afterEach(() => {
  delete process.env.DSH_CODEBUDDY_AUTH_FILE
  if (workdir !== undefined) {
    rmSync(workdir, { recursive: true, force: true })
    workdir = undefined
  }
})

function oneEntry(): CodeBuddyAccountEntry {
  return {
    id: 'entry-1',
    auth: {
      accessToken: 'token-1',
      expiresAt: Date.now() + 3600_000,
      refreshToken: 'refresh-1',
      refreshExpiresAt: Date.now() + 7200_000,
      domain: 'copilot.tencent.com',
    },
    account: { uid: 'uid-1', nickname: 'tester' },
    client: 'cli',
    clientVersion: '2.163.0',
  } as unknown as CodeBuddyAccountEntry
}

describe('凭据文件三态（FNOS-011-04）', () => {
  it('文件不存在 → absent（普通未登录）', async () => {
    useTempAuthFile()
    await expect(storageFileState()).resolves.toBe('absent')
    // 读取路径行为不变：呈现为未登录（undefined）。
    await expect(loadStorage()).resolves.toBeUndefined()
  })

  it('600 → usable，正常加载', async () => {
    const path = useTempAuthFile()
    const storage = { version: 1, activeId: 'entry-1', accounts: [oneEntry()] } as unknown as CodeBuddyStorage
    await saveStorage(storage)
    chmodSync(path, 0o600)
    await expect(storageFileState()).resolves.toBe('usable')
    const loaded = await loadStorage()
    expect(loaded?.accounts).toHaveLength(1)
  })

  it('0000（属主不可读）→ unusable，加载结果与未登录一致但不编造凭据', async () => {
    const path = useTempAuthFile()
    const storage = { version: 1, activeId: 'entry-1', accounts: [oneEntry()] } as unknown as CodeBuddyStorage
    await saveStorage(storage)
    chmodSync(path, 0o000)
    await expect(storageFileState()).resolves.toBe('unusable')
    await expect(loadStorage()).resolves.toBeUndefined()
    // 文件仍在：判定不删除、不改写用户文件。
    expect(existsSync(path)).toBe(true)
  })

  it('644（权限过宽）→ unusable（既有拒绝语义不回退）', async () => {
    const path = useTempAuthFile()
    writeFileSync(path, 'x', { mode: 0o644 })
    await expect(storageFileState()).resolves.toBe('unusable')
  })

  it('panelStatus 载荷：unusable 时携带 credentialState，absent 时不携带', async () => {
    useTempAuthFile()
    const { CodeBuddyAuthService } = await import('../src/host/auth-service.ts')
    const ctx = {
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      effect: () => () => {},
      inject: () => Promise.resolve(undefined),
    } as never
    const service = new CodeBuddyAuthService(ctx)
    // absent：与既有形状一致（不带 credentialState）。
    const absent = await service.panelStatus() as Record<string, unknown>
    expect(absent).toEqual({ accounts: [], currentId: undefined })
    // unusable：带区分字段。
    const path = process.env.DSH_CODEBUDDY_AUTH_FILE!
    writeFileSync(path, 'x', { mode: 0o000 })
    const unusable = await service.panelStatus() as Record<string, unknown>
    expect(unusable.credentialState).toBe('unusable')
  })
})
