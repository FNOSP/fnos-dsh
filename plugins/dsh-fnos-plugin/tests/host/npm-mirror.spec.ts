import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseNrmList } from '../../src/host/npm-mirror.ts'

/**
 * npm 镜像管理：解析 `nrm ls`。
 *
 * 这是整个功能里唯一需要「读懂外部工具输出」的地方，而外部格式最容易随版本变。
 * 下面的样本取自 nrm 2.1.0 的真实输出。
 */
const REAL_OUTPUT = `  npm ---------- https://registry.npmjs.org/
  yarn --------- https://registry.yarnpkg.com/
  tencent ------ https://mirrors.tencent.com/npm/
  cnpm --------- https://r.cnpmjs.org/
* taobao ------- https://registry.npmmirror.com/
  npmMirror ---- https://skimdb.npmjs.com/registry/
  huawei ------- https://repo.huaweicloud.com/repository/npm/
`

const MIRROR = readFileSync(new URL('../../src/host/npm-mirror.ts', import.meta.url), 'utf8')

describe('解析 nrm ls', () => {
  it('读出全部源，并标出当前源', () => {
    const mirrors = parseNrmList(REAL_OUTPUT)
    expect(mirrors).toHaveLength(7)
    expect(mirrors.map(m => m.name)).toEqual(['npm', 'yarn', 'tencent', 'cnpm', 'taobao', 'npmMirror', 'huawei'])
    // 行首 `*` 是当前源标记。
    expect(mirrors.filter(m => m.current).map(m => m.name)).toEqual(['taobao'])
  })

  it('保持 nrm 的原始顺序（不把当前源提到最前）', () => {
    // 用户按自己熟悉的顺序看列表；重排会让「第几个是什么」失效。
    expect(parseNrmList(REAL_OUTPUT)[0]?.name).toBe('npm')
  })

  it('没有当前源标记时全部为非当前', () => {
    const mirrors = parseNrmList('  npm ---------- https://registry.npmjs.org/\n')
    expect(mirrors).toEqual([{ name: 'npm', registry: 'https://registry.npmjs.org/', current: false }])
  })

  it('跳过 nrm 的 ERROR / SUCCESS 行', () => {
    const output = ` SUCCESS  The registry has been changed to 'taobao'.
 ERROR  Error: EPERM: operation not permitted
  npm ---------- https://registry.npmjs.org/
`
    expect(parseNrmList(output)).toHaveLength(1)
  })

  it('只接受 http(s) 的 URL', () => {
    // nrm 也可能打印自定义字段，非 URL 的内容不该被当成镜像。
    expect(parseNrmList('  weird ---- not-a-url\n')).toEqual([])
  })

  it('容忍 `-` 数量与额外空白', () => {
    expect(parseNrmList('*  a -- http://x.test/\n')).toEqual([{ name: 'a', registry: 'http://x.test/', current: true }])
    expect(parseNrmList('   b ------------------------ https://y.test/\n')).toHaveLength(1)
  })

  it('空输入返回空列表', () => {
    expect(parseNrmList('')).toEqual([])
  })
})

describe('未安装与失败要区分', () => {
  it('ENOENT 判为未安装，其它失败如实报错', () => {
    /*
      两者的处置完全不同：没装要去装，装了但报错（比如 .npmrc 权限）重装也没用。
      混为一谈会让用户反复重装。
    */
    expect(MIRROR).toContain('nrm-not-installed')
    expect(MIRROR).toContain('nrm-failed')
    expect(MIRROR).toContain('ENOENT')
  })

  it('必须把 error.message 并入输出，否则检测不到「未安装」', () => {
    /*
      真机踩到：命令不存在时 execFile 的 stdout 与 stderr **都是空字符串**，
      `spawn nrm ENOENT` 只在 error.message 里。只拼 stdout+stderr 的话，
      「没装」会被误报成「装了但执行失败」，提示用户去重装一个从没装过的东西。
    */
    expect(MIRROR).toContain("error?.message ?? ''")
    expect(MIRROR).toContain('codeName')
  })

  it('不代用户执行全局安装', () => {
    // `npm i -g` 写全局 node_modules，跨项目生效，不该由应用替用户决定。
    expect(MIRROR).not.toContain("'install'")
    expect(MIRROR).not.toContain("'-g'")
  })
})

describe('切换源', () => {
  it('用 nrm use，且校验名字（会被拼进命令行）', () => {
    expect(MIRROR).toContain("'use'")
    expect(MIRROR).toContain('invalid-mirror-name')
    expect(MIRROR).toContain('[A-Za-z0-9._-]')
  })
})
