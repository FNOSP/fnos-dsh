import { afterEach, describe, expect, it, vi } from 'vitest'
import { assignFileToInput, findUploadInput, injectUpload } from '../src/upload-input.ts'

/**
 * 往 `input[type=file]` 注入文件。
 *
 * 这一组的核心断言是：**不需要元素可见**。`input.files` 是普通属性赋值，
 * 与无障碍树无关；早前为了「让 CDP `upload_file` 取到 uid」而去改祖先
 * `display`、挪 DOM、拦 `click`，全部多余，而且造成过页面污染。
 */

/** 造一枚假的 file input。 */
function fakeInput(options: { accept?: string, directory?: boolean, visible?: boolean } = {}) {
  const dispatched: string[] = []
  return {
    dispatched,
    files: null as { length: number } | null,
    hasAttribute: (name: string) => name === 'webkitdirectory' && options.directory === true,
    getAttribute: (name: string) => (name === 'accept' ? (options.accept ?? '') : null),
    dispatchEvent: (event: unknown) => {
      dispatched.push((event as { type?: string }).type ?? '?')
      return true
    },
    getBoundingClientRect: () => ({ width: options.visible === false ? 0 : 100 }),
  }
}

/** 页面里的 `document` 与事件构造器替身。 */
function stubDocument(inputs: ReturnType<typeof fakeInput>[]) {
  const listeners: string[] = []
  class FakeEvent {
    type: string
    constructor(type: string) { this.type = type; listeners.push(type) }
  }
  class FakeDataTransfer {
    items = { add: (_file: unknown) => { /* noop */ } }
    files = { length: 1 }
  }
  class FakeFile {
    size = 123
    constructor(_parts: unknown[], public name: string, _init: unknown) {}
  }
  vi.stubGlobal('document', { querySelectorAll: () => inputs })
  vi.stubGlobal('DataTransfer', FakeDataTransfer)
  vi.stubGlobal('File', FakeFile)
  vi.stubGlobal('PointerEvent', FakeEvent)
  vi.stubGlobal('MouseEvent', FakeEvent)
  vi.stubGlobal('Event', FakeEvent)
  vi.stubGlobal('atob', (value: string) => Buffer.from(value, 'base64').toString('binary'))
  return { listeners }
}

afterEach(() => { vi.unstubAllGlobals() })

describe('findUploadInput', () => {
  it('按 accept 匹配，并排除目录 input', () => {
    const dir = fakeInput({ accept: '.fpk', directory: true })
    const file = fakeInput({ accept: '.fpk' })
    stubDocument([dir, file])
    expect(findUploadInput('.fpk')).toBe(file)
  })

  it('没有匹配时返回 null', () => {
    stubDocument([fakeInput({ accept: '.png' })])
    expect(findUploadInput('.fpk')).toBeNull()
  })

  it('没有 document 时安全返回 null（Node 侧调用）', () => {
    vi.stubGlobal('document', undefined)
    expect(findUploadInput('.fpk')).toBeNull()
  })
})

describe('assignFileToInput', () => {
  it('赋值并派发完整事件序列', () => {
    const input = fakeInput()
    stubDocument([input])
    assignFileToInput(input, { size: 456 })
    // 只派发 input/change 时 fnOS 不消费；指针事件是必需的。
    expect(input.dispatched).toEqual(['pointerdown', 'pointerup', 'click', 'input', 'change'])
    expect(input.files?.length).toBe(1)
  })
})

describe('injectUpload', () => {
  it('元素不可见也照样注入成功', () => {
    /*
      这是本组最重要的一条：早前以为「必须让元素可见才能注入」，于是去改祖先
      `display`，反而把同容器里的目录 input 一起放了出来。
    */
    const hidden = fakeInput({ accept: '.fpk', visible: false })
    stubDocument([hidden])
    const result = injectUpload(Buffer.from('hello').toString('base64'), 'a.fpk', '.fpk')
    expect(result.injected).toBe(true)
    expect(result.fileName).toBe('a.fpk')
    expect(result.visible).toBe(false)
    expect(hidden.dispatched).toContain('change')
  })

  it('找不到 input 时返回未注入而不是抛错', () => {
    stubDocument([])
    const result = injectUpload('AAAA', 'a.fpk', '.fpk')
    expect(result.injected).toBe(false)
    expect(result.filesAfter).toBe(-1)
  })
})
