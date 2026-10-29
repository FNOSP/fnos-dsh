/**
 * 识别官方「打开设置」的组合键。
 *
 * 与安装逻辑分开：安装需要 React 与 Semi 的 HotKeys（含浏览器专属 API），
 * 而「哪些组合算设置键」是纯判断，独立成文件才能在 Node 环境直接测。
 *
 * 官方 `settings.open` 的默认绑定：
 *
 * | 运行时 | 绑定 |
 * | --- | --- |
 * | desktop:macos | `Meta + Comma` |
 * | desktop:windows/linux | `Control + Comma` |
 * | web:* | `primary + Alt + Comma` |
 *
 * fnOS 应用跑在 iframe 里（运行时为 Web），但用户在浏览器里按 `Ctrl/Cmd + ,`
 * 会先被浏览器当成自身的「设置」吃掉，因此带不带 `alt` 两种形态都要认——不认
 * 带 `alt` 的那种，它同样会被浏览器吞掉。
 *
 * 注意：识别范围是「带不带 `alt` 都算」，但**补发时统一补上 `alt`**，因为 Web
 * 那组默认绑定要求 `primary + alt + Comma`。详见 `settings-shortcut.ts`。
 */
export function isSettingsShortcut(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>,
): boolean {
  if (event.key !== ',') return false
  // 带 Shift 的是 DSH 的另一个命令，不能抢。
  if (event.shiftKey) return false
  return event.ctrlKey || event.metaKey
}
