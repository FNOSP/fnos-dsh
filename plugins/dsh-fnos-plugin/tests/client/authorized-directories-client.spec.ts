import { afterEach, describe, expect, it, vi } from 'vitest'
import { directoriesFromResponse, readablePathsFromResponse, renameAuthorizedEntry, requestAuthorizedEntries } from '../../src/client/services/authorized-directories-client.ts'

describe('fnOS authorized-directory client response', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps shared application paths display-only and defaults older entries to removable', () => {
    expect(directoriesFromResponse({
      directories: [
        { path: '/vol4/share', semanticPath: '存储空间4/share', removable: true },
        { path: '/vol4/app-share', semanticPath: '存储空间4/app-share', removable: false },
        { path: '/vol4/legacy', semanticPath: '存储空间4/legacy' },
      ],
    })).toEqual([
      { path: '/vol4/share', semanticPath: '存储空间4/share', removable: true },
      { path: '/vol4/app-share', semanticPath: '存储空间4/app-share', removable: false },
      { path: '/vol4/legacy', semanticPath: '存储空间4/legacy', removable: true },
    ])
  })

  it('carries the host validity flag through instead of dropping it', () => {
    // Host 用 `valid` 标注该目录是否仍在 fnOS 授权范围内。解析时丢掉这个字段，
    // 客户端会把每条目录都当成「无法判定」，于是即使 Host 已正确判定为有效，
    // 界面仍永久停留在降级提示上。
    const parsed = directoriesFromResponse({
      directories: [
        { path: '/vol4/ok', semanticPath: '存储空间4/ok', removable: true, valid: true },
        { path: '/vol4/stale', semanticPath: '存储空间4/stale', removable: true, valid: false },
        { path: '/vol4/unknown', semanticPath: '存储空间4/unknown', removable: true },
      ],
    })

    expect(parsed.map(entry => entry.valid)).toEqual([true, false, undefined])
    // 只读项不参与判定：Host 不给 valid 时不得凭空生成。
    expect(directoriesFromResponse({
      directories: [{ path: '/vol4/app', semanticPath: '存储空间4/app', removable: false }],
    })[0]?.valid).toBeUndefined()
  })

  it('normalizes readable path responses and ignores malformed duplicates', () => {
    expect(readablePathsFromResponse({
      paths: [
        { path: '/vol4/media', semanticPath: '存储空间4/media' },
        { path: '/vol4/media', semanticPath: 'duplicate' },
        { path: '/vol2/docs' },
        { path: '', semanticPath: 'invalid' },
      ],
    })).toEqual([
      { path: '/vol4/media', semanticPath: '存储空间4/media' },
      { path: '/vol2/docs', semanticPath: '/vol2/docs' },
    ])
  })

  it('loads a de-duplicated authorized file listing through the same-origin route', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      directory: { path: '/vol4/share', semanticPath: '存储空间4/share' },
      entries: [
        { path: '/vol4/share/a.txt', semanticPath: '存储空间4/share/a.txt', kind: 'file', size: 12 },
        { path: '/vol4/share/docs', semanticPath: '存储空间4/share/docs', kind: 'directory' },
        { path: '/vol4/share/a.txt', semanticPath: 'duplicate', kind: 'file' },
        { path: '/vol4/share/bad', semanticPath: 'invalid', kind: 'unknown' },
      ],
      truncated: true,
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)

    await expect(requestAuthorizedEntries('/vol4/share')).resolves.toEqual({
      directory: { path: '/vol4/share', semanticPath: '存储空间4/share' },
      entries: [
        { path: '/vol4/share/a.txt', semanticPath: '存储空间4/share/a.txt', kind: 'file', size: 12 },
        { path: '/vol4/share/docs', semanticPath: '存储空间4/share/docs', kind: 'directory' },
      ],
      truncated: true,
    })
    expect(fetch).toHaveBeenCalledWith('/plugins/dsh-fnos/authorized-directories/entries', expect.objectContaining({ method: 'POST' }))
  })
})

describe('FNOS-040-02 重命名条目的客户端封装', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('把新名字发给宿主并返回改名后的条目', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      entry: { path: '/vol4/share/new.txt', semanticPath: '存储空间4/share/new.txt', kind: 'file' },
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)

    await expect(renameAuthorizedEntry('/vol4/share/old.txt', 'new.txt')).resolves.toEqual({
      path: '/vol4/share/new.txt',
      semanticPath: '存储空间4/share/new.txt',
      kind: 'file',
    })
    expect(fetch).toHaveBeenCalledWith(
      '/plugins/dsh-fnos/authorized-directories/rename-entry',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('宿主错误码原样抛出，供弹框翻成可操作原因', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'fnos-entry-exists' }), { status: 409 })))
    await expect(renameAuthorizedEntry('/vol4/share/a', 'b')).rejects.toThrow('fnos-entry-exists')
  })

  it('响应体缺字段时按协议错误处理，不当成成功', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ entry: { path: '/vol4/share/a' } }), { status: 200 })))
    await expect(renameAuthorizedEntry('/vol4/share/a', 'b')).rejects.toThrow('invalid-rename-response')
  })
})
