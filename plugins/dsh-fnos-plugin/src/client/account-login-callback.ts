/**
 * 账号登录回调地址的解析（纯函数，不依赖 DOM 与组件）。
 *
 * 单独成模块的原因：`FnosAccountLoginDialog` 一 import 就会拉起 Semi 的组件
 * 与图标，测试环境解析不了；而这里只是字符串处理，可以独立断言。
 *
 * @module dsh-fnos/account-login-callback
 */

/**
 * 从用户粘贴的内容里取出 `code` / `state`。
 *
 * 三种形态都要接——用户实际复制到什么就粘什么，不该要求他手工截取参数：
 *
 * - 整条回调地址：`http://127.0.0.1:3080/oauth/callback?code=…&state=…`
 * - 裸查询串：`?code=…&state=…`
 * - 只有参数：`code=…&state=…`
 *
 * @param raw - 用户粘贴的文本。
 * @returns 解析结果；缺任一项时为 undefined。
 */
export function parseCallbackInput(raw: string): { code: string, state: string } | undefined {
  const text = raw.trim()
  if (text === '') return undefined
  let url: URL
  try {
    url = new URL(text)
  } catch {
    // 不是完整地址：补一个 `?` 与一个占位 origin 再试。
    try {
      url = new URL(text.startsWith('?') ? text : `?${text}`, 'http://127.0.0.1')
    } catch {
      return undefined
    }
  }
  const code = url.searchParams.get('code') ?? ''
  const state = url.searchParams.get('state') ?? ''
  return code === '' || state === '' ? undefined : { code, state }
}
