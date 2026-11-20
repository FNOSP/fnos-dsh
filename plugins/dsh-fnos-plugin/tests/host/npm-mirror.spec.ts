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

  it('提供安装能力，且只装 nrm 这一个包', () => {
    /*
      早前只显示命令、让用户去终端执行。但这是 fnOS 应用——用户打开的是 Web
      界面，未必有可以直接执行的 shell 环境，「请你去终端跑这条命令」等于把问题
      丢回去。既然界面上有「安装」按钮，就该真的装上。

      约束：只装 nrm、只用标准 `-g`，不改其它全局状态。
    */
    expect(MIRROR).toContain('installNrm')
    expect(MIRROR).toContain("'install', '-g', 'nrm'")
  })
})

describe('安装过程有日志', () => {
  it('用 spawn 流式写日志，而不是 execFile 一次性给', () => {
    /*
      安装要几十秒，execFile 只在结束时给全部输出——界面那段时间只能显示一个
      「正在安装…」，用户无法判断是在下载还是卡住了。
    */
    expect(MIRROR).toContain('spawn(')
    expect(MIRROR).toContain('appendLog')
    expect(MIRROR).toContain('startLog')
  })

  it('成功与失败都落一行结论', () => {
    expect(MIRROR).toContain('nrm 安装成功')
    expect(MIRROR).toContain('nrm 安装失败')
  })

  it('界面按 offset 增量拉日志，写进任务浮层而不是卡片', () => {
    /*
      FNOS-059：日志不再存在卡片里，改为进任务日志浮层（同时由浮层写入运行日志
      中心）。卡片只保留进度与失败原因，因此这里断言的是「拉取 + 转发」这条链路，
      而不是「卡片渲染 <pre>」。
    */
    const CARD = readFileSync(new URL('../../src/components/NpmMirrorCard.tsx', import.meta.url), 'utf8')
    expect(CARD).toContain('fetchInstallLog')
    expect(CARD).toContain("fetchInstallLog(logOffsetRef.current, 'mirror')")
    expect(CARD).toContain('logPanelStore.beginTask')
    expect(CARD).toContain('logPanelStore.append')
    // 卡片内不再出现日志框标记。
    expect(CARD).not.toContain('dsh-fnos-mirror-log')
  })

  it('nrm 与插件安装使用各自的日志文件，互不覆盖', () => {
    const INSTALL = readFileSync(new URL('../../src/host/plugin-install.ts', import.meta.url), 'utf8')
    expect(INSTALL).toContain("kind === 'mirror' ? 'mirror-log.txt' : 'install-log.txt'")
    expect(MIRROR).toContain("installLogPath('mirror')")
  })
})

describe('安装日志去处（FNOS-059）', () => {
  it('日志不再渲染在卡片里', () => {
    /*
      原先卡片内有一个 140px 定高的代码框显示 npm 输出。它有三个问题：与浮层/
      日志中心内容重复、展开会把下方卡片顶走、随卡片卸载而丢失。
      现在日志统一由任务浮层与运行日志中心承担。
    */
    const CARD = readFileSync(new URL('../../src/components/NpmMirrorCard.tsx', import.meta.url), 'utf8')
    expect(CARD).not.toContain('dsh-fnos-mirror-logbox')
    expect(CARD).not.toContain('copyLog')
    // 失败原因仍以 <pre> 显示（它是错误提示，不是日志）。
    expect(CARD).toContain('dsh-fnos-mirror-error')
  })

  it('失败时按钮变「重新安装」，失败原因仍显示在卡片', () => {
    // 进度与失败原因留在原地是必要的：用户不必为了看结果去翻浮层。
    const CARD = readFileSync(new URL('../../src/components/NpmMirrorCard.tsx', import.meta.url), 'utf8')
    expect(CARD).toContain('setFailed(true)')
    expect(CARD).toContain("failed ? t('mirrorReinstall')")
    expect(CARD).toContain('installError')
  })
})

describe('自测发现的三处修复', () => {

  it('backdrop-filter 的 -webkit- 前缀必须写在标准属性之前', () => {
    /*
      实测 lightningcss 压这两行时只保留最后一条：标准属性若在前，产物里只剩
      `-webkit-backdrop-filter`，Chrome 上模糊完全不生效
      （`getComputedStyle(...).backdropFilter` 返回 `none`）。
    */
    const SCSS = readFileSync(new URL('../../src/styles/index.scss', import.meta.url), 'utf8')
    const idx = SCSS.indexOf('-webkit-backdrop-filter: blur(8px)')
    expect(idx).toBeGreaterThan(-1)
    // 标准属性紧跟其后。
    expect(SCSS.slice(idx, idx + 200)).toMatch(/-webkit-backdrop-filter[^;]*;\s*backdrop-filter:/u)
  })

  it('卸载确认框的主按钮用「卸载」而不是「确认授权」', () => {
    // `t('confirm')` 在授权场景是「确认授权」，放到卸载框里语义不对。
    const PANEL = readFileSync(new URL('../../src/components/InstalledPluginsPanel.tsx', import.meta.url), 'utf8')
    const idx = PANEL.indexOf("t('pluginRemoveTitle')")
    const block = PANEL.slice(idx, idx + 400)
    expect(block).toContain("okText={t('uninstall')}")
    expect(block).not.toContain("okText={t('confirm')}")
  })
})

describe('界面宽度', () => {
  it('带 width: 100% + padding 的块必须 border-box', () => {
    /*
      真机踩到：`.dsh-fnos-mirror-command` 写了 `width: 100%` + `padding: 8px 12px`
      但没有 `box-sizing: border-box`，横向多出 24px，把整个 tab 撑出水平滚动条
      （clientWidth 579 / scrollWidth 603）。
    */
    const SCSS = readFileSync(new URL('../../src/styles/index.scss', import.meta.url), 'utf8')
    for (const selector of ['.dsh-fnos-mirror-command {', '.dsh-fnos-mirror-error {']) {
      const i = SCSS.indexOf(selector)
      const rule = SCSS.slice(i, SCSS.indexOf('}', i))
      expect(rule, selector).toContain('box-sizing: border-box')
    }
  })
})

describe('切换源', () => {
  it('用 nrm use，且校验名字（会被拼进命令行）', () => {
    expect(MIRROR).toContain("'use'")
    expect(MIRROR).toContain('invalid-mirror-name')
    expect(MIRROR).toContain('[A-Za-z0-9._-]')
  })
})
