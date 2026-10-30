import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * FNOS-040：右键菜单的「打开 / 重命名」与面板状态保持。
 *
 * 与删除链路的用例同一手法——断言源码里的契约而不是渲染结果：这些行为都发生在
 * 真实面板里（需要 DOM、Semi 树与 fnOS iframe），单测环境无法复现，而真正要防的
 * 回归是「有人把某一环拆掉」：
 *
 *  1. 打开动作没有按条目类型分流（目录交给文件管理器、文件交给 fnOS 打开）；
 *  2. 重命名没有落到宿主路由，或成功后没有刷新父目录那一层；
 *  3. 展开/滚动被重新交回 Semi 的内部状态（面板一收起就丢）。
 */

const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8')

const PANEL = read('../../src/components/FnosAuthorizedPathPicker.tsx')
const LOCALES = read('../../src/client/locales.ts')
const OPENER = read('../../src/client/services/file-opener.ts')
const CLIENT = read('../../src/client/services/authorized-directories-client.ts')
const HOST = read('../../src/host/authorized-directories.ts')
const BUTTON = read('../../src/components/FnosInputPickerButton.tsx')
const STYLE = read('../../src/styles/index.scss')

describe('FNOS-040-01 右键打开按条目类型分流', () => {
  it('面板把路径与类型一起交给 fnOS 打开', () => {
    expect(PANEL).toContain('openFnosEntry(target.path, target.kind, () => createTrimApp())')
  })

  it('目录走文件管理器，文件走 fnOS 打开/预览', () => {
    // 目录用 openFileManager 才能「定位到该目录」；文件的默认应用打开才是预览。
    expect(OPENER).toMatch(/if \(kind === 'directory'\) await sdk\.openFileManager\(path\)/u)
    expect(OPENER).toMatch(/else await sdk\.openFile\(path\)/u)
  })

  it('carrier 未就绪时显式失败，不回退到 DSH 原生打开', () => {
    expect(OPENER).toContain('sdk.isStandaloneWeb')
    expect(OPENER).toContain("throw new Error('fnOS iframe SDK did not initialize its web carrier')")
  })

  it('打开失败给出可见提示，不静默吞掉', () => {
    expect(PANEL).toContain("Toast.error({ content: t('openEntryFailed') })")
  })
})

describe('FNOS-040-02 重命名走宿主路由', () => {
  it('客户端只把宿主错误码原样抛出', () => {
    expect(CLIENT).toContain('FNOS_AUTHORIZED_RENAME_ENTRY_PATH')
    expect(CLIENT).toContain('export async function renameAuthorizedEntry')
  })

  it('宿主拒绝授权根改名，且不覆盖已存在的目标', () => {
    expect(HOST).toContain("'fnos-rename-root-forbidden'")
    // POSIX 的 rename 会静默覆盖同名文件，必须先探测目标是否已存在。
    expect(HOST).toMatch(/const existing = await stat\(target\)/u)
    expect(HOST).toContain("if (existing !== undefined) return json(res, 409, { error: 'fnos-entry-exists' })")
  })

  it('成功只重取父目录那一层，其它展开分支不动', () => {
    // 整树重取会把用户展开的分支全收起来。
    const call = PANEL.indexOf('applyEntries(await requestAuthorizedEntries(parent), parent)')
    expect(call).toBeGreaterThan(0)
    expect(PANEL).toContain('const parent = parentPathOf(renameTarget.path)')
  })

  it('重命名弹框与新建共用 fnOS 样式作用域', () => {
    const modals = PANEL.match(/className="dsh-fnos-create-dialog"/gu) ?? []
    expect(modals.length).toBe(2)
  })
})

describe('FNOS-040-03 展开与滚动跨收起保留', () => {
  it('展开状态受控，交给面板而不是 Semi 内部状态', () => {
    expect(PANEL).toContain('expandedKeys={expandedKeys}')
    expect(PANEL).toContain('onExpand={handleExpand}')
  })

  it('滚动位置记在真正滚动的那一层上', () => {
    expect(PANEL).toContain('treeScrollContainer(panelRef.current)')
    // 纵向滚动在树的根元素上；内层 `.semi-tree-option-list` 只做横向，
    // 记错层会永远读到 scrollTop = 0。
    expect(PANEL).toContain("panel.querySelector<HTMLElement>('.dsh-fnos-path-panel-tree')")
    expect(PANEL).toContain('container.scrollTop = scrollTopRef.current')
  })

  it('样式里纵向滚动确实落在树的根元素上', () => {
    // 断言与上面同一处契约：若有人把 overflow 挪回内层 list，还原就会失效。
    const tree = STYLE.slice(STYLE.lastIndexOf('.dsh-fnos-path-panel-tree {'))
    expect(tree).toMatch(/overflow:\s*auto;/u)
  })

  it('勾选状态仍然每次展开重新开始（与改造前一致）', () => {
    expect(PANEL).toContain('setDesiredPaths(EMPTY_TREE_VALUE)')
    expect(PANEL).toContain('setDesiredPaths(undefined)')
  })

  it('条目消失或改名后清掉对应展开记录', () => {
    expect(PANEL).toContain('forgetExpandedKeys(target.path)')
    expect(PANEL).toContain('forgetExpandedKeys(renameTarget.path)')
  })
})

describe('FNOS-040-04 输入区图标气泡改为「文件管理」', () => {
  it('触发器用的是 inputPicker 文案', () => {
    expect(BUTTON).toContain("title={t('inputPicker')}")
  })

  it('中英文都不再是「插入 NAS 文件或目录」', () => {
    expect(LOCALES).not.toContain('插入 NAS 文件或目录')
    expect(LOCALES).not.toContain('Insert NAS file or directory')
    expect(LOCALES).toContain("inputPicker: '文件管理'")
    expect(LOCALES).toContain("inputPicker: 'File manager'")
  })
})
