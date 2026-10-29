import { describe, expect, it } from 'vitest'
import { isSettingsShortcut } from '../../src/client/shortcuts/settings-shortcut-matcher.ts'

/**
 * 官方「打开设置」快捷键的识别。
 *
 * 该快捷键在 DSH 里有两套默认绑定：
 *
 * | 运行时 | 绑定 |
 * | --- | --- |
 * | desktop:macos | `Meta + Comma` |
 * | desktop:windows/linux | `Control + Comma` |
 * | web:* | `primary + Alt + Comma` |
 *
 * fnOS 应用跑在 iframe 里（运行时为 Web），但用户在浏览器里按 `Ctrl/Cmd + ,`
 * 会被浏览器当成自己的「设置」先吃掉。所以要同时认这两种形态，才能抢在浏览器
 * 之前 `preventDefault`。
 */

type EventShape = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>

const make = (patch: Partial<EventShape>): EventShape => ({
  key: ',',
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...patch,
})

describe('FNOS-012 设置快捷键识别', () => {
  it.each([
    ['Windows/Linux 的 Ctrl + ,', { ctrlKey: true }],
    ['macOS 的 Cmd + ,', { metaKey: true }],
    ['Web 的 Ctrl + Alt + ,', { ctrlKey: true, altKey: true }],
    ['Web 的 Cmd + Alt + ,', { metaKey: true, altKey: true }],
  ])('识别 %s', (_label, patch) => {
    expect(isSettingsShortcut(make(patch))).toBe(true)
  })

  it('不把单独的逗号当快捷键', () => {
    expect(isSettingsShortcut(make({}))).toBe(false)
  })

  it('不抢 Ctrl/Cmd + Shift + ,（那是 DSH 的另一个命令）', () => {
    expect(isSettingsShortcut(make({ ctrlKey: true, shiftKey: true }))).toBe(false)
    expect(isSettingsShortcut(make({ metaKey: true, shiftKey: true }))).toBe(false)
  })

  it('只认逗号键，不误伤同修饰键的其它键', () => {
    expect(isSettingsShortcut(make({ ctrlKey: true, key: 'k' }))).toBe(false)
    expect(isSettingsShortcut(make({ ctrlKey: true, key: '.' }))).toBe(false)
  })
})
