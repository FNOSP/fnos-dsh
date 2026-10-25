/**
 * 账号卡片里 API Key 兜底入口的可见性判断。
 *
 * 单独放在服务层是为了让这条规则可以被单测覆盖：组件文件是 `.tsx`，测试按仓库
 * 惯例只读取源码文本、不直接 import，纯函数放这里才能被断言。
 *
 * @module dsh-opencode/client/account-entry
 */

/** 账号卡片对外可观察的状态。 */
export type AccountEntryStatus = 'loading' | 'signed-out' | 'signing-in' | 'signed-in' | 'error'

/**
 * API Key 兜底登录入口是否可见。
 *
 * 只在「未登录、且不在授权中」时提供：授权进行中再摆一条别的登录路径，会让人
 * 以为设备码流程卡住了；已登录与状态未知时同样不显示。
 *
 * @param status - 账号卡片的状态。
 * @returns 可见时为 true。
 */
export function apiKeyEntryVisible(status: AccountEntryStatus): boolean {
  return status !== 'signed-in' && status !== 'signing-in' && status !== 'loading'
}
