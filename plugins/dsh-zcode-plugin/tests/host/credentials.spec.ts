import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ZCodeCredentialStore } from '../../src/host/credentials.ts'
import { ZCodePreferencesStore } from '../../src/host/preferences.ts'
import type { ZCodeCredentialRecord } from '../../src/contracts/auth.ts'

let directory: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'dsh-zcode-cred-'))
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

const record: ZCodeCredentialRecord = {
  version: 1,
  family: 'bigmodel',
  zcodeJwt: 'zcode-jwt',
  accessToken: 'maas',
  userId: '409',
}

describe('凭据存储', () => {
  it('缺失文件时返回 undefined', async () => {
    const store = new ZCodeCredentialStore(join(directory, 'auth.json'))
    await expect(store.read()).resolves.toBeUndefined()
  })

  it('写入后以 0600 落盘并可读回', async () => {
    const filename = join(directory, 'auth.json')
    const store = new ZCodeCredentialStore(filename)
    await store.write(record)
    await expect(store.read()).resolves.toEqual(record)
    if (process.platform !== 'win32') {
      const mode = (await stat(filename)).mode & 0o777
      expect(mode).toBe(0o600)
    }
  })

  it('删除后读回 undefined', async () => {
    const store = new ZCodeCredentialStore(join(directory, 'auth.json'))
    await store.write(record)
    await store.delete()
    await expect(store.read()).resolves.toBeUndefined()
    // 再次删除不报错。
    await expect(store.delete()).resolves.toBeUndefined()
  })

  it('拒绝未知字段而不是静默忽略', async () => {
    const filename = join(directory, 'auth.json')
    await writeFile(filename, JSON.stringify({
      version: 1,
      credential: { ...record, surprise: 'x' },
    }), { mode: 0o600 })
    const store = new ZCodeCredentialStore(filename)
    await expect(store.read()).rejects.toThrow(/未知字段/u)
  })

  it('拒绝不支持的格式版本', async () => {
    const filename = join(directory, 'auth.json')
    await writeFile(filename, JSON.stringify({ version: 2, credential: record }), { mode: 0o600 })
    const store = new ZCodeCredentialStore(filename)
    await expect(store.read()).rejects.toThrow(/格式版本/u)
  })

  it('拒绝非法 family 与空 JWT', async () => {
    const filename = join(directory, 'auth.json')
    const store = new ZCodeCredentialStore(filename)
    await expect(store.write({ ...record, family: 'other' as 'bigmodel' }))
      .rejects.toThrow(/family/u)
    await expect(store.write({ ...record, zcodeJwt: '' })).rejects.toThrow(/zcodeJwt/u)
  })

  it('落盘内容是带 version 的信封', async () => {
    const filename = join(directory, 'auth.json')
    const store = new ZCodeCredentialStore(filename)
    await store.write(record)
    const parsed = JSON.parse(await readFile(filename, 'utf8')) as { version: number; credential: unknown }
    expect(parsed.version).toBe(1)
    expect(parsed.credential).toMatchObject({ zcodeJwt: 'zcode-jwt' })
  })
})

describe('偏好存储', () => {
  it('文件缺失时给出默认值', async () => {
    const store = new ZCodePreferencesStore(join(directory, 'prefs.json'))
    await expect(store.read()).resolves.toMatchObject({
      usageVisibility: 'auto',
      hiddenModels: [],
    })
  })

  it('合并写入并返回完整值', async () => {
    const store = new ZCodePreferencesStore(join(directory, 'prefs.json'))
    await store.write({ refreshMinutes: 30 })
    const afterMinutes = await store.read()
    expect(afterMinutes.refreshMinutes).toBe(30)
    const merged = await store.write({ hiddenModels: ['GLM-5.3'] })
    expect(merged).toMatchObject({ refreshMinutes: 30, hiddenModels: ['GLM-5.3'] })
  })

  it('损坏文件回落到默认值而不是抛错', async () => {
    const filename = join(directory, 'prefs.json')
    await writeFile(filename, '{ not json', 'utf8')
    const store = new ZCodePreferencesStore(filename)
    await expect(store.read()).resolves.toMatchObject({ usageVisibility: 'auto' })
  })

  it('越界刷新间隔被夹回合法区间', async () => {
    const store = new ZCodePreferencesStore(join(directory, 'prefs.json'))
    const high = await store.write({ refreshMinutes: 99_999 })
    expect(high.refreshMinutes).toBe(240)
    const low = await store.write({ refreshMinutes: -5 })
    expect(low.refreshMinutes).toBe(0)
  })
})
