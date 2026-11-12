/**
 * 往页面里的 `<input type="file">` 注入文件（纯页面内 JS）。
 *
 * ## 用法前提（否则注入了也不生效）
 *
 * 1. 先断掉 `input.click()`——元素级 + `MutationObserver` 跟随新节点。
 *    它同时解决两件事：不弹系统文件窗口；避免 `upload_file` 作用于
 *    「会打开选择器的元素」时崩标签页（`RESULT_CODE_KILLED_BAD_MESSAGE`）。
 * 2. 必须点一次「从电脑上传」——应用要靠那一步才挂上 `change` 处理器。
 *    点它会卸载对话框，重开后再注入。
 * 3. 目标若在 `display:none` 容器里，只放开它自己的容器，并把同容器里的
 *    目录 input 单独藏掉（两枚在同一个容器里，会一起露出来）。
 *
 * ## 不要做的事
 *
 * - **不要改 `HTMLInputElement.prototype.click`**：全局劫持，补丁没恢复时
 *   fnOS 自身逻辑静默失效、页面跳回 `/login`。
 * - **不要 `appendChild` 到 `body`**：应用依赖事件委托，换位置会失配。
 */


/**
 * 注入所需的最小节点形状。
 *
 * 这个包的编译目标没有 DOM lib（它整体面向 Node），而本模块的代码是**注入到
 * 页面里执行**的，所以用结构类型描述真正用到的那几个成员。
 */
export interface FileInputTarget {
  files: { length: number } | null
  dispatchEvent: (event: unknown) => boolean
  hasAttribute: (name: string) => boolean
  getAttribute: (name: string) => string | null
  getBoundingClientRect?: () => { width: number }
}

/** 页面里 `document` 的最小查询面。 */
interface DocumentLike {
  querySelectorAll: (selector: string) => readonly FileInputTarget[]
}

/**
 * 按 `accept` 找到「从电脑上传」那枚 input。
 *
 * 排除 `webkitdirectory`：页面里同时有一个目录选择器，注错地方会让应用收到
 * 一个它不认识的目录选择结果。
 *
 * @param accept - 期望的扩展名，例如 `.fpk`；省略时不按 `accept` 过滤。
 * @returns 找到的 input，或 `null`。
 */
export function findUploadInput(accept?: string): FileInputTarget | null {
  const doc = (globalThis as unknown as { document?: DocumentLike }).document
  if (doc === undefined) return null
  const acceptAttr = accept?.toLowerCase()
  return [...doc.querySelectorAll('input[type="file"]')]
    .filter(el => !el.hasAttribute('webkitdirectory'))
    .find((el) => {
      if (acceptAttr === undefined) return true
      const attr = (el.getAttribute('accept') ?? '').toLowerCase()
      return attr === '' || attr.split(',').some((part: string) => part.trim() === acceptAttr)
    }) ?? null
}

/**
 * 把已构造好的 `File` 放进 input 并派发「用户选了文件」的事件序列。
 *
 * 事件序列是**实测必需**的：只派发 `input` / `change` 时 fnOS 收不到文件
 * （不弹安全提示、`input.files` 也不会被清空）；补上 pointer 与 click 之后才
 * 走通——应用在 `change` 之外还靠指针事件判定「这次是用户选的」。
 *
 * @param input - 目标 input。
 * @param file - 要注入的文件。
 * @param win - 提供 `DataTransfer` / 事件构造器与 `File` 的全局对象，默认 `globalThis`。
 * @returns 注入的字节数。
 */
export function assignFileToInput(
  input: FileInputTarget,
  file: unknown,
  win: {
    DataTransfer: new () => { items: { add: (file: unknown) => void }, files: { length: number } }
    PointerEvent: new (type: string, init?: { bubbles?: boolean }) => unknown
    MouseEvent: new (type: string, init?: { bubbles?: boolean }) => unknown
    Event: new (type: string, init?: { bubbles?: boolean }) => unknown
  } = globalThis as never,
): number {
  const transfer = new win.DataTransfer()
  transfer.items.add(file)
  input.files = transfer.files

  const size = (file as { size?: number }).size ?? 0
  input.dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true }))
  input.dispatchEvent(new win.PointerEvent('pointerup', { bubbles: true }))
  input.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
  input.dispatchEvent(new win.Event('input', { bubbles: true }))
  input.dispatchEvent(new win.Event('change', { bubbles: true }))
  return size
}

/** 注入结果。 */
export interface UploadInjectionResult {
  /** 是否成功找到 input 并赋值。 */
  readonly injected: boolean
  /** 注入的字节数。 */
  readonly bytes: number
  /** 文件名。 */
  readonly fileName: string
  /** 注入后 input 里还剩几个文件：`0` 表示应用已接管并清空，属正常现象。 */
  readonly filesAfter: number
  /** 目标元素当时是否可见——**不影响注入能力**，仅作记录。 */
  readonly visible: boolean
}

/**
 * 一次性完成「按 accept 找 input → 构造 File → 赋值并派发事件」。
 *
 * 参数全部以 base64 / 字符串传入，便于整个调用被序列化后注入页面执行。
 *
 * @param base64 - 文件内容的 base64。
 * @param fileName - 文件名（含扩展名）。
 * @param accept - 期望的扩展名过滤，例如 `.fpk`。
 * @returns 注入结果。
 */
export function injectUpload(base64: string, fileName: string, accept = '.fpk'): UploadInjectionResult {
  const empty = { injected: false, bytes: 0, fileName, filesAfter: -1, visible: false }
  const input = findUploadInput(accept)
  if (input === null) return empty

  const bin = atob(base64)
  const buffer = new Uint8Array(bin.length)
  for (let index = 0; index < bin.length; index += 1) buffer[index] = bin.charCodeAt(index)
  const FileCtor = (globalThis as unknown as {
    File: new (parts: Uint8Array[], name: string, init: { type: string }) => unknown
  }).File
  const file = new FileCtor([buffer], fileName, { type: 'application/octet-stream' })

  const bytes = assignFileToInput(input, file)
  return {
    injected: true,
    bytes,
    fileName,
    filesAfter: input.files === null ? -1 : input.files.length,
    visible: (input.getBoundingClientRect?.().width ?? 0) > 0,
  }
}
