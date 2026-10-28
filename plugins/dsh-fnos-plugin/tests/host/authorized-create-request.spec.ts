import { describe, expect, it } from 'vitest'
import { parseCreateRequest } from '../../src/host/authorized-directories.ts'

/**
 * FNOS-034：面板右键新建条目的请求体校验。
 *
 * 这条路由是本插件唯一的「新增类」写操作，校验必须挡住三类越权：
 *
 *  1. 用 `../`、绝对路径或分隔符把条目写到父目录之外；
 *  2. 用 `.`/`..` 或控制字符造出无法访问的条目；
 *  3. 用 SMB 下的保留字符造出别的协议打不开的条目。
 *
 * 校验在 Host 侧独立完成，不依赖客户端先挡一遍。
 */

describe('FNOS-034 新建条目：父目录与类型', () => {
  it('接受合法请求', () => {
    expect(parseCreateRequest({ parent: '/vol1/media', name: '影片', kind: 'directory' }))
      .toEqual({ parent: '/vol1/media', name: '影片', kind: 'directory' })
    expect(parseCreateRequest({ parent: '/vol1/media', name: 'a.txt', kind: 'file' }))
      .toEqual({ parent: '/vol1/media', name: 'a.txt', kind: 'file' })
  })

  it('父目录必须是绝对路径', () => {
    expect(parseCreateRequest({ parent: 'vol1/media', name: 'x', kind: 'directory' })).toBeNull()
    expect(parseCreateRequest({ parent: '', name: 'x', kind: 'directory' })).toBeNull()
  })

  it('父目录里的 .. 会被规范化，不会逃出授权根', () => {
    // posix.normalize 之后仍是绝对路径；后续还有授权根比对兜底。
    expect(parseCreateRequest({ parent: '/vol1/media/../media', name: 'x', kind: 'directory' }))
      .toEqual({ parent: '/vol1/media', name: 'x', kind: 'directory' })
  })

  it('kind 只接受 directory 与 file', () => {
    expect(parseCreateRequest({ parent: '/vol1', name: 'x', kind: 'symlink' })).toBeNull()
    expect(parseCreateRequest({ parent: '/vol1', name: 'x' })).toBeNull()
  })

  it('非对象请求体一律拒绝', () => {
    for (const value of [null, undefined, 'x', 42, []]) {
      expect(parseCreateRequest(value)).toBeNull()
    }
  })
})

describe('FNOS-034 新建条目：名称校验', () => {
  const create = (name: unknown) => parseCreateRequest({ parent: '/vol1', name, kind: 'file' })

  it('拒绝空名与纯空白', () => {
    expect(create('')).toBeNull()
    expect(create('   ')).toBeNull()
    expect(create(42)).toBeNull()
  })

  it('拒绝 . 与 ..', () => {
    expect(create('.')).toBeNull()
    expect(create('..')).toBeNull()
  })

  it('拒绝任何路径分隔符（含反斜杠）', () => {
    expect(create('a/b')).toBeNull()
    expect(create('a\\b')).toBeNull()
    expect(create('/abs')).toBeNull()
    expect(create('../escape')).toBeNull()
  })

  it('拒绝 SMB 下非法的保留字符', () => {
    for (const name of ['a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b']) {
      expect(create(name)).toBeNull()
    }
  })

  it('拒绝控制字符', () => {
    expect(create('a\u0000b')).toBeNull()
    expect(create('a\u0007b')).toBeNull()
    expect(create('a\nb')).toBeNull()
  })

  it('拒绝超长名称（>255）', () => {
    expect(create('a'.repeat(255))).not.toBeNull()
    expect(create('a'.repeat(256))).toBeNull()
  })

  it('去掉首尾空白后接受常见名字', () => {
    expect(parseCreateRequest({ parent: '/vol1', name: '  我的影片  ', kind: 'directory' }))
      .toEqual({ parent: '/vol1', name: '我的影片', kind: 'directory' })
  })

  it('允许中文、空格、点与短横线', () => {
    for (const name of ['第 1 季', 'v1.2.3', 'a-b_c', '.hidden']) {
      expect(create(name)).not.toBeNull()
    }
  })
})
