import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * 删除链路：确认后必须真的发请求。
 *
 * 实机反馈「点击删除并未真实删除」。根因是 Popconfirm 的 `onConfirm` 触发时，
 * 与它同层的菜单节点可能已卸载，闭包里的 `contextMenu` 变成 undefined，早期
 * 实现据此直接 return——请求从未发出，界面看起来「点了没反应」。
 *
 * 这类 bug 不会报错、不会留日志，只能靠断言「目标来源不依赖随时会消失的 state」
 * 来防。本文件因此只做源码契约断言：真正发请求的行为由
 * `authorized-directory-picker.spec.ts` 之外的集成测试覆盖成本过高。
 */

const PANEL = readFileSync(new URL('../../src/components/FnosAuthorizedPathPicker.tsx', import.meta.url), 'utf8')
const LOCALES = readFileSync(new URL('../../src/client/locales.ts', import.meta.url), 'utf8')
const STYLE = readFileSync(new URL('../../src/styles/index.scss', import.meta.url), 'utf8')

describe('FNOS-034 删除：确认后必须真的发出请求', () => {
  it('删除目标保存在 ref 里，不依赖会卸载的 state', () => {
    expect(PANEL).toContain('deleteTargetRef')
    // 确认处理函数从 ref 读，而不是从 contextMenu state 读。
    expect(PANEL).toMatch(/const target = deleteTargetRef\.current/u)
  })

  it('右键时就把目标写入 ref（而不是只在 state 里）', () => {
    expect(PANEL).toMatch(/deleteTargetRef\.current = \{ path: entry\.path/u)
  })

  it('删除调用真的存在，且早于清理本地状态', () => {
    // 请求必须在「从树里摘掉」之前发出，否则失败时界面已经先一步骗了用户。
    const call = PANEL.indexOf('await deleteAuthorizedEntry(target.path)')
    const cleanup = PANEL.indexOf('setTreeData(current => removeNode(current, target.path))')
    expect(call).toBeGreaterThan(0)
    expect(cleanup).toBeGreaterThan(call)
  })

  it('Popconfirm 弹层不被判为「菜单外点击」', () => {
    // Popconfirm 由 Semi portal 到 body，不在 menuRef 内。不豁免的话，点「确定」
    // 会被外部点击监听判成菜单外点击 → 菜单卸载 → Popconfirm 消失 →
    // onConfirm 永不触发。这是「删除点了没反应」的真因。
    expect(PANEL).toContain("closest('.semi-popconfirm')")
  })

  it('确认链路有可观测日志', () => {
    // 无日志时，实机出问题只能靠猜。两条日志分别覆盖「请求是否发出」与
    // 「宿主是否拒绝」。
    expect(PANEL).toContain("[dsh-fnos][delete] confirm")
    expect(PANEL).toContain("[dsh-fnos][delete] succeeded")
    expect(PANEL).toContain("[dsh-fnos][delete] failed")
  })

  it('失败时用 toast 告知，不静默吞掉', () => {
    expect(PANEL).toMatch(/catch \(error: unknown\) \{[\s\S]{0,220}Toast\.error/u)
  })
})

describe('FNOS-034 删除提示：使用 Popconfirm 默认尺寸', () => {
  it('不给 Popconfirm 传宽度或尺寸类', () => {
    const block = /<Popconfirm[\s\S]*?>/u.exec(PANEL)?.[0] ?? ''
    expect(block.length).toBeGreaterThan(0)
    expect(block).not.toMatch(/width=/u)
    expect(block).not.toMatch(/style=/u)
    expect(block).not.toMatch(/className=/u)
  })

  it('样式表不覆盖 popconfirm 尺寸', () => {
    // 自定义尺寸会和 Semi 自带的 max-width 打架，把提示框撑得比正文还大。
    expect(STYLE.toLowerCase()).not.toContain('semi-popconfirm')
  })

  it('确认文案保持短句，避免撑宽默认气泡', () => {
    const zh = LOCALES.slice(LOCALES.indexOf('export const zh'))
    const match = /deleteDialogBody: '((?:[^'\\]|\\.)*)'/u.exec(zh)
    expect(match?.[1]).toBeDefined()
    // Popconfirm 的默认宽度按短句设计；超过约 30 个字符会明显变宽。
    expect([...(match?.[1] ?? '')].length).toBeLessThanOrEqual(30)
  })
})

/**
 * 取消授权的确认弹框：异步期间不能立即关闭。
 *
 * 撤销授权是后端操作（撤 ACL → 重拉列表 → 回写持久化）。早前 `onOk` 里先
 * `setPendingDeletePath(undefined)` 就返回，弹层瞬间消失而后台还在跑：用户看不到
 * 进度，容易以为没生效而重复点击；失败时错误也只落到列表上，与「已取消」的观感冲突。
 */
describe('取消授权：确认后保持打开并显示 loading', () => {
  const CARD = readFileSync(new URL('../../src/components/AuthorizedDirectoriesCard.tsx', import.meta.url), 'utf8')

  it('确认时进入 loading，而不是立刻关闭', () => {
    /*
      Semi Modal 文档：「点击确认按钮时的回调函数，**返回 Promise 时，确认按钮
      会出现 loading 态**」。所以正解是让 `onOk` 返回 Promise，由组件自己管
      loading 与关闭时机。

      不要手写 `confirmLoading` / `okButtonProps.loading`，更不能传 `disabled`
      —— 那会让按钮变成灰色不可点态，看起来像「坏了」而不是「正在处理」。
    */
    expect(CARD).toContain('onOk={() => confirmDelete()}')
    expect(CARD).toContain('async (): Promise<void> =>')
    expect(CARD).not.toContain('okButtonProps={{ loading: deletePending, disabled: deletePending }}')
    expect(CARD).not.toContain('confirmLoading={deletePending}')
    // 更不能把确认按钮 disable 掉——那是灰色不可点态，与 loading 视觉完全不同。
    expect(CARD).not.toContain('okButtonProps=')
    expect(CARD).not.toContain('cancelButtonProps={{ disabled')
  })

  it('loading 期间不能被打断（取消、遮罩、Esc）', () => {
    // 中途关闭会让用户以为操作被取消，但请求其实还在跑。
    expect(CARD).toContain('closeOnEsc={!deletePending}')
    expect(CARD).toContain('maskClosable={!deletePending}')
    expect(CARD).toContain('if (!deletePending) setPendingDeletePath(undefined)')
  })

  it('等操作真正结束才关闭弹层', () => {
    // confirmDelete 用 finally 关闭：成功失败都要收尾，不能卡在 loading。
    const block = CARD.slice(CARD.indexOf('const confirmDelete'), CARD.indexOf('const confirmDelete') + 900)
    expect(block).toContain('await removeDirectory(path)')
    expect(block).toContain('setDeletePending(false)')
    expect(block).toContain('setPendingDeletePath(undefined)')
    // 重复提交要短路。
    expect(block).toContain('deletePending) return')
  })

  it('按钮文案是「确认」，不是「确认授权」', () => {
    /*
      「确认授权」只适用于**申请**授权的场景（如选择器弹窗的 okText）。
      这里是**取消**授权，说「确认授权」正好相反。所以另立 `confirmAction`，
      不改 `confirm`——它仍被添加目录的选择器使用。
    */
    expect(CARD).toContain("okText={t('confirmAction')}")
    expect(LOCALES).toContain("confirmAction: '确认'")
    expect(LOCALES).toContain("confirmAction: 'Confirm'")
    // 原键保持「确认授权」不变。
    expect(LOCALES).toContain("confirm: '确认授权'")
  })
})
