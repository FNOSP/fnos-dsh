import { describe, expect, it, vi } from 'vitest'
import {
  mergePersistedWithLive,
  readPersistedAuthorizedDirectories,
  writePersistedAuthorizedDirectories,
  type AuthorizedDirectoriesSettings,
} from '../../src/host/authorized-directories.ts'

/**
 * 授权目录持久化（FNOS-009-09）的宿主侧读写。
 *
 * settings 是这份数据的**唯一权威来源**：没有第二份镜像文件，所以这里的读写
 * 规则就是持久化契约本身。最容易出错的是老用户升级路径——字段不存在时读取方
 * 必须拿到空数组，而不是 `undefined` 顺着调用链炸掉整页。
 */

const NS = 'dsh-fnos'

/** 搭一个最小 settings 替身；`update` 记录调用参数。 */
function settingsStub(value?: unknown): AuthorizedDirectoriesSettings & { updates: Array<[string, Record<string, unknown>]> } {
  const updates: Array<[string, Record<string, unknown>]> = []
  return {
    updates,
    describe: () => [{ ns: NS, value }],
    update: async (ns, patch) => { updates.push([ns, patch]) },
  }
}

describe('readPersistedAuthorizedDirectories', () => {
  it('returns an empty list when an upgraded profile has no field yet', () => {
    // 老用户的 settings 里没有这个字段：必须得到空数组，不能是 undefined。
    expect(readPersistedAuthorizedDirectories(settingsStub({ gatewayProxyPaths: [] }), NS)).toEqual([])
  })

  it('returns an empty list when the namespace is absent entirely', () => {
    const settings: AuthorizedDirectoriesSettings = { describe: () => [], update: async () => undefined }
    expect(readPersistedAuthorizedDirectories(settings, NS)).toEqual([])
  })

  it('reads the stored paths in order', () => {
    const settings = settingsStub({ authorizedDirectories: ['/vol4/a', '/vol2/b'] })
    expect(readPersistedAuthorizedDirectories(settings, NS)).toEqual(['/vol4/a', '/vol2/b'])
  })

  it('drops malformed and duplicate entries instead of failing', () => {
    const settings = settingsStub({ authorizedDirectories: ['/vol4/a', '/vol4/a/', 'relative', '', null, 7, '/vol2/b'] })

    // 坏数据只跳过，不抛错：持久化记录可能来自更早的版本。
    expect(readPersistedAuthorizedDirectories(settings, NS)).toEqual(['/vol4/a', '/vol2/b'])
  })

  it('tolerates a non-array field value', () => {
    expect(readPersistedAuthorizedDirectories(settingsStub({ authorizedDirectories: '/vol4/a' }), NS)).toEqual([])
  })
})

describe('writePersistedAuthorizedDirectories', () => {
  it('writes normalized, de-duplicated paths to the given namespace', async () => {
    const settings = settingsStub()

    const stored = await writePersistedAuthorizedDirectories(settings, NS, ['/vol4/a', '/vol4/a/', '/vol2/b'])

    expect(stored).toEqual(['/vol4/a', '/vol2/b'])
    expect(settings.updates).toEqual([[NS, { authorizedDirectories: ['/vol4/a', '/vol2/b'] }]])
  })

  it('accepts an empty list, which is how a full eviction is committed', async () => {
    const settings = settingsStub()

    const stored = await writePersistedAuthorizedDirectories(settings, NS, [])

    expect(stored).toEqual([])
    expect(settings.updates).toEqual([[NS, { authorizedDirectories: [] }]])
  })

  it('rejects malformed entries by dropping them rather than storing garbage', async () => {
    const settings = settingsStub()

    await writePersistedAuthorizedDirectories(settings, NS, ['/vol4/ok', 'relative', 42])

    expect(settings.updates[0]?.[1]).toEqual({ authorizedDirectories: ['/vol4/ok'] })
  })

  it('propagates a settings write rejection so the caller can log it', async () => {
    const settings: AuthorizedDirectoriesSettings = {
      describe: () => [{ ns: NS, value: {} }],
      update: vi.fn().mockRejectedValue(new Error('settings unavailable')),
    }

    await expect(writePersistedAuthorizedDirectories(settings, NS, ['/vol4/a'])).rejects.toThrow('settings unavailable')
  })
})

describe('mergePersistedWithLive', () => {
  it('keeps persisted entries first and appends live-only ones', () => {
    // 持久化优先是 FNOS-009-09-AC-02 的核心：实时来源为空时持久化项照样在。
    expect(mergePersistedWithLive(['/vol4/kept'], ['/vol4/new'])).toEqual(['/vol4/kept', '/vol4/new'])
  })

  it('keeps every persisted entry when the live query returned nothing', () => {
    expect(mergePersistedWithLive(['/vol4/a', '/vol2/b'], [])).toEqual(['/vol4/a', '/vol2/b'])
  })

  it('collapses a path that appears in both sources', () => {
    expect(mergePersistedWithLive(['/vol4/a'], ['/vol4/a', '/vol2/b'])).toEqual(['/vol4/a', '/vol2/b'])
  })

  it('includes read-only shared paths without letting them displace user entries', () => {
    expect(mergePersistedWithLive(['/vol4/mine'], [], ['/vol1/@appshare/app'])).toEqual(['/vol4/mine', '/vol1/@appshare/app'])
  })

  it('tolerates undefined and malformed inputs', () => {
    expect(mergePersistedWithLive(undefined, undefined)).toEqual([])
    expect(mergePersistedWithLive([], null, ['/vol4/a', 'nope'])).toEqual(['/vol4/a'])
  })
})
