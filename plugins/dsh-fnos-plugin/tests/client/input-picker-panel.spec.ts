import { describe, expect, it, vi } from 'vitest'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import { createPickerOpenStore } from '../../src/client/input-references/picker-store.ts'
import { displayName, selectedPaths, toTreeNode, updateChildren } from '../../src/client/input-references/picker-tree.ts'
import type { AuthorizedEntry } from '../../src/contracts/authorized-directories-contract.ts'

/**
 * FNOS-034：选择器浮层的开关 store、树数据搬运与槽位注册。
 *
 * 这三块都是纯逻辑，不需要渲染 React。几何与样式由包契约测试钉住。
 */

const Comp = (() => null) as never

describe('FNOS-034-02-AC-03 开关按会话隔离', () => {
  it('展开一个会话不影响另一个会话', () => {
    const store = createPickerOpenStore()
    store.set('session-a' as never, true)
    expect(store.isOpen('session-a' as never)).toBe(true)
    expect(store.isOpen('session-b' as never)).toBe(false)
  })

  it('toggle 来回翻转，且不误伤其它会话', () => {
    const store = createPickerOpenStore()
    store.toggle('session-a' as never)
    expect(store.isOpen('session-a' as never)).toBe(true)
    store.toggle('session-b' as never)
    store.toggle('session-a' as never)
    expect(store.isOpen('session-a' as never)).toBe(false)
    expect(store.isOpen('session-b' as never)).toBe(true)
  })

  it('重复设置同一状态不触发通知（避免多余渲染）', () => {
    const store = createPickerOpenStore()
    const listener = vi.fn()
    store.subscribe(listener)
    store.set('session-a' as never, true)
    store.set('session-a' as never, true)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('closeAll 清空所有会话，且空集合时不再通知', () => {
    const store = createPickerOpenStore()
    store.set('session-a' as never, true)
    store.set('session-b' as never, true)
    const listener = vi.fn()
    store.subscribe(listener)
    store.closeAll()
    expect(store.isOpen('session-a' as never)).toBe(false)
    expect(store.isOpen('session-b' as never)).toBe(false)
    expect(listener).toHaveBeenCalledTimes(1)
    store.closeAll()
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('退订后不再收到通知', () => {
    const store = createPickerOpenStore()
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    unsubscribe()
    store.set('session-a' as never, true)
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('FNOS-034-02-AC-01 树数据搬运', () => {
  const directory: AuthorizedEntry = { kind: 'directory', path: '/vol1/media', semanticPath: '存储空间 1/media' }
  const file: AuthorizedEntry = { kind: 'file', path: '/vol1/media/a.mkv', semanticPath: '存储空间 1/media/a.mkv' }

  it('目录可展开、文件是叶子', () => {
    expect(toTreeNode(directory, null).isLeaf).toBe(false)
    expect(toTreeNode(file, null).isLeaf).toBe(true)
  })

  it('节点 key 与 value 都用内部路径（不是可读路径）', () => {
    const node = toTreeNode(directory, null)
    expect(node.key).toBe('/vol1/media')
    expect(node.value).toBe('/vol1/media')
    expect(node.key).not.toContain('存储空间')
  })

  it('懒加载到的子节点并回父节点，且把父节点标为可再展开', () => {
    const tree = [toTreeNode(directory, null)]
    const next = updateChildren(tree, '/vol1/media', [toTreeNode(file, null)])
    expect(next[0]?.children?.map(child => child.key)).toEqual(['/vol1/media/a.mkv'])
    expect(next[0]?.isLeaf).toBe(false)
  })

  it('并回子节点不影响兄弟节点', () => {
    const sibling: AuthorizedEntry = { kind: 'directory', path: '/vol2', semanticPath: 'vol2' }
    const tree = [toTreeNode(directory, null), toTreeNode(sibling, null)]
    const next = updateChildren(tree, '/vol1/media', [toTreeNode(file, null)])
    expect(next[1]).toBe(tree[1])
  })

  it('保留父子同时勾选的路径，不做父子折叠', () => {
    expect(selectedPaths(['/vol1', '/vol1/media'])).toEqual(['/vol1', '/vol1/media'])
  })

  it('丢弃非绝对路径并去重', () => {
    expect(selectedPaths(['/a', '/a', 'b', '', null, '/c'])).toEqual(['/a', '/c'])
  })

  it('空值归一成空数组', () => {
    expect(selectedPaths(undefined)).toEqual([])
    expect(selectedPaths(null)).toEqual([])
  })

  it('显示名取最后一段，根路径原样返回', () => {
    expect(displayName('/vol1/media')).toBe('media')
    expect(displayName('/')).toBe('/')
    expect(displayName('')).toBe('')
  })
})

describe('FNOS-034-01-AC-01 槽位注册', () => {
  /**
   * 用真实 SlotCore 注册两个条目，断言最终形状。
   *
   * 顺序与 id 一旦被打平，界面只会「静默挪个位置」，评审时很难发现；而
   * 复用指令面板的 id 会直接替换掉官方菜单。
   */
  function slotFixture() {
    const core = new SlotCore()
    core.register({
      name: 'root',
      children: {
        'conversation.composer.bar': { kind: 'single', scope: 'session-maybe' },
        'conversation.input.left': { kind: 'list', scope: 'session' },
        'conversation.input.overlay': { kind: 'list', scope: 'session' },
      },
    }, Comp)
    // 模拟上游已有的 overlay 条目，验证本插件不会与之冲突。
    for (const [id, order] of [['slash-menu', 0], ['command-popup', 1], ['feedback-dialog', 2]] as const) {
      core.register({ name: 'conversation.input.overlay', id, order } as never, Comp)
    }
    return core
  }

  const BUTTON_SEAT = { name: 'conversation.input.left', id: 'dsh-fnos-input-picker', order: 100 }
  const PANEL_SEAT = { name: 'conversation.input.overlay', id: 'dsh-fnos-path-panel', order: 10 }

  it('浮层注册在 conversation.input.overlay，且排在官方条目之后', () => {
    const core = slotFixture()
    core.register(PANEL_SEAT as never, Comp)
    const ids = core.entries('conversation.input.overlay').map(entry => (entry.options as { id: string }).id)
    expect(ids).toEqual(['slash-menu', 'command-popup', 'feedback-dialog', 'dsh-fnos-path-panel'])
  })

  it('使用自有 id，不替换指令面板与命令选择', () => {
    const core = slotFixture()
    core.register(PANEL_SEAT as never, Comp)
    const ids = core.entries('conversation.input.overlay').map(entry => (entry.options as { id: string }).id)
    // 官方三条目原样保留：本插件只是新增一个自己的条目。
    expect(ids).toContain('slash-menu')
    expect(ids).toContain('command-popup')
    expect(ids).toContain('feedback-dialog')
    // 同 id 同 priority 的重复注册会被 SlotCore 直接拒绝——这就是为什么插件
    // 必须用自有 id 而不是借用指令面板的 id。
    expect(() => { core.register(PANEL_SEAT as never, Comp) }).toThrow(/already has an entry/u)
  })

  it('工具栏按钮仍在 conversation.input.left', () => {
    const core = slotFixture()
    core.register(BUTTON_SEAT as never, Comp)
    expect(core.entries('conversation.input.left').map(entry => (entry.options as { id: string }).id))
      .toEqual(['dsh-fnos-input-picker'])
  })
})
