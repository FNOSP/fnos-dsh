/**
 * 把一枚 `<input type="file">` 变「可被 CDP 注入」但不影响页面观感，并在用完后
 * 完整还原。
 *
 * ## 为什么不能直接改祖先的 `display`
 *
 * 实测踩过：把祖先容器（fnOS 上带 `.hidden` 类的那个）从 `display: none` 改成
 * `block`，会让**同容器里的另一枚目录 input 一并显现**——用户看到应用中心顶部
 * 多出一个「选择文件」按钮，以为安装出错了。
 *
 * 祖先的样式属于页面，不属于我们。正确的做法是只动目标元素本身，且不动它的
 * `display`（`display: none` 的元素不进入无障碍树，CDP 拿不到 uid）。
 *
 * ## 三条约束
 *
 * 1. **必须留在无障碍树里**：`display: none` / `disabled` 都会被排除，快照取不到
 *    uid，`DOM.setFileInputFiles` 无从下手。用 1px + 极小透明度；
 * 2. **不能移动 DOM 位置**：应用可能依赖它在原容器里接收事件，`appendChild` 到
 *    `body` 会让 `change` 打到别处；
 * 3. **必须可还原**：返回的 dispose 要把内联样式逐条清掉，恢复成调用前原样。
 *
 * @module dsh-e2e-kit/upload-input
 */

/**
 * 目标 input 的最小形状。
 *
 * 这个包的编译目标没有 DOM lib（它整体面向 Node），而本模块的代码是**注入到
 * 页面里执行**的，所以用结构类型描述真正用到的那几个成员，而不是引 `lib.dom`。
 */
export interface UploadInputTarget {
  readonly style: {
    setProperty: (property: string, value: string, priority?: string) => void
    getPropertyValue: (property: string) => string
    getPropertyPriority: (property: string) => string
    removeProperty: (property: string) => void
  }
  id: string
  hasAttribute: (name: string) => boolean
  getAttribute: (name: string) => string | null
  setAttribute: (name: string, value: string) => void
  removeAttribute: (name: string) => void
}

/** 隐藏但仍可被 CDP 寻址的内联样式。 */
const STEALTH_STYLE = {
  position: 'fixed',
  top: '0',
  left: '0',
  width: '1px',
  height: '1px',
  opacity: '0.01',
  padding: '0',
  border: '0',
  margin: '0',
  'pointer-events': 'none',
} as const

/** 一次注入准备的结果。 */
export interface PreparedUploadInput {
  /** 目标 input。 */
  readonly input: UploadInputTarget
  /** 还原到准备之前的状态（幂等）。 */
  readonly dispose: () => void
}

/**
 * 让目标 input 可被 CDP 寻址，同时不改变页面观感。
 *
 * @param input - 应用请求打开选择器的那一枚 input。
 * @param id - 便于在快照里定位的临时 id。
 * @returns 目标与还原函数。
 */
export function prepareUploadInput(input: UploadInputTarget, id = 'dsh-upload-target'): PreparedUploadInput {
  const saved: Array<[string, string, string]> = []
  for (const [prop, value] of Object.entries(STEALTH_STYLE)) {
    const previous = input.style.getPropertyValue(prop)
    const priority = input.style.getPropertyPriority(prop)
    saved.push([prop, previous, priority])
    input.style.setProperty(prop, value, 'important')
  }
  const previousId = input.id
  input.id = id
  const hadLabel = input.hasAttribute('aria-label')
  const previousLabel = input.getAttribute('aria-label')
  input.setAttribute('aria-label', id)

  let disposed = false
  const dispose = (): void => {
    if (disposed) return
    disposed = true
    for (const [prop, value, priority] of saved) {
      if (value === '') input.style.removeProperty(prop)
      else input.style.setProperty(prop, value, priority)
    }
    if (previousId === '') input.removeAttribute('id')
    else input.id = previousId
    if (hadLabel) {
      if (previousLabel !== null) input.setAttribute('aria-label', previousLabel)
    } else {
      input.removeAttribute('aria-label')
    }
  }

  return { input, dispose }
}
