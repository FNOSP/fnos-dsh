import { describe, expect, it } from 'vitest'
import {
  detectShortcutPlatform,
  fnosSettingsAriaKeys,
  fnosSettingsShortcutKeys,
} from '../../src/client/shortcuts/fnos-settings-shortcut.ts'

/**
 * 「飞牛 OS 设置」的快捷键：`Cmd/Ctrl + ,`。
 *
 * 这个组合的归属在本次调整后变了：
 *
 * | 组合 | 归谁 |
 * | --- | --- |
 * | `Cmd/Ctrl + ,` | 本插件 → 飞牛设置弹框 |
 * | `Cmd/Ctrl + Alt + ,` | DSH 官方 → DSH 设置面板 |
 *
 * 提示要显示用户**按得到**的修饰键，所以平台判断必须可靠——写死一个，
 * 另一半用户照着按没反应，而界面上还理直气壮地显示着那个键。
 */

describe('飞牛设置快捷键：平台判断', () => {
  it('userAgentData 优先（Chromium）', () => {
    expect(detectShortcutPlatform({ userAgentData: { platform: 'macOS' }, platform: 'Win32' })).toBe('mac')
    expect(detectShortcutPlatform({ userAgentData: { platform: 'Windows' }, platform: 'MacIntel' })).toBe('other')
  })

  it('没有 userAgentData 时退到 platform', () => {
    expect(detectShortcutPlatform({ platform: 'MacIntel', userAgent: 'Windows NT' })).toBe('mac')
    expect(detectShortcutPlatform({ platform: 'Linux x86_64' })).toBe('other')
  })

  it('再退到 userAgent 字符串', () => {
    expect(detectShortcutPlatform({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' })).toBe('mac')
    expect(detectShortcutPlatform({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })).toBe('other')
  })

  it('什么都拿不到时按非 mac 处理', () => {
    // 宁可显示 `Ctrl`：非 mac 用户里多数是 Windows/Linux，
    // 而 mac 用户看到错提示的概率与前者相同——但 mac 的 ⌘ 更特殊，猜错代价更高。
    expect(detectShortcutPlatform({})).toBe('other')
  })

  it('空字符串字段被跳过而不是误命中', () => {
    // 空串不能当成「匹配到 mac」，否则会显示一个按不到的 ⌘。
    expect(detectShortcutPlatform({ userAgentData: { platform: '' }, platform: '' })).toBe('other')
  })
})

describe('飞牛设置快捷键：键帽与无障碍', () => {
  it('mac 显示 ⌘,，其余显示 Ctrl,', () => {
    expect(fnosSettingsShortcutKeys('mac')).toEqual(['⌘', ','])
    expect(fnosSettingsShortcutKeys('other')).toEqual(['Ctrl', ','])
  })

  it('aria-keyshortcuts 用规范写法', () => {
    // 读屏与浏览器据此发现命令；必须用 `Meta` / `Control` 而不是符号。
    expect(fnosSettingsAriaKeys('mac')).toBe('Meta+,')
    expect(fnosSettingsAriaKeys('other')).toBe('Control+,')
  })
})
