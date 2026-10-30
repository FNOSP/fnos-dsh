import { describe, expect, it } from 'vitest'
import { parseRenameRequest } from '../../src/host/authorized-directories.ts'

/**
 * FNOS-040-02：重命名请求体校验。
 *
 * 重命名是本插件第二类写操作（第一类是新建）。它与新建共用单段名字规则，但目标
 * 是一个**已存在**的路径，因此要额外挡住两类越权：
 *
 *  1. 用 `../` 或分隔符把条目挪到别的目录（名字必须仍是单段）；
 *  2. 用非法字符造出别的协议打不开的名字（与新建同一套禁用字符）。
 *
 * 授权根不可改名、目标已存在不覆盖这两条由路由判定（需要真实文件系统），
 * 这里只钉请求体解析。
 */

describe('FNOS-040-02 重命名：路径与名字', () => {
  it('接受合法请求', () => {
    expect(parseRenameRequest({ path: '/vol1/media/old.mp4', name: 'new.mp4' }))
      .toEqual({ path: '/vol1/media/old.mp4', name: 'new.mp4' })
  })

  it('名字两端的空白会被裁掉', () => {
    expect(parseRenameRequest({ path: '/vol1/media/a', name: '  b  ' }))
      .toEqual({ path: '/vol1/media/a', name: 'b' })
  })

  it('路径必须是绝对路径并规范化', () => {
    expect(parseRenameRequest({ path: 'vol1/media/a', name: 'b' })).toBeNull()
    expect(parseRenameRequest({ path: '', name: 'b' })).toBeNull()
    expect(parseRenameRequest({ path: '/vol1/media/../media/a', name: 'b' }))
      .toEqual({ path: '/vol1/media/a', name: 'b' })
  })

  it('名字不能带路径分隔符，不能把条目挪到别的目录', () => {
    expect(parseRenameRequest({ path: '/vol1/media/a', name: '../b' })).toBeNull()
    expect(parseRenameRequest({ path: '/vol1/media/a', name: 'x/y' })).toBeNull()
    expect(parseRenameRequest({ path: '/vol1/media/a', name: 'x\\y' })).toBeNull()
  })

  it('名字不能是 . 或 ..，也不能为空', () => {
    expect(parseRenameRequest({ path: '/vol1/media/a', name: '.' })).toBeNull()
    expect(parseRenameRequest({ path: '/vol1/media/a', name: '..' })).toBeNull()
    expect(parseRenameRequest({ path: '/vol1/media/a', name: '   ' })).toBeNull()
    expect(parseRenameRequest({ path: '/vol1/media/a', name: 'x'.repeat(256) })).toBeNull()
  })

  it('拒绝 SMB 下不可用的字符与控制字符', () => {
    for (const name of ['a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b', 'a\u0001b']) {
      expect(parseRenameRequest({ path: '/vol1/media/a', name })).toBeNull()
    }
  })

  it('非对象请求体与缺字段一律拒绝', () => {
    for (const value of [null, undefined, 1, 'x', [], {}]) {
      expect(parseRenameRequest(value)).toBeNull()
    }
    expect(parseRenameRequest({ path: '/vol1/media/a' })).toBeNull()
    expect(parseRenameRequest({ name: 'b' })).toBeNull()
  })
})
